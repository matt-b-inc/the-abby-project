# Abby Camp — first Unity prototype

A first Unity prototype connected to the existing Django app. The phone Web prototype now opens a small **Memory Meadow** with a following dragon, touch exploration, direct task access, and confirmed journal keepsakes. The dragon art is a temporary project-authored illustration; the explorer still uses the original Kenney placeholder. **The primary product target is Abby's iPhone on iOS; Android is the first available test device.**

## Shared meadow slice

The child-only web page at `/meadow` is reachable from Today. It uses the existing private-by-default journal form and its interrupted-save reconciliation. A new eligible journal's confirmed reward receipt appears as a **Memory bloom** on both the web page and Play. Editing a journal, greeting the dragon, refreshing, or reopening Play grants nothing. The read-only `/api/chronicle/meadow/` response contains receipt identifiers, dates and counts, never journal words or family replies. It shows the newest 30 blooms and all-time totals, projected from existing journal records; legacy entries without verified awards and administratively deleted entries are not retained as separate collectibles.

Play reads the same authenticated child account, refreshes after browser resume and periodically, and clears the old collection on account changes. Its first visit displays existing blooms without replaying their celebrations. Later new receipts cause one local reaction per origin and child on this device; this acknowledgement is presentation only.

`shared/storybook/presentation.json` and its exported artwork/font are canonical for both clients. Run `python scripts/storybook/sync_presentation.py` after editing them, or `--check` to detect drift. The authored `Assets/AbbyCamp/Presentation/Meadow.asset` holds appearances, palette and shared Nunito font. Rebuilding preserves its appearance references and the authored dragon definition. Replace that definition's portrait or model and animation mapping without changing the companion ID or journal receipt IDs. See [AssetNotes.md](AssetNotes.md) for provenance and replacement details.

For a disposable same-origin React and Unity preview, build both clients and run:

```powershell
python scripts/unity/web_fixture_server.py --frontend-root frontend/dist --port 8089
```

This fixture seeds synthetic accounts and writing skills; it never reads `.env` or the project database. Sign in with the fixture credentials, keep a test memory at `/meadow`, then open `/play/` in the same browser. Physical phone performance, keyboard and lifecycle checks remain necessary.

## Product goal and next slice

The core loop is **record life → save a lasting memory → receive recognition → return for family interaction and reflection**. Abby should be able to add journals, school results, creations, photos, and milestones, and look back on them later in life. Parents should be able to participate through encouragement, shared prompts, memories, and rewards. Game progression is driven by these contributions; the visual theme remains open.

Reward each eligible saved contribution once. Keep content capture available after the day's reward allowance is used. Recognize recording and reflecting on a grade consistently across good and disappointing results. Accumulated milestones can unlock companion progress, customization, album covers, and adventure chapters. Edits and revisits remain interactive while reward eligibility stays tied to distinct contributions.

Journal and grade capture are implemented in the existing web app: recoverable device drafts, confirmed saves, durable XP receipts, a small paw reaction, family replies on shared entries, and reopening memories in their history tabs or Yearbook. Grades retain percentages, points, or letters as recorded, with optional reflections and later corrections. The first grade capture each day is eligible for recognition independent of its mark; further results remain saveable. Stable save and reply request IDs reconcile interrupted requests without duplicate awards or replies. See [the phone capture guide](../../docs/journal-phone-slice.md). Additional memory capture, complete lifetime export, and connecting the reaction to an owned companion in Unity remain additional work.

Journal and grade entries default to **Only you**. Abby can explicitly share an entry with family and change its sharing later. Server access checks protect private entries across web and MCP reads; family replies require a shared entry. Chronicle responses are excluded from the web app's offline API cache so a cached response cannot bypass account or sharing changes. Archive requirements include journal text, structured grades, original photos/audio, dates, parent responses, and full export/backup; the current portfolio export does not cover all of these.

## iPhone direction

The phone prototype has a responsive portrait/landscape layout, safe-area insets, scrollable sheets, keyboard-aware login, tap-to-walk, a following camera, and direct Tasks access from anywhere. Tap the companion or **Say hello** for a friendly local reaction with no reward or account mutation. Theme selection remains open pending Abby's preferences. Browser viewport checks help development; Android and iPhone hardware still need performance, keyboard, resume, and safe-area testing.

There is no Mac available yet. The existing React home-screen web app handles capture and history; Unity exports a separate Web scene served at **/play/** on the same HTTPS origin. Its welcome screen loads Unity after an explicit tap, and offers a return link to the web app. Unity 6.6 supports [iOS Safari 15 and newer and Android Chrome](https://docs.unity.com/en-us/engine/6000.6/manual/platform-specific/webgl/intro/browsercompatibility); Web builds and native iOS builds are separate validation targets. Native packaging can follow when a Mac or cloud build route is available.

The existing backend's skill, pet, quest, and milestone systems can drive long-term progression. Owned-pet integration, evolving scenery, furnishings, and world unlocks are not implemented in this Unity prototype. Presentation should read authoritative progress and preserve it when the theme or assets change.

iOS also needs remembered login, refresh after app resume, preserved reconciliation for interrupted saves, an accessible HTTPS backend, an iOS build profile, and validation on Abby's actual phone. Native local builds use macOS and Xcode; [Unity's build guide](https://docs.unity3d.com/6000.0/Documentation/Manual/iphone-BuildProcess.html) also describes the cloud build alternative.

## Open and play

Use **Unity 6000.6.5f1**, the selected editor for this project. See [the official release notes](https://unity.com/releases/editor/whats-new/6000.6.5f1).

Install 6000.6.5f1 in Unity Hub under **Installs → Install Editor**, including **Web Build Support**. In **Projects**, select AbbyCamp's editor version and choose 6000.6.5f1. The editor's import upgrades its supported packages; retain the resulting package manifest/lock and project settings together. The original desktop harness was built with 6000.3.2f1.

The original editor, 6000.3.2f1, has Unity's known valid-package signature warning. See [Unity's official notice](https://discussions.unity.com/t/package-manager-error-resolved-new-hub-badge-warning/1706569).

Open `Assets/AbbyCamp/Scenes/Camp.unity`, then press Play. The scene and presentation assets are saved in the repository; rebuilding is optional.

After a local build, run `Builds/Windows/AbbyCamp.exe`. This development build supports the loopback Django server and also connects to remote HTTPS origins.

| Control | Action |
| --- | --- |
| Tap the ground | Walk to that spot; dragging a sheet does not move the character |
| Tasks / tap the board | Open rituals directly, without walking to the board |
| Tap the companion / Say hello | Friendly reaction, with no XP or save |
| Change look | Switch dog and fox while preserving the gameplay root |
| Back to camp | Close a sheet when no request is in progress |

Keyboard arrows/WASD, E near the board, K, and Escape remain useful editor conveniences. Windows is a development harness, not a product target.

Demo mode is usable without a server. Its one practice action is saved locally as a demo flag, never as coins, XP, inventory, or activity in a real account.

## Connect real rituals

1. Start the existing Django development server, or use the deployed app's HTTPS origin.
2. For Web `/play/`, sign in to the journal on the same browser origin first. The world validates that existing account through `/api/auth/me/` and connects automatically for a child account. If sign-in is needed, **Connect your account → Open journal** returns to the journal. The editor/Windows harness retains explicit child-account login and an origin field (for example, `http://127.0.0.1:8000`, without `/api`).
3. Open **Tasks**. It lists that child's active, approved positive/both habits, including disabled rows that reached their daily cap.
4. Record a habit only after doing it. The client calls the existing `POST /api/habits/{id}/log/` once and celebrates only an acknowledged response. Refreshes read current habits and character level/streak from Django.

Web builds read the journal's `abby_auth_token` from same-origin browser storage, validate it with Django, and keep the camp's session in memory. They never ask for a password or mint a token. Reloading `/play/` reuses a valid journal session; the journal and world can remain connected together. Storage access failures, missing credentials, and parent accounts leave the world in demo mode. Tokens never enter navigation URLs or cross-window messages.

Journal logout or account switching clears the world's old identity and tasks, aborts active requests, and validates the new session before real actions are enabled. Every request checks for a changed browser credential before sending and before accepting its response, including after browser resume. A rejected token is removed only if it still matches the credential used by that request. A failed validation does not retry automatically: use **Connect your account** to retry after restoring the connection. **Sign out of camp** disconnects only this world, keeping the journal session; choose **Connect** to reconnect. Journal logout continues to revoke the token on Django.

Editor/Windows passwords and tokens stay in memory, and restarting that client requires explicit login. Django still rotates its single per-user token on every successful password login, invalidating previous sessions. Native sign-out continues to clear only local camp credentials.

A lost or ambiguous save response disables further logging until the account is refreshed. If the refresh still cannot confirm the result, check ritual history in the web app, then choose **I checked ritual history** to resume. Record the ritual again only if it is missing from that history. Mutations never retry automatically; the backend does not yet provide idempotency keys.

Habit XP is a configured pool, whose distribution and boosts remain server-owned. The UI displays confirmed strength; exact XP, coins, and drops need their own verified account reads before they appear in the camp. The camp's companion is currently a presentation prototype, independent of the owned-pet catalog. Feeding, hatching, inventory, parent approvals, and playable expeditions are later slices.

## Replace art

Gameplay components and `CampEntityIdentity` live on actor roots. A `VisualPresenter` instantiates only the appearance child from a `VisualDefinition`. Each definition holds its model, local scale/offset/rotation, animation controller, and intent mappings.

The generated dog and fox definitions under `Assets/AbbyCamp/Generated` demonstrate replacing an appearance while preserving identity, position, following behavior, and game progress. Import replacement art into its own directory, create a definition, map Idle/Walk/Celebrate, and assign it. Colliders and movement stay on the root. Different rigs can use different animation controllers.

Original third-party models are under `Assets/ThirdParty/Kenney`. Materials/controllers/definitions created for this project are under `Assets/AbbyCamp/Generated`. Sources and original CC0 licenses are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); exact clips and import guidance are in [AssetNotes.md](AssetNotes.md).

## Build and validate

From the repository root in PowerShell:

```powershell
./scripts/unity/Build-Camp.ps1 -Target Web
./scripts/unity/Publish-Web.ps1 -BuildImage -SaveImage -ImageTag abby-unity-web:preview-1
./scripts/unity/Test-WebHosting.ps1 -ImageTag abby-unity-web:preview-1
node --test scripts/unity/test_browser_session.cjs
```

The build script uses **6000.6.5f1** at Unity Hub's default Windows installation location. A custom installation path can be passed with `-UnityEditor`. Close this project in the editor before a batch build. Web output is in `Builds/Web` with a `Logs/build-web.log` log. Normal builds preserve the saved scene. Pass `-RebuildScene` only to regenerate the starting camp and replace its scene and generated presentation assets. `-ValidateOnly` performs scene/API checks without exporting; `-Target Windows` retains the desktop harness.

The Web output must be served over HTTP/HTTPS, not opened as a local file. [Coolify hosting instructions](../../docs/unity-web-hosting.md) describe the separate image and `/play/` path routing. A Git PR/main merge updates source but does not compile or deploy Unity. Generated builds and image archives remain ignored. The React service-worker update must also be deployed and accepted by any installed PWA, so it stops substituting the React index for `/play/`.

For local browser checks with disposable API data:

```powershell
python scripts/unity/web_fixture_server.py --port 8089
```

Open `http://127.0.0.1:8089/play/`. This loopback preview uses synthetic child `camp-smoke` and password `only-local-smoke`. It never loads `.env` or opens the project's database. Ctrl+C removes its temporary data. Use the HTTPS Coolify URL for testing on a phone.

Unity menu **Abby Camp → Create or rebuild camp** regenerates the scene and generated presentation assets. This replaces changes to the generated camp, so use it deliberately. **Validate all** checks scene structure, imported models/animations, the dog/fox swap, and API contracts. **Build phone Web prototype** and **Build Windows prototype** also run those checks.

The opt-in development smoke is run by:

```powershell
./scripts/unity/Test-Camp.ps1
```

It uses real Django views against disposable SQLite, runs the built player, captures screenshots, verifies movement/following, swaps appearances, exercises the task-board UI, checks demo save restoration, signs in, logs exactly one real fixture habit, and verifies authorization/daily caps. A fixture-only HTTP 503 also checks that uncertain saves stay blocked through refresh until history acknowledgement, which sends no mutation. It preserves the original local demo flag. It never reads `.env` or uses the project's database. Python must have the repository's Django dependencies installed.

`Library`, build output, logs, screenshots, and user settings are ignored; source `.meta` files are retained. The package manifest/lock and project settings are included. Journal/grade reactions are currently implemented in React; connecting those saves to an owned Unity companion is a later slice. Real-phone lifecycle/performance and native iOS deployment need their own validation before Abby uses it day to day.

## Phone Web verification — 2026-10-10

The 6000.6.5f1 Web export passed scene/asset validation and 41 API contract checks. Browser checks covered 320×568 and 393×852 portrait views, 844×393 landscape, and a simulated keyboard-reduced viewport. The walkthrough verified practice persistence, ground movement and camera follow, direct Tasks access away from the board, companion greetings and appearance changes, credential preservation on rotation, sign-in, scrolling, and sign-out.

Against disposable Django data, an injected HTTP 503 blocked further saves through refresh until history acknowledgement. Neither refresh nor acknowledgement posted another log. One later confirmed save increased the fixture habit to one tap and skill XP from 95 to 105; the capped task remained disabled. This validates request handling and visible browser interaction, not physical touch gestures or a real phone keyboard. The packaged nginx image has a separate nine-check hosting verification. Android Chrome hardware testing is next, followed by iPhone Safari when available.

## Shared browser session verification — 2026-10-10

The handoff passed 25 Django auth/family tests, 12 JavaScript bridge tests, and the complete React suite (2,346 tests; coverage gates, lint, and production build passed). Unity 6000.6.5f1 exported the Web build after scene checks and 42 API contract checks.

Browser checks against disposable loopback Django accounts confirmed automatic adoption, journal/world coexistence, local camp sign-out and reconnection, journal logout, stale-token rejection/clearing, parent-session preservation, and restoration after reloading `/play/`. Switching to another family's child while an earlier save response was delayed removed the old account's tasks and toast; the new account could save its own ritual without inheriting the old uncertainty. The fixture recorded exactly two explicitly requested habit saves, with no automatic retries. Its four password logins came only from the fixture's journal controls, including account changes; opening, reconnecting, and reloading the world added none.

This validates the browser/IL2CPP bridge and live Django boundary. Physical iPhone/Android lifecycle testing remains outstanding. The source patch and local Web export do not update the deployed preview; deployment is a separate step.
