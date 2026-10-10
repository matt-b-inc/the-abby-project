using System;
using System.Collections.Generic;
using AbbyCamp.Data;
using AbbyCamp.Services;
using UnityEditor;
using UnityEngine;

namespace AbbyCamp.Editor
{
    /// <summary>Focused contract checks, also callable by Unity batch mode with
    /// -executeMethod AbbyCamp.Editor.ApiContractValidation.Run.</summary>
    public static class ApiContractValidation
    {
        private const string Habit = "{\"id\":9,\"name\":\"Read {a} book \\\"today\\\"\",\"habit_type\":\"positive\",\"user\":7,\"xp_reward\":5,\"max_taps_per_day\":1,\"taps_today\":0,\"strength\":-2,\"is_active\":true,\"pending_parent_review\":false,\"skill_tags\":[{\"skill\":2,\"skill_name\":\"Reading\",\"xp_weight\":1}]}";
        private static int checks;

        [MenuItem("Abby Camp/Validate API Contracts")]
        public static void Run()
        {
            checks = 0;
            var user = ApiContract.ParseLogin("{\"id\":7,\"username\":\"abby\",\"display_name\":\"Abby\",\"role\":\"child\",\"token\":\"0123456789012345678901234567890123456789\"}", out var token);
            Check(user.id == 7 && user.DisplayName == "Abby" && token.Length == 40, "Flat Django login response");
            Reject(() => ApiContract.ParseLogin("{\"id\":7,\"username\":\"abby\",\"role\":\"child\",\"token\":\"bad\"}", out _), "Missing/invalid token");
            Reject(() => ApiContract.ParseUser("{\"username\":\"abby\",\"role\":\"child\"}"), "Missing identity");
            Reject(() => ApiContract.ParseUser("{\"id\":7,\"username\":\"abby\",\"role\":\"staff\"}"), "Unknown account role");
            var page = ApiContract.ParseHabitPage("{\"count\":21,\"next\":\"http://localhost:8000/api/habits/?page=2\",\"previous\":null,\"results\":[" + Habit + "]}");
            Check(page.count == 21 && page.results.Length == 1 && page.results[0].name == "Read {a} book \"today\"", "Paginated habits and escaped strings");
            var habit = page.results[0];
            Check(habit.IsEligibleForUser(7) && !habit.IsEligibleForUser(8), "Only own habits");
            habit.is_active = false;
            Check(!habit.IsEligibleForUser(7), "Inactive habits excluded");
            habit.is_active = true;
            habit.pending_parent_review = true;
            Check(!habit.IsEligibleForUser(7), "Unapproved habits excluded");
            habit.pending_parent_review = false;
            habit.habit_type = "negative";
            Check(!habit.IsEligibleForUser(7), "Negative-only habits excluded");
            habit.habit_type = "both";
            Check(habit.IsEligibleForUser(7), "Both-direction habits allow positive taps");
            habit.taps_today = habit.max_taps_per_day;
            Check(habit.DailyLimitReached, "Daily tap cap");
            Reject(() => ApiContract.ParseHabit(Habit.Replace(",\"pending_parent_review\":false", "")), "Missing approval cannot silently allow tapping");
            Reject(() => ApiContract.ParseHabit(Habit.Replace("\"is_active\":true", "\"is_active\":\"true\"")), "Safety flags must be booleans");
            Reject(() => ApiContract.ParseHabitPage("{\"count\":0,\"next\":null}"), "Missing results cannot masquerade as empty list");
            var empty = ApiContract.ParseHabitPage("{\"count\":0,\"next\":null,\"results\":[]}");
            Check(empty.results.Length == 0 && empty.next == null, "Empty final habit page");
            var tap = ApiContract.ParseHabitTap("{\"direction\":1,\"xp_reward\":5,\"new_strength\":0,\"game_event\":null}");
            Check(tap.direction == 1 && tap.new_strength == 0 && tap.game_event == null, "Confirmed tap remains valid without optional game event");
            var partialTap = ApiContract.ParseHabitTap("{\"direction\":1,\"xp_reward\":0,\"new_strength\":1,\"game_event\":{\"streak\":null,\"quest\":null,\"daily_challenge\":null,\"drops\":[],\"notifications\":[]}}");
            Check(partialTap.game_event != null && partialTap.game_event.streak == null && partialTap.game_event.quest == null && partialTap.game_event.daily_challenge == null, "Optional event nulls retain absent-event semantics");
            Reject(() => ApiContract.ParseHabitTap("{\"error\":\"No reward\",\"game_event\":{\"direction\":1,\"xp_reward\":5,\"new_strength\":2}}"), "Nested keys cannot fake a confirmed tap");
            Reject(() => ApiContract.ParseHabitTap("{\"direction\":-1,\"xp_reward\":0,\"new_strength\":2}"), "Positive-tap confirmation required");
            Reject(() => ApiContract.ParseHabitTap("{\"direction\":1,\"direction\":-1,\"xp_reward\":0,\"new_strength\":2}"), "Duplicate response keys rejected");
            Reject(() => ApiContract.ParseHabitTap("{\"direction\":1,\"xp_reward\":0,\"new_strength\":2}" + " trailing"), "Trailing response data rejected");
            var eventTap = ApiContract.ParseHabitTap("{\"direction\":1,\"xp_reward\":5,\"new_strength\":3,\"game_event\":{\"streak\":{\"is_first_today\":true,\"check_in_bonus_coins\":5,\"streak\":2},\"drops\":[{\"item_id\":4,\"item_name\":\"Fox egg\",\"quantity\":1,\"was_salvaged\":false}],\"quest\":{\"quest_name\":\"Forest trial\",\"completed\":true},\"daily_challenge\":{\"newly_completed\":true}}}");
            string withoutSkill = eventTap.DescribeConfirmedOutcome(new HabitDto());
            Check(withoutSkill == "Ritual recorded. Strength: 3." && eventTap.game_event.drops[0].item_name == "Fox egg", "Confirmation omits unverified event rewards while retaining event data");
            Check(eventTap.DescribeConfirmedOutcome(ApiContract.ParseHabit(Habit)) == "Ritual recorded. Strength: 3." && tap.DescribeConfirmedOutcome() == "Ritual recorded. Strength: 0.", "Configured XP and null game event do not change confirmed base outcome");
            var definite = ApiContract.HttpError(400, "{\"error\":\"Daily limit reached\"}", true, false);
            Check(!definite.OutcomeUnknown && definite.Message == "Daily limit reached", "Validation rejection is definite");
            Check(ApiContract.HttpError(503, "<html>down</html>", true, false).OutcomeUnknown, "Server error after POST may have committed");
            Check(ApiContract.HttpError(408, "", true, false).OutcomeUnknown, "HTTP timeout after POST may have committed");
            Check(ApiContract.HttpError(0, "", true, true).OutcomeUnknown, "Lost POST response may have committed");
            Check(!ApiContract.HttpError(0, "", false, true).OutcomeUnknown, "Failed reads are not failed mutations");
            Check(ApiContract.HttpError(401, "{\"detail\":\"Invalid token.\"}", false, false).RequiresLogin, "Expired token ends session");
            Check(AbbyApiClient.TryValidateBaseUrl("http://127.0.0.1:8000/", out var origin, out _) && origin == "http://127.0.0.1:8000", "Loopback HTTP origin normalized");
            Check(AbbyApiClient.TryValidateBaseUrl("http://localhost:8000", out _, out _), "Localhost HTTP allowed");
            Check(AbbyApiClient.TryValidateBaseUrl("https://abby.example.com", out _, out _), "Remote HTTPS allowed");
            Check(!AbbyApiClient.TryValidateBaseUrl("http://192.168.1.2:8000", out _, out _), "Remote HTTP prohibited");
            Check(!AbbyApiClient.TryValidateBaseUrl("https://abby.example.com/api/", out _, out _), "Origin must not include an endpoint path");
            Check(!AbbyApiClient.TryValidateBaseUrl("https://user:pass@abby.example.com", out _, out _), "Embedded credentials rejected");
            Check(AbbyApiClient.TryResolveHabitPageUrl("https://abby.example.com", "/api/habits/?page=2", out _), "Same-origin pagination supported");
            Check(!AbbyApiClient.TryResolveHabitPageUrl("https://abby.example.com", "https://other.example.com/api/habits/?page=2", out _), "Pagination cannot exfiltrate token to another host");
            Check(!AbbyApiClient.TryResolveHabitPageUrl("https://abby.example.com", "http://abby.example.com/api/habits/?page=2", out _), "Pagination cannot downgrade HTTPS");
            Check(!AbbyApiClient.TryResolveHabitPageUrl("https://abby.example.com", "/api/auth/", out _), "Pagination restricted to habit endpoint");

            const string bloom = "{\"receipt_id\":\"journal:123\",\"type\":\"memory_bloom\",\"title\":\"Memory bloom\",\"earned_at\":\"2026-10-10T12:34:56Z\"}";
            const string meadowJson = "{\"schema_version\":1,\"keepsake_count\":1,\"journal_xp_awarded\":5,\"keepsakes\":[" + bloom + "]}";
            var meadow = ApiContract.ParseMeadow(meadowJson);
            Check(meadow.keepsake_count == 1 && meadow.keepsakes[0].receipt_id == "journal:123", "Read-only meadow receipt metadata");
            var emptyMeadow = ApiContract.ParseMeadow("{\"schema_version\":1,\"keepsake_count\":0,\"journal_xp_awarded\":0,\"keepsakes\":[]}");
            Check(emptyMeadow.keepsakes.Length == 0, "Empty collection remains a valid acknowledged read");
            Reject(() => ApiContract.ParseMeadow(meadowJson.Replace("\"schema_version\":1", "\"schema_version\":2")), "Unknown meadow schema cannot be displayed as progress");
            Reject(() => ApiContract.ParseMeadow(meadowJson.Replace("\"keepsake_count\":1", "\"keepsake_count\":0")), "Collection count cannot be smaller than its window");
            Reject(() => ApiContract.ParseMeadow(meadowJson.Replace("journal:123", "journal:invalid")), "Keepsake requires stable journal receipt identity");
            Reject(() => ApiContract.ParseMeadow(meadowJson.Replace("memory_bloom", "unverified_reward")), "Unknown reward type is not recognised as an earned bloom");
            Reject(() => ApiContract.ParseMeadow(meadowJson.Replace("2026-10-10T12:34:56Z", "not-a-date")), "Keepsake requires an earned date");
            Reject(() => ApiContract.ParseMeadow("{\"schema_version\":1,\"keepsake_count\":2,\"journal_xp_awarded\":10,\"keepsakes\":[" + bloom + "," + bloom + "]}"), "Duplicate keepsake receipts rejected");
            var localMemory = new Dictionary<string, string>();
            string Read(string key) => localMemory.TryGetValue(key, out var value) ? value : "";
            void Remember(string key, string value) => localMemory[key] = value;
            Check(MeadowReceiptMemory.Observe("https://abby.example.com", 7, meadow, Read, Remember) == null, "First visit baselines existing awarded history without replaying a celebration");
            var nextMeadow = ApiContract.ParseMeadow(meadowJson.Replace("journal:123", "journal:124").Replace("12:34:56Z", "12:35:56Z"));
            Check(MeadowReceiptMemory.Observe("https://abby.example.com", 7, nextMeadow, Read, Remember)?.receipt_id == "journal:124", "New acknowledged receipt celebrates locally");
            Check(MeadowReceiptMemory.Observe("https://abby.example.com", 7, nextMeadow, Read, Remember) == null, "Refresh cannot replay receipt celebration");
            Check(MeadowReceiptMemory.Observe("https://abby.example.com", 7, emptyMeadow, Read, Remember) == null
                && MeadowReceiptMemory.Observe("https://abby.example.com", 7, meadow, Read, Remember) == null, "Deletion and older window items cannot replay historical celebrations");
            Check(MeadowReceiptMemory.Observe("https://abby.example.com", 8, nextMeadow, Read, Remember) == null, "Receipt presentation baselines separately for another child");
            Check(MeadowReceiptMemory.Observe("https://other.example.com", 7, nextMeadow, Read, Remember) == null, "Receipt presentation stays scoped to its server origin");

            var gameObject = new GameObject("API validation client");
            try
            {
                var client = gameObject.AddComponent<AbbyApiClient>();
                ApiError rejection = null;
                bool completed = false;
                var coroutine = client.LogPositiveHabit(null, _ => completed = true, problem => rejection = problem);
                Check(!coroutine.MoveNext() && !completed && rejection != null && rejection.RequiresLogin, "Logged-out tap never issues a request");
                rejection = null;
                coroutine = client.ResumeBrowserSession(_ => completed = true, problem => rejection = problem);
                Check(!coroutine.MoveNext() && !completed && rejection != null && rejection.RequiresLogin && !client.IsAuthenticated,
                    "Missing browser credential cannot mint a token or authorize camp actions");
                client.ConfigureBaseUrl("https://abby.example.com", out _);
                Check(!client.ConfigureBaseUrl("http://remote.example.com", out _) && client.BaseUrl == "https://abby.example.com", "Rejected configuration preserves valid origin");
            }
            finally { UnityEngine.Object.DestroyImmediate(gameObject); }
            Debug.Log("Abby Camp API contracts: " + checks + " checks passed.");
        }

        private static void Check(bool condition, string description)
        {
            checks++;
            if (!condition) throw new InvalidOperationException("API contract validation failed: " + description);
        }

        private static void Reject(Action parse, string description)
        {
            bool rejected = false;
            try { parse(); }
            catch (FormatException) { rejected = true; }
            catch (ArgumentException) { rejected = true; }
            Check(rejected, description);
        }
    }
}
