#if UNITY_EDITOR || DEVELOPMENT_BUILD
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using AbbyCamp.Data;
using AbbyCamp.Services;
using AbbyCamp.UI;
using AbbyCamp.World;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace AbbyCamp.Validation
{
    /// <summary>Opt-in development-build smoke: exercises actual UI, physics,
    /// asset swaps, persistence and the disposable Django HTTP fixture.</summary>
    public sealed class CampRuntimeSmoke : MonoBehaviour
    {
        private const string DemoKey = "AbbyCamp.Demo.PracticeCompleted";
        private readonly List<string> checks = new List<string>();
        private readonly List<string> runtimeErrors = new List<string>();
        private bool hadDemoValue;
        private int oldDemoValue;
        private bool failed;
        private string output;
        private string fixtureUrl;
        private string username;
        private string password;
        private bool failFirstSave;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Bootstrap()
        {
            var args = Environment.GetCommandLineArgs();
            if (Array.IndexOf(args, "--abby-smoke") < 0) return;
            var instance = new GameObject("DevelopmentSmoke").AddComponent<CampRuntimeSmoke>();
            DontDestroyOnLoad(instance.gameObject);
            instance.hadDemoValue = PlayerPrefs.HasKey(DemoKey);
            instance.oldDemoValue = PlayerPrefs.GetInt(DemoKey, 0);
            PlayerPrefs.DeleteKey(DemoKey);
            PlayerPrefs.Save();
            instance.output = Argument(args, "--abby-smoke-output") ?? Path.Combine(Application.persistentDataPath, "Smoke");
            instance.fixtureUrl = Argument(args, "--abby-api-url");
            instance.username = Argument(args, "--abby-api-user");
            instance.password = Argument(args, "--abby-api-password");
            instance.failFirstSave = Array.IndexOf(args, "--abby-smoke-failed-save") >= 0;
            Directory.CreateDirectory(instance.output);
            Application.runInBackground = true;
        }

        private static string Argument(string[] args, string name)
        {
            int index = Array.IndexOf(args, name);
            return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
        }

        private void Start()
        {
            Application.logMessageReceived += ObserveLog;
            StartCoroutine(Monitor(Run()));
        }

        private void ObserveLog(string message, string trace, LogType type)
        {
            if (type == LogType.Exception || type == LogType.Error || type == LogType.Assert)
                runtimeErrors.Add(message);
        }

        private IEnumerator Monitor(IEnumerator routine)
        {
            while (!failed)
            {
                object step = null;
                bool moved = false;
                Exception problem = null;
                try { moved = routine.MoveNext(); if (moved) step = routine.Current; }
                catch (Exception exception) { problem = exception; }
                if (problem != null) { Finish(false, problem.ToString()); yield break; }
                if (!moved) yield break;
                if (step is IEnumerator nested && !(step is CustomYieldInstruction))
                    yield return Monitor(nested);
                else yield return step;
            }
        }

        private IEnumerator Run()
        {
            for (int frame = 0; frame < 25; frame++) yield return null;
            var player = FindFirstObjectByType<CampPlayerController>();
            var pet = FindFirstObjectByType<CompanionFollower>();
            var board = FindFirstObjectByType<CampTaskBoard>();
            var ui = FindFirstObjectByType<CampPrototypeController>();
            Check(player != null && pet != null && board != null && ui != null, "Runtime camp components are present");
            Check(ui.IsDemo && !ui.IsModalOpen, "Camp boots into explorable demo without a server");
            yield return WaitUntil(() => player.GetComponent<CharacterController>().isGrounded, 3f, "Player is grounded on the camp collision surface");
            yield return Capture("camp.png");

            var position = player.transform.position;
            player.SetDestination(position + new Vector3(1.8f, 0f, 0.8f));
            yield return new WaitForSecondsRealtime(1.2f);
            Check(Vector3.Distance(position, player.transform.position) > 0.5f, "Destination movement uses the live player controller");
            var petBefore = pet.transform.position;
            yield return new WaitForSecondsRealtime(0.6f);
            Check(Vector3.Distance(pet.transform.position, player.transform.position) < 3.5f, "Companion follows the player");
            var petRoot = pet.gameObject.GetEntityId();
            var identity = pet.GetComponent<CampEntityIdentity>();
            string stableId = identity != null ? identity.ContentId : "";
            var oldAppearance = pet.Appearance.Definition;
            pet.ToggleAppearance();
            yield return null;
            Check(pet.gameObject.GetEntityId() == petRoot && pet.Appearance.Definition != oldAppearance, "Dog/fox swap preserves the gameplay root");
            Check(identity != null && identity.ContentId == stableId && !string.IsNullOrEmpty(stableId), "Asset swap preserves the companion identity");
            Check(Vector3.Distance(petBefore, pet.transform.position) < 2.5f, "Asset swap preserves companion position and following");
            yield return Capture("alternate-companion.png");
            pet.ToggleAppearance();

            player.SetDestination(board.transform.position + new Vector3(0f, 0f, -1.5f));
            yield return WaitUntil(() => board.IsInRange, 8f, "Player can approach the task board");
            player.SetInputEnabled(false);
            player.SetInputEnabled(true);
            ui.OpenTaskBoard();
            yield return null;
            Check(ui.IsModalOpen && !player.InputEnabled, "Task board opens and suspends world input");
            yield return Capture("task-board.png");
            Click("Practice ritual");
            yield return null;
            Check(PlayerPrefs.GetInt(DemoKey) == 1 && !ui.IsModalOpen && player.InputEnabled, "Demo practice persists and returns to camp");
            yield return new WaitForSecondsRealtime(0.4f);
            yield return Capture("celebration.png");
            SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
            for (int frame = 0; frame < 20; frame++) yield return null;
            ui = FindFirstObjectByType<CampPrototypeController>();
            player = FindFirstObjectByType<CampPlayerController>();
            board = FindFirstObjectByType<CampTaskBoard>();
            Check(HasText("Practice saved"), "Reopening the camp restores demo progress");

            if (!string.IsNullOrEmpty(fixtureUrl))
            {
                Click("Connect your account");
                yield return null;
                var inputs = FindObjectsByType<InputField>(FindObjectsSortMode.None);
                Array.Sort(inputs, (a, b) => a.transform.GetSiblingIndex().CompareTo(b.transform.GetSiblingIndex()));
                Check(inputs.Length == 3, "Connection form exposes server, username, password");
                inputs[0].text = fixtureUrl;
                inputs[1].text = username;
                inputs[2].text = password;
                Click("Connect");
                yield return WaitUntil(() => !ui.IsBusy && !ui.IsModalOpen, 20f, "Connection and account reads complete");
                var api = ui.GetComponent<AbbyApiClient>();
                Check(api.IsAuthenticated && api.CurrentUser.role == "child" && !ui.IsDemo, "Real Django login succeeds through the UI");
                ApiError problem = null;
                UserDto me = null;
                yield return api.FetchMe(value => me = value, error => problem = error);
                Check(problem == null && me != null && me.id == api.CurrentUser.id, "Authenticated account round trip matches the child");
                HabitDto[] habits = null;
                yield return api.FetchHabits(value => habits = value, error => problem = error);
                Check(problem == null && habits != null && habits.Length == 2, "Pagination and scoping expose only two published positive child habits");
                var habit = Array.Find(habits, item => !item.DailyLimitReached);
                Check(habit != null, "An uncapped fixture ritual is available");
                int oldTaps = habit.taps_today;
                int oldStrength = habit.strength;
                ui.OpenTaskBoard();
                yield return WaitUntil(() => !ui.IsBusy, 10f, "Task board fetch finishes");
                yield return Capture("connected-task-board.png");
                if (failFirstSave)
                {
                    Click("I did this");
                    yield return WaitUntil(() => !ui.IsBusy, 10f, "Injected unavailable save response completes");
                    Check(ui.IsModalOpen && !FindButton("I did this").interactable,
                        "An uncertain save keeps the board open and blocks another tap");
                    Check(FindButton("I checked ritual history") == null,
                        "History acknowledgement requires a successful refresh first");
                    yield return Capture("uncertain-save.png");
                    Click("Refresh tasks");
                    yield return WaitUntil(() => !ui.IsBusy, 10f, "Uncertain save refresh finishes");
                    Check(FindButton("I checked ritual history") != null && !FindButton("I did this").interactable,
                        "A refreshed uncertain result still needs explicit history acknowledgement");
                    yield return api.FetchHabits(value => habits = value, error => problem = error);
                    Check(problem == null && Array.Find(habits, item => item.id == habit.id).taps_today == oldTaps,
                        "The injected failure and refresh saved no fixture habit");
                    Click("I checked ritual history");
                    Check(ui.IsModalOpen && FindButton("I did this").interactable,
                        "Explicit history acknowledgement restores the ritual action");
                    yield return api.FetchHabits(value => habits = value, error => problem = error);
                    Check(problem == null && Array.Find(habits, item => item.id == habit.id).taps_today == oldTaps,
                        "Acknowledgement itself sends no habit mutation");
                }
                Click("I did this");
                yield return WaitUntil(() => !ui.IsBusy && !ui.IsModalOpen, 20f, "Real habit logging and reconciliation finish");
                yield return api.FetchHabits(value => habits = value, error => problem = error);
                var recorded = Array.Find(habits, item => item.id == habit.id);
                Check(problem == null && recorded != null && recorded.taps_today == oldTaps + 1 && recorded.strength == oldStrength + 1,
                    "UI action records exactly one habit tap in the real Django ledger");
                HabitTapDto unexpected = null;
                problem = null;
                yield return api.LogPositiveHabit(recorded, value => unexpected = value, error => problem = error);
                Check(unexpected == null && problem != null && !problem.OutcomeUnknown, "Daily cap rejects a duplicate positive tap");
                Click("Sign out of camp");
                Check(ui.IsDemo && !api.IsAuthenticated, "Sign-out returns to demo and clears the memory-only session");
                problem = null;
                yield return api.LogPositiveHabit(recorded, value => unexpected = value, error => problem = error);
                Check(problem != null && problem.RequiresLogin, "Signed-out habit writes are rejected");
            }
            Check(runtimeErrors.Count == 0, "Smoke run contains no runtime errors");
            Finish(true, "");
        }

        private IEnumerator WaitUntil(Func<bool> predicate, float seconds, string label)
        {
            float end = Time.realtimeSinceStartup + seconds;
            while (!predicate() && Time.realtimeSinceStartup < end) yield return null;
            Check(predicate(), label);
        }

        private IEnumerator Capture(string name)
        {
            string path = Path.Combine(output, name);
            yield return CampPreviewCapture.Capture(path);
            Check(File.Exists(path) && new FileInfo(path).Length > 10000, "Rendered screenshot: " + name);
        }

        private void Check(bool condition, string label)
        {
            if (!condition) throw new InvalidOperationException(label);
            checks.Add(label);
        }

        private static bool HasText(string value)
        {
            foreach (var text in FindObjectsByType<Text>(FindObjectsSortMode.None))
                if (text.text.Contains(value)) return true;
            return false;
        }

        private static void Click(string caption)
        {
            var button = FindButton(caption);
            if (button == null) throw new InvalidOperationException("Button not found: " + caption);
            if (!button.interactable) throw new InvalidOperationException("Button is disabled: " + caption);
            button.onClick.Invoke();
        }

        private static Button FindButton(string caption)
        {
            foreach (var button in FindObjectsByType<Button>(FindObjectsSortMode.None))
            {
                var label = button.GetComponentInChildren<Text>();
                if (label == null || label.text != caption) continue;
                return button;
            }
            return null;
        }

        private void Finish(bool success, string detail)
        {
            failed = !success;
            Application.logMessageReceived -= ObserveLog;
            if (hadDemoValue) PlayerPrefs.SetInt(DemoKey, oldDemoValue); else PlayerPrefs.DeleteKey(DemoKey);
            PlayerPrefs.Save();
            string report = (success ? "PASSED" : "FAILED") + "\n" + string.Join("\n", checks) + "\n" + detail + "\n" + string.Join("\n", runtimeErrors);
            File.WriteAllText(Path.Combine(output, "smoke-results.txt"), report);
            Debug.Log("ABBY_CAMP_RUNTIME_SMOKE_" + (success ? "PASSED" : "FAILED") + ": " + checks.Count + " checks.");
            Application.Quit(success ? 0 : 1);
        }
    }
}
#endif
