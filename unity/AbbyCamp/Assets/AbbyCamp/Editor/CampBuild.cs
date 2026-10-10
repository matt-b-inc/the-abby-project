using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace AbbyCamp.Editor
{
    public static class CampBuild
    {
        [MenuItem("Abby Camp/Validate all")]
        public static void ValidateAll()
        {
            CampSceneBuilder.Validate();
            ApiContractValidation.Run();
            Debug.Log("ABBY_CAMP_VALIDATION_PASSED: scene, asset swap, and API contracts.");
        }

        public static void PrepareAndValidate()
        {
            CampSceneBuilder.Build();
            ValidateAll();
        }

        [MenuItem("Abby Camp/Build Windows prototype")]
        public static void BuildWindows()
        {
            if (!File.Exists(CampSceneBuilder.ScenePath)) CampSceneBuilder.Build();
            ValidateAll();
            PlayerSettings.companyName = "The Abby Project";
            PlayerSettings.productName = "Abby Camp";
            PlayerSettings.runInBackground = true;
            PlayerSettings.defaultScreenWidth = 1600;
            PlayerSettings.defaultScreenHeight = 900;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.DevelopmentOnly;
            var output = Path.GetFullPath("Builds/Windows/AbbyCamp.exe");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { "Assets/AbbyCamp/Scenes/Camp.unity" },
                locationPathName = output,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.Development
            });
            if (report.summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException("Abby Camp build failed: " + report.summary.result);
            Debug.Log("ABBY_CAMP_BUILD_PASSED: " + output);
        }

        public static void RebuildAndBuildWindows()
        {
            CampSceneBuilder.Build();
            BuildWindows();
        }

        [MenuItem("Abby Camp/Build phone Web prototype")]
        public static void BuildWeb()
        {
            if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.WebGL, BuildTarget.WebGL))
                throw new InvalidOperationException("Install Web Build Support for Unity 6000.6.5f1 in Unity Hub.");
            if (!File.Exists(CampSceneBuilder.ScenePath)) CampSceneBuilder.Build();
            ValidateAll();
            PlayerSettings.companyName = "The Abby Project";
            PlayerSettings.productName = "Abby's World";
            PlayerSettings.runInBackground = false;
            PlayerSettings.defaultWebScreenWidth = 393;
            PlayerSettings.defaultWebScreenHeight = 852;
            PlayerSettings.WebGL.template = "PROJECT:AbbyPhone";
            // Cached scripts must never be paired with a different release's Wasm.
            PlayerSettings.WebGL.nameFilesAsHashes = true;
            // Uncompressed files work with ordinary static hosting without special
            // Content-Encoding headers. Compression can be added after phone testing.
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;
            PlayerSettings.WebGL.threadsSupport = false;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.DevelopmentOnly;

            var output = WebOutputDirectory();
            Directory.CreateDirectory(output);
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { CampSceneBuilder.ScenePath },
                locationPathName = output,
                target = BuildTarget.WebGL,
                // Test the same release output that static hosting will serve.
                options = BuildOptions.None
            });
            if (report.summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException("Abby phone Web build failed: " + report.summary.result);
            Debug.Log("ABBY_CAMP_WEB_BUILD_PASSED: " + output);
        }

        public static void RebuildAndBuildWeb()
        {
            CampSceneBuilder.Build();
            BuildWeb();
        }

        private static string WebOutputDirectory()
        {
            var output = Path.GetFullPath("Builds/Web");
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length; index++)
            {
                if (arguments[index] != "-abbyWebOutput") continue;
                if (index + 1 == arguments.Length || string.IsNullOrWhiteSpace(arguments[index + 1]))
                    throw new ArgumentException("-abbyWebOutput needs a dedicated output directory.");
                output = Path.GetFullPath(arguments[index + 1]);
            }

            var project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            if (IsInside(project, output))
                throw new ArgumentException("The Web output cannot be the Unity project or its parent directory.");
            foreach (var sourceDirectory in new[] { "Assets", "Packages", "ProjectSettings", "Library" })
                if (IsInside(output, Path.Combine(project, sourceDirectory)))
                    throw new ArgumentException("Choose a Web output directory outside Unity's source and cache folders.");
            return output;
        }

        private static bool IsInside(string path, string directory)
        {
            path = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            directory = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return string.Equals(path, directory, StringComparison.OrdinalIgnoreCase)
                || path.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }
    }
}
