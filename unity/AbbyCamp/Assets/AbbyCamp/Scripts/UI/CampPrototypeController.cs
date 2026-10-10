using System;
using System.Collections;
using AbbyCamp.Data;
using AbbyCamp.Services;
using AbbyCamp.World;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace AbbyCamp.UI
{
    /// <summary>Owns session/UI state; world objects and art never own account progression.</summary>
    public sealed class CampPrototypeController : MonoBehaviour
    {
        [SerializeField] private CampPlayerController player;
        [SerializeField] private CompanionFollower companion;
        [SerializeField] private CampTaskBoard taskBoard;

        private const string DemoPracticeKey = "AbbyCamp.Demo.PracticeCompleted";
        private readonly Color ink = new Color(0.16f, 0.22f, 0.23f);
        private readonly Color paper = new Color(0.96f, 0.94f, 0.86f);
        private readonly Color teal = new Color(0.13f, 0.40f, 0.37f);
        private AbbyApiClient api;
        private Font font;
        private RectTransform canvas;
        private RectTransform safeArea;
        private CampPhoneLayout phoneLayout;
        private RectTransform headingPanel;
        private RectTransform controlsPanel;
        private RectTransform footerPanel;
        private Text titleLabel;
        private Button patButton;
        private Button swapButton;
        private RectTransform modalSafeArea;
        private RectTransform modalSheet;
        private Text modalTitle;
        private Text modalSubtitle;
        private RectTransform modalFooter;
        private ScrollRect modalScroll;
        private GameObject lastFocusedInput;
        private bool revealFocusedInput;
        private GameObject modal;
        private Text modeLabel;
        private Text progressLabel;
        private Text promptLabel;
        private Text toastLabel;
        private Text sessionHint;
        private Button boardButton;
        private Button connectButton;
        private HabitDto[] habits = Array.Empty<HabitDto>();
        private CharacterDto character;
        private bool busy;
        private bool boardOpen;
        private bool outcomeUnknown;
        private bool canResolveOutcome;
        private bool demoComplete;
        private int uncertainHabitId;
        private int uncertainTapsBefore;
        private float toastUntil;
        private float patAvailableAt;
        private float boardScrollPosition = 1f;
        private string boardStatus = "";
        private bool browserSessionDirty;

        public bool IsDemo => api == null || !api.IsAuthenticated;
        public bool IsModalOpen => modal != null;
        public bool IsBusy => busy;

        public void Configure(CampPlayerController campPlayer, CompanionFollower pet, CampTaskBoard board)
        {
            player = campPlayer;
            companion = pet;
            taskBoard = board;
        }

        private void Start()
        {
            if (player == null) player = FindFirstObjectByType<CampPlayerController>();
            if (companion == null) companion = FindFirstObjectByType<CompanionFollower>();
            if (taskBoard == null) taskBoard = FindFirstObjectByType<CampTaskBoard>();
            api = GetComponent<AbbyApiClient>();
            if (api == null) api = gameObject.AddComponent<AbbyApiClient>();
            api.BrowserSessionChanged += BrowserSessionChanged;
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            demoComplete = PlayerPrefs.GetInt(DemoPracticeKey, 0) == 1;
            CreateInterface();
            if (taskBoard != null) taskBoard.InteractionRequested += OpenTaskBoard;
            if (player != null)
            {
                player.CompanionTapped += PatCompanion;
                player.TaskBoardTapped += OpenTaskBoard;
            }
            RefreshHud();
            Toast("Tap the ground to explore, or open Tasks to try a ritual.", 7f);
#if UNITY_WEBGL && !UNITY_EDITOR
            browserSessionDirty = true;
#endif
        }

        private void OnDestroy()
        {
            if (api != null) api.BrowserSessionChanged -= BrowserSessionChanged;
            if (taskBoard != null) taskBoard.InteractionRequested -= OpenTaskBoard;
            if (player != null)
            {
                player.CompanionTapped -= PatCompanion;
                player.TaskBoardTapped -= OpenTaskBoard;
            }
            if (phoneLayout != null) phoneLayout.LayoutChanged -= LayoutInterface;
        }

        private void Update()
        {
            if (canvas == null) return;
            if (browserSessionDirty && !busy)
            {
                browserSessionDirty = false;
                StartCoroutine(ConnectBrowserSession());
            }
            var inRange = taskBoard != null && taskBoard.IsInRange;
            boardButton.interactable = !busy && !IsModalOpen;
            patButton.interactable = !busy && !IsModalOpen && companion != null;
            swapButton.interactable = !busy && !IsModalOpen && companion != null;
            promptLabel.text = IsModalOpen ? "" : inRange
                ? "Tap the board or open Tasks"
                : "Tap to walk · Tap your companion to say hello";
            if (!IsModalOpen && Input.GetKeyDown(KeyCode.K)) SwapCompanion();
            if (IsModalOpen && Input.GetKeyDown(KeyCode.Escape) && !busy) CloseModal();
            if (toastLabel != null && Time.unscaledTime > toastUntil) toastLabel.text = "";
            KeepFocusedInputVisible();
        }

        private void BrowserSessionChanged()
        {
            // Remove the previous account's presentation immediately, even
            // while its aborted request is finishing. Reconnect after it ends.
            habits = Array.Empty<HabitDto>();
            character = null;
            outcomeUnknown = false;
            canResolveOutcome = false;
            boardOpen = false;
            boardStatus = "";
            if (toastLabel != null) toastLabel.text = "";
            toastUntil = 0;
            DismissModal();
            RefreshHud();
            browserSessionDirty = true;
        }

        private IEnumerator ConnectBrowserSession()
        {
            busy = true;
            ApiError failure = null;
            yield return api.ResumeBrowserSession(_ => { }, error => failure = error);
            busy = false;
            RefreshHud();
            if (failure != null)
            {
                Toast(failure.Message, 7f);
                yield break;
            }
            // An aborted save from the previous account may have finished its
            // failure callback while validation was queued. Its uncertainty
            // cannot be carried into this account's task board.
            outcomeUnknown = false;
            canResolveOutcome = false;
            uncertainHabitId = 0;
            uncertainTapsBefore = 0;
            boardStatus = "";
            Toast("Your journal account is connected. Open Tasks to see your rituals.", 7f);
            yield return LoadAccountState();
        }

        private void CreateInterface()
        {
            var go = new GameObject("CampInterface", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            go.transform.SetParent(transform, false);
            go.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = go.GetComponent<CanvasScaler>();
            canvas = go.GetComponent<RectTransform>();
            safeArea = Box(canvas, "CampSafeArea", Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            safeArea.anchorMax = Vector2.one;
            phoneLayout = go.AddComponent<CampPhoneLayout>();
            phoneLayout.Configure(go.GetComponent<Canvas>(), scaler, safeArea);
            if (FindFirstObjectByType<EventSystem>() == null)
                new GameObject("CampEventSystem", typeof(EventSystem), typeof(StandaloneInputModule));

            headingPanel = Panel(safeArea, "CampHeading", Vector2.zero, new Vector2(0, 1), new Vector2(0, 1), Vector2.zero, paper);
            titleLabel = Label(headingPanel, "YOUR WORLD", 24, Vector2.zero, Vector2.zero, TextAnchor.UpperLeft, ink, FontStyle.Bold);
            titleLabel.resizeTextForBestFit = true;
            titleLabel.resizeTextMinSize = 16;
            titleLabel.resizeTextMaxSize = 24;
            titleLabel.name = "CampTitle";
            progressLabel = Label(headingPanel, "", 16, Vector2.zero, Vector2.zero, TextAnchor.UpperLeft, teal);
            progressLabel.resizeTextForBestFit = true;
            progressLabel.resizeTextMinSize = 14;
            progressLabel.resizeTextMaxSize = 16;
            progressLabel.name = "AccountProgress";
            modeLabel = Label(headingPanel, "", 15, Vector2.zero, Vector2.zero, TextAnchor.UpperLeft, ink, FontStyle.Bold);
            modeLabel.name = "AccountMode";
            connectButton = Button(headingPanel, "Connect your account", Vector2.zero, new Vector2(136, 48), OpenConnection);
            connectButton.name = "AccountButton";
            sessionHint = Label(headingPanel, "", 14, Vector2.zero, Vector2.zero, TextAnchor.UpperLeft, ink);
            sessionHint.name = "SessionHint";

            controlsPanel = Panel(safeArea, "CampActions", Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero, paper);
            boardButton = Button(controlsPanel, "Tasks", Vector2.zero, new Vector2(100, 48), OpenTaskBoard);
            boardButton.name = "TasksButton";
            patButton = Button(controlsPanel, "Say hello", Vector2.zero, new Vector2(100, 48), PatCompanion);
            patButton.name = "PatCompanionButton";
            swapButton = Button(controlsPanel, "Change look", Vector2.zero, new Vector2(100, 48), SwapCompanion, true);
            swapButton.name = "SwapCompanionButton";

            footerPanel = Panel(safeArea, "InteractionHint", Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero, new Color(teal.r, teal.g, teal.b, 0.94f));
            promptLabel = Label(footerPanel, "", 14, Vector2.zero, Vector2.zero, TextAnchor.MiddleCenter, paper, FontStyle.Bold);
            promptLabel.name = "MovementHint";
            toastLabel = Label(footerPanel, "", 15, Vector2.zero, Vector2.zero, TextAnchor.MiddleCenter, paper);
            toastLabel.name = "CampMessage";
            phoneLayout.LayoutChanged += LayoutInterface;
            LayoutInterface();
        }

        public void OpenTaskBoard()
        {
            if (busy) return;
            if (!boardOpen) boardScrollPosition = 1f;
            boardOpen = true;
            DrawTaskBoard();
            if (!IsDemo) StartCoroutine(LoadAccountState());
        }

        private void DrawTaskBoard()
        {
            if (modalScroll != null && boardOpen) boardScrollPosition = modalScroll.verticalNormalizedPosition;
            BeginModal("YOUR DAILY RITUALS", "Small things, done with care.");
            var content = modalScroll.content;
            FlowLabel(content, "RitualExplanation", IsDemo
                ? "DEMO PRACTICE · This stays in your local camp."
                : "Choose a ritual you have actually done. Your account records it immediately.",
                16, ink);
            var status = boardStatus;
            if (busy) status = "Loading your progress…";
            if (!string.IsNullOrEmpty(status))
                FlowLabel(content, "RitualStatus", status, 15, outcomeUnknown ? new Color(0.57f, 0.25f, 0.13f) : teal);
            if (IsDemo)
            {
                TaskRow(content, "DemoPracticeRitual", "Try your first camp ritual", demoComplete ? "Practice saved. Ready to connect your own rituals?" : "Practice logging one small thing you did today.",
                    demoComplete ? "Practised" : "Practice ritual", !demoComplete && !busy, PracticeRitual);
            }
            else if (habits.Length == 0 && !busy)
            {
                FlowLabel(content, "NoRitualsMessage", "No published positive rituals yet.\nAdd one in the web app, then refresh here.", 18, ink);
            }
            else
            {
                foreach (var habit in habits)
                {
                    var selected = habit;
                    bool capped = selected.DailyLimitReached;
                    string allowance = $"{selected.taps_today} / {selected.max_taps_per_day} recorded today";
                    TaskRow(content, "Ritual_" + selected.id, selected.name, allowance, capped ? "Done today" : "I did this", !busy && !outcomeUnknown && !capped,
                        () => StartCoroutine(RecordRitual(selected)));
                }
            }
            var refresh = FooterButton("RefreshRitualsButton", outcomeUnknown && canResolveOutcome ? "I checked ritual history" : "Refresh tasks", () =>
            {
                if (outcomeUnknown && canResolveOutcome) ResolveUncertainSave();
                else StartCoroutine(LoadAccountState());
            });
            refresh.interactable = !busy && !IsDemo;
            var close = FooterButton("CloseRitualsButton", "Back to camp", CloseModal);
            close.interactable = !busy;
            LayoutInterface();
            Canvas.ForceUpdateCanvases();
            modalScroll.verticalNormalizedPosition = boardScrollPosition;
        }

        private void TaskRow(RectTransform parent, string name, string title, string detail, string action, bool enabled, Action clicked)
        {
            var row = Panel(parent, name, Vector2.zero, new Vector2(0, 1), new Vector2(0, 1), Vector2.zero, new Color(1, 1, 1, 0.66f));
            VerticalFlow(row, 12, 8);
            FlowLabel(row, "RitualName", title, 18, ink, FontStyle.Bold);
            FlowLabel(row, "RitualAllowance", detail, 15, teal);
            var button = FlowButton(row, "RecordRitualButton", action, clicked);
            button.interactable = enabled;
        }

        private void PracticeRitual()
        {
            if (demoComplete || busy || !IsDemo) return;
            demoComplete = true;
            PlayerPrefs.SetInt(DemoPracticeKey, 1);
            PlayerPrefs.Save();
            boardStatus = "Practice saved locally. Connect your account to record real rituals.";
            CloseModal();
            companion?.Celebrate();
            RefreshHud();
            Toast("Practice saved. Your companion is cheering you on!", 7f);
        }

        private IEnumerator RecordRitual(HabitDto habit)
        {
            if (busy || IsDemo || outcomeUnknown) yield break;
            busy = true;
            boardStatus = "Recording your ritual…";
            DrawTaskBoard();
            HabitTapDto receipt = null;
            ApiError failure = null;
            yield return api.LogPositiveHabit(habit, value => receipt = value, error => failure = error);
            busy = false;
            if (failure != null)
            {
                outcomeUnknown = failure.OutcomeUnknown;
                canResolveOutcome = false;
                uncertainHabitId = habit.id;
                uncertainTapsBefore = habit.taps_today;
                boardStatus = failure.Message;
                if (outcomeUnknown)
                    boardStatus += " Refresh tasks to check the result before recording anything else.";
                if (failure.RequiresLogin) api.ClearSession();
                RefreshHud();
                if (boardOpen) DrawTaskBoard();
                yield break;
            }
            if (receipt == null)
            {
                outcomeUnknown = true;
                canResolveOutcome = false;
                uncertainHabitId = habit.id;
                uncertainTapsBefore = habit.taps_today;
                boardStatus = "The response could not be confirmed. Refresh tasks before continuing.";
                if (boardOpen) DrawTaskBoard();
                yield break;
            }
            CloseModal();
            companion?.Celebrate();
            Toast($"Recorded: {habit.name}. Strength: {receipt.new_strength}.", 8f);
            boardStatus = receipt.DescribeConfirmedOutcome(habit);
            yield return LoadAccountState();
        }

        private IEnumerator LoadAccountState()
        {
            if (busy || IsDemo) yield break;
            busy = true;
            canResolveOutcome = false;
            if (boardOpen) DrawTaskBoard();
            ApiError failure = null;
            HabitDto[] loadedHabits = null;
            yield return api.FetchHabits(value => loadedHabits = value, error => failure = error);
            if (failure == null && loadedHabits != null)
            {
                habits = loadedHabits;
                if (outcomeUnknown)
                {
                    var checkedHabit = Array.Find(habits, item => item.id == uncertainHabitId);
                    if (checkedHabit != null && checkedHabit.taps_today > uncertainTapsBefore)
                    {
                        outcomeUnknown = false;
                        boardStatus = "Your ritual is recorded. Progress refreshed from your account.";
                    }
                    else
                    {
                        canResolveOutcome = true;
                        boardStatus = "The earlier result is still uncertain. Check ritual history in the web app, then choose 'I checked ritual history' to continue.";
                    }
                }
                else if (string.IsNullOrEmpty(boardStatus)) boardStatus = "Your progress is up to date.";
                yield return api.FetchCharacter(value => character = value, error => failure = error);
            }
            busy = false;
            if (failure != null)
            {
                boardStatus = failure.Message;
                if (failure.RequiresLogin)
                {
                    api.ClearSession();
                    habits = Array.Empty<HabitDto>();
                    character = null;
                }
            }
            RefreshHud();
            if (boardOpen) DrawTaskBoard();
        }

        private void ResolveUncertainSave()
        {
            if (busy || IsDemo || !outcomeUnknown || !canResolveOutcome) return;
            outcomeUnknown = false;
            canResolveOutcome = false;
            boardStatus = "Earlier result reviewed. Record only rituals that are missing from your history.";
            if (boardOpen) DrawTaskBoard();
        }

        private void OpenConnection()
        {
            if (busy) return;
            boardOpen = false;
            if (!IsDemo)
            {
                api.ClearSession();
                habits = Array.Empty<HabitDto>();
                character = null;
                outcomeUnknown = false;
                canResolveOutcome = false;
                boardStatus = "";
                RefreshHud();
                Toast("Signed out of this camp. You can keep exploring in demo mode.");
                return;
            }
#if UNITY_WEBGL && !UNITY_EDITOR
            BeginModal("BRING YOUR PROGRESS", "Use the same account as your journal.");
            FlowLabel(modalScroll.content, "ConnectionMessage", "Sign in or switch accounts in your journal, then return here. Your world will connect to that account.", 16, ink);
            FooterButton("OpenJournalButton", "Open journal", api.OpenJournal);
            FlowButton(modalScroll.content, "ResumeJournalButton", "Connect journal account", () =>
            {
                CloseModal();
                StartCoroutine(ConnectBrowserSession());
            });
            FooterButton("CancelConnectionButton", "Keep exploring", CloseModal);
            LayoutInterface();
#else
            BeginModal("BRING YOUR PROGRESS", "Connect your existing Abby account.");
            var content = modalScroll.content;
            InputField server = null;
#if !UNITY_WEBGL || UNITY_EDITOR
            FlowLabel(content, "ServerAddressLabel", "Server address", 15, ink, FontStyle.Bold);
            server = FlowInput(content, "ServerAddressInput", api.BaseUrl, "https://your-abby-app.example", false);
            server.keyboardType = TouchScreenKeyboardType.URL;
#endif
            FlowLabel(content, "UsernameLabel", "Username", 15, ink, FontStyle.Bold);
            var username = FlowInput(content, "UsernameInput", "", "Your child account", false);
            FlowLabel(content, "PasswordLabel", "Password", 15, ink, FontStyle.Bold);
            var password = FlowInput(content, "PasswordInput", "", "Password", true);
            var message = FlowLabel(content, "ConnectionMessage", "Signing in here replaces other sessions for this account. Your password is never saved by the camp.", 15, ink);
            Button submit = null;
            Button cancel = null;
            submit = FooterButton("ConnectAccountButton", "Connect", () =>
            {
                if (busy) return;
                if (!api.ConfigureBaseUrl(server == null ? api.BaseUrl : server.text, out var error)) { message.text = error; return; }
                if (string.IsNullOrWhiteSpace(username.text) || string.IsNullOrEmpty(password.text))
                { message.text = "Enter your username and password."; return; }
                StartCoroutine(Connect(username.text.Trim(), password.text, message, submit, cancel));
                password.text = "";
            });
            cancel = FooterButton("CancelConnectionButton", "Keep exploring", CloseModal);
            LayoutInterface();
#endif
        }

        private IEnumerator Connect(string username, string password, Text message, Button submit, Button cancel)
        {
            busy = true;
            submit.interactable = false;
            cancel.interactable = false;
            message.text = "Connecting…";
            UserDto user = null;
            ApiError failure = null;
            yield return api.Login(username, password, value => user = value, error => failure = error);
            busy = false;
            if (failure != null)
            {
                message.text = failure.Message;
                submit.interactable = true;
                cancel.interactable = true;
                RefreshHud();
                yield break;
            }
            if (user == null || user.role != "child")
            {
                api.ClearSession();
                message.text = "This camp uses a child account. Parent tools are available in the web app.";
                submit.interactable = true;
                cancel.interactable = true;
                yield break;
            }
            outcomeUnknown = false;
            canResolveOutcome = false;
            boardStatus = "";
            CloseModal();
            RefreshHud();
            Toast("Connected. Open Tasks to see your rituals.", 7f);
            yield return LoadAccountState();
        }

        private void SwapCompanion()
        {
            if (busy || IsModalOpen || companion == null) return;
            companion.ToggleAppearance();
            Toast("A new look, with the same companion behavior and progress.", 5f);
        }

        /// <summary>A friendly local reaction. Petting never calls the API or awards progress.</summary>
        public void PatCompanion()
        {
            if (busy || IsModalOpen || companion == null || Time.unscaledTime < patAvailableAt) return;
            patAvailableAt = Time.unscaledTime + 0.8f;
            companion.Celebrate();
            Toast("Your companion is happy to see you!", 4f);
        }

        private void RefreshHud()
        {
            if (modeLabel == null) return;
            modeLabel.text = IsDemo ? "DEMO CAMP" : "CONNECTED · " + api.CurrentUser.DisplayName;
            sessionHint.text = IsDemo ? "Explore, say hello, or try a practice ritual."
                : "Open Tasks to record a ritual you have done.";
            connectButton.GetComponentInChildren<Text>().text = IsDemo ? "Connect your account" : "Sign out of camp";
            connectButton.interactable = !busy;
            progressLabel.text = IsDemo
                ? (demoComplete ? "Practice saved" : "Try a ritual")
                : character == null ? "Connected" : $"Level {character.level} · Streak {character.login_streak}";
        }

        private RectTransform BeginModal(string title, string subtitle)
        {
            if (modal != null) { modal.SetActive(false); Destroy(modal); }
            var backdrop = Panel(canvas, "ModalBackdrop", Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero, new Color(0.06f, 0.12f, 0.12f, 0.70f));
            backdrop.anchorMin = Vector2.zero;
            backdrop.anchorMax = Vector2.one;
            backdrop.offsetMin = Vector2.zero;
            backdrop.offsetMax = Vector2.zero;
            modal = backdrop.gameObject;
            modalSafeArea = Box(backdrop, "ModalSafeArea", Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            modalSheet = Panel(modalSafeArea, "CampSheet", Vector2.zero, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, paper);
            modalTitle = Label(modalSheet, title, 23, Vector2.zero, Vector2.zero, TextAnchor.UpperLeft, ink, FontStyle.Bold);
            modalTitle.name = "SheetTitle";
            modalSubtitle = Label(modalSheet, subtitle, 16, Vector2.zero, Vector2.zero, TextAnchor.UpperLeft, teal);
            modalSubtitle.name = "SheetSubtitle";
            var viewport = Panel(modalSheet, "SheetViewport", Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero, new Color(0, 0, 0, 0.03f));
            viewport.anchorMax = Vector2.one;
            viewport.offsetMin = new Vector2(16, 76);
            viewport.offsetMax = new Vector2(-16, -94);
            viewport.gameObject.AddComponent<RectMask2D>();
            var content = Box(viewport, "SheetContent", Vector2.zero, new Vector2(0, 1), new Vector2(0, 1), Vector2.zero);
            content.anchorMax = Vector2.one;
            content.anchorMin = new Vector2(0, 1);
            VerticalFlow(content, 0, 12);
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            modalScroll = viewport.gameObject.AddComponent<ScrollRect>();
            modalScroll.horizontal = false;
            modalScroll.viewport = viewport;
            modalScroll.content = content;
            modalScroll.movementType = ScrollRect.MovementType.Clamped;
            modalScroll.scrollSensitivity = 24f;
            modalFooter = Box(modalSheet, "SheetActions", Vector2.zero, Vector2.zero, Vector2.zero, Vector2.zero);
            var footerLayout = modalFooter.gameObject.AddComponent<HorizontalLayoutGroup>();
            footerLayout.spacing = 12;
            footerLayout.childControlHeight = true;
            footerLayout.childControlWidth = true;
            footerLayout.childForceExpandWidth = true;
            footerLayout.childForceExpandHeight = false;
            player?.SetInputEnabled(false);
            taskBoard?.SetInputEnabled(false);
            LayoutInterface();
            return modalSheet;
        }

        private void CloseModal()
        {
            if (busy) return;
            DismissModal();
        }

        private void DismissModal()
        {
            if (modal != null) Destroy(modal);
            modal = null;
            modalSheet = null;
            modalSafeArea = null;
            modalScroll = null;
            modalFooter = null;
            boardOpen = false;
            player?.SetInputEnabled(true);
            taskBoard?.SetInputEnabled(true);
        }

        private void LayoutInterface()
        {
            if (safeArea == null || headingPanel == null) return;
            revealFocusedInput = true;
            var size = safeArea.rect.size;
            var landscape = phoneLayout.IsLandscape;
            var width = Mathf.Max(1, size.x - 24);
            var headerHeight = landscape ? 86 : 132;
            Place(headingPanel, new Vector2(12, -12), new Vector2(width, headerHeight));
            Place(titleLabel.rectTransform, new Vector2(12, -10), new Vector2(width - 164, 30));
            Place(progressLabel.rectTransform, new Vector2(12, -42), new Vector2(width - 164, 24));
            Place(modeLabel.rectTransform, new Vector2(12, -68), new Vector2(width - 24, 24));
            // In landscape, use one status line and give the actors room to breathe.
            if (landscape)
            {
                Place(modeLabel.rectTransform, new Vector2(12, -60), new Vector2(width - 164, 22));
                Place(progressLabel.rectTransform, new Vector2(12, -36), new Vector2(width - 164, 22));
            }
            Place(connectButton.GetComponent<RectTransform>(), new Vector2(width - 148, -12), new Vector2(136, 48));
            ResizeButtonLabel(connectButton);
            sessionHint.gameObject.SetActive(!landscape);
            Place(sessionHint.rectTransform, new Vector2(12, -96), new Vector2(width - 24, 32));

            var actionWidth = landscape ? Mathf.Min(width, 540) : width;
            controlsPanel.anchorMin = controlsPanel.anchorMax = Vector2.zero;
            controlsPanel.pivot = Vector2.zero;
            controlsPanel.anchoredPosition = new Vector2((size.x - actionWidth) / 2, 12);
            controlsPanel.sizeDelta = new Vector2(actionWidth, 64);
            var buttonWidth = (actionWidth - 40) / 3;
            var buttons = new[] { boardButton, patButton, swapButton };
            for (int i = 0; i < buttons.Length; i++)
            {
                Place(buttons[i].GetComponent<RectTransform>(), new Vector2(12 + i * (buttonWidth + 8), -8), new Vector2(buttonWidth, 48));
                ResizeButtonLabel(buttons[i]);
            }
            var footerWidth = landscape ? Mathf.Min(width, 640) : width;
            var footerHeight = landscape ? 58 : 80;
            footerPanel.anchorMin = footerPanel.anchorMax = Vector2.zero;
            footerPanel.pivot = Vector2.zero;
            footerPanel.anchoredPosition = new Vector2((size.x - footerWidth) / 2, 84);
            footerPanel.sizeDelta = new Vector2(footerWidth, footerHeight);
            Place(promptLabel.rectTransform, new Vector2(10, -4), new Vector2(footerWidth - 20, 22));
            Place(toastLabel.rectTransform, new Vector2(10, -28), new Vector2(footerWidth - 20, footerHeight - 30));

            if (modalSheet == null || modalSafeArea == null) return;
            modalSafeArea.anchorMin = safeArea.anchorMin;
            modalSafeArea.anchorMax = safeArea.anchorMax;
            modalSafeArea.offsetMin = modalSafeArea.offsetMax = Vector2.zero;
            var compactSheet = size.y < 300;
            var sheetSize = new Vector2(Mathf.Min(580, size.x - 24), Mathf.Min(760, size.y - (compactSheet ? 0 : 24)));
            modalSheet.sizeDelta = sheetSize;
            modalTitle.fontSize = compactSheet ? 20 : 23;
            Place(modalTitle.rectTransform, new Vector2(16, compactSheet ? -8 : -16), new Vector2(sheetSize.x - 32, 32));
            modalSubtitle.gameObject.SetActive(!compactSheet);
            Place(modalSubtitle.rectTransform, new Vector2(16, -54), new Vector2(sheetSize.x - 32, 36));
            modalScroll.viewport.offsetMin = new Vector2(16, compactSheet ? 64 : 76);
            modalScroll.viewport.offsetMax = new Vector2(-16, compactSheet ? -44 : -94);
            modalFooter.anchorMin = modalFooter.anchorMax = Vector2.zero;
            modalFooter.pivot = Vector2.zero;
            modalFooter.anchoredPosition = new Vector2(16, compactSheet ? 8 : 16);
            modalFooter.sizeDelta = new Vector2(sheetSize.x - 32, 48);
            Canvas.ForceUpdateCanvases();
            if (modalScroll != null)
            {
                LayoutRebuilder.ForceRebuildLayoutImmediate(modalScroll.content);
                foreach (var button in modalSheet.GetComponentsInChildren<Button>()) ResizeButtonLabel(button);
            }
        }

        private void KeepFocusedInputVisible()
        {
            if (modalScroll == null || EventSystem.current == null) return;
            var selected = EventSystem.current.currentSelectedGameObject;
            if (selected == null || selected.GetComponent<InputField>() == null || !selected.transform.IsChildOf(modalScroll.content))
            {
                lastFocusedInput = null;
                return;
            }
            if (selected == lastFocusedInput && !revealFocusedInput) return;
            lastFocusedInput = selected;
            revealFocusedInput = false;
            // Reveal once on focus/resize, leaving the user free to scroll afterwards.
            LayoutRebuilder.ForceRebuildLayoutImmediate(modalScroll.content);
            var bounds = RectTransformUtility.CalculateRelativeRectTransformBounds(modalScroll.viewport, selected.transform);
            var view = modalScroll.viewport.rect;
            var position = modalScroll.content.anchoredPosition;
            if (bounds.min.y < view.yMin + 12) position.y += view.yMin + 12 - bounds.min.y;
            else if (bounds.max.y > view.yMax - 12) position.y -= bounds.max.y - (view.yMax - 12);
            position.y = Mathf.Clamp(position.y, 0, Mathf.Max(0, modalScroll.content.rect.height - view.height));
            modalScroll.content.anchoredPosition = position;
        }

        /// <summary>Read-only sizing diagnostics for device/viewport checks.</summary>
        public string DescribePhoneLayout()
        {
            if (safeArea == null) return "Camp UI has not started.";
            return $"Camp UI: screen={Screen.width}x{Screen.height}, safe={phoneLayout.UsableScreenRect}, logical={safeArea.rect.size}, minTarget=48, modal={(modalSheet == null ? Vector2.zero : modalSheet.rect.size)}";
        }

        public void LogPhoneLayout() => Debug.Log(DescribePhoneLayout());

        private static void Place(RectTransform rect, Vector2 position, Vector2 size)
        {
            rect.anchorMin = rect.anchorMax = new Vector2(0, 1);
            rect.pivot = new Vector2(0, 1);
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
        }

        private static void ResizeButtonLabel(Button button)
        {
            var label = button.GetComponentInChildren<Text>();
            if (label == null) return;
            label.rectTransform.anchorMin = Vector2.zero;
            label.rectTransform.anchorMax = Vector2.one;
            label.rectTransform.offsetMin = new Vector2(8, 0);
            label.rectTransform.offsetMax = new Vector2(-8, 0);
        }

        private static void VerticalFlow(RectTransform rect, int padding, int spacing)
        {
            var layout = rect.gameObject.AddComponent<VerticalLayoutGroup>();
            layout.padding = new RectOffset(padding, padding, padding, padding);
            layout.spacing = spacing;
            layout.childControlWidth = true;
            layout.childControlHeight = true;
            layout.childForceExpandWidth = true;
            layout.childForceExpandHeight = false;
        }

        private Text FlowLabel(RectTransform parent, string name, string value, int size, Color color, FontStyle style = FontStyle.Normal)
        {
            var text = Label(parent, value, size, Vector2.zero, Vector2.zero, TextAnchor.UpperLeft, color, style);
            text.name = name;
            text.supportRichText = false;
            return text;
        }

        private Button FlowButton(RectTransform parent, string name, string label, Action clicked)
        {
            var button = Button(parent, label, Vector2.zero, new Vector2(100, 48), clicked);
            button.name = name;
            var layout = button.gameObject.AddComponent<LayoutElement>();
            layout.minHeight = layout.preferredHeight = 48;
            layout.flexibleWidth = 1;
            return button;
        }

        private Button FooterButton(string name, string label, Action clicked) => FlowButton(modalFooter, name, label, clicked);

        private InputField FlowInput(RectTransform parent, string name, string value, string placeholder, bool secret)
        {
            var input = InputField(parent, value, placeholder, Vector2.zero, secret);
            input.name = name;
            var layout = input.gameObject.AddComponent<LayoutElement>();
            layout.minHeight = layout.preferredHeight = 48;
            foreach (var text in input.GetComponentsInChildren<Text>())
            {
                text.rectTransform.anchorMin = Vector2.zero;
                text.rectTransform.anchorMax = Vector2.one;
                text.rectTransform.offsetMin = new Vector2(12, 6);
                text.rectTransform.offsetMax = new Vector2(-12, -6);
            }
            input.shouldHideMobileInput = false;
            return input;
        }

        private void Toast(string message, float duration = 5f)
        {
            if (toastLabel == null) return;
            toastLabel.text = message;
            toastUntil = Time.unscaledTime + duration;
        }

        private RectTransform Box(Transform parent, string name, Vector2 size, Vector2 anchor, Vector2 pivot, Vector2 position)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var rect = go.GetComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = anchor;
            rect.anchorMax = anchor;
            rect.pivot = pivot;
            rect.sizeDelta = size;
            rect.anchoredPosition = position;
            return rect;
        }

        private RectTransform Panel(Transform parent, string name, Vector2 size, Vector2 anchor, Vector2 pivot, Vector2 position, Color color)
        {
            var rect = Box(parent, name, size, anchor, pivot, position);
            rect.gameObject.AddComponent<Image>().color = color;
            return rect;
        }

        private Text Label(Transform parent, string value, int size, Vector2 position, Vector2 dimensions, TextAnchor alignment, Color color, FontStyle style = FontStyle.Normal)
        {
            var rect = Box(parent, "Label", dimensions, new Vector2(0, 1), new Vector2(0, 1), position);
            var text = rect.gameObject.AddComponent<Text>();
            text.font = font;
            text.text = value;
            text.supportRichText = false;
            text.fontSize = size;
            text.fontStyle = style;
            text.color = color;
            text.alignment = alignment;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.raycastTarget = false;
            return text;
        }

        private Button Button(Transform parent, string label, Vector2 position, Vector2 size, Action clicked, bool quiet = false)
        {
            var rect = Panel(parent, label, size, new Vector2(0, 1), new Vector2(0, 1), position, quiet ? new Color(0.13f, 0.4f, 0.37f, 0.10f) : teal);
            var button = rect.gameObject.AddComponent<Button>();
            button.targetGraphic = rect.GetComponent<Image>();
            var colors = button.colors;
            colors.highlightedColor = new Color(1.10f, 1.10f, 1.10f);
            colors.pressedColor = new Color(0.75f, 0.85f, 0.80f);
            colors.disabledColor = new Color(0.55f, 0.55f, 0.55f, 0.65f);
            button.colors = colors;
            button.onClick.AddListener(() => clicked());
            Label(rect, label, quiet ? 14 : 16, Vector2.zero, size, TextAnchor.MiddleCenter, quiet ? teal : Color.white, FontStyle.Bold);
            return button;
        }

        private InputField InputField(Transform parent, string value, string placeholder, Vector2 position, bool secret)
        {
            var rect = Panel(parent, "Input", new Vector2(564, 48), new Vector2(0, 1), new Vector2(0, 1), position, Color.white);
            var input = rect.gameObject.AddComponent<InputField>();
            var text = Label(rect, "", 18, new Vector2(12, -7), new Vector2(540, 34), TextAnchor.MiddleLeft, ink);
            text.supportRichText = false;
            var hint = Label(rect, placeholder, 18, new Vector2(12, -7), new Vector2(540, 34), TextAnchor.MiddleLeft, new Color(0.45f, 0.49f, 0.49f));
            hint.supportRichText = false;
            input.textComponent = text;
            input.placeholder = hint;
            input.contentType = secret ? UnityEngine.UI.InputField.ContentType.Password : UnityEngine.UI.InputField.ContentType.Standard;
            input.characterLimit = secret ? 256 : 2048;
            input.text = value;
            return input;
        }
    }
}
