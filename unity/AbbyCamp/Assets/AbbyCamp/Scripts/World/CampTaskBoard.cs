using System;
using UnityEngine;

namespace AbbyCamp.World
{
    public sealed class CampTaskBoard : MonoBehaviour
    {
        [SerializeField] private Transform player;
        [SerializeField] private float interactionRange = 3.3f;
        private bool inputEnabled = true;

        public event Action InteractionRequested;
        public bool IsInRange => player != null && Vector3.ProjectOnPlane(player.position - transform.position, Vector3.up).sqrMagnitude <= interactionRange * interactionRange;

        public void Configure(Transform playerTransform, float range = 3.3f)
        {
            player = playerTransform;
            interactionRange = range;
        }

        public void SetInputEnabled(bool enabled) => inputEnabled = enabled;

        public void Interact()
        {
            if (inputEnabled && IsInRange) InteractionRequested?.Invoke();
        }

        private void Update()
        {
            if (inputEnabled && IsInRange && Input.GetKeyDown(KeyCode.E)) Interact();
        }

        private void OnDrawGizmosSelected()
        {
            Gizmos.color = new Color(1f, .8f, .2f, .6f);
            Gizmos.DrawWireSphere(transform.position, interactionRange);
        }
    }
}
