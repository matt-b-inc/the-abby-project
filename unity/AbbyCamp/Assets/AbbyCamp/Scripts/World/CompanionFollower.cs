using AbbyCamp.Presentation;
using UnityEngine;

namespace AbbyCamp.World
{
    [RequireComponent(typeof(CharacterController))]
    public sealed class CompanionFollower : MonoBehaviour
    {
        [SerializeField] private Transform target;
        [SerializeField] private VisualDefinition primaryAppearance;
        [SerializeField] private VisualDefinition secondaryAppearance;
        [SerializeField] private float moveSpeed = 4.8f;
        [SerializeField] private float followDistance = 1.9f;
        private CharacterController motor;
        private float verticalSpeed;
        private bool isFollowing;
        private float celebrationPause;

        public VisualPresenter Appearance => GetComponent<VisualPresenter>();
        public VisualDefinition PrimaryAppearance => primaryAppearance;
        public VisualDefinition SecondaryAppearance => secondaryAppearance;

        public void Configure(Transform followTarget, VisualDefinition first, VisualDefinition second)
        {
            target = followTarget;
            primaryAppearance = first;
            secondaryAppearance = second;
        }

        private void Awake() => motor = GetComponent<CharacterController>();

        public void ApplyAppearance(VisualDefinition definition)
        {
            if (Appearance != null) Appearance.SetVisual(definition);
        }

        public void ToggleAppearance()
        {
            ApplyAppearance(Appearance != null && Appearance.Definition == secondaryAppearance ? primaryAppearance : secondaryAppearance);
        }

        public void Celebrate()
        {
            celebrationPause = 1.15f;
            if (Appearance != null) Appearance.Celebrate();
        }

        private void Update()
        {
            if (target == null || motor == null) return;
            celebrationPause = Mathf.Max(0f, celebrationPause - Time.deltaTime);
            var delta = Vector3.ProjectOnPlane(target.position - transform.position, Vector3.up);
            var distance = delta.magnitude;
            if (distance > followDistance + .5f) isFollowing = true;
            else if (distance < followDistance) isFollowing = false;
            var direction = Vector3.zero;
            if (isFollowing && celebrationPause <= 0f)
            {
                direction = delta.normalized;
                // Pick an unobstructed short step around static props instead of pushing into them.
                if (Blocked(direction))
                {
                    var left = Quaternion.Euler(0f, -65f, 0f) * direction;
                    var right = Quaternion.Euler(0f, 65f, 0f) * direction;
                    direction = !Blocked(left) ? left : !Blocked(right) ? right : Vector3.zero;
                }
            }
            if (direction.sqrMagnitude > .01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(direction), 1f - Mathf.Exp(-9f * Time.deltaTime));
            else if (distance > .5f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(delta), 1f - Mathf.Exp(-3f * Time.deltaTime));
            if (motor.isGrounded && verticalSpeed < 0f) verticalSpeed = -2f;
            verticalSpeed += Physics.gravity.y * Time.deltaTime;
            var before = transform.position;
            motor.Move((direction * moveSpeed + Vector3.up * verticalSpeed) * Time.deltaTime);
            if (Appearance != null)
                Appearance.SetLocomotion(Mathf.Clamp01(Vector3.ProjectOnPlane(transform.position - before, Vector3.up).magnitude / Mathf.Max(.0001f, moveSpeed * Time.deltaTime)));
        }

        private bool Blocked(Vector3 direction)
        {
            var hits = Physics.SphereCastAll(transform.position + Vector3.up * .4f, .18f, direction, .7f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);
            foreach (var hit in hits)
            {
                if (hit.collider.transform == transform || hit.collider.transform.IsChildOf(transform)) continue;
                if (target != null && (hit.collider.transform == target || hit.collider.transform.IsChildOf(target))) continue;
                return true;
            }
            return false;
        }
    }
}
