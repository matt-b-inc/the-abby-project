using System;
using AbbyCamp.Data;
using UnityEngine;

namespace AbbyCamp.Services
{
    /// <summary>Device-local presentation acknowledgements; never account rewards.
    /// Keys include origin and validated child ID. First visit baselines existing history.</summary>
    public static class MeadowReceiptMemory
    {
        public static KeepsakeDto Observe(string origin, int childId, MeadowDto meadow,
            Func<string, string> read, Action<string, string> remember)
        {
            if (childId < 1 || string.IsNullOrEmpty(origin) || meadow == null || meadow.keepsakes == null) return null;
            string scope = "AbbyCamp.Meadow." + Hash128.Compute(origin) + ".child." + childId + ".";
            bool initialised = read(scope + "initialised") == "1";
            long.TryParse(read(scope + "latestTicks"), out var previousTicks);
            int.TryParse(read(scope + "latestId"), out var previousId);
            long newestTicks = previousTicks;
            int newestId = previousId;
            KeepsakeDto newestUnseen = null;
            foreach (var item in meadow.keepsakes)
            {
                long ticks = DateTimeOffset.Parse(item.earned_at).UtcDateTime.Ticks;
                int id = int.Parse(item.receipt_id.Substring(8));
                bool isNew = ticks > previousTicks || (ticks == previousTicks && id > previousId);
                if (initialised && newestUnseen == null && isNew) newestUnseen = item;
                if (ticks > newestTicks || (ticks == newestTicks && id > newestId))
                {
                    newestTicks = ticks;
                    newestId = id;
                }
            }
            // Never lower the watermark after deletion or a shorter response. An
            // older item entering the 30-item window must not replay a celebration.
            remember(scope + "latestTicks", newestTicks.ToString());
            remember(scope + "latestId", newestId.ToString());
            remember(scope + "initialised", "1");
            return newestUnseen;
        }

        public static KeepsakeDto Observe(string origin, int childId, MeadowDto meadow)
        {
            var result = Observe(origin, childId, meadow, key => PlayerPrefs.GetString(key, ""),
                (key, value) => PlayerPrefs.SetString(key, value));
            PlayerPrefs.Save();
            return result;
        }
    }
}
