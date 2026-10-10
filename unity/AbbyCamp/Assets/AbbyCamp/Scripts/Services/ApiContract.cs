using System;
using System.Collections.Generic;
using System.Globalization;
using AbbyCamp.Data;
using UnityEngine;

namespace AbbyCamp.Services
{
    /// <summary>JsonUtility DTO parsing plus required-field checks. Missing approval
    /// flags must never default into permission to perform a real habit action.</summary>
    public static class ApiContract
    {
        [Serializable] private sealed class TokenPayload { public string token; }
        [Serializable] private sealed class ErrorPayload { public string error; public string detail; }
        [Serializable] private sealed class StringPayload { public string value; }

        public static UserDto ParseLogin(string json, out string token)
        {
            var user = ParseUser(json);
            token = JsonUtility.FromJson<TokenPayload>(json).token;
            if (string.IsNullOrEmpty(token) || token.Length != 40)
                throw new FormatException("The login response did not include a valid session token.");
            foreach (char character in token)
                if (!Uri.IsHexDigit(character))
                    throw new FormatException("The login response included an invalid session token.");
            return user;
        }

        public static UserDto ParseUser(string json)
        {
            var fields = ReadObject(json);
            RequireInteger(fields, "id", 1);
            RequireString(fields, "username");
            RequireString(fields, "role");
            var user = JsonUtility.FromJson<UserDto>(json);
            if (string.IsNullOrWhiteSpace(user.username) || (user.role != "child" && user.role != "parent"))
                throw new FormatException("The server returned an incomplete account.");
            return user;
        }

        public static CharacterDto ParseCharacter(string json)
        {
            var fields = ReadObject(json);
            RequireInteger(fields, "id", 1);
            RequireInteger(fields, "level", 0);
            RequireInteger(fields, "login_streak", 0);
            RequireString(fields, "username");
            return JsonUtility.FromJson<CharacterDto>(json);
        }

        public static HabitPageDto ParseHabitPage(string json)
        {
            var fields = ReadObject(json);
            int count = RequireInteger(fields, "count", 0);
            string next = Require(fields, "next");
            if (next != "null" && !next.StartsWith("\"", StringComparison.Ordinal))
                throw new FormatException("The habit pagination link was invalid.");
            var records = ReadArray(Require(fields, "results"));
            var page = JsonUtility.FromJson<HabitPageDto>(json);
            // JsonUtility materializes JSON null strings as empty strings. Keep
            // the API's explicit end-of-pagination marker as a null reference.
            page.next = next == "null" ? null : JsonUtility.FromJson<StringPayload>("{\"value\":" + next + "}").value;
            page.results = new HabitDto[records.Count];
            page.count = count;
            for (int index = 0; index < records.Count; index++)
                page.results[index] = ParseHabit(records[index]);
            return page;
        }

        public static HabitDto ParseHabit(string json)
        {
            var fields = ReadObject(json);
            RequireInteger(fields, "id", 1);
            RequireInteger(fields, "user", 1);
            RequireInteger(fields, "xp_reward", 0);
            RequireInteger(fields, "max_taps_per_day", 0);
            RequireInteger(fields, "taps_today", 0);
            RequireInteger(fields, "strength", int.MinValue);
            RequireBoolean(fields, "is_active");
            RequireBoolean(fields, "pending_parent_review");
            RequireString(fields, "name");
            RequireString(fields, "habit_type");
            var habit = JsonUtility.FromJson<HabitDto>(json);
            if (string.IsNullOrWhiteSpace(habit.name) ||
                (habit.habit_type != "positive" && habit.habit_type != "negative" && habit.habit_type != "both"))
                throw new FormatException("The server returned an incomplete habit.");
            return habit;
        }

        public static HabitTapDto ParseHabitTap(string json)
        {
            var fields = ReadObject(json);
            if (RequireInteger(fields, "direction", int.MinValue) != 1)
                throw new FormatException("The server did not confirm a positive habit tap.");
            RequireInteger(fields, "xp_reward", 0);
            RequireInteger(fields, "new_strength", int.MinValue);
            // game_event may be null when an optional game-loop step fails.
            // The base tap still succeeded and must not be replayed.
            var tap = JsonUtility.FromJson<HabitTapDto>(json);
            if (!fields.TryGetValue("game_event", out var eventJson) || eventJson == "null")
                tap.game_event = null;
            else
            {
                var eventFields = ReadObject(eventJson);
                if (IsMissingOrNull(eventFields, "streak")) tap.game_event.streak = null;
                if (IsMissingOrNull(eventFields, "quest")) tap.game_event.quest = null;
                if (IsMissingOrNull(eventFields, "daily_challenge")) tap.game_event.daily_challenge = null;
                if (IsMissingOrNull(eventFields, "drops")) tap.game_event.drops = null;
                if (IsMissingOrNull(eventFields, "notifications")) tap.game_event.notifications = null;
            }
            return tap;
        }

        private static bool IsMissingOrNull(Dictionary<string, string> fields, string name)
        {
            return !fields.TryGetValue(name, out var value) || value == "null";
        }

        public static ApiError HttpError(long status, string body, bool mutation, bool transportFailure)
        {
            string message = null;
            try
            {
                ReadObject(body);
                var payload = JsonUtility.FromJson<ErrorPayload>(body);
                message = string.IsNullOrWhiteSpace(payload.error) ? payload.detail : payload.error;
            }
            catch (Exception) { /* HTML proxy responses are not user-facing diagnostics. */ }
            if (string.IsNullOrWhiteSpace(message))
            {
                if (status == 401) message = "Your session has expired. Sign in again.";
                else if (status == 403) message = "This account cannot perform that action.";
                else if (status == 429) message = "The server is receiving too many requests. Wait before trying again.";
                else if (transportFailure) message = "Could not reach the server. Check the server address and connection.";
                else message = "The server could not complete the request (HTTP " + status + ").";
            }
            message = message.Replace('\r', ' ').Replace('\n', ' ');
            if (message.Length > 400) message = message.Substring(0, 400);
            bool unknown = mutation && (transportFailure || status == 408 || status >= 500 || (status >= 300 && status < 400));
            if (unknown) message += " The habit may have been saved. Refresh its state before logging it again.";
            return new ApiError(message, status, unknown, status == 401);
        }

        private static string Require(Dictionary<string, string> fields, string name)
        {
            if (!fields.TryGetValue(name, out var value))
                throw new FormatException("The server response is missing '" + name + "'.");
            return value;
        }

        private static int RequireInteger(Dictionary<string, string> fields, string name, int minimum)
        {
            if (!int.TryParse(Require(fields, name), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out int value) || value < minimum)
                throw new FormatException("The server returned an invalid '" + name + "'.");
            return value;
        }

        private static void RequireBoolean(Dictionary<string, string> fields, string name)
        {
            string value = Require(fields, name);
            if (value != "true" && value != "false")
                throw new FormatException("The server returned an invalid '" + name + "'.");
        }

        private static void RequireString(Dictionary<string, string> fields, string name)
        {
            if (!Require(fields, name).StartsWith("\"", StringComparison.Ordinal))
                throw new FormatException("The server returned an invalid '" + name + "'.");
        }

        // JsonUtility ignores unknown/missing fields. This scanner only preserves
        // each top-level JSON value for presence/type checks; DTO deserialization
        // remains JsonUtility's responsibility. It handles escaped/nested strings,
        // rather than searching for field-name substrings in untrusted JSON.
        private static Dictionary<string, string> ReadObject(string json)
        {
            if (string.IsNullOrWhiteSpace(json) || json.Length > 2 * 1024 * 1024)
                throw new FormatException("The server returned an empty or oversized response.");
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            int index = 0;
            Eat(json, ref index, '{');
            SkipWhitespace(json, ref index);
            if (Peek(json, index) != '}')
            {
                while (true)
                {
                    int start = index;
                    SkipString(json, ref index);
                    string key = JsonUtility.FromJson<StringPayload>("{\"value\":" + json.Substring(start, index - start) + "}").value;
                    Eat(json, ref index, ':');
                    SkipWhitespace(json, ref index);
                    start = index;
                    SkipValue(json, ref index, 0);
                    if (values.ContainsKey(key)) throw new FormatException("The server returned duplicate JSON fields.");
                    values.Add(key, json.Substring(start, index - start).Trim());
                    SkipWhitespace(json, ref index);
                    if (Peek(json, index) == '}') break;
                    Eat(json, ref index, ',');
                    SkipWhitespace(json, ref index);
                }
            }
            Eat(json, ref index, '}');
            SkipWhitespace(json, ref index);
            if (index != json.Length) throw new FormatException("Unexpected data after the server response.");
            return values;
        }

        private static List<string> ReadArray(string json)
        {
            var values = new List<string>();
            int index = 0;
            Eat(json, ref index, '[');
            SkipWhitespace(json, ref index);
            if (Peek(json, index) != ']')
            {
                while (true)
                {
                    int start = index;
                    SkipValue(json, ref index, 0);
                    values.Add(json.Substring(start, index - start));
                    SkipWhitespace(json, ref index);
                    if (Peek(json, index) == ']') break;
                    Eat(json, ref index, ',');
                    SkipWhitespace(json, ref index);
                }
            }
            Eat(json, ref index, ']');
            SkipWhitespace(json, ref index);
            if (index != json.Length) throw new FormatException("Invalid array in the server response.");
            return values;
        }

        private static void SkipValue(string json, ref int index, int depth)
        {
            if (depth > 64) throw new FormatException("The server response is nested too deeply.");
            SkipWhitespace(json, ref index);
            char first = Peek(json, index);
            if (first == '\"') { SkipString(json, ref index); return; }
            if (first == '{' || first == '[')
            {
                char end = first == '{' ? '}' : ']';
                index++;
                SkipWhitespace(json, ref index);
                if (Peek(json, index) != end)
                {
                    while (true)
                    {
                        if (first == '{') { SkipString(json, ref index); Eat(json, ref index, ':'); }
                        SkipValue(json, ref index, depth + 1);
                        SkipWhitespace(json, ref index);
                        if (Peek(json, index) == end) break;
                        Eat(json, ref index, ',');
                        SkipWhitespace(json, ref index);
                    }
                }
                Eat(json, ref index, end);
                return;
            }
            int start = index;
            while (index < json.Length && !char.IsWhiteSpace(json[index]) && json[index] != ',' && json[index] != '}' && json[index] != ']') index++;
            string primitive = json.Substring(start, index - start);
            if (primitive != "true" && primitive != "false" && primitive != "null" &&
                !double.TryParse(primitive, NumberStyles.Float, CultureInfo.InvariantCulture, out _))
                throw new FormatException("The server returned invalid JSON.");
        }

        private static void SkipString(string json, ref int index)
        {
            SkipWhitespace(json, ref index);
            if (Peek(json, index++) != '\"') throw new FormatException("The server returned invalid JSON text.");
            while (index < json.Length)
            {
                char character = json[index++];
                if (character == '\"') return;
                if (character < ' ') throw new FormatException("The server returned an invalid JSON string.");
                if (character != '\\') continue;
                char escaped = Peek(json, index++);
                if (escaped == 'u')
                {
                    for (int digit = 0; digit < 4; digit++)
                        if (!Uri.IsHexDigit(Peek(json, index++))) throw new FormatException("Invalid JSON Unicode escape.");
                }
                else if ("\"\\/bfnrt".IndexOf(escaped) < 0) throw new FormatException("Invalid JSON escape.");
            }
            throw new FormatException("The server returned an unterminated JSON string.");
        }

        private static char Peek(string json, int index)
        {
            if (index >= json.Length) throw new FormatException("The server response was truncated.");
            return json[index];
        }

        private static void Eat(string json, ref int index, char expected)
        {
            SkipWhitespace(json, ref index);
            if (Peek(json, index++) != expected) throw new FormatException("The server returned invalid JSON.");
        }

        private static void SkipWhitespace(string json, ref int index)
        {
            while (index < json.Length && char.IsWhiteSpace(json[index])) index++;
        }
    }
}
