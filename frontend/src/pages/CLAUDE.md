# frontend/src/pages/

Page-level architecture: the Quests hub, the Atlas hub, the Sigil Frontispiece, the Yearbook, the role-split Dashboard, and the page primitives that unify how every page renders.

## Page primitives (added 2026-05, commit `2b240fc`)

The 2026-05 audit lifted two layout primitives out of the per-page copy-paste pattern:

- **`<PageShell>`** ([`components/layout/PageShell.jsx`](/frontend/src/components/layout/PageShell.jsx)) — root wrapper replacing the copy-pasted `<motion.div className="max-w-6xl mx-auto space-y-5">`. Owns spine width (`max-w-6xl` wide / `max-w-3xl` narrow), vertical rhythm (3 tiers: `loose` = `space-y-6`, `default` = `space-y-5`, `tight` = `space-y-3`), and the fade-in animation. Does NOT add horizontal padding (that stays in `JournalShell`'s `px-4 md:px-6` to avoid double-padding). Set `animate={false}` for pages handling their own motion; pass `variants` to take over the motion config entirely. Set `as="main"` for `<main>` semantics. Used today across 17 surfaces — Achievements, ActivityPage, Badges, Character, ChildDashboard, ClockPage, CodexPage, DashboardSkeleton, Inventory, Manage, ParentDashboard, Payments, ProjectIngest, ProjectNew, Rewards, SettingsPage and Timecards. Quests-hub tab bodies (Chores, Habits, Projects, Homework, Movement, Forge, Trials) deliberately wear `QuestFolio` instead — they are tabs inside a hub, not page roots.

- **`<SectionHeader>`** ([`components/SectionHeader.jsx`](/frontend/src/components/SectionHeader.jsx)) — non-collapsible sibling of `AccordionSection` for always-open sections. Mirrors the `AccordionSection` vocabulary: script kicker, atlas chapter numeral via `index` prop (renders `§I`, `§II`, … through `chapterMark`), `RuneBadge` count badge, optional supporting body line via children, and right-aligned `actions` slot. Renders as `h2` by default (configurable via `as` prop — use `h3` for nested). Extensively used in `SettingsPage`, which now reads as a journal chapter with six `ParchmentCard` sections each led by a `SectionHeader` with chapter numerals 0-5.

**Mobile readability**: as part of the same audit:
- `HeaderStatusPips` button heights bumped from `h-8` (32px) → `h-11` (44px) with `px-3` to meet mobile tap-target sizing; text changed from `text-xs` → `text-caption`.
- Form modal grids now collapse `grid-cols-1 sm:grid-cols-2` (or `sm:grid-cols-3`) for screens below 640px (Chores, Habits, Manage, Timecards, Trials).
- All raw `text-xs` and `text-sm` replaced with semantic tokens (`text-caption`, `text-body`, `text-tiny`, `text-lede`) across ~110 instances.
- 30+ raw `<button>` elements migrated to `<Button>` or `<IconButton>` primitives across Habits, Chores, Settings, Manage, Inventory, Payments, Trials, ProjectNew, ClockPage, Rewards, Projects, Achievements, and Badges.

## Memory Meadow (first shared storybook slice)

`/meadow` is a lazy-loaded child-only page under `JournalShell`, reached from
the `MeadowVisitCard` on child Today. Existing journal/archive and parent
pages keep their current behavior. The page links directly to same-origin
`/play/` so the shared browser sign-in continues into Unity.

`pages/meadow/meadow.constants.js` adapts generated
`src/storybook/presentation.json` and bundled, hashed image/font URLs. The
source manifest lives at `shared/storybook/presentation.json`; update it
through `scripts/storybook/sync_presentation.py` rather than editing the
generated copy. Art filenames never identify a keepsake. Temporary dragon
portraits can be replaced independently of journal receipts and companion ID.

Capture reuses `JournalEntryFormModal`, first checking the existing
`getTodayJournal` endpoint to choose create or edit. Its private default,
family sharing choice, device drafts and idempotent retry remain intact.
Opt-in `surfaceClassName` / `surfaceStyle` pass through to `BottomSheet` so
the portal's capture and confirmation surfaces use the meadow palette and
bundled Nunito without changing other forms.
The optional second `onSaved` argument reports the form's effective mode,
including a POST 409 recovery into an edit; the meadow uses that value when
deciding whether a confirmed receipt can trigger a new-memory celebration.

`getMeadow` reads `/api/chronicle/meadow/`: verified, body-free journal award
receipts become `memory_bloom` keepsakes. Count is lifetime total; the array
contains the newest 30. A confirmed creation refreshes this endpoint and
celebrates only the saved journal's previously unknown receipt ID. Edits,
known receipt replays, unavailable rewards and uncertain saves never invent
another bloom. Say hello is local companion feedback and grants no reward.
Celebration motion respects `prefers-reduced-motion`.

## Quests hub (commits `3e8c18c`, `69d7b48`)

The Quests page consolidates all "things to do" under one tab hub. Seven top-level `ChapterHub` tabs:

| Tab | Slug | Backing page |
|---|---|---|
| Ventures | `ventures` | `pages/Projects.jsx` |
| Duties | `duties` | `pages/Chores.jsx` |
| Study | `study` | `pages/Homework/index.jsx` |
| Rituals | `rituals` | `pages/Habits.jsx` |
| Movement | `movement` | `pages/Movement.jsx` |
| Forge | `forge` | `pages/forge/index.jsx` |
| Trials | `trials` | `pages/trials/index.jsx` |

The hub itself lives at [`pages/quests/index.jsx`](/frontend/src/pages/quests/index.jsx). Legacy routes redirect:
- `/chores` → `/quests?tab=duties`
- `/homework` → `/quests?tab=study`
- `/habits` → `/quests?tab=rituals`
- `/trials` → `/quests?tab=trials` via `TrialsLegacyRedirect()` in [`App.jsx`](/frontend/src/App.jsx) (preserves the search string so `/trials?scroll=<itemId>` from QuickActions still works).

### Shared folio shell

[`pages/quests/QuestFolio.jsx`](/frontend/src/pages/quests/QuestFolio.jsx) is the verso/recto shell shared by Ventures, Duties, Study, Rituals, Movement. Modeled on `pages/achievements/FolioSpread.jsx` but parameterized so a tab can fill in its own letter / title / stats / progress without dragging the skill-tree XP math along.
- **Verso** (left, ~220-260px desktop · top banner mobile): cloth headband tied to tier (`tierForProgress`), brass-rimmed `IlluminatedVersal` drop-cap, script kicker, display-serif title with foil-glint, stats row, progress bar, optional `RarityStrand`.
- **Recto** (right): consumer-supplied children — the working list grouped under `ChapterRubric` numerals (§I, §II, …).

No new tier ladders, halo colors, or keyframes — composition against the existing Atlas cohort.

### Rarity mapping

[`pages/quests/quests.constants.js`](/frontend/src/pages/quests/quests.constants.js) maps per-page tier concepts onto the Atlas `RARITY_KEYS` vocabulary:
- `difficultyToRarity(level)` — Project difficulty 1-5 → common / uncommon / rare / epic / legendary (clamped both ends so off-scale values land on common).
- `effortToRarity` — Homework effort_level uses the same 1-5 ladder; aliased to `difficultyToRarity`.
- `buildRarityCounts(items, mapper, isEarned)` — produces the `{common: {earned, total}, …, legendary: {…}}` shape `RarityStrand` consumes. Empty buckets stay at 0 so the trough still paints.

Ventures + Study render a `RarityStrand` on the verso. Duties, Rituals, Movement, Forge, Trials skip it (their progression isn't difficulty-ranked).

### Trials sub-architecture

The standalone `/trials` page was folded into the Quests hub (now the last tab) and rewritten to speak the codex/folio/vessels vocabulary. Files under [`pages/trials/`](/frontend/src/pages/trials/):
- `index.jsx` — orchestrator: `IncipitBand` hero → `IssueChallengeForm` (parent-only) → `ActiveQuestFolio` → `FamilyTrialsFolio` → `QuestCodex`.
- `ActiveQuestFolio.jsx` — wraps the in-progress quest in the shared `QuestFolio` verso/recto shell (letter initial, quest name, progress, stats, party/rewards on the recto).
- `QuestCodex.jsx` — vessel kind shelf (All/Boss/Collection/Co-op) + codex shelf (four status chapters: **Available** §I / **Underway** §II / **Closed** §III / **Locked** §IV) + `TrialsFolio` body. The Locked chapter is new — quests gated by `required_badge` render there with an unlock hint.
- `TrialsFolio.jsx` — chapter body; tile grid of `QuestTile` components.
- `QuestTile.jsx` — individual quest card.
- `FamilyTrialsFolio.jsx` — parent's family roll-up with `ChapterRubric` header.
- `IssueChallengeForm.jsx` — parent-only utilitarian form; co-op toggle + multi-child picker; surfaces `allowed_triggers` and `on_time_only` toggle in an Advanced details panel.
- `trials.constants.js` — `CHAPTERS`, `KIND_FILTERS`, `groupQuestsByChapter`, `overallProgress`, status & kind vocabulary.

Backend `QuestDefinitionSerializer` widened by two fields — `required_badge_id` + `required_badge_name` — so the Locked chapter can render unlock hints without a second fetch.

### Forge sub-architecture

Sits between Ventures and Trials — 3D print requests. Backend contract lives in [`apps/printing/CLAUDE.md`](/apps/printing/CLAUDE.md);
the frontend half is under [`pages/forge/`](/frontend/src/pages/forge/):

- `index.jsx` — orchestrator. A hub tab, so it wears `QuestFolio` and **not**
  `PageShell`. Verso stats are pending / printing / grams-this-month; verso
  progress is the household's filament cap consumption. Sections are numbered
  `ChapterRubric`s: Awaiting your decision (parent) → In the queue → On the bed →
  Monthly budgets (parent) → Prints without a request (parent) → Printers
  (parent) → Finished & closed.
- `PrintRequestCard.jsx` — thumbnail (placeholder when null), colour chip,
  needed-by, `StatusBadge`, the reason, live `ProgressBar` while a job runs, and
  the **decoded** `latest_job.failure_reason` on failure — never an HMS code.
- `PlateFilenameChip.jsx` — the minted `plate_filename` with a copy button.
  Shared by the card and the approval sheet because that string *is* the flow:
  matching is `normalize_subtask_name(reported) == request.slug`, so a plate
  saved under the wrong name lands as an unlinked job someone has to hand-link.
- `PrintRequestModal.jsx` — the child's submit form. Link **or** upload; links
  POST JSON, an upload switches to multipart (which is why `createPrintRequest`
  accepts either an object or a `FormData`). The `/print-requests/preview/`
  scrape on blur/paste is soft — a preview `error` renders as a hint, never a
  blocker, because `enrich_request_metadata` gets another shot after submit.
- `ApprovalSheet.jsx` — grams + minutes from the slicer, notes, Approve/Reject.
  A **409** carries `problems[]` and the budget summary; the sheet renders them
  and offers an explicit "Approve anyway" that re-POSTs with `force: true`.
  Branching is on `err.status`, never on the message string.
- `BudgetPanel.jsx` — parent-only. Two independently-capped dimensions; a null
  cap renders "No cap" (zero is a real cap meaning "nothing this month") and a
  negative remaining renders as an ember overage rather than being clamped.
  Inline cap editor, append-only adjustment form, recent ledger.
- `FilamentChip.jsx` — one loaded spool, read-only on the printer card and a
  button in the request form. Honest about absence: a null `hex` (unread tag)
  is a dashed outline, never black — `#000000` is real black filament — and a
  null `remain_percent` (any spool without an RFID tag, i.e. every third-party
  roll) renders no number rather than "0%".
- `FilamentPicker.jsx` — the swatch row above the Colour field. Reads
  `live.filaments` from each active printer's status, dedupes by name+colour,
  and **fills the free-text field in** rather than replacing it: the AMS
  reports what is loaded *now*, and the plate may be sliced days later. It
  stores the readable name, never a slot. Renders nothing — not an error, not
  an empty state — when the printer is asleep or the call fails, because the
  form has to keep working exactly as it did before.
- `PrinterStatus.jsx` — polls `GET /api/printers/<id>/status/` on the
  `ProjectIngest` pattern (setTimeout recursion, ref cleared on unmount,
  `document.hidden` skip), 10s while a job is open and 45s idle. It reads our
  fan-out snapshot rather than opening MQTT: the X1's broker tolerates ~four
  clients total, shared with Studio / Handy / Home Assistant.
- `UnlinkedJobsPanel.jsx` — parent-only Handy escape hatch. Picker is filtered to
  `LINKABLE_REQUEST_STATUSES` so a rejected or cancelled request can never
  absorb a print. It also has to be *emptyable* — every print a parent runs
  for themselves lands here and matches nothing — so each row carries
  **Dismiss** (soft hide, reversible from the "Show N cleared prints" toggle)
  and **Delete** (irreversible, behind a `ConfirmDialog`). The page fetches
  the cleared rows as a second `listPrintJobs({unlinked, dismissed})` call
  rather than a flag on the first, so the default list stays exactly what
  needs attention. The server refuses both actions on a running or linked
  job; the panel renders that refusal in its `ErrorAlert` rather than
  no-op'ing.
- `PrinterConfigPanel.jsx` — parent-only printer registry. Credentials are
  write-only; blank fields on an edit mean "keep what is stored". The server
  refuses an incomplete printer, so a 400 comes back keyed by field
  (`{access_code: [...]}`) and `fieldErrors` from [`utils/api.js`](/frontend/src/utils/api.js)
  hangs each message on its own input rather than letting the client's
  `JSON.stringify` fallback print raw JSON in the banner. Anything the form has
  no input for still falls through to the banner. Cards render
  `credential_hint` (or `last_error`) beneath the meta line — the red badge on
  its own never said *which* field was blank.
- `forge.constants.js` — tone maps, `formatGrams` / `formatMinutes` /
  `formatCap`, `usagePercent`, `budgetProgress`, `jobProgressLabel`,
  `isJobOpen`, `describeFilament`.

Child sees their own requests, a submit button, and the live view only while one
of *their* prints is running. Parents additionally get the approval queue, the
budget panel, the unlinked-jobs panel and printer config.

## Atlas hub ([`pages/atlas/index.jsx`](/frontend/src/pages/atlas/index.jsx))

Three top-level `ChapterHub` tabs — **Skills** ([`pages/Achievements.jsx`](/frontend/src/pages/Achievements.jsx)), **Badges** ([`pages/Badges.jsx`](/frontend/src/pages/Badges.jsx)), **Sketchbook** ([`pages/Portfolio.jsx`](/frontend/src/pages/Portfolio.jsx)). Skills and Badges are siblings, not sub-tabs. Badge admin (create/edit/delete) lives under Skills → Manage because [`ManagePanel`](/frontend/src/pages/achievements/ManagePanel.jsx) is a single cross-cutting admin surface for categories/subjects/skills/badges — don't duplicate it on the Badges tab.

A fourth tab — **Yearbook** — sits inside the Atlas hub: lifelong chronological chapter timeline with `ChapterCard` variants (current/past/future), `TimelineEntry` with kind-iconed rows, `EntryDetailSheet` (BottomSheet), and `ManualEntryFormModal` for the parent-only add-memory flow.

### Skills page ([`pages/Achievements.jsx`](/frontend/src/pages/Achievements.jsx), "Illuminated Atlas")

A **tome shelf opening onto an illuminated folio** — designed to speak the same manuscript language as its Atlas siblings. [`SkillTreeView`](/frontend/src/pages/achievements/SkillTreeView.jsx) is a thin orchestrator: [`TomeShelf`](/frontend/src/pages/achievements/TomeShelf.jsx) + [`TomeSpine`](/frontend/src/pages/achievements/TomeSpine.jsx) above [`FolioSpread`](/frontend/src/pages/achievements/FolioSpread.jsx).

**TomeShelf** is a horizontal snap-scroll rail with `role="tablist"` + arrow-key nav + `scrollIntoView` on active change (same contract as the old CategoryRibbon). **TomeSpine** renders each SkillCategory as a bound book: icon medallion at the head cap, vertical display-serif name running up the spine (14px, `writing-mode: vertical-rl` + `transform: rotate(180deg)`), a bookmark ribbon in sheikah-teal that unfurls on select, an L# chip near the foot, and a gilt foot-band whose fill width/color is keyed to `tierForProgress` for category progress. The chip + band live **inside** the flex column (icon → `flex-1` title → chip → band) so a long vertical title like "Woodworking" can never overflow into the chip zone regardless of category name length.

**FolioSpread** renders the active category as a two-page parchment spread on desktop (`md:grid-cols-[220px_1fr]`, gutter shadow down the middle) collapsing to single-column on mobile. The verso (left page) is the category incipit: a huge gilt drop-capital rendered by [`IlluminatedVersal`](/frontend/src/components/atlas/IlluminatedVersal.jsx), script kicker, level strap, and a progress bar. The recto (right page) lists subjects as [`ChapterRubric`](/frontend/src/components/atlas/ChapterRubric.jsx) headers (§I / §II drop-caps, not sticky) followed by [`SkillVerse`](/frontend/src/pages/achievements/SkillVerse.jsx) rows.

**SkillVerse** is an illuminated row: `IlluminatedVersal` drop-cap (the skill's first letter) filling bottom-up with gilt as XP accrues + wearing a `RARITY_HALO[tier]` glow at cresting/gilded tiers, the skill name + level name + inline [`PrereqChain`](/frontend/src/pages/achievements/PrereqChain.jsx), and a right-aligned L# strap with a thin gilt hairline encoding progress to next level. [`SkillDetailSheet`](/frontend/src/pages/achievements/SkillDetailSheet.jsx) (via `BottomSheet`) also uses `IlluminatedVersal` at `size="xl"` with the halo.

Parent View|Manage toggle in the header routes to [`ManagePanel`](/frontend/src/pages/achievements/ManagePanel.jsx).

### Badges page ([`pages/Badges.jsx`](/frontend/src/pages/Badges.jsx), "Sigil Case — Reliquary Codex")

View-only illuminated codex that groups badges into seven criterion-family chapters (Chronos · Ventures · Mastery · Coffers · Scholar · Adventure · Reliquary), mirroring how [`apps/achievements/criteria.py`](/apps/achievements/criteria.py) already buckets criterion types by subsystem.

- [`SigilCodex`](/frontend/src/pages/achievements/SigilCodex.jsx) orchestrates — an [`IncipitBand`](/frontend/src/components/atlas/IncipitBand.jsx) hero above seven [`CollectionFolio`](/frontend/src/pages/achievements/CollectionFolio.jsx) sections.
- [`collections.constants.js`](/frontend/src/pages/achievements/collections.constants.js) owns the taxonomy: `COLLECTIONS` array (id/rubric/letter/name/kicker/criteria), `collectionForCriterion` (falls back to `reliquary` for unknowns so new backend criteria never render as "undefined"), `groupBadgesByCollection`, `rarityCounts`, `unlockHint` (plain-English template for every known criterion_type; falls back to `badge.description` for unknowns), `ladderSiblings` (same-criterion_type progressions for the detail sheet).
- Each folio is a `<section aria-labelledby>` with a rubric numeral (§I–§VII), an `IlluminatedVersal` drop-cap whose gilt fills with chapter progress, a slim [`RarityStrand`](/frontend/src/components/atlas/RarityStrand.jsx) (5-segment distribution band sized by per-rarity totals, inner fill by earned/total), and the 2/3/4/5-col sigil grid. Empty chapters still render the header + "no seals yet in this chapter" whisper so the codex skeleton reads consistently for fresh users.
- [`BadgeSigil`](/frontend/src/components/atlas/BadgeSigil.jsx): earned sigils keep `RARITY_HALO` + foil sheen + `animate-gilded-glint` for recents (≤ 7d via `isRecentlyEarned`) and now show a `+{xp_bonus} XP` gilt ledge. Unearned sigils render as **debossed intaglios** — pressed ring with inset shadow, grayscaled icon, and a single-line font-script `unlockHint(badge)` line beneath the name. `aria-label` still ends in `· not yet earned`.
- [`BadgeDetailSheet`](/frontend/src/pages/achievements/BadgeDetailSheet.jsx) accepts `allBadges` + `earnedIds` so it can render (a) a `"from the reliquary of {chapter} · §N"` script chip, (b) a "to earn" / "you earned this by" unlock card with the plain-English hint, and (c) a ladder strip of Tier I/II/III rungs when 2+ badges share a criterion_type (current rung highlighted; earned siblings styled moss; later rungs dashed + muted). Pass-through from `Badges.jsx` via `useMemo`'d `earnedIds` Set.
- **Hint-vs-description dedupe**: the detail sheet suppresses the hint card when `unlockHint(badge)` falls back to `badge.description`, so the same prose doesn't render twice (description already sits under the rarity ribbon). Sigil tiles are unaffected — they never show the description, so the hint always renders on unearned tiles.
- **Accessibility**: every folio exposes `role=region` via `<section aria-labelledby>`; `RarityStrand` carries `role="img"` with a descriptive aria-label ("4 of 21 sealed — 2 of 7 common, 1 of 6 uncommon, …"). All gilt / flourish / glint effects sit inside the existing `@media (prefers-reduced-motion: reduce)` rules in [`index.css`](/frontend/src/index.css).
- No backend changes — reads `/api/achievements/summary/` + `/api/badges/` exactly as the old flat grid did. The retired `BadgeSigilGrid.jsx` is gone; `SigilCodex` is the only consumer in the tree.

### Sketchbook page ([`pages/Portfolio.jsx`](/frontend/src/pages/Portfolio.jsx))

Flattens the `/api/portfolio/` response (`{projects, homework}`) into one unified item list, then re-groups based on the active mode. Toolbar: four filter pills (`All` / `Projects` / `Homework` / `Timelapses`) with live counts + a `By project` / `By date` sort toggle. By-date groups by `"MMMM YYYY"` (newest first). Each tile is a `<button>` — click opens an inline lightbox (fixed overlay at `z-50`, prev/next `IconButton`s, click-backdrop-to-close) scoped to the current filtered/ordered set.

- **Audio playback** (2026-05): when the active tile is a Creation that carries an `audio` attachment, the lightbox renders an `<audio controls>` next to the image — fix for the upload-but-never-playback latent bug.
- Trash icon in the top-right corner is gated by `canDelete = user.role === 'parent' || item.ownerId === user.id` and routes through [`ConfirmDialog`](/frontend/src/components/ConfirmDialog.jsx) (`role="alertdialog"`, "Remove" label).
- Delete endpoints: `DELETE /api/photos/{id}/` for project photos (permissioned `destroy` on [`ProjectPhotoViewSet`](/apps/portfolio/views.py) — owner or parent; both the row AND the storage blob go), `DELETE /api/homework-proofs/{id}/` for proofs (new [`HomeworkProofViewSet`](/apps/homework/views.py) — destroy-only; the parent `HomeworkSubmission` stays so approval history remains intact).
- The [`PortfolioView`](/apps/portfolio/views.py) response includes `user` on each photo and `user_id` on each homework item so the frontend can gate `canDelete` without an extra lookup.

## Character page / Frontispiece (`/sigil`, route redirected from `/character`, 2026-04-22 redesign)

The inside-cover plate of the journal — personal author-portrait rather than a dashboard. Architecture in [`pages/character/`](/frontend/src/pages/character/):

- [`SigilFrontispiece.jsx`](/frontend/src/pages/character/SigilFrontispiece.jsx) — hero incipit with an oversized `IlluminatedVersal` of the user's initial (gilt fills with level %), display-name in italic serif, active title as a script chip, the **Trophy Seal** on the recto, and three `StreakGlyph` vital pips beneath (current streak with animated `StreakFlame`, perfect days, best streak).
- [`TrophySlot.jsx`](/frontend/src/pages/character/TrophySlot.jsx) + [`TrophyBadgePicker.jsx`](/frontend/src/pages/character/TrophyBadgePicker.jsx) — empty slot is a debossed intaglio ("choose from your reliquary"); filled slot wears full `RARITY_HALO`. Picker is a `BottomSheet` that passes earned badges through `groupBadgesByCollection` — clicking a seal sets the trophy; clicking the current trophy clears it (null payload).
- Four [`CosmeticChapter.jsx`](/frontend/src/pages/character/CosmeticChapter.jsx) folios mirror `CollectionFolio`: rubric numeral + drop-cap + rarity strand + sigil grid. Each tile is a [`CosmeticSigil.jsx`](/frontend/src/pages/character/CosmeticSigil.jsx) in one of three states — **equipped** (halo + "equipped" gilt ribbon), **owned** (clean rarity-ringed tile), or **locked** (debossed intaglio + script unlock hint derived from `item.description` or a rarity-flavored fallback). Locked tiles render as `role="img"` with "not yet owned" in the aria-label — not clickable, so they don't accept focus or trigger equip.
- **Live theme preview**: hovering a cosmetic in the Journal Covers chapter calls `applyTheme(metadata.theme)` transiently so the whole page skin previews in real time. `mouseleave` / `blur` restores the user's current theme. Guarded by `matchMedia('(prefers-reduced-motion: reduce)')` — reduced-motion users never see the flash.
- Per-area shared logic lives in [`character.constants.js`](/frontend/src/pages/character/character.constants.js) — `COSMETIC_CHAPTERS` (slot → rubric/letter/name/kicker), `STREAK_TIERS` + `streakTier(days)` (flame sizing ladder aligned with backend milestone thresholds 1/7/30/100), `mergeSlotCosmetics(slot, owned, catalog, activeId)` (dedupe + sort: equipped → owned → locked, each sub-sorted by rarity then name), `slotRarityCounts` (feeds the strand), `cosmeticLockHint` (description-or-rarity-flavored fallback).
- [`Character.jsx`](/frontend/src/pages/Character.jsx) is a thin orchestrator: parallel fetches via `useApi` for `getCharacterProfile` + `getCosmetics` + `getCosmeticCatalog` + `getBadges` + `getAchievementsSummary`, with `useMemo`'d `allBadges`/`earnedBadges` passed to the picker. Equip/unequip + trophy-set all optimistically mutate via `refresh()` without a full page reload.

## Dashboard (role-split)

[`pages/Dashboard.jsx`](/frontend/src/pages/Dashboard.jsx) is a thin router — loads `/api/dashboard/` once and branches to `ChildDashboard` or `ParentDashboard` based on `user.role`. The shared loader + error-retry block lives at this layer so integration tests can exercise both roles from one entry point.

- **Child** body: contextual `HeroPrimaryCard` (priority `clocked → next-action → quest-progress → idle`, where `next-action` consumes `next_actions[0]` from the backend's [`apps/projects/priority.py`](/apps/projects/priority.py) scorer), horizontal `VitalPipStrip` (coins/streak/level/pet), quest log (duties/homework/rituals entries with "to be inked before nightfall" kicker merged into the page header — no separate "Today's Log" section header), loot rail, and everything else wrapped in `AccordionSection` (collapsed by default, open state persisted per-title in `localStorage` keyed `dashboard-accordion-{slug}`). **Since-last-visit card** (2026-06): the dashboard payload's child-only `since_last_visit` block (`{last_seen_at, badges_earned, coins_earned, approvals}`, `null` on first visit — backed by `User.last_seen_at`, stamped on every dashboard fetch) renders as a dismissible [`SinceLastVisitCard`](/frontend/src/components/dashboard/SinceLastVisitCard.jsx) above the `VitalPipStrip`; it hides itself when every count is zero, so quick refreshes show nothing.
- **Parent** body: `useParentDashboard` hook aggregates pending chores + pending homework submissions + pending redemptions + pending creations + pending **exchange requests** (added 2026-05 via `getExchangeList`) in parallel via `Promise.allSettled`, unifies to `{ id, kind, kidId, kidName, title, subtitle, reward, submittedAt }`, sorts newest-first; `ApprovalQueueList` groups by kid with inline Approve/Reject rows that call the existing `approveChoreCompletion` / `approveHomeworkSubmission` / `approveRedemption` / `approveCreation` / `approveExchange` endpoints and optimistically remove the row. **Approve all (N)** (2026-05): when a kid has 2+ approvable rows pending, a per-kid `Approve all (N)` button appears; the fanout uses `Promise.allSettled` so a single 4xx doesn't kill the batch (failures stay visible with an error chip). Bulk runs greater than 3 rows prompt a `ConfirmDialog` first. **Reject sheet** (2026-05): the inline Reject button now opens a `BottomSheet` with an optional note input — the note is woven into the rejection-notification body (visible per the chore/homework/creation/redemption/exchange notification types) so the kid sees why without having to ask. **Empty state** (2026-05): the dashboard payload's `_parent_extras` now includes `children_count`; `ParentDashboard` renders a `NoChildrenWelcome` card linking to `/manage` when `children_count === 0` instead of an empty queue. **Child picker on Payments adjust** (2026-05): the parent-only `Adjust Payment` form on `/payments` swapped its raw "Child User ID" number input for a `<SelectField>` populated by `getChildren()` — eliminates typo-driven 404s. **Partial-failure visibility** (2026-05-09): the hook also returns `failedSources` (string labels — `chore approvals`, `homework approvals`, `reward redemptions`, etc., one per `SOURCES` entry in [`useParentDashboard.js`](/frontend/src/hooks/useParentDashboard.js)). `ParentDashboard.jsx` renders an `<ErrorAlert>` + Retry button above the queue when any fetch errored, so a 500 on (say) `/api/homework/dashboard/` is no longer indistinguishable from "no pending homework approvals" — pinned by the "shows a retry-able banner when an approval queue fails to load" case in [`ParentDashboard.test.jsx`](/frontend/src/pages/ParentDashboard.test.jsx). Today's Log is retired for parents. Collapsed `Week at a glance` + `Quick adjusts` blocks round out the page. **Week at a glance is live** (2026-06): `_parent_extras` now returns `this_week_by_kid` (`[{kid_id, name, hours, earnings}]` — completed `TimeEntry` minutes × the child's `hourly_rate`, family-scoped via `children_in`), so `WeekGlanceBlock` and the Family Snapshot per-kid lines render real data instead of the perpetual empty state.

## Global header + FAB

`JournalShell` wraps avatar (mobile) + `HeaderStatusPips` (middle, role-aware) + `NotificationBell` (right) in a `sticky top-0 z-30` container that also includes the `HeaderProgressBand` — a 2–3px full-width band that's inert by default and renders a sheikah-teal gradient scaled to `getActiveQuest().progress_percent` when a quest is active. The sticky container has a `bg-ink-page` backdrop so page content doesn't bleed through on scroll.

**Gotcha:** the mobile `overflow-x: hidden` guard lives on `body` (not `main`) in `index.css` — putting it on `main` turns `<main>` into a scroll container which traps `position: sticky` inside the main's overflow instead of the window.

**Quest log on the child dashboard** is now driven entirely by `next_actions` from the dashboard payload — `buildQuestLogFromActions()` in [`ChildDashboard.jsx`](/frontend/src/pages/ChildDashboard.jsx) buckets the scored, sorted feed into Study (homework) / Duty (chore) / Ritual (habit) sections. Backend ordering (overdue → due-today → due-tomorrow → daily chore → due-this-week → weekly chore — see scoring formula in [`apps/projects/priority.py`](/apps/projects/priority.py)) is preserved within each section. Submitted-pending homework is excluded server-side ("nothing left to *do*"); rejected submissions remain eligible. Clicking an open homework row opens [`HomeworkSubmitSheet`](/frontend/src/components/HomeworkSubmitSheet.jsx) inline (photo upload + notes + `submitHomework`) so the child can file proof without leaving the dashboard — the same component is reused on [`pages/Homework/index.jsx`](/frontend/src/pages/Homework/index.jsx).

`QuickActionsFab` replaces the old `ClockFab` — single bottom-right button that opens `QuickActionsSheet` with role-aware contextual actions: child sees Clock in · Add homework · Submit due (only when a due assignment exists) · Ask for a print (deep-links to `/quests?tab=forge&new=1`, which opens the submit modal on mount) · Start a quest (only when a quest scroll is in inventory) · Contribute to hoard (only when an active savings goal exists); parent sees Clock in · Create homework for a kid · Adjust coins · Adjust payment. Reward shop is deliberately **not** in quick actions — browsing rewards is a considered choice and belongs on the Treasury page. Clock-in is still the most common action and is the default focus when opened. The FAB continues to show a running-timer chip while clocked in so the at-a-glance signal is preserved.

## Notifications constants parity

[`components/NotificationBell.jsx`](/frontend/src/components/NotificationBell.jsx) renders a type-specific lucide icon and falls back to a sensible default route when the backend `link` field is empty, via the `NOTIFICATION_TYPE_META` map in [`components/notifications.constants.js`](/frontend/src/components/notifications.constants.js) (`{icon, accent, route}` per type — e.g. `badge_earned` → Award icon, gold accent, `/atlas?tab=badges`). The default route is the safety net: notifiers that forget to set `link` still navigate to a relevant page rather than no-op'ing the click.

**Parity gate**: [`notifications.constants.test.js`](/frontend/src/components/notifications.constants.test.js) hardcodes the backend `NotificationType` enum; the test fails CI when a new value lands on the backend without an entry here, so the bell can't silently degrade to the generic Bell + no-route fallback. Unknown types still fall back gracefully to `BellRing` + null route — but the parity test is what makes that a fail-loud rather than fail-silent path.

## Avatars

`accounts.User.avatar` ImageField → `upload_to="avatars/"`. Self-uploaded on the Settings page Profile card — hidden `<input type="file">` triggered by a "Upload/Change avatar" `<Button>`, optionally paired with a "Remove" button that opens `ConfirmDialog` and sends `PATCH /api/auth/me/ {avatar: ""}`. Upload path runs the file through [`downscaleImage`](/frontend/src/utils/image.js) (`maxDim: 512`) before sending multipart. [`MeView.patch`](/apps/projects/views.py) accepts both multipart + JSON via `parser_classes = [MultiPartParser, FormParser, JSONParser]` — a new file replaces the old via `user.avatar.delete(save=False)` → new assign, empty-string sentinel clears without assigning. [`AvatarMenu`](/frontend/src/components/AvatarMenu.jsx) renders `<img src={user.avatar}>` when set, falls back to the display-name initial otherwise. [`AuthProvider`](/frontend/src/hooks/useApi.js) exposes `setUser` so `SettingsPage` can refresh context in place after upload — no second `/auth/me/` roundtrip needed.

## Page list

```
pages/
  Dashboard.jsx                Thin role router — loads /dashboard/ once,
                               branches to ChildDashboard / ParentDashboard
  ChildDashboard.jsx           Child body (HeroPrimaryCard + VitalPipStrip
                               + quest log + AccordionSections)
  ParentDashboard.jsx          Parent body (ApprovalQueueList + Week at a
                               glance + Quick adjusts)
  _dashboardShared.js          formatWeekdayDate, mapProjectTone,
                               streakMultiplier helpers shared across both
                               bodies
  Projects, ProjectDetail, ProjectNew, ProjectIngest
  ClockPage
  Chores                       Backing tab for /quests?tab=duties
  Homework/                    index.jsx + sibling AssignmentCard.jsx —
                               backing tab for /quests?tab=study
  Habits                       Backing tab for /quests?tab=rituals
  Movement                     Backing tab for /quests?tab=movement
  Inventory
  bestiary/                    BestiaryHub — Companions/Mounts party tabs
                               + Codex + Hatchery (4 sub-tabs all speaking
                               the Atlas template — see apps/pets/CLAUDE.md
                               for the alignment details)
  quests/                      QuestsHub orchestrator (7 tabs) + QuestFolio
                               shell + quests.constants
  forge/                       3D print requests — index + PrintRequestCard,
                               PlateFilenameChip, PrintRequestModal,
                               ApprovalSheet, BudgetPanel, PrinterStatus,
                               PrinterConfigPanel, UnlinkedJobsPanel,
                               forge.constants
  trials/                      Trials sub-architecture (ActiveQuestFolio,
                               QuestCodex, TrialsFolio, FamilyTrialsFolio,
                               IssueChallengeForm, QuestTile,
                               trials.constants)
  Character.jsx, character/    Sigil Frontispiece, TrophySlot,
                               TrophyBadgePicker, CosmeticChapter,
                               CosmeticSigil, character.constants,
                               WellbeingCard
  Timecards, Payments, Rewards
  Achievements                 Skills tab inside AtlasHub (skill tree +
                               parent View|Manage toggle)
  Badges                       Sibling tab inside AtlasHub — sigil case,
                               view-only
  Portfolio                    Sketchbook tab inside AtlasHub
  yearbook/                    Atlas 4th tab — lifelong chronological
                               chapter timeline; ChapterCard with
                               current/past/future variants, TimelineEntry,
                               EntryDetailSheet (BottomSheet),
                               ManualEntryFormModal, JournalEntryFormModal
  Manage                       Parent CRUD (Children + Co-parents + Project
                               Templates + Rewards + Categories + Subjects
                               + Skills + Badges + Admin)
  SettingsPage                 PageShell width="narrow" rhythm="loose" +
                               six SectionHeader-led ParchmentCard sections
  Login, Signup
```

Page-level `*Card` / `*Verse` / `*Sigil` / `*Spine` components (AssignmentCard, CatalogCard, SkillVerse, TomeSpine, BadgeSigil, RewardCard, CoinBalanceCard, ProjectOverridesCard, StepCard) live as sibling files in their owning subfolder. Promote to `components/cards/` only when reused twice.

## Key entry points
- `Dashboard.jsx` — role router.
- `quests/index.jsx`, `quests/QuestFolio.jsx`, `quests/quests.constants.js`.
- `forge/index.jsx`, `forge/forge.constants.js`, `forge/PlateFilenameChip.jsx`.
- `trials/index.jsx`, `trials/QuestCodex.jsx`, `trials/trials.constants.js`.
- `Achievements.jsx`, `achievements/SkillTreeView.jsx`, `achievements/SigilCodex.jsx`, `achievements/collections.constants.js`.
- `Character.jsx`, `character/SigilFrontispiece.jsx`, `character/character.constants.js`, `character/WellbeingCard.jsx`.
- `yearbook/JournalEntryFormModal.jsx`.
- `Portfolio.jsx`.
