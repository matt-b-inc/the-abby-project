using UnityEngine;

namespace AbbyCamp.Presentation
{
    /// <summary>Owns a model child, animation mappings, and lightweight fallback reactions.</summary>
    public sealed class VisualPresenter : MonoBehaviour
    {
        [SerializeField] private VisualDefinition definition;
        private Transform model;
        private Animator animator;
        private SpriteRenderer portrait;
        private float blinkRemaining;
        private float nextBlinkAt;
        private Vector3 restPosition;
        private Vector3 restScale;
        private Quaternion restRotation;
        private float locomotion;
        private float celebrationRemaining;
        private bool hasSpeed;
        private bool hasCelebrate;
        private const float CelebrationDuration = 1.15f;

        public VisualDefinition Definition => definition;

        private void Awake()
        {
            SetVisual(definition);
        }

        public void SetVisual(VisualDefinition next)
        {
            if (model == null) model = transform.Find("Appearance");
            if (model != null)
            {
                model.gameObject.SetActive(false);
                if (Application.isPlaying) Destroy(model.gameObject);
                else DestroyImmediate(model.gameObject);
            }

            definition = next;
            portrait = null;
            GameObject instance;
            if (next != null && next.ModelPrefab != null)
                instance = Instantiate(next.ModelPrefab, transform);
            else if (next != null && next.Portrait != null)
            {
                instance = new GameObject("Portrait");
                instance.transform.SetParent(transform, false);
                portrait = instance.AddComponent<SpriteRenderer>();
                portrait.sprite = next.Portrait;
                var height = Mathf.Max(.001f, next.Portrait.bounds.size.y);
                instance.transform.localScale = Vector3.one * (next.PortraitHeight / height);
                instance.transform.localPosition = Vector3.up * (next.PortraitHeight * .52f);
                nextBlinkAt = Time.time + 3.5f;
            }
            else
            {
                instance = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                instance.transform.SetParent(transform, false);
                instance.transform.localScale = new Vector3(.55f, .65f, .55f);
                instance.transform.localPosition = Vector3.up * .65f;
                var material = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
                material.color = next != null ? next.PlaceholderColor : new Color(.98f, .62f, .3f);
                instance.GetComponent<Renderer>().sharedMaterial = material;
            }

            instance.name = "Appearance";
            model = instance.transform;
            if (next != null && (next.ModelPrefab != null || next.Portrait != null))
            {
                model.localPosition = next.ModelPrefab != null ? next.LocalPosition : model.localPosition + next.LocalPosition;
                model.localRotation = Quaternion.Euler(next.LocalEulerAngles);
                model.localScale = next.ModelPrefab != null ? next.LocalScale : Vector3.Scale(model.localScale, next.LocalScale);
            }

            // Physics belongs to the gameplay root, even when a replacement pack includes colliders.
            foreach (var collider in instance.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
            foreach (var body in instance.GetComponentsInChildren<Rigidbody>(true))
            {
                body.isKinematic = true;
                body.detectCollisions = false;
            }

            animator = instance.GetComponentInChildren<Animator>();
            if (animator == null && next != null && next.AnimatorController != null)
                animator = instance.AddComponent<Animator>();
            if (animator != null)
            {
                animator.applyRootMotion = false;
                if (next != null && next.AnimatorController != null) animator.runtimeAnimatorController = next.AnimatorController;
            }

            hasSpeed = HasParameter(next != null ? next.LocomotionParameter : null, AnimatorControllerParameterType.Float);
            hasCelebrate = HasParameter(next != null ? next.CelebrateTrigger : null, AnimatorControllerParameterType.Trigger);
            restPosition = model.localPosition;
            restScale = model.localScale;
            restRotation = model.localRotation;
            celebrationRemaining = 0f;
            blinkRemaining = 0f;
        }

        public void SetLocomotion(float normalizedSpeed)
        {
            locomotion = Mathf.Clamp01(normalizedSpeed);
            if (hasSpeed) animator.SetFloat(definition.LocomotionParameter, locomotion, .12f, Time.deltaTime);
        }

        public void Celebrate()
        {
            celebrationRemaining = CelebrationDuration;
            if (hasCelebrate) animator.SetTrigger(definition.CelebrateTrigger);
            var effects = GetComponent<RewardReaction>();
            if (effects != null) effects.Play();
        }

        private bool HasParameter(string parameterName, AnimatorControllerParameterType type)
        {
            if (animator == null || animator.runtimeAnimatorController == null || string.IsNullOrEmpty(parameterName)) return false;
            foreach (var parameter in animator.parameters)
                if (parameter.name == parameterName && parameter.type == type) return true;
            return false;
        }

        private void Update()
        {
            if (model == null) return;
            var offset = Vector3.zero;
            var rotation = restRotation;
            var scale = restScale;
            if (portrait != null)
            {
                offset.y = Mathf.Sin(Time.time * 2.2f) * .035f;
                if (definition.BillboardPortrait && Camera.main != null)
                    rotation = Quaternion.Inverse(transform.rotation) * Camera.main.transform.rotation;
                if (Time.time >= nextBlinkAt)
                {
                    blinkRemaining = .14f;
                    nextBlinkAt = Time.time + 3.5f + Random.value * 2f;
                }
                blinkRemaining = Mathf.Max(0f, blinkRemaining - Time.deltaTime);
                portrait.sprite = celebrationRemaining > 0f && definition.HappyPortrait != null
                    ? definition.HappyPortrait
                    : blinkRemaining > 0f && definition.BlinkPortrait != null ? definition.BlinkPortrait : definition.Portrait;
            }
            if (!hasSpeed && locomotion > .05f)
                offset.y = Mathf.Abs(Mathf.Sin(Time.time * 13f)) * .055f * locomotion;
            if (celebrationRemaining > 0f)
            {
                celebrationRemaining = Mathf.Max(0f, celebrationRemaining - Time.deltaTime);
                if (!hasCelebrate)
                {
                    var progress = 1f - celebrationRemaining / CelebrationDuration;
                    offset.y += Mathf.Abs(Mathf.Sin(progress * Mathf.PI * 3f)) * .4f;
                    rotation *= Quaternion.Euler(0f, portrait == null ? Mathf.Sin(progress * Mathf.PI * 2f) * 18f : 0f, portrait != null ? Mathf.Sin(progress * Mathf.PI * 2f) * 6f : 0f);
                    scale *= 1f + Mathf.Sin(progress * Mathf.PI) * .055f;
                }
            }
            model.localPosition = restPosition + offset;
            model.localRotation = rotation;
            model.localScale = scale;
        }
    }
}
