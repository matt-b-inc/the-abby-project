using System;
using System.Collections.Generic;
using AbbyCamp.Presentation;
using UnityEngine;
using UnityEngine.EventSystems;

namespace AbbyCamp.World
{
    [RequireComponent(typeof(CharacterController))]
    public sealed class CampPlayerController : MonoBehaviour
    {
        [SerializeField] private float moveSpeed = 4.2f;
        [SerializeField] private float turnSpeed = 12f;
        [SerializeField] private Vector2 worldMin = new Vector2(-12f, -9f);
        [SerializeField] private Vector2 worldMax = new Vector2(12f, 9f);
        private CharacterController motor;
        private float verticalSpeed;
        private bool inputEnabled = true;
        private Vector3? destination;
        private float blockedTime;
        private int activeFinger = -1;
        private Vector2 pointerStart;
        private bool mouseTap;
        private readonly List<RaycastResult> interfaceHits = new List<RaycastResult>();

        public event Action CompanionTapped;
        public event Action TaskBoardTapped;

        public VisualPresenter Appearance => GetComponent<VisualPresenter>();
        public bool InputEnabled => inputEnabled;
        public float MovementFraction { get; private set; }

        private void Awake() => motor = GetComponent<CharacterController>();

        private void Start()
        {
            // Runtime setup also upgrades the saved scene without regenerating its art.
            var view = Camera.main;
            if (view != null && view.GetComponent<CampPhoneCamera>() == null)
                view.gameObject.AddComponent<CampPhoneCamera>().Configure(transform);
        }

        public void SetInputEnabled(bool enabled)
        {
            inputEnabled = enabled;
            if (!enabled) destination = null;
            if (!enabled) { activeFinger = -1; mouseTap = false; }
            MovementFraction = 0f;
            if (Appearance != null) Appearance.SetLocomotion(0f);
        }

        public void SetDestination(Vector3 position)
        {
            if (!inputEnabled) return;
            destination = new Vector3(Mathf.Clamp(position.x, worldMin.x, worldMax.x), 0f, Mathf.Clamp(position.z, worldMin.y, worldMax.y));
            blockedTime = 0f;
        }

        public void MoveTo(Vector3 position) => SetDestination(position);

        private void Update()
        {
            if (motor == null) return;
            var input = inputEnabled ? new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical")) : Vector2.zero;
            input = Vector2.ClampMagnitude(input, 1f);
            var forward = Vector3.forward;
            var right = Vector3.right;
            var camera = Camera.main;
            if (camera != null)
            {
                forward = Vector3.ProjectOnPlane(camera.transform.forward, Vector3.up).normalized;
                right = Vector3.ProjectOnPlane(camera.transform.right, Vector3.up).normalized;
                if (forward.sqrMagnitude < .01f) forward = Vector3.forward;
                if (right.sqrMagnitude < .01f) right = Vector3.right;
            }
            var direction = forward * input.y + right * input.x;
            if (input.sqrMagnitude > .01f) destination = null;
            if (inputEnabled && camera != null) ReadPointer(camera);
            if (inputEnabled && destination.HasValue)
            {
                var delta = Vector3.ProjectOnPlane(destination.Value - transform.position, Vector3.up);
                if (delta.magnitude < .12f) destination = null;
                else direction = delta.normalized * Mathf.Min(1f, delta.magnitude / Mathf.Max(.001f, moveSpeed * Time.deltaTime));
            }
            if (direction.sqrMagnitude > .01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(direction), 1f - Mathf.Exp(-turnSpeed * Time.deltaTime));
            if (motor.isGrounded && verticalSpeed < 0f) verticalSpeed = -2f;
            verticalSpeed += Physics.gravity.y * Time.deltaTime;
            var before = transform.position;
            motor.Move((direction * moveSpeed + Vector3.up * verticalSpeed) * Time.deltaTime);
            var position = transform.position;
            var boundedPosition = new Vector3(Mathf.Clamp(position.x, worldMin.x, worldMax.x), position.y, Mathf.Clamp(position.z, worldMin.y, worldMax.y));
            if ((boundedPosition - position).sqrMagnitude > .00001f) motor.Move(boundedPosition - position);
            MovementFraction = Mathf.Clamp01(Vector3.ProjectOnPlane(transform.position - before, Vector3.up).magnitude / Mathf.Max(.0001f, moveSpeed * Time.deltaTime));
            if (destination.HasValue)
            {
                blockedTime = MovementFraction < .04f ? blockedTime + Time.deltaTime : 0f;
                if (blockedTime > .65f) destination = null;
            }
            if (Appearance != null) Appearance.SetLocomotion(MovementFraction);
        }

        private void ReadPointer(Camera view)
        {
            // Touch and its emulated mouse events must never trigger the same action twice.
            if (Input.touchCount > 0)
            {
                mouseTap = false;
                if (Input.touchCount > 1) { activeFinger = -1; return; }
                var touch = Input.GetTouch(0);
                if (touch.phase == TouchPhase.Began)
                {
                    activeFinger = PointerHitsInterface(touch.position) ? -1 : touch.fingerId;
                    pointerStart = touch.position;
                }
                else if (touch.fingerId == activeFinger && touch.phase == TouchPhase.Ended)
                {
                    activeFinger = -1;
                    if (IsTap(touch.position) && !PointerHitsInterface(touch.position)) TapWorld(view, touch.position);
                }
                else if (touch.phase == TouchPhase.Canceled) activeFinger = -1;
                return;
            }
            if (Input.GetMouseButtonDown(0))
            {
                mouseTap = !PointerHitsInterface(Input.mousePosition);
                pointerStart = Input.mousePosition;
            }
            if (Input.GetMouseButtonUp(0))
            {
                bool accepted = mouseTap;
                mouseTap = false;
                if (accepted && IsTap(Input.mousePosition) && !PointerHitsInterface(Input.mousePosition))
                    TapWorld(view, Input.mousePosition);
            }
        }

        private bool IsTap(Vector2 position) => (position - pointerStart).sqrMagnitude <= Mathf.Pow(Mathf.Clamp(Screen.width * .035f, 12f, 28f), 2f);

        private bool PointerHitsInterface(Vector2 position)
        {
            if (EventSystem.current == null) return false;
            interfaceHits.Clear();
            EventSystem.current.RaycastAll(new PointerEventData(EventSystem.current) { position = position }, interfaceHits);
            return interfaceHits.Count > 0;
        }

        private void TapWorld(Camera view, Vector2 position)
        {
            var ray = view.ScreenPointToRay(position);
            if (Physics.Raycast(ray, out var hit, 100f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore))
            {
                if (hit.collider.GetComponentInParent<CompanionFollower>() != null)
                {
                    CompanionTapped?.Invoke();
                    return;
                }
                if (hit.collider.GetComponentInParent<CampTaskBoard>() != null)
                {
                    TaskBoardTapped?.Invoke();
                    return;
                }
            }
            var ground = new Plane(Vector3.up, Vector3.zero);
            if (ground.Raycast(ray, out var distance)) SetDestination(ray.GetPoint(distance));
        }
    }
}
