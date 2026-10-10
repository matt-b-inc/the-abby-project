using System;
using System.IO;
using System.Linq;
using AbbyCamp.Presentation;
using AbbyCamp.UI;
using AbbyCamp.World;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace AbbyCamp.Editor
{
    /// <summary>Reproducible meadow. Rebuilding preserves authored presentation references.</summary>
    public static class CampSceneBuilder
    {
        public const string ScenePath = "Assets/AbbyCamp/Scenes/Camp.unity";
        private const string GeneratedPath = "Assets/AbbyCamp/Generated";
        public const string PresentationPath = "Assets/AbbyCamp/Presentation/Meadow.asset";
        private static CampPresentationDefinition presentation;
        private const string NaturePath = "Assets/ThirdParty/Kenney/NatureKit/Models/";
        private static Material grass, darkGrass, path, wood, darkWood, paper, turquoise, orange, stone, rewardSparkles;

        [MenuItem("Abby Camp/Create or rebuild camp")]
        public static void Build()
        {
            Directory.CreateDirectory("Assets/AbbyCamp/Scenes");
            Directory.CreateDirectory(GeneratedPath);
            AssetDatabase.Refresh();
            ConfigureKenneyImports();
            ConfigureStorybookImports();
            presentation = LoadPresentation();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            MakeMaterials();
            BuildCameraAndLighting();
            BuildGround();
            BuildScenery();
            var playerAppearance = presentation.PlayerAppearance;
            var dogAppearance = presentation.CompanionAppearance;
            var foxAppearance = presentation.AlternateCompanionAppearance;
            var player = BuildPlayer(playerAppearance);
            var companion = BuildCompanion(player, dogAppearance, foxAppearance);
            var board = BuildBoard(player);
            var session = new GameObject("CampSession").AddComponent<CampPrototypeController>();
            session.Configure(player, companion, board, presentation);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("ABBY_CAMP_BUILD_OK: saved " + ScenePath);
        }

        [MenuItem("Abby Camp/Validate prototype")]
        public static void Validate()
        {
            if (SceneManager.GetActiveScene().path != ScenePath)
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var player = UnityEngine.Object.FindFirstObjectByType<CampPlayerController>();
            var companion = UnityEngine.Object.FindFirstObjectByType<CompanionFollower>();
            var board = UnityEngine.Object.FindFirstObjectByType<CampTaskBoard>();
            Require(player != null && companion != null && board != null, "Missing gameplay actors.");
            Require(UnityEngine.Object.FindFirstObjectByType<CampPrototypeController>() != null, "Missing session UI.");
            var authored = AssetDatabase.LoadAssetAtPath<CampPresentationDefinition>(PresentationPath);
            Require(authored != null && player.Appearance.Definition == authored.PlayerAppearance && companion.PrimaryAppearance == authored.CompanionAppearance,
                "Scene does not use its authored presentation references.");
            Require(authored.UiFont != null, "The shared Nunito UI font is missing.");
            ValidateSharedPalette(authored);
            Require(Camera.main != null && Camera.main.orthographic, "Missing fixed isometric camera.");
            Require(player.GetComponent<CharacterController>() != null && companion.GetComponent<CharacterController>() != null, "Movement requires root controllers.");
            Physics.SyncTransforms();
            var walkingSurface = GameObject.Find("Meadow walking surface")?.GetComponent<BoxCollider>();
            Require(walkingSurface != null && Mathf.Abs(walkingSurface.bounds.max.y) < .02f,
                "Meadow physics must use a flat ground surface rather than a scaled capsule.");
            Require(walkingSurface.bounds.Contains(new Vector3(player.transform.position.x, -.01f, player.transform.position.z))
                && walkingSurface.bounds.Contains(new Vector3(companion.transform.position.x, -.01f, companion.transform.position.z)),
                "Player and companion must start above the flat walking surface.");
            Require(board.IsInRange, "Player must start in reach of task board.");
            Require(companion.PrimaryAppearance != null && companion.SecondaryAppearance != null, "Companion needs two swappable appearances.");
            var originalDefinition = companion.Appearance.Definition;
            var beforePosition = companion.transform.position;
            var beforeRotation = companion.transform.rotation;
            var beforeScale = companion.transform.localScale;
            var identity = companion.GetComponent<CampEntityIdentity>();
            var originalId = identity.ContentId;
            companion.ApplyAppearance(companion.SecondaryAppearance);
            Require(companion.Appearance.Definition == companion.SecondaryAppearance, "Appearance switch did not apply.");
            Require(companion.transform.position == beforePosition && companion.transform.rotation == beforeRotation && companion.transform.localScale == beforeScale, "Appearance switch moved gameplay root.");
            Require(identity.ContentId == originalId && companion.GetComponent<CharacterController>().enabled, "Appearance switch changed identity or movement.");
            companion.ApplyAppearance(originalDefinition);
            var appearances = new[] { player.Appearance.Definition, companion.PrimaryAppearance, companion.SecondaryAppearance };
            foreach (var definition in appearances)
            {
                Require(definition != null && (definition.ModelPrefab != null || definition.Portrait != null), "Missing model or portrait for an appearance.");
                // A static sprite/model is valid: VisualPresenter supplies local feedback.
                // An imported animation controller is optional, never a condition on identity.
            }
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            EditorSceneManager.SaveScene(SceneManager.GetActiveScene());
            Debug.Log("ABBY_CAMP_VALIDATE_OK: actors, interaction, authored presentation, and appearance swap preserve gameplay identity and transforms.");
        }

        private static CampPresentationDefinition LoadPresentation()
        {
            Directory.CreateDirectory("Assets/AbbyCamp/Presentation");
            var settings = AssetDatabase.LoadAssetAtPath<CampPresentationDefinition>(PresentationPath);
            if (settings == null)
            {
                settings = ScriptableObject.CreateInstance<CampPresentationDefinition>();
                AssetDatabase.CreateAsset(settings, PresentationPath);
            }
            // Seed only missing references. Rebuilds never replace an authored dragon/model.
            if (settings.PlayerAppearance == null)
                settings.PlayerAppearance = CreateDefinition("camper-green", "Assets/ThirdParty/Kenney/BlockyCharacters/Models/character-f.fbx", 1.5f, "emote-yes", settings.Primary);
            if (settings.CompanionAppearance == null)
                settings.CompanionAppearance = CreateDragonDefinition(settings.Accent);
            if (settings.AlternateCompanionAppearance == null)
                settings.AlternateCompanionAppearance = CreateDefinition("companion-fox", "Assets/ThirdParty/Kenney/CubePets/Models/animal-fox.fbx", .8f, "dance", settings.Accent);
            if (settings.MemoryBloom == null)
                settings.MemoryBloom = AssetDatabase.LoadAssetAtPath<Sprite>("Assets/AbbyCamp/Art/Shared/memory-bloom.png");
            if (settings.UiFont == null)
                settings.UiFont = AssetDatabase.LoadAssetAtPath<Font>("Assets/AbbyCamp/Art/Shared/Nunito-SemiBold.ttf");
            EditorUtility.SetDirty(settings);
            return settings;
        }

        private static VisualDefinition CreateDragonDefinition(Color fallback)
        {
            const string location = "Assets/AbbyCamp/Presentation/meadow-dragon.asset";
            var existing = AssetDatabase.LoadAssetAtPath<VisualDefinition>(location);
            if (existing != null) return existing;
            var definition = ScriptableObject.CreateInstance<VisualDefinition>();
            definition.AppearanceId = "meadow-dragon";
            definition.PlaceholderColor = fallback;
            definition.Portrait = AssetDatabase.LoadAssetAtPath<Sprite>("Assets/AbbyCamp/Art/Shared/dragon-idle.png");
            definition.HappyPortrait = AssetDatabase.LoadAssetAtPath<Sprite>("Assets/AbbyCamp/Art/Shared/dragon-happy.png");
            definition.BlinkPortrait = AssetDatabase.LoadAssetAtPath<Sprite>("Assets/AbbyCamp/Art/Shared/dragon-blink.png");
            definition.PortraitHeight = 1.9f;
            AssetDatabase.CreateAsset(definition, location);
            return definition;
        }

        private static void ConfigureStorybookImports()
        {
            foreach (var filename in new[] { "dragon-idle.png", "dragon-happy.png", "dragon-blink.png", "memory-bloom.png" })
            {
                var importer = AssetImporter.GetAtPath("Assets/AbbyCamp/Art/Shared/" + filename) as TextureImporter;
                if (importer == null) continue;
                importer.textureType = TextureImporterType.Sprite;
                importer.spriteImportMode = SpriteImportMode.Single;
                importer.spritePixelsPerUnit = 100;
                importer.alphaIsTransparency = true;
                importer.mipmapEnabled = false;
                importer.wrapMode = TextureWrapMode.Clamp;
                importer.maxTextureSize = 1024;
                importer.SaveAndReimport();
            }
        }

        [Serializable] private sealed class SharedManifest { public int schema_version; public SharedPalette palette; }
        [Serializable] private sealed class SharedPalette
        {
            public string paper, ink, primary, grass, accent, sky, gold;
        }

        private static void ValidateSharedPalette(CampPresentationDefinition settings)
        {
            var source = Resources.Load<TextAsset>("StorybookPresentation");
            Require(source != null, "Shared storybook presentation manifest is missing.");
            var manifest = JsonUtility.FromJson<SharedManifest>(source.text);
            Require(manifest != null && manifest.schema_version == 1 && manifest.palette != null, "Unsupported shared presentation schema.");
            void Match(Color actual, string expected, string label)
            {
                Require(ColorUtility.TryParseHtmlString(expected, out var canonical), "Missing shared " + label + " color.");
                Require(Mathf.Abs(actual.r - canonical.r) < .00001f && Mathf.Abs(actual.g - canonical.g) < .00001f && Mathf.Abs(actual.b - canonical.b) < .00001f,
                    "World " + label + " differs from the shared web presentation manifest.");
            }
            Match(settings.Paper, manifest.palette.paper, "paper");
            Match(settings.Ink, manifest.palette.ink, "ink");
            Match(settings.Primary, manifest.palette.primary, "primary");
            Match(settings.Grass, manifest.palette.grass, "grass");
            Match(settings.Accent, manifest.palette.accent, "accent");
            Match(settings.Sky, manifest.palette.sky, "sky");
            Match(settings.Path, manifest.palette.gold, "gold");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static void MakeMaterials()
        {
            grass = MakeMaterial("Grass", presentation.Grass);
            darkGrass = MakeMaterial("Raised meadow", presentation.GrassEdge);
            path = MakeMaterial("Sandstone path", presentation.Path);
            wood = MakeMaterial("Warm cedar", new Color(.68f, .52f, .39f));
            darkWood = MakeMaterial("Deep cedar", new Color(.48f, .38f, .32f));
            paper = MakeMaterial("Task paper", presentation.Paper);
            turquoise = MakeMaterial("Camp teal", presentation.Primary);
            orange = MakeMaterial("Camp gold", presentation.Accent);
            stone = MakeMaterial("Slate stones", new Color(.72f, .77f, .75f));
            rewardSparkles = MakeMaterial("Reward sparkles", presentation.Path);
            var particleShader = Shader.Find("Universal Render Pipeline/Particles/Unlit");
            if (particleShader != null) rewardSparkles.shader = particleShader;
            EditorUtility.SetDirty(rewardSparkles);
        }

        private static void ConfigureKenneyImports()
        {
            var modelPaths = AssetDatabase.FindAssets("t:Model", new[] { "Assets/ThirdParty/Kenney" }).Select(AssetDatabase.GUIDToAssetPath).ToArray();
            foreach (var modelPath in modelPaths)
            {
                var importer = AssetImporter.GetAtPath(modelPath) as ModelImporter;
                if (importer == null) continue;
                var isAnimated = modelPath.Contains("BlockyCharacters") || modelPath.Contains("CubePets");
                if (isAnimated)
                {
                    importer.animationType = ModelImporterAnimationType.Generic;
                    importer.importAnimation = true;
                    importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                    var clips = importer.defaultClipAnimations;
                    foreach (var clip in clips)
                    {
                        var clipName = clip.name.ToLowerInvariant().Split('|').Last();
                        clip.loopTime = clipName == "idle" || clipName == "walk" || clipName == "run" || clipName == "sprint";
                    }
                    importer.clipAnimations = clips;
                    importer.SaveAndReimport();
                }
                // The packs use standard FBX materials; remap each named material individually to URP.
                // Nature keeps its distinct submesh colors, while characters/pets retain supplied textures.
                var sourceMaterials = AssetDatabase.LoadAllAssetsAtPath(modelPath).OfType<Material>().ToArray();
                foreach (var source in sourceMaterials)
                {
                    var pack = modelPath.Contains("NatureKit") ? "nature" : modelPath.Contains("CubePets") ? "pets" : "character";
                    var safeName = string.Concat(source.name.Select(character => char.IsLetterOrDigit(character) || character == '-' || character == '_' ? character : '_'));
                    var materialPath = GeneratedPath + "/kenney-" + pack + "-" + safeName + ".mat";
                    var material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
                    if (material == null)
                    {
                        material = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
                        AssetDatabase.CreateAsset(material, materialPath);
                    }
                    material.color = source.HasProperty("_Color") ? source.color : Color.white;
                    var sourceTexture = source.mainTexture;
                    if (sourceTexture == null && pack == "pets")
                        sourceTexture = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/ThirdParty/Kenney/CubePets/Models/Textures/colormap.png");
                    if (sourceTexture == null && pack == "character")
                    {
                        var textureName = Path.GetFileNameWithoutExtension(modelPath).Replace("character-", "texture-");
                        sourceTexture = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/ThirdParty/Kenney/BlockyCharacters/Models/Textures/" + textureName + ".png");
                    }
                    material.mainTexture = sourceTexture;
                    if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", .12f);
                    EditorUtility.SetDirty(material);
                    importer.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material), source.name), material);
                }
                importer.SaveAndReimport();
            }
            // Already remapped FBX materials may no longer appear as imported subassets on a
            // later rebuild. Update their referenced generated assets explicitly as well.
            foreach (var guid in AssetDatabase.FindAssets("t:Material", new[] { GeneratedPath }))
            {
                var materialPath = AssetDatabase.GUIDToAssetPath(guid);
                var filename = Path.GetFileNameWithoutExtension(materialPath);
                const string prefix = "kenney-nature-";
                if (!filename.StartsWith(prefix, StringComparison.Ordinal)) continue;
                var material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
                material.color = NatureColor(filename.Substring(prefix.Length), material.color);
                if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", .08f);
                EditorUtility.SetDirty(material);
            }
        }

        private static Color NatureColor(string name, Color fallback)
        {
            // Unity handles the material color-space conversion for these display palette values.
            switch (name.ToLowerInvariant())
            {
                case "leafsgreen": return new Color(.36f, .49f, .34f);
                case "leafsdark": return new Color(.27f, .39f, .29f);
                case "grass": return new Color(.43f, .54f, .36f);
                case "dirt": return new Color(.52f, .40f, .28f);
                case "rock":
                case "_defaultmat": return new Color(.48f, .53f, .50f);
                case "wood": return new Color(.51f, .36f, .23f);
                case "wooddark": return new Color(.36f, .26f, .18f);
                case "woodbark": return new Color(.42f, .29f, .20f);
                case "woodbarkdark": return new Color(.32f, .23f, .17f);
                case "woodinner": return new Color(.66f, .51f, .33f);
                case "coloryellow": return new Color(.82f, .68f, .32f);
                case "colorred": return new Color(.69f, .39f, .29f);
                case "colorreddark": return new Color(.52f, .29f, .23f);
                default: return fallback;
            }
        }

        private static Material MakeMaterial(string name, Color color)
        {
            var location = GeneratedPath + "/" + name + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(location);
            if (material == null)
            {
                material = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
                AssetDatabase.CreateAsset(material, location);
            }
            material.color = color;
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", .12f);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void BuildCameraAndLighting()
        {
            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            cameraObject.transform.position = new Vector3(13.5f, 19f, -19f);
            cameraObject.transform.LookAt(new Vector3(0f, 0f, 1f));
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 10.6f;
            camera.nearClipPlane = .1f;
            camera.farClipPlane = 100f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = presentation.Sky;
            cameraObject.AddComponent<CampPhoneCamera>();
            cameraObject.AddComponent<AudioListener>();
            var sun = new GameObject("Late afternoon sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.transform.rotation = Quaternion.Euler(48f, -38f, 0f);
            sun.color = new Color(1f, .96f, .88f);
            sun.intensity = 1.15f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = .55f;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.76f, .78f, .75f);
            RenderSettings.ambientIntensity = 1f;
            RenderSettings.fog = false;
        }

        private static void BuildGround()
        {
            var environment = new GameObject("Meadow environment").transform;
            Shape("Soft meadow island", PrimitiveType.Cylinder, new Vector3(0f, -.3f, 0f), new Vector3(21f, .3f, 17f), grass, environment, false);
            // Unity's cylinder primitive has a CapsuleCollider. Flattening its
            // mesh keeps a large capsule radius and lifts actors into the sky.
            // A separate flat walking surface stays inside the visible disk.
            AddObstacle("Meadow walking surface", new Vector3(0f, -.3f, 0f), new Vector3(15.6f, .6f, 10.4f), environment);
            Shape("Meadow edge", PrimitiveType.Cylinder, new Vector3(0f, -.62f, 0f), new Vector3(20.9f, .12f, 16.9f), darkGrass, environment, false);
            Disc("Welcome clearing", new Vector3(-.7f, .011f, .7f), 3.8f, path, environment);
            for (var i = 0; i < 5; i++)
            {
                var t = i / 4f;
                Disc("Stepping stone " + (i + 1), Vector3.Lerp(new Vector3(1f, .022f, -5f), new Vector3(-3f, .022f, 2.5f), t), .58f, paper, environment);
            }
            // Simple perimeter belongs to gameplay and is independent of scenery artwork.
            Boundary("North boundary", new Vector3(0f, 1.5f, 5f), new Vector3(21f, 3f, .4f), environment);
            Boundary("South boundary", new Vector3(0f, 1.5f, -5f), new Vector3(21f, 3f, .4f), environment);
            Boundary("West boundary", new Vector3(-7.6f, 1.5f, 0f), new Vector3(.4f, 3f, 17f), environment);
            Boundary("East boundary", new Vector3(7.6f, 1.5f, 0f), new Vector3(.4f, 3f, 17f), environment);
        }

        private static void BuildScenery()
        {
            var scenery = new GameObject("Replaceable meadow scenery").transform;
            var treePositions = new[] { new Vector3(-6.8f, 0f, 3.8f), new Vector3(-5f, 0f, 5.5f), new Vector3(5.8f, 0f, 4.5f), new Vector3(7.2f, 0f, 1.7f), new Vector3(-7f, 0f, -3.5f) };
            for (var i = 0; i < treePositions.Length; i++)
            {
                var p = treePositions[i];
                Shape("Round tree trunk " + i, PrimitiveType.Cylinder, p + Vector3.up * .95f, new Vector3(.25f, .95f, .25f), wood, scenery, false);
                Shape("Round tree crown " + i, PrimitiveType.Sphere, p + Vector3.up * 2.15f, new Vector3(2.3f, 2.3f, 2.3f), i % 2 == 0 ? darkGrass : turquoise, scenery, false);
                Shape("Round tree tuft " + i, PrimitiveType.Sphere, p + new Vector3(.65f, 2.3f, .3f), new Vector3(1.45f, 1.65f, 1.45f), grass, scenery, false);
                AddObstacle("Tree collision " + i, p + Vector3.up * .6f, new Vector3(.4f, 1.2f, .4f), scenery);
            }
            for (var i = 0; i < 16; i++)
            {
                var angle = i * 2.399963f;
                var p = new Vector3(Mathf.Cos(angle) * (5f + i % 2), .12f, Mathf.Sin(angle) * 4.8f);
                Shape("Little meadow stone " + i, PrimitiveType.Sphere, p, new Vector3(.5f, .22f, .4f), stone, scenery, false);
                Flower("Meadow flower " + i, p + new Vector3(.5f, -.12f, .35f), i % 2 == 0 ? orange : paper, scenery);
            }
            Disc("Dragon resting patch", new Vector3(3.8f, .025f, .2f), 1.2f, darkGrass, scenery);
            Shape("Memory perch", PrimitiveType.Cylinder, new Vector3(4.8f, .3f, 1.7f), new Vector3(1f, .3f, 1f), wood, scenery, false);
            Flower("Memory bloom landmark", new Vector3(4.8f, .62f, 1.7f), orange, scenery, 2.2f);
            Label("MEMORY BLOOMS", new Vector3(4.8f, 1.8f, 1.5f), .05f, presentation.Ink, scenery);
        }

        private static void Flower(string name, Vector3 ground, Material petals, Transform parent, float size = 1f)
        {
            Shape(name + " stem", PrimitiveType.Cylinder, ground + Vector3.up * .2f * size, new Vector3(.04f, .2f, .04f) * size, darkGrass, parent, false);
            var centre = ground + Vector3.up * .4f * size;
            for (var petal = 0; petal < 5; petal++)
            {
                var angle = petal * Mathf.PI * 2f / 5f;
                Shape(name + " petal", PrimitiveType.Sphere, centre + new Vector3(Mathf.Cos(angle) * .12f, 0, Mathf.Sin(angle) * .12f) * size, new Vector3(.16f, .06f, .16f) * size, petals, parent, false);
            }
            Shape(name + " centre", PrimitiveType.Sphere, centre + Vector3.up * .02f * size, new Vector3(.11f, .075f, .11f) * size, path, parent, false);
        }
        private static CampPlayerController BuildPlayer(VisualDefinition definition)
        {
            var playerObject = new GameObject("Explorer");
            playerObject.transform.position = new Vector3(-3.5f, .08f, 1.3f);
            playerObject.transform.rotation = Quaternion.Euler(0f, 20f, 0f);
            playerObject.AddComponent<CampEntityIdentity>().Configure("player");
            var motor = playerObject.AddComponent<CharacterController>();
            motor.height = 1.7f;
            motor.radius = .32f;
            motor.center = new Vector3(0f, .85f, 0f);
            motor.stepOffset = .25f;
            motor.skinWidth = .04f;
            playerObject.AddComponent<VisualPresenter>().SetVisual(definition);
            playerObject.AddComponent<RewardReaction>().Configure(rewardSparkles);
            return playerObject.AddComponent<CampPlayerController>();
        }

        private static CompanionFollower BuildCompanion(CampPlayerController player, VisualDefinition first, VisualDefinition second)
        {
            var companionObject = new GameObject("Companion");
            companionObject.transform.position = new Vector3(-1.8f, .08f, -.1f);
            companionObject.transform.rotation = Quaternion.Euler(0f, -20f, 0f);
            companionObject.AddComponent<CampEntityIdentity>().Configure("starter-companion");
            var motor = companionObject.AddComponent<CharacterController>();
            motor.height = .7f;
            motor.radius = .24f;
            motor.center = new Vector3(0f, .36f, 0f);
            motor.stepOffset = .15f;
            motor.skinWidth = .03f;
            companionObject.AddComponent<VisualPresenter>().SetVisual(first);
            companionObject.AddComponent<RewardReaction>().Configure(rewardSparkles);
            var companion = companionObject.AddComponent<CompanionFollower>();
            companion.Configure(player.transform, first, second);
            return companion;
        }

        private static CampTaskBoard BuildBoard(CampPlayerController player)
        {
            var boardObject = new GameObject("Task Board");
            boardObject.transform.position = new Vector3(-4.5f, 0f, 3.8f);
            var parent = boardObject.transform;
            Shape("Board left post", PrimitiveType.Cube, new Vector3(-5.8f, 1.2f, 3.8f), new Vector3(.2f, 2.4f, .2f), darkWood, parent, true);
            Shape("Board right post", PrimitiveType.Cube, new Vector3(-3.2f, 1.2f, 3.8f), new Vector3(.2f, 2.4f, .2f), darkWood, parent, true);
            Shape("Task board panel", PrimitiveType.Cube, new Vector3(-4.5f, 1.65f, 3.8f), new Vector3(2.9f, 1.55f, .2f), wood, parent, true);
            Shape("Board header", PrimitiveType.Cube, new Vector3(-4.5f, 2.57f, 3.8f), new Vector3(3.2f, .45f, .3f), turquoise, parent, false);
            Label("TASK BOARD", new Vector3(-4.5f, 2.57f, 3.625f), .095f, Color.white, parent);
            for (var i = 0; i < 3; i++)
            {
                var x = -5.4f + i * .9f;
                Shape("Habit card " + (i + 1), PrimitiveType.Cube, new Vector3(x, 1.7f, 3.675f), new Vector3(.65f, .85f, .035f), paper, parent, false);
                Shape("Habit pin " + (i + 1), PrimitiveType.Sphere, new Vector3(x, 2.03f, 3.635f), Vector3.one * .09f, i == 1 ? turquoise : orange, parent, false);
                for (var line = 0; line < 3; line++)
                    Shape("Card line", PrimitiveType.Cube, new Vector3(x, 1.8f - line * .15f, 3.65f), new Vector3(.43f - line * .055f, .027f, .014f), wood, parent, false);
            }
            Disc("Task board welcome mat", new Vector3(-4.5f, .025f, 2.1f), 1.1f, paper, parent);
            var board = boardObject.AddComponent<CampTaskBoard>();
            board.Configure(player.transform);
            return board;
        }

        private static VisualDefinition CreateDefinition(string id, string modelPath, float targetHeight, string celebrationClip, Color fallback)
        {
            var definitionPath = GeneratedPath + "/" + id + ".asset";
            var definition = AssetDatabase.LoadAssetAtPath<VisualDefinition>(definitionPath);
            if (definition != null) return definition;
            definition = ScriptableObject.CreateInstance<VisualDefinition>();
            AssetDatabase.CreateAsset(definition, definitionPath);
            definition.AppearanceId = id;
            definition.ModelPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            definition.PlaceholderColor = fallback;
            definition.LocalEulerAngles = Vector3.zero;
            definition.LocalPosition = Vector3.zero;
            definition.LocalScale = Vector3.one;
            if (definition.ModelPrefab != null)
            {
                var temporary = UnityEngine.Object.Instantiate(definition.ModelPrefab);
                var bounds = GetBounds(temporary);
                var scale = targetHeight / Mathf.Max(.001f, bounds.size.y);
                definition.LocalScale = temporary.transform.localScale * scale;
                definition.LocalEulerAngles = temporary.transform.localEulerAngles;
                definition.LocalPosition = Vector3.up * (-bounds.min.y * scale);
                UnityEngine.Object.DestroyImmediate(temporary);
                definition.AnimatorController = CreateAnimator(id, modelPath, celebrationClip);
            }
            else Debug.LogWarning("Model unavailable; placeholder used: " + modelPath);
            EditorUtility.SetDirty(definition);
            return definition;
        }

        private static RuntimeAnimatorController CreateAnimator(string id, string modelPath, string celebrationClipName)
        {
            var clips = AssetDatabase.LoadAllAssetsAtPath(modelPath).OfType<AnimationClip>().Where(clip => !clip.name.StartsWith("__preview__", StringComparison.Ordinal)).ToArray();
            AnimationClip Find(string name) => clips.FirstOrDefault(clip => string.Equals(clip.name, name, StringComparison.OrdinalIgnoreCase) || clip.name.EndsWith("|" + name, StringComparison.OrdinalIgnoreCase));
            var idle = Find("idle");
            var walk = Find("walk");
            var celebrate = Find(celebrationClipName);
            if (idle == null || walk == null || celebrate == null)
            {
                Debug.LogWarning("Missing model animation mapping: " + id + " clips=" + string.Join(",", clips.Select(clip => clip.name)));
                return null;
            }
            var controllerPath = GeneratedPath + "/" + id + ".controller";
            AssetDatabase.DeleteAsset(controllerPath);
            var controller = AnimatorController.CreateAnimatorControllerAtPath(controllerPath);
            controller.AddParameter("Speed", AnimatorControllerParameterType.Float);
            controller.AddParameter("Celebrate", AnimatorControllerParameterType.Trigger);
            var machine = controller.layers[0].stateMachine;
            var idleState = machine.AddState("Idle");
            idleState.motion = idle;
            var walkState = machine.AddState("Walk");
            walkState.motion = walk;
            var celebrateState = machine.AddState("Celebrate");
            celebrateState.motion = celebrate;
            machine.defaultState = idleState;
            var walkTransition = idleState.AddTransition(walkState);
            walkTransition.hasExitTime = false;
            walkTransition.duration = .12f;
            walkTransition.AddCondition(AnimatorConditionMode.Greater, .08f, "Speed");
            var idleTransition = walkState.AddTransition(idleState);
            idleTransition.hasExitTime = false;
            idleTransition.duration = .12f;
            idleTransition.AddCondition(AnimatorConditionMode.Less, .08f, "Speed");
            var reaction = machine.AddAnyStateTransition(celebrateState);
            reaction.hasExitTime = false;
            reaction.duration = .1f;
            reaction.canTransitionToSelf = false;
            reaction.AddCondition(AnimatorConditionMode.If, 0f, "Celebrate");
            var reactionEnd = celebrateState.AddTransition(idleState);
            reactionEnd.hasExitTime = true;
            reactionEnd.exitTime = 1f;
            reactionEnd.duration = .12f;
            return controller;
        }

        private static GameObject PlaceImported(string filename, string name, Vector3 position, float height, float yaw, Transform parent)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(NaturePath + filename);
            if (prefab == null) return null;
            var instance = UnityEngine.Object.Instantiate(prefab);
            instance.name = name;
            instance.transform.SetParent(parent, true);
            instance.transform.position = Vector3.zero;
            instance.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            var bounds = GetBounds(instance);
            var scale = height / Mathf.Max(.001f, bounds.size.y);
            instance.transform.localScale *= scale;
            instance.transform.position = position - Vector3.up * bounds.min.y * scale;
            foreach (var collider in instance.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
            return instance;
        }

        private static Bounds GetBounds(GameObject instance)
        {
            var renderers = instance.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0) return new Bounds(Vector3.zero, Vector3.one);
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
            return bounds;
        }

        private static GameObject Shape(string name, PrimitiveType type, Vector3 position, Vector3 scale, Material material, Transform parent, bool collision)
        {
            var instance = GameObject.CreatePrimitive(type);
            instance.name = name;
            instance.transform.SetParent(parent, true);
            instance.transform.position = position;
            instance.transform.localScale = scale;
            instance.GetComponent<Renderer>().sharedMaterial = material;
            instance.GetComponent<Collider>().enabled = collision;
            return instance;
        }

        private static void Disc(string name, Vector3 position, float radius, Material material, Transform parent)
        {
            Shape(name, PrimitiveType.Cylinder, position, new Vector3(radius * 2f, .012f, radius * 2f), material, parent, false);
        }

        private static void Boundary(string name, Vector3 position, Vector3 scale, Transform parent)
        {
            AddObstacle(name, position, scale, parent);
        }

        private static void AddObstacle(string name, Vector3 position, Vector3 size, Transform parent)
        {
            var instance = new GameObject(name);
            instance.transform.SetParent(parent, true);
            instance.transform.position = position;
            instance.AddComponent<BoxCollider>().size = size;
        }

        private static void Label(string text, Vector3 position, float characterSize, Color color, Transform parent)
        {
            var label = new GameObject(text).AddComponent<TextMesh>();
            label.transform.SetParent(parent, true);
            label.transform.position = position;
            label.text = text;
            label.font = presentation.UiFont != null ? presentation.UiFont : Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            label.fontSize = 48;
            label.characterSize = characterSize;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.color = color;
            label.GetComponent<MeshRenderer>().sharedMaterial = label.font.material;
        }
    }
}
