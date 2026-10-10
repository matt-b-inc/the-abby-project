using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
using AbbyCamp.Data;
using UnityEngine;
using UnityEngine.Networking;

namespace AbbyCamp.Services
{
    /// <summary>
    /// Coroutine client for the existing Django API. Call these methods through
    /// StartCoroutine; each invokes exactly one success or failure callback while
    /// its coroutine remains alive. Session credentials exist only in memory.
    /// No request is retried automatically, including a failed mutation.
    /// </summary>
    public sealed class AbbyApiClient : MonoBehaviour
    {
        [SerializeField] private string baseUrl = "http://127.0.0.1:8000";
        [SerializeField, Range(5, 60)] private int timeoutSeconds = 20;

        private string token;
        private string configurationError;
        private int sessionVersion;
        private bool loginInFlight;
        private string browserOrigin;
        private string observedBrowserToken;
        private readonly HashSet<UnityWebRequest> activeRequests = new HashSet<UnityWebRequest>();
        private readonly Dictionary<int, HabitDto> knownHabits = new Dictionary<int, HabitDto>();

        public string BaseUrl => baseUrl;
        public UserDto CurrentUser { get; private set; }
        public bool IsAuthenticated => !string.IsNullOrEmpty(token) && CurrentUser != null;
        public bool MutationInFlight { get; private set; }
        public event Action BrowserSessionChanged;

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern string AbbySession_ReadToken();
        [DllImport("__Internal")] private static extern void AbbySession_ClearToken(string expectedToken);
        [DllImport("__Internal")] private static extern void AbbySession_OpenJournal();
#endif

        [Serializable] private sealed class LoginBody
        {
            public string action = "login";
            public string username;
            public string password;
        }

        [Serializable] private sealed class TapBody { public int direction = 1; }

        private void Awake()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            // A /play/ build connects to the same origin as the web app and API.
            // Never default a phone browser to the developer PC's loopback server.
            if (Uri.TryCreate(Application.absoluteURL, UriKind.Absolute, out var page))
                baseUrl = browserOrigin = page.GetLeftPart(UriPartial.Authority);
#endif
            if (!ConfigureBaseUrl(baseUrl, out var error)) configurationError = error;
#if UNITY_WEBGL && !UNITY_EDITOR
            observedBrowserToken = AbbySession_ReadToken() ?? "";
#endif
        }

        private void OnDestroy() => ClearSession();

        private void Update() => SynchronizeBrowserSession();

        // Read again before every request and after every response as well as
        // during play. Background tabs may pause Update while the journal logs
        // out or switches account. Never accept an old response into a new session.
        private bool SynchronizeBrowserSession()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            string current = AbbySession_ReadToken() ?? "";
            if (!string.Equals(observedBrowserToken, current, StringComparison.Ordinal))
            {
                observedBrowserToken = current;
                ClearSession();
                BrowserSessionChanged?.Invoke();
                return true;
            }
#endif
            return false;
        }

        public void OpenJournal()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            AbbySession_OpenJournal();
#endif
        }

        /// <summary>Web only: validate the journal's existing same-origin token
        /// using /me. No password login, token minting, or mutation is performed.
        /// Parent sessions remain available to the journal, not camp actions.</summary>
        public IEnumerator ResumeBrowserSession(Action<UserDto> success, Action<ApiError> failure)
        {
            SynchronizeBrowserSession();
            if (loginInFlight || MutationInFlight)
            {
                failure?.Invoke(new ApiError("Wait for the current action to finish before connecting."));
                yield break;
            }
            ClearSession();
            if (string.IsNullOrEmpty(observedBrowserToken))
            {
                failure?.Invoke(new ApiError("Sign in in your journal, then return to your world.", requiresLogin: true));
                yield break;
            }
            token = observedBrowserToken;
            loginInFlight = true;
            try
            {
                yield return Send("GET", baseUrl + "/api/auth/me/", null, true, false, json =>
                {
                    UserDto user;
                    try { user = ApiContract.ParseUser(json); }
                    catch (Exception exception)
                    {
                        ClearSession();
                        failure?.Invoke(InvalidResponse(exception, false));
                        return;
                    }
                    if (user.role != "child")
                    {
                        ClearSession();
                        failure?.Invoke(new ApiError("This world uses a child account. Parent tools are in the journal."));
                        return;
                    }
                    CurrentUser = user;
                    success?.Invoke(user);
                }, problem => { ClearSession(); failure?.Invoke(problem); }, validatingSession: true);
            }
            finally { loginInFlight = false; }
        }

        /// <summary>Accepts an origin such as https://abby.example.com. Plain HTTP
        /// is allowed only for loopback development. Changing origin ends session.</summary>
        public bool ConfigureBaseUrl(string value, out string error)
        {
            if (!TryValidateBaseUrl(value, out var origin, out error)) return false;
#if UNITY_WEBGL && !UNITY_EDITOR
            if (!string.Equals(origin, browserOrigin, StringComparison.Ordinal))
            {
                error = "Open your world from the same address as your journal.";
                return false;
            }
#endif
            if (!string.Equals(baseUrl, origin, StringComparison.Ordinal) || configurationError != null)
                ClearSession();
            baseUrl = origin;
            configurationError = null;
            return true;
        }

        public static bool TryValidateBaseUrl(string value, out string origin, out string error)
        {
            origin = null;
            error = "Use a server origin such as https://abby.example.com or http://127.0.0.1:8000.";
            if (!Uri.TryCreate(value == null ? null : value.Trim(), UriKind.Absolute, out var uri)) return false;
            if ((uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) ||
                !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) ||
                !string.IsNullOrEmpty(uri.Fragment) || uri.AbsolutePath != "/" || string.IsNullOrEmpty(uri.Host)) return false;
            if (uri.Scheme == Uri.UriSchemeHttp && !uri.IsLoopback)
            {
                error = "Use HTTPS for a remote server. HTTP is supported only on this computer's loopback address.";
                return false;
            }
            origin = uri.GetLeftPart(UriPartial.Authority);
            error = null;
            return true;
        }

        /// <summary>Clears the local session without revoking Django tokens in
        /// other clients. Any active network requests are aborted. Aborting a tap
        /// cannot undo a tap already committed by the server.</summary>
        public void ClearSession()
        {
            sessionVersion++;
            token = null;
            CurrentUser = null;
            knownHabits.Clear();
            foreach (var request in activeRequests) request.Abort();
        }

        public IEnumerator Login(string username, string password, Action<UserDto> success, Action<ApiError> failure)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            failure?.Invoke(new ApiError("Sign in in your journal, then return to your world.", requiresLogin: true));
            yield break;
#else
            if (loginInFlight || MutationInFlight)
            {
                failure?.Invoke(new ApiError("Wait for the current action to finish before signing in."));
                yield break;
            }
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password))
            {
                failure?.Invoke(new ApiError("Enter your username and password."));
                yield break;
            }
            ClearSession();
            loginInFlight = true;
            try
            {
                var body = JsonUtility.ToJson(new LoginBody { username = username.Trim(), password = password });
                yield return Send("POST", baseUrl + "/api/auth/", body, false, false, json =>
                {
                    try
                    {
                        var user = ApiContract.ParseLogin(json, out var sessionToken);
                        token = sessionToken;
                        CurrentUser = user;
                    }
                    catch (Exception exception)
                    {
                        failure?.Invoke(InvalidResponse(exception, false));
                        return;
                    }
                    success?.Invoke(CurrentUser);
                }, failure);
            }
            finally { loginInFlight = false; }
#endif
        }

        public IEnumerator FetchMe(Action<UserDto> success, Action<ApiError> failure)
        {
            yield return Send("GET", baseUrl + "/api/auth/me/", null, true, false, json =>
            {
                UserDto user;
                try
                {
                    user = ApiContract.ParseUser(json);
                    if (CurrentUser != null && user.id != CurrentUser.id)
                        throw new FormatException("The session account changed unexpectedly.");
                    CurrentUser = user;
                }
                catch (Exception exception) { failure?.Invoke(InvalidResponse(exception, false)); return; }
                success?.Invoke(user);
            }, failure);
        }

        public IEnumerator FetchCharacter(Action<CharacterDto> success, Action<ApiError> failure)
        {
            yield return Send("GET", baseUrl + "/api/character/", null, true, false, json =>
            {
                CharacterDto character;
                try
                {
                    character = ApiContract.ParseCharacter(json);
                    if (CurrentUser == null || character.username != CurrentUser.username)
                        throw new FormatException("The character does not belong to the signed-in account.");
                }
                catch (Exception exception) { failure?.Invoke(InvalidResponse(exception, false)); return; }
                success?.Invoke(character);
            }, failure);
        }

        /// <summary>Retrieves all DRF pages, validates each page URL before sending
        /// credentials, and returns only this account's published active habits
        /// supporting positive taps. Daily-limit rows remain visible for feedback.</summary>
        public IEnumerator FetchHabits(Action<HabitDto[]> success, Action<ApiError> failure)
        {
            int version = sessionVersion;
            var habits = new List<HabitDto>();
            var ids = new HashSet<int>();
            var visited = new HashSet<string>(StringComparer.Ordinal);
            string next = baseUrl + "/api/habits/";
            while (!string.IsNullOrEmpty(next))
            {
                if (!TryResolveHabitPageUrl(baseUrl, next, out var pageUrl) || !visited.Add(pageUrl) || visited.Count > 500)
                {
                    failure?.Invoke(new ApiError("The server returned an unsafe or repeating habit pagination link."));
                    yield break;
                }
                HabitPageDto page = null;
                ApiError error = null;
                yield return Send("GET", pageUrl, null, true, false, json =>
                {
                    try { page = ApiContract.ParseHabitPage(json); }
                    catch (Exception exception) { error = InvalidResponse(exception, false); }
                }, problem => error = problem);
                if (error != null) { failure?.Invoke(error); yield break; }
                if (version != sessionVersion || !IsAuthenticated)
                {
                    failure?.Invoke(new ApiError("The session ended before habits could be loaded.", requiresLogin: true));
                    yield break;
                }
                foreach (var habit in page.results)
                {
                    if (!ids.Add(habit.id) || ids.Count > 10000)
                    {
                        failure?.Invoke(new ApiError("The server returned duplicate or too many habit records. Refresh the task board."));
                        yield break;
                    }
                    if (habit.IsEligibleForUser(CurrentUser.id)) habits.Add(habit);
                }
                next = page.next;
            }
            knownHabits.Clear();
            foreach (var habit in habits) knownHabits.Add(habit.id, habit);
            success?.Invoke(habits.ToArray());
        }

        public static bool TryResolveHabitPageUrl(string origin, string next, out string resolved)
        {
            resolved = null;
            if (!Uri.TryCreate(origin + "/", UriKind.Absolute, out var baseUri) ||
                !Uri.TryCreate(baseUri, next, out var uri)) return false;
            if (uri.Scheme != baseUri.Scheme || uri.IdnHost != baseUri.IdnHost || uri.Port != baseUri.Port ||
                !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment) ||
                uri.AbsolutePath != "/api/habits/") return false;
            resolved = uri.AbsoluteUri;
            return true;
        }

        /// <summary>Logs exactly one explicit positive tap. The habit must come
        /// from the most recent successful FetchHabits call. On OutcomeUnknown,
        /// reload state instead of retrying the POST.</summary>
        public IEnumerator LogPositiveHabit(HabitDto habit, Action<HabitTapDto> success, Action<ApiError> failure)
        {
            if (!IsAuthenticated)
            {
                failure?.Invoke(new ApiError("Sign in before logging a real ritual.", requiresLogin: true));
                yield break;
            }
            if (habit == null || !knownHabits.TryGetValue(habit.id, out var known) || !known.IsEligibleForUser(CurrentUser.id))
            {
                failure?.Invoke(new ApiError("Reload the task board before logging that ritual."));
                yield break;
            }
            if (known.DailyLimitReached)
            {
                failure?.Invoke(new ApiError("You have already reached this ritual's daily limit."));
                yield break;
            }
            yield return Send("POST", baseUrl + "/api/habits/" + known.id + "/log/",
                JsonUtility.ToJson(new TapBody()), true, true, json =>
                {
                    HabitTapDto result;
                    try { result = ApiContract.ParseHabitTap(json); }
                    catch (Exception exception)
                    {
                        knownHabits.Clear();
                        failure?.Invoke(InvalidResponse(exception, true));
                        return;
                    }
                    known.strength = result.new_strength;
                    known.taps_today++;
                    habit.strength = known.strength;
                    habit.taps_today = known.taps_today;
                    success?.Invoke(result);
                }, error =>
                {
                    // A refreshed server list is required before another tap if
                    // the prior result was ambiguous; the cache cannot authorize it.
                    if (error.OutcomeUnknown) knownHabits.Clear();
                    failure?.Invoke(error);
                });
        }

        private IEnumerator Send(string method, string url, string json, bool authenticated, bool mutation,
            Action<string> success, Action<ApiError> failure, bool validatingSession = false)
        {
            SynchronizeBrowserSession();
            bool validOrigin = TryValidateBaseUrl(baseUrl, out _, out var error);
            if (configurationError != null || !validOrigin)
            {
                failure?.Invoke(new ApiError(configurationError ?? error));
                yield break;
            }
            if (authenticated && (string.IsNullOrEmpty(token) || (!validatingSession && !IsAuthenticated)))
            {
                failure?.Invoke(new ApiError("Sign in to connect to your Abby account.", requiresLogin: true));
                yield break;
            }
            if (mutation && MutationInFlight)
            {
                failure?.Invoke(new ApiError("Wait for the current ritual to finish saving."));
                yield break;
            }
            int version = sessionVersion;
            string requestToken = token;
            if (mutation) MutationInFlight = true;
            using (var request = new UnityWebRequest(url, method))
            {
                request.downloadHandler = new DownloadHandlerBuffer();
                request.timeout = Mathf.Clamp(timeoutSeconds, 5, 60);
                // Never forward credentials through a server redirect.
                request.redirectLimit = 0;
                request.SetRequestHeader("Accept", "application/json");
                if (authenticated) request.SetRequestHeader("Authorization", "Token " + requestToken);
                if (json != null)
                {
                    request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                    request.SetRequestHeader("Content-Type", "application/json");
                }
                activeRequests.Add(request);
                try
                {
                    UnityWebRequestAsyncOperation operation = null;
                    Exception sendException = null;
                    try { operation = request.SendWebRequest(); }
                    catch (Exception exception) { sendException = exception; }
                    if (sendException != null)
                    {
                        failure?.Invoke(new ApiError("The request could not be started. Check the server address and Unity connection settings."));
                        yield break;
                    }
                    yield return operation;
                    SynchronizeBrowserSession();
                    if (version != sessionVersion)
                    {
                        failure?.Invoke(new ApiError(mutation ?
                            "The session ended while saving. The habit may have been saved; refresh its state before logging again." :
                            "The session ended before the request completed.", outcomeUnknown: mutation, requiresLogin: true));
                        yield break;
                    }
                    bool transportFailure = request.result == UnityWebRequest.Result.ConnectionError ||
                        request.result == UnityWebRequest.Result.DataProcessingError;
                    if (request.result != UnityWebRequest.Result.Success || request.responseCode < 200 || request.responseCode >= 300)
                    {
                        var problem = ApiContract.HttpError(request.responseCode, request.downloadHandler.text, mutation, transportFailure);
                        if (problem.RequiresLogin)
                        {
#if UNITY_WEBGL && !UNITY_EDITOR
                            // Only the rejected credential may be discarded. A
                            // late 401 cannot erase a newer journal account.
                            if (authenticated && request.responseCode == 401)
                                AbbySession_ClearToken(requestToken);
#endif
                            ClearSession();
                        }
                        failure?.Invoke(problem);
                        yield break;
                    }
                    success?.Invoke(request.downloadHandler.text);
                }
                finally
                {
                    activeRequests.Remove(request);
                    if (mutation) MutationInFlight = false;
                }
            }
        }

        private static ApiError InvalidResponse(Exception exception, bool mutation)
        {
            string message = exception is FormatException ? exception.Message : "The server returned an unreadable response.";
            if (mutation) message += " The habit may have been saved. Refresh its state before logging it again.";
            return new ApiError(message, outcomeUnknown: mutation);
        }
    }
}
