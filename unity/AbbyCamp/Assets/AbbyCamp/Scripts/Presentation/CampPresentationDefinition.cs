using UnityEngine;

namespace AbbyCamp.Presentation
{
    /// <summary>Authored appearance and palette settings, independent of saved progress.</summary>
    [CreateAssetMenu(menuName = "Abby Camp/World Presentation")]
    public sealed class CampPresentationDefinition : ScriptableObject
    {
        public string WorldTitle = "MEMORY MEADOW";
        public VisualDefinition PlayerAppearance;
        public VisualDefinition CompanionAppearance;
        public VisualDefinition AlternateCompanionAppearance;
        public Sprite MemoryBloom;
        public Font UiFont;
        public Color Paper = new Color(1f, .972549f, .933333f);
        public Color Ink = new Color(.286275f, .219608f, .309804f);
        public Color Primary = new Color(.458824f, .376471f, .658824f);
        public Color Grass = new Color(.662745f, .811765f, .662745f);
        public Color GrassEdge = new Color(.55f, .69f, .55f);
        public Color Path = new Color(1f, .847059f, .572549f);
        public Color Accent = new Color(.956863f, .713725f, .627451f);
        public Color Sky = new Color(.862745f, .933333f, .956863f);
    }
}
