/**
 * Single source of truth for every ``localStorage`` key the app reads or
 * writes. Importing from here instead of inlining string literals avoids
 * typo bugs (a misspelt key reads ``null`` silently and breaks features
 * in subtle ways) and gives a grep-able registry when you need to clear
 * or migrate a key.
 *
 * If you add a new key, document its purpose + lifetime here. The 401
 * self-heal path in ``api/client.js`` clears AUTH_TOKEN on demand;
 * everything else is best-effort cache.
 */
export const STORAGE_KEYS = {
  // DRF token. Cleared on 401 self-heal (see api/client.js) and on
  // explicit logout. Read by every authed API call.
  AUTH_TOKEN: 'abby_auth_token',

  // Per-section open/close state for the child dashboard accordions.
  // The full key is ``DASHBOARD_ACCORDION_PREFIX + slug(title)`` —
  // see components/dashboard/AccordionSection.jsx.
  DASHBOARD_ACCORDION_PREFIX: 'dashboard-accordion-',

  // Set of savings-goal IDs whose completion toast has already fired,
  // so we don't celebrate the same goal twice when the polling hook
  // re-evaluates. JSON-serialized array.
  SEEN_SAVINGS_COMPLETIONS: 'seenSavingsCompletions',

  // Set of notification IDs whose approval toast (chore/homework/
  // creation/exchange approved or rejected) has already fired for the
  // child. Independent of the unread-bell flag so the bell still
  // reflects the parent's notification list. JSON-serialized array.
  SEEN_APPROVAL_TOASTS: 'seenApprovalToasts',

  // Sprite catalog JSON + the ETag we last saw — paired keys.
  // SpriteCatalogProvider revalidates on mount via If-None-Match.
  SPRITE_CATALOG: 'spriteCatalog',
  SPRITE_CATALOG_ETAG: 'spriteCatalogEtag',

  // Timestamp (Date.now() ms) of the last PWA service-worker reload
  // attempt. Used by PwaStatusProvider to suppress the update banner
  // for 60s after a reload, swallowing rolling-deploy SW drift across
  // replicas. See the PWA gotcha in CLAUDE.md.
  PWA_LAST_RELOAD: 'pwa:last-reload-attempt',

  // Per-hub last-used tab ID. Key is ``CHAPTER_TAB_PREFIX + hubPath``.
  // ChapterHub reads on mount when no ?tab= is in the URL.
  CHAPTER_TAB_PREFIX: 'chapter-tab-',

  // FAB onboarding tooltip dismissed. Stored as "1" after first open.
  FAB_ONBOARDED: 'fab-onboarded',

  // Last project id (stringified) the user clocked into, written on every
  // successful clock-in. ClockPage + the FAB's ClockPane preselect it so the
  // daily repeat case skips the venture picker; the FAB menu upgrades to a
  // one-tap "Clock in · <venture>" row when it still matches an active
  // project. Best-effort — ignored when the id no longer matches.
  LAST_CLOCK_PROJECT: 'clock:last-project-id',

  // Last successful /api/auth/me/ payload, JSON-serialized. Written on every
  // successful boot fetch / login / signup by AuthProvider (hooks/useApi.js).
  // Read ONLY when boot-time getMe() rejects with a NETWORK error (no
  // ``.status`` on the thrown error — api/client.js attaches ``.status`` to
  // every HTTP error) while AUTH_TOKEN is still present: the offline-hydrate
  // path that keeps a valid session on the journal instead of bouncing to
  // Login when the wifi flakes. Cleared on logout or external session change.
  // Best-effort cache — never trusted over a live response, and never read
  // for HTTP 401/403 rejections.
  CACHED_USER: 'auth:last-user',
};
