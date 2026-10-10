using UnityEngine;

namespace AbbyCamp.Presentation
{
    /// <summary>A replaceable presentation; progression and entity identity never live here.</summary>
    [CreateAssetMenu(menuName = "Abby Camp/Visual Definition")]
    public sealed class VisualDefinition : ScriptableObject
    {
        public string AppearanceId;
        public GameObject ModelPrefab;
        [Tooltip("Optional portrait companion. A model takes precedence when assigned.")]
        public Sprite Portrait;
        public Sprite HappyPortrait;
        public Sprite BlinkPortrait;
        [Min(.1f)] public float PortraitHeight = 1.7f;
        [Tooltip("Portraits face the camera without rotating their gameplay root.")]
        public bool BillboardPortrait = true;
        public Vector3 LocalPosition = Vector3.zero;
        public Vector3 LocalEulerAngles = Vector3.zero;
        public Vector3 LocalScale = Vector3.one;
        public RuntimeAnimatorController AnimatorController;
        public string LocomotionParameter = "Speed";
        public string CelebrateTrigger = "Celebrate";
        [Tooltip("Used if this asset has no model, so gameplay remains usable while art changes.")]
        public Color PlaceholderColor = new Color(.98f, .62f, .3f);
    }
}
