using UnityEngine;

namespace AbbyCamp.UI
{
    /// <summary>A small native nine-slice for the shared rounded storybook cards.</summary>
    public static class CampUiShapes
    {
        private static Sprite roundedPanel;

        public static Sprite RoundedPanel
        {
            get
            {
                if (roundedPanel != null) return roundedPanel;
                const int size = 48;
                const float radius = 12;
                var texture = new Texture2D(size, size, TextureFormat.RGBA32, false);
                texture.name = "Meadow rounded panel";
                texture.filterMode = FilterMode.Bilinear;
                texture.wrapMode = TextureWrapMode.Clamp;
                var pixels = new Color32[size * size];
                for (var y = 0; y < size; y++)
                    for (var x = 0; x < size; x++)
                    {
                        float dx = Mathf.Max(radius - (x + .5f), x + .5f - (size - radius), 0f);
                        float dy = Mathf.Max(radius - (y + .5f), y + .5f - (size - radius), 0f);
                        float alpha = Mathf.Clamp01(radius - Mathf.Sqrt(dx * dx + dy * dy) + .5f);
                        pixels[y * size + x] = new Color32(255, 255, 255, (byte)(alpha * 255));
                    }
                texture.SetPixels32(pixels);
                texture.Apply(false, true);
                roundedPanel = Sprite.Create(texture, new Rect(0, 0, size, size), new Vector2(.5f, .5f), 100,
                    0, SpriteMeshType.FullRect, new Vector4(radius, radius, radius, radius));
                roundedPanel.name = "Meadow rounded panel";
                return roundedPanel;
            }
        }
    }
}
