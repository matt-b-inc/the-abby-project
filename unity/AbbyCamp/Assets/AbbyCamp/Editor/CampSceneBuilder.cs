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
    /// <summary>Reproducible first camp. Rebuilding replaces the generated scene and its visual definitions.</summary>
    public static class CampSceneBuilder
    {
        public const string ScenePath = "Assets/AbbyCamp/Scenes/Camp.unity";
        private const string GeneratedPath = "Assets/AbbyCamp/Generated";
        private const string NaturePath = "Assets/ThirdParty/Kenney/NatureKit/Models/";
        private static Material grass, darkGrass, path, wood, darkWood, paper, turquoise, orange, stone, rewardSparkles;

        [MenuItem("Abby Camp/Create or rebuild camp")]
        public static void Build()
        {
            Directory.CreateDirectory("Assets/AbbyCamp/Scenes");
            Directory.CreateDirectory(GeneratedPath);
            AssetDatabase.Refresh();
            ConfigureKenneyImports();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            MakeMaterials();
            BuildCameraAndLighting();
            BuildGround();
            BuildScenery();
            var playerAppearance = CreateDefinition("camper-green", "Assets/ThirdParty/Kenney/BlockyCharacters/Models/character-f.fbx", 1.8f, "emote-yes", new Color(.29f, .68f, .5f));
            var dogAppearance = CreateDefinition("companion-dog", "Assets/ThirdParty/Kenney/CubePets/Models/animal-dog.fbx", .8f, "dance", new Color(.9f, .61f, .32f));
            var foxAppearance = CreateDefinition("companion-fox", "Assets/ThirdParty/Kenney/CubePets/Models/animal-fox.fbx", .8f, "dance", new Color(1f, .4f, .16f));
            var player = BuildPlayer(playerAppearance);
            var companion = BuildCompanion(player, dogAppearance, foxAppearance);
            var board = BuildBoard(player);
            var session = new GameObject("CampSession").AddComponent<CampPrototypeController>();
            session.Configure(player, companion, board);
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
            Require(Camera.main != null && Camera.main.orthographic, "Missing fixed isometric camera.");
            Require(player.GetComponent<CharacterController>() != null && companion.GetComponent<CharacterController>() != null, "Movement requires root controllers.");
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
                Require(definition.ModelPrefab != null, "Missing imported model for " + definition.AppearanceId);
                Require(definition.AnimatorController != null, "Missing animation mapping for " + definition.AppearanceId);
            }
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            EditorSceneManager.SaveScene(SceneManager.GetActiveScene());
            Debug.Log("ABBY_CAMP_VALIDATE_OK: actors, interaction, models, animations, and two-model swap preserve gameplay identity and transforms.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static void MakeMaterials()
        {
            grass = MakeMaterial("Grass", new Color(.47f, .59f, .41f));
            darkGrass = MakeMaterial("Raised meadow", new Color(.36f, .47f, .34f));
            path = MakeMaterial("Sandstone path", new Color(.77f, .70f, .56f));
            wood = MakeMaterial("Warm cedar", new Color(.51f, .34f, .22f));
            darkWood = MakeMaterial("Deep cedar", new Color(.31f, .22f, .16f));
            paper = MakeMaterial("Task paper", new Color(.95f, .91f, .76f));
            turquoise = MakeMaterial("Camp teal", new Color(.16f, .49f, .46f));
            orange = MakeMaterial("Camp gold", new Color(.89f, .62f, .29f));
            stone = MakeMaterial("Slate stones", new Color(.48f, .53f, .50f));
            rewardSparkles = MakeMaterial("Reward sparkles", new Color(1f, .9f, .55f));
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
            camera.backgroundColor = new Color(.77f, .86f, .85f);
            cameraObject.AddComponent<AudioListener>();
            var sun = new GameObject("Late afternoon sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.transform.rotation = Quaternion.Euler(48f, -38f, 0f);
            sun.color = new Color(1f, .96f, .88f);
            sun.intensity = 1.15f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = .55f;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.50f, .57f, .55f);
            RenderSettings.ambientIntensity = .8f;
            RenderSettings.fog = false;
        }

        private static void BuildGround()
        {
            var environment = new GameObject("Camp environment").transform;
            Shape("Meadow island", PrimitiveType.Cube, new Vector3(0f, -.3f, 0f), new Vector3(28f, .6f, 22f), grass, environment, true);
            Shape("Island edge", PrimitiveType.Cube, new Vector3(0f, -.78f, 0f), new Vector3(27.9f, .36f, 21.9f), darkGrass, environment, false);
            Disc("Camp clearing", new Vector3(.1f, .011f, .5f), 5.6f, path, environment);
            for (var i = 0; i < 6; i++)
            {
                var t = i / 5f;
                var position = Vector3.Lerp(new Vector3(1.5f, .022f, -7f), new Vector3(-3f, .022f, 2.5f), t);
                Disc("Path stone " + (i + 1), position, .85f, path, environment);
            }
            // Invisible perimeter keeps the character on the island without requiring replacement-art colliders.
            Boundary("North boundary", new Vector3(0f, 1.5f, 10.1f), new Vector3(28f, 3f, .4f), environment);
            Boundary("South boundary", new Vector3(0f, 1.5f, -10.1f), new Vector3(28f, 3f, .4f), environment);
            Boundary("West boundary", new Vector3(-13.1f, 1.5f, 0f), new Vector3(.4f, 3f, 22f), environment);
            Boundary("East boundary", new Vector3(13.1f, 1.5f, 0f), new Vector3(.4f, 3f, 22f), environment);
        }

        private static void BuildScenery()
        {
            var scenery = new GameObject("Replaceable camp scenery").transform;
            var treePositions = new[]
            {
                new Vector3(-10f, 0f, 6f), new Vector3(-8.6f, 0f, 8f), new Vector3(-6.6f, 0f, 7.6f),
                new Vector3(8f, 0f, 7.8f), new Vector3(10f, 0f, 5.2f), new Vector3(11f, 0f, 7.4f),
                new Vector3(-10.5f, 0f, -5.8f), new Vector3(-8.8f, 0f, -7.8f), new Vector3(10.4f, 0f, -6f)
            };
            for (var i = 0; i < treePositions.Length; i++)
            {
                var height = 2.8f + (i % 3) * .55f;
                var tree = PlaceImported(i % 2 == 0 ? "tree_blocks.fbx" : "tree_pineSmallA.fbx", "Tree " + (i + 1), treePositions[i], height, i * 37f, scenery);
                if (tree == null)
                {
                    Shape("Tree trunk", PrimitiveType.Cylinder, treePositions[i] + Vector3.up * .7f, new Vector3(.45f, .7f, .45f), wood, scenery, false);
                    Shape("Tree canopy", PrimitiveType.Cube, treePositions[i] + Vector3.up * 2f, new Vector3(1.6f, 2f, 1.6f), darkGrass, scenery, false);
                }
                AddObstacle("Tree trunk collision", treePositions[i] + Vector3.up * .5f, new Vector3(.55f, 1f, .55f), scenery);
            }
            for (var i = 0; i < 12; i++)
            {
                var angle = i * 2.399963f;
                var position = new Vector3(Mathf.Cos(angle) * (8f + i % 3), 0f, Mathf.Sin(angle) * (6f + i % 2));
                PlaceImported("rock_smallA.fbx", "Meadow rock " + (i + 1), position, .28f + (i % 3) * .12f, i * 71f, scenery);
                PlaceImported("plant_bush.fbx", "Meadow bush " + (i + 1), position + new Vector3(.75f, 0f, .4f), .5f, i * 19f, scenery);
            }
            for (var i = 0; i < 10; i++)
                PlaceImported("flower_yellowA.fbx", "Wildflower " + (i + 1), new Vector3(-7.7f + i % 5 * .45f, 0f, -3.5f + i / 5 * .6f), .28f, i * 52f, scenery);

            var tent = PlaceImported("tent_smallOpen.fbx", "Camper tent", new Vector3(5.2f, 0f, 4.7f), 2.25f, 180f, scenery);
            if (tent == null) Shape("Tent placeholder", PrimitiveType.Cube, new Vector3(5.2f, 1f, 4.7f), new Vector3(3f, 2f, 2.7f), turquoise, scenery, false);
            AddObstacle("Tent collision", new Vector3(5.2f, .8f, 4.7f), new Vector3(2.6f, 1.6f, 2.5f), scenery);
            Disc("Companion garden", new Vector3(5f, .02f, -.5f), 1.8f, darkGrass, scenery);
            PlaceImported("log.fbx", "Resting log", new Vector3(4.3f, 0f, .7f), .5f, 90f, scenery);
            Shape("Water bowl", PrimitiveType.Cylinder, new Vector3(5.7f, .08f, -.8f), new Vector3(.6f, .08f, .6f), turquoise, scenery, false);
            Shape("Bowl water", PrimitiveType.Cylinder, new Vector3(5.7f, .163f, -.8f), new Vector3(.47f, .008f, .47f), paper, scenery, false);
            PlaceImported("campfire_logs.fbx", "Evening campfire", new Vector3(1.6f, 0f, 3.2f), .5f, 25f, scenery);
            for (var i = 0; i < 7; i++)
            {
                var angle = i / 7f * Mathf.PI * 2f;
                Shape("Fire ring stone", PrimitiveType.Sphere, new Vector3(1.6f + Mathf.Cos(angle) * .73f, .1f, 3.2f + Mathf.Sin(angle) * .73f), new Vector3(.35f, .2f, .3f), stone, scenery, false);
            }
            Shape("Camp lantern post", PrimitiveType.Cylinder, new Vector3(-.1f, .9f, 4.8f), new Vector3(.08f, .9f, .08f), darkWood, scenery, false);
            Shape("Lantern", PrimitiveType.Cube, new Vector3(-.1f, 1.85f, 4.8f), new Vector3(.28f, .4f, .28f), orange, scenery, false);
            Shape("Camp flagpole", PrimitiveType.Cylinder, new Vector3(7.5f, 1.75f, 1.6f), new Vector3(.085f, 1.75f, .085f), darkWood, scenery, false);
            Shape("Camp pennant", PrimitiveType.Cube, new Vector3(7.93f, 3.1f, 1.6f), new Vector3(.9f, .52f, .045f), turquoise, scenery, false);
            BuildGate(scenery);
        }

        private static void BuildGate(Transform parent)
        {
            Shape("Trail gate left", PrimitiveType.Cube, new Vector3(-1.8f, 1.2f, 7.5f), new Vector3(.22f, 2.4f, .25f), wood, parent, false);
            Shape("Trail gate right", PrimitiveType.Cube, new Vector3(1.8f, 1.2f, 7.5f), new Vector3(.22f, 2.4f, .25f), wood, parent, false);
            Shape("Trail gate lintel", PrimitiveType.Cube, new Vector3(0f, 2.45f, 7.5f), new Vector3(4.1f, .36f, .36f), wood, parent, false);
            Shape("Trail sign", PrimitiveType.Cube, new Vector3(0f, 2.47f, 7.24f), new Vector3(2.6f, .6f, .08f), turquoise, parent, false);
            Label("EXPEDITION TRAIL", new Vector3(0f, 2.47f, 7.18f), .07f, new Color(.99f, .96f, .82f), parent);
            // A preview landmark only: expeditions become interactive in a later slice.
        }

        private static CampPlayerController BuildPlayer(VisualDefinition definition)
        {
            var playerObject = new GameObject("Camper");
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
            if (definition == null)
            {
                definition = ScriptableObject.CreateInstance<VisualDefinition>();
                AssetDatabase.CreateAsset(definition, definitionPath);
            }
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
            label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            label.fontSize = 48;
            label.characterSize = characterSize;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.color = color;
            label.GetComponent<MeshRenderer>().sharedMaterial = label.font.material;
        }
    }
}
