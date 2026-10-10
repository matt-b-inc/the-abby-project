using UnityEngine;

namespace AbbyCamp.World
{
    /// <summary>Keeps the player and companion in the open middle of a phone screen.</summary>
    [RequireComponent(typeof(Camera))]
    public sealed class CampPhoneCamera : MonoBehaviour
    {
        private Transform target;
        private CompanionFollower companion;
        private Camera view;
        private Vector3 offset;
        private Vector3 focus;

        public void Configure(Transform player) => target = player;

        private void Start()
        {
            view = GetComponent<Camera>();
            if (target == null) target = FindFirstObjectByType<CampPlayerController>()?.transform;
            companion = FindFirstObjectByType<CompanionFollower>();
            // Preserve the scene's isometric viewing angle while following the actors.
            offset = -transform.forward * 24f;
            focus = ActorFocus();
            Application.targetFrameRate = 30;
        }

        private Vector3 ActorFocus()
        {
            if (target == null) return Vector3.zero;
            var position = target.position;
            if (companion != null && Vector3.Distance(position, companion.transform.position) < 8f)
                position = Vector3.Lerp(position, companion.transform.position, .35f);
            return position + Vector3.up * .5f;
        }

        private void LateUpdate()
        {
            if (view == null || target == null) return;
            focus = Vector3.Lerp(focus, ActorFocus(), 1f - Mathf.Exp(-5f * Time.deltaTime));
            // Portrait gets closer to the actors; landscape keeps enough vertical space.
            float wantedSize = view.aspect < 1f ? 5.6f : 6.2f;
            view.orthographicSize = Mathf.Lerp(view.orthographicSize, wantedSize, 1f - Mathf.Exp(-6f * Time.deltaTime));
            transform.position = focus + offset;
        }
    }
}
