#if UNITY_EDITOR || DEVELOPMENT_BUILD
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace AbbyCamp.Validation
{
    /// <summary>Renders the real world and runtime UI independently of desktop-window visibility.</summary>
    public static class CampPreviewCapture
    {
        private const int Width = 1600;
        private const int Height = 900;

        private readonly struct CanvasState
        {
            public readonly Canvas Canvas;
            public readonly RenderMode Mode;
            public readonly Camera Camera;
            public readonly float PlaneDistance;

            public CanvasState(Canvas canvas)
            {
                Canvas = canvas;
                Mode = canvas.renderMode;
                Camera = canvas.worldCamera;
                PlaneDistance = canvas.planeDistance;
            }

            public void Restore()
            {
                if (Canvas == null) return;
                Canvas.renderMode = Mode;
                Canvas.worldCamera = Camera;
                Canvas.planeDistance = PlaneDistance;
            }
        }

        public static IEnumerator Capture(string path)
        {
            var camera = UnityEngine.Camera.main;
            if (camera == null) throw new InvalidOperationException("Preview capture requires the camp camera.");
            if (SystemInfo.graphicsDeviceType == GraphicsDeviceType.Null)
                throw new InvalidOperationException("Preview capture requires an active graphics device.");
            var target = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB)
            {
                name = "Camp offscreen preview",
                antiAliasing = 1,
                useMipMap = false
            };
            target.Create();
            var originalTarget = camera.targetTexture;
            var originalAspect = camera.aspect;
            var originalActive = RenderTexture.active;
            var canvases = new List<CanvasState>();
            Texture2D image = null;

            try
            {
                camera.targetTexture = target;
                camera.aspect = (float)Width / Height;
                foreach (var canvas in UnityEngine.Object.FindObjectsByType<Canvas>(FindObjectsSortMode.None))
                {
                    if (!canvas.isActiveAndEnabled || !canvas.isRootCanvas || canvas.renderMode != RenderMode.ScreenSpaceOverlay) continue;
                    canvases.Add(new CanvasState(canvas));
                    canvas.renderMode = RenderMode.ScreenSpaceCamera;
                    canvas.worldCamera = camera;
                    canvas.planeDistance = Mathf.Max(1f, camera.nearClipPlane + .1f);
                }
                Canvas.ForceUpdateCanvases();
                // Let camera-space Canvas geometry/layout rebuild at the requested target resolution.
                yield return null;
                Canvas.ForceUpdateCanvases();
                var request = new UniversalRenderPipeline.SingleCameraRequest { destination = target };
                if (!RenderPipeline.SupportsRenderRequest(camera, request))
                    throw new InvalidOperationException("The active pipeline does not support an offscreen single-camera render.");
                RenderPipeline.SubmitRenderRequest(camera, request);
                RenderTexture.active = target;
                image = new Texture2D(Width, Height, TextureFormat.RGBA32, false, false);
                image.ReadPixels(new Rect(0, 0, Width, Height), 0, 0, false);
                image.Apply(false, false);
                ValidatePixels(image.GetPixels32(), Path.GetFileName(path));
                var absolutePath = Path.GetFullPath(path);
                Directory.CreateDirectory(Path.GetDirectoryName(absolutePath));
                File.WriteAllBytes(absolutePath, image.EncodeToPNG());
            }
            finally
            {
                foreach (var state in canvases) state.Restore();
                camera.targetTexture = originalTarget;
                camera.aspect = originalAspect;
                RenderTexture.active = originalActive;
                Canvas.ForceUpdateCanvases();
                if (image != null) UnityEngine.Object.Destroy(image);
                target.Release();
                UnityEngine.Object.Destroy(target);
            }
        }

        private static void ValidatePixels(Color32[] pixels, string name)
        {
            var colors = new HashSet<int>();
            var sampleCount = 0;
            var brightCount = 0;
            var darkest = 255;
            var lightest = 0;
            for (var i = 0; i < pixels.Length; i += 7)
            {
                var pixel = pixels[i];
                var brightness = (pixel.r * 2 + pixel.g * 3 + pixel.b) / 6;
                darkest = Math.Min(darkest, brightness);
                lightest = Math.Max(lightest, brightness);
                if (brightness > 20) brightCount++;
                colors.Add((pixel.r >> 3) << 10 | (pixel.g >> 3) << 5 | (pixel.b >> 3));
                sampleCount++;
            }
            if (brightCount < sampleCount / 50 || lightest - darkest < 25 || colors.Count < 24)
                throw new InvalidOperationException($"Blank preview rejected: {name}; bright={brightCount}/{sampleCount}, range={lightest - darkest}, colors={colors.Count}.");
            Debug.Log($"ABBY_CAMP_PREVIEW_OK: {name}; {Width}x{Height}, bright={brightCount}/{sampleCount}, range={lightest - darkest}, colors={colors.Count}.");
        }
    }
}
#endif
