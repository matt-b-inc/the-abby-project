using System;
using UnityEngine;
using UnityEngine.UI;

namespace AbbyCamp.UI
{
    /// <summary>Uses CSS pixels on Web and a 390-unit short edge in native/editor views.
    /// Insets follow the device safe area. A native keyboard reduces the usable area;
    /// browser keyboard resizing is handled by the same screen-size observation.</summary>
    public sealed class CampPhoneLayout : MonoBehaviour
    {
        public const float ReferenceShortEdge = 390f;
        private Canvas uiCanvas;
        private CanvasScaler scaler;
        private RectTransform safeRoot;
        private Rect previousUsable;
        private Vector2Int previousScreen;
        private Vector2Int referenceScreen;
        private bool keyboardResize;

        public event Action LayoutChanged;
        public Rect UsableScreenRect { get; private set; }
        public Vector2 LogicalSize => safeRoot == null ? Vector2.zero : safeRoot.rect.size;
        public bool IsLandscape => referenceScreen.x > referenceScreen.y;

        public void Configure(Canvas canvas, CanvasScaler canvasScaler, RectTransform root)
        {
            uiCanvas = canvas;
            scaler = canvasScaler;
            safeRoot = root;
            Apply(true);
        }

        private void Update() => Apply(false);

        private void Apply(bool force)
        {
            if (safeRoot == null || Screen.width <= 0 || Screen.height <= 0) return;
            var screen = new Vector2Int(Screen.width, Screen.height);
            var usable = Screen.safeArea;
            if (usable.width <= 0 || usable.height <= 0)
                usable = new Rect(0, 0, Screen.width, Screen.height);
            // Some platforms already resize the screen for the keyboard. Only apply
            // an inset when Unity reports a keyboard area inside the current screen.
            var keyboard = TouchScreenKeyboard.area;
            if (TouchScreenKeyboard.visible && keyboard.height > 0 && keyboard.yMax < Screen.height)
            {
                var bottom = Mathf.Max(usable.yMin, keyboard.yMax);
                if (bottom < usable.yMax) usable.yMin = bottom;
            }
            if (!force && screen == previousScreen && usable == previousUsable) return;
            bool inputFocused = false;
            foreach (var input in uiCanvas.GetComponentsInChildren<InputField>())
                if (input.isFocused) { inputFocused = true; break; }
            if (force || referenceScreen == Vector2Int.zero)
            {
                referenceScreen = screen;
                keyboardResize = false;
            }
            else if (screen.x != previousScreen.x)
            {
                // If rotated while typing, the browser may still report the
                // keyboard-reduced height. The old width is the new full height.
                referenceScreen = inputFocused || TouchScreenKeyboard.visible || keyboardResize
                    ? new Vector2Int(screen.x, Mathf.Max(screen.y, referenceScreen.x))
                    : screen;
                keyboardResize = screen.y < referenceScreen.y;
            }
            else if (inputFocused || TouchScreenKeyboard.visible)
            {
                keyboardResize = screen.y < referenceScreen.y;
            }
            else if (!keyboardResize || screen.y >= referenceScreen.y)
            {
                referenceScreen = screen;
                keyboardResize = false;
            }
            // Preserve the original touch scale while the browser keyboard reduces
            // visualViewport height, including its close animation after blur.
            previousScreen = screen;
            previousUsable = usable;
            UsableScreenRect = usable;
#if UNITY_WEBGL && !UNITY_EDITOR
            // The Web template renders at CSS pixel resolution. Keep 48-unit
            // controls at 48 CSS pixels even on small phones/in landscape.
            var scale = 1f;
#else
            var scale = Mathf.Min(referenceScreen.x, referenceScreen.y) / ReferenceShortEdge;
#endif
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ConstantPixelSize;
            scaler.scaleFactor = scale;
            uiCanvas.scaleFactor = scale;
            safeRoot.anchorMin = new Vector2(usable.xMin / Screen.width, usable.yMin / Screen.height);
            safeRoot.anchorMax = new Vector2(usable.xMax / Screen.width, usable.yMax / Screen.height);
            safeRoot.offsetMin = Vector2.zero;
            safeRoot.offsetMax = Vector2.zero;
            Canvas.ForceUpdateCanvases();
            LayoutChanged?.Invoke();
        }
    }
}
