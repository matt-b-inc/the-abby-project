using System;

namespace AbbyCamp.Data
{
    // Deliberately small projections of the existing Django serializers. Content IDs,
    // rather than any model or animation names, cross the presentation boundary.
    [Serializable]
    public sealed class UserDto
    {
        public int id;
        public string username;
        public string display_name;
        public string role;
        public FamilyDto family;

        public string DisplayName => string.IsNullOrWhiteSpace(display_name) ? username : display_name;
    }

    [Serializable]
    public sealed class FamilyDto
    {
        public int id;
        public string name;
        public string timezone;
    }

    [Serializable]
    public sealed class HabitDto
    {
        public int id;
        public string name;
        public string habit_type;
        public int user;
        public int xp_reward;
        public int max_taps_per_day;
        public int taps_today;
        public int strength;
        public bool is_active;
        public bool pending_parent_review;
        public HabitSkillTagDto[] skill_tags;

        public bool SupportsPositiveTap => habit_type == "positive" || habit_type == "both";
        public bool DailyLimitReached => taps_today >= max_taps_per_day;

        public bool IsEligibleForUser(int userId)
        {
            return id > 0 && user == userId && is_active && !pending_parent_review && SupportsPositiveTap;
        }
    }

    [Serializable]
    public sealed class HabitSkillTagDto
    {
        public int skill;
        public string skill_name;
        public int xp_weight;
    }

    [Serializable]
    public sealed class HabitPageDto
    {
        public int count;
        public string next;
        public HabitDto[] results;
    }

    [Serializable]
    public sealed class CharacterDto
    {
        public int id;
        public string username;
        public string display_name;
        public int level;
        public int login_streak;
        public int longest_login_streak;
        public int perfect_days_count;
        public string last_active_date;
    }

    [Serializable]
    public sealed class HabitTapDto
    {
        public int direction;
        // This is the configured skill XP pool. Without skill tags the backend
        // distributes no skill XP; it is not a character XP total or coin award.
        public int xp_reward;
        public int new_strength;
        public GameEventDto game_event;

        public string DescribeConfirmedOutcome(HabitDto habit = null)
        {
            // The base tap is committed before the optional game loop. That
            // pipeline can roll back a step after populating its result object,
            // so game_event alone cannot confirm ledger, inventory, or quest
            // rewards. Keep those DTOs for future authoritative-state reads.
            // xp_reward likewise describes a pool rather than exact XP granted.
            return "Ritual recorded. Strength: " + new_strength + ".";
        }
    }

    [Serializable]
    public sealed class GameEventDto
    {
        public string trigger_type;
        public StreakEventDto streak;
        public DropEventDto[] drops;
        public QuestEventDto quest;
        public DailyChallengeEventDto daily_challenge;
        public string[] notifications;
    }

    [Serializable]
    public sealed class StreakEventDto
    {
        public bool is_first_today;
        public int check_in_bonus_coins;
        public int streak;
        public float multiplier;
        public bool freeze_consumed;
        public bool streak_broken;
    }

    [Serializable]
    public sealed class DropEventDto
    {
        public int item_id;
        public string item_name;
        public string item_type;
        public string item_rarity;
        public int quantity;
        public bool was_salvaged;
    }

    [Serializable]
    public sealed class QuestEventDto
    {
        public int quest_id;
        public string quest_name;
        public int damage_dealt;
        public int new_progress;
        public int target;
        public bool completed;
    }

    [Serializable]
    public sealed class DailyChallengeEventDto
    {
        public int challenge_id;
        public string challenge_type;
        public int progress;
        public int target;
        public bool newly_completed;
    }

    [Serializable]
    public sealed class MeadowDto
    {
        public int schema_version;
        public int keepsake_count;
        public int journal_xp_awarded;
        public KeepsakeDto[] keepsakes;
    }

    [Serializable]
    public sealed class KeepsakeDto
    {
        public string receipt_id;
        public string type;
        public string title;
        public string earned_at;
    }

    public sealed class ApiError
    {
        public readonly string Message;
        public readonly long StatusCode;
        // True means a habit tap may have reached Django. Refresh server state
        // and ask the user to reconcile it; never replay that POST automatically.
        public readonly bool OutcomeUnknown;
        public readonly bool RequiresLogin;

        public ApiError(string message, long statusCode = 0, bool outcomeUnknown = false, bool requiresLogin = false)
        {
            Message = message;
            StatusCode = statusCode;
            OutcomeUnknown = outcomeUnknown;
            RequiresLogin = requiresLogin;
        }

        public override string ToString() => Message;
    }
}
