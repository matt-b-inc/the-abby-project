# CLAUDE.md

## Project
The Abby Project — Django + React app for tracking kids' projects, chores, and homework: time tracking, weekly timecards, payment ledger (Greenlight), non-monetary Coins economy + reward shop, skill tree (Category → Subject → Skill) with badges, Instructables/PDF project ingestion with an AI enrichment pipeline, 3D print requests with a filament/print-time budget and automatic Bambu MQTT job tracking, and a Habitica-inspired RPG gamification layer (character profiles, streaks, habits, random drops, collectible pets with mount evolution, quests, and cosmetics).

## How this documentation is organized

This root `CLAUDE.md` carries always-relevant context: stack, commands, top-level architecture, auth surfaces, shared plumbing, the multi-family scoping rule, cross-cutting gotchas (single-origin frontend, media storage, LLM backend, Sentry, timezone), env vars + tunable settings, project-wide conventions, key entry points.

Deep subsystem details live next to the code they describe, in subtree CLAUDE.md files that load only when work touches that subtree:

| File | When loaded |
|---|---|
| [`apps/rpg/CLAUDE.md`](apps/rpg/CLAUDE.md) | RPG game loop · sprite generation · drops · streaks · consumables · cosmetics |
| [`apps/pets/CLAUDE.md`](apps/pets/CLAUDE.md) | Pets · mounts · breeding · expeditions · companion growth · bestiary UI |
| [`apps/quests/CLAUDE.md`](apps/quests/CLAUDE.md) | Boss/collection quests · rage shield · daily challenges |
| [`apps/chronicle/CLAUDE.md`](apps/chronicle/CLAUDE.md) | Age-aware chronicle · journal entries · chapter transitions · birthdays |
| [`apps/homework/CLAUDE.md`](apps/homework/CLAUDE.md) | Homework lifecycle · effort scaling · AI planning · anti-farm gate |
| [`apps/creations/CLAUDE.md`](apps/creations/CLAUDE.md) | Creation log · daily cap · bonus track |
| [`apps/wellbeing/CLAUDE.md`](apps/wellbeing/CLAUDE.md) | Daily affirmation + gratitude · soft surface |
| [`apps/rewards/CLAUDE.md`](apps/rewards/CLAUDE.md) | Coins economy · reward shop · wishlist · money→coins exchange |
| [`apps/chores/CLAUDE.md`](apps/chores/CLAUDE.md) | Duties · alternating-week schedules · submit-then-approve workflow |
| [`apps/timecards/CLAUDE.md`](apps/timecards/CLAUDE.md) | Clock-in/out · weekly timecards · auto clock-out · CSV export |
| [`apps/habits/CLAUDE.md`](apps/habits/CLAUDE.md) | Rituals · positive/negative taps · strength decay |
| [`apps/movement/CLAUDE.md`](apps/movement/CLAUDE.md) | Physical activity sessions · intensity scaling · daily reward cap |
| [`apps/printing/CLAUDE.md`](apps/printing/CLAUDE.md) | 3D print requests · Bambu MQTT listener · HMS decoding · filament budget |
| [`apps/mcp_server/CLAUDE.md`](apps/mcp_server/CLAUDE.md) | MCP OAuth 2.1 surface ladder · context helpers |
| [`apps/ingestion/CLAUDE.md`](apps/ingestion/CLAUDE.md) | Scrapy-style ingestion pipeline · AI enrichment |
| [`apps/achievements/CLAUDE.md`](apps/achievements/CLAUDE.md) | Skill tree · 48 badge criterion types · XP entry-point table |
| [`frontend/CLAUDE.md`](frontend/CLAUDE.md) | Design system · Atlas cohort · PWA · journal covers · testing |
| [`frontend/src/pages/CLAUDE.md`](frontend/src/pages/CLAUDE.md) | Page primitives · Quests hub · Atlas hub · Frontispiece · Yearbook |

## Stack
- **Backend:** Django 5.1, DRF 3.15, PostgreSQL 16, Redis 7, Celery 5.4 + Beat, Gunicorn, Python 3.12
- **Frontend:** React 19, Vite 8, Tailwind 4, Framer Motion, React Router 7, lucide-react
- **Deploy:** Single multi-stage Docker image — Node builds the React bundle, Django serves it + the API via WhiteNoise from one origin. Compose services: `db`, `redis`, `django`, `celery_worker`, `celery_beat`, `printer_listener` (single-replica by design — see [`apps/printing/CLAUDE.md`](apps/printing/CLAUDE.md)). Self-hosted runner; CI/CD via `.github/workflows/ci-cd.yml`.
- **Observability:** Self-hosted Sentry at `logs.neato.digital` — error tracking, performance tracing, and release automation with source map upload via `@sentry/vite-plugin`. JSON-structured logging (opt-in via `LOG_JSON=1`).

## Commands
```bash
# Full stack
docker compose up --build
docker compose exec django python manage.py migrate --noinput
docker compose exec django python manage.py seed_data --noinput
docker compose exec django python manage.py createsuperuser

# Frontend (local)
cd frontend && npm run dev       # :3000 with /api proxy to :8000
npm run build
npm run lint
npm run test                     # vitest watcher
npm run test:run                 # one-shot run (CI-style)
npm run test:coverage            # run + coverage report (gated in CI)

# Backend tests
docker compose exec django python manage.py test

# Backend tests without Docker (Windows dev box, no Redis running)
# Uses config/settings_test.py — LocMem cache + eager Celery + in-memory broker.
DATABASE_URL="sqlite:///tmp_test.db" SECRET_KEY="x" \
  DJANGO_SETTINGS_MODULE=config.settings_test \
  python manage.py test apps.achievements apps.rpg apps.quests apps.pets

# One-shot RPG catalog cleanup (run after YAML-authoring restructure removes
# skill categories / badges / quests that the upsert-only loadrpgcontent
# can't touch). See DUPLICATE_BADGES + LEGACY_SKILL_CATEGORIES constants in
# apps/rpg/management/commands/cleanup_rpg_catalog.py.
docker compose exec django python manage.py cleanup_rpg_catalog --dry-run
docker compose exec django python manage.py cleanup_rpg_catalog

# Content loading
docker compose exec django python manage.py loadrpgcontent          # RPG YAML → DB
docker compose exec django python manage.py loadwellbeingcontent    # Wellbeing affirmations YAML
docker compose exec django python manage.py prune_pack_content      # Remove orphaned pack entries

# MCP server (stdio mode for local development/testing)
docker compose exec django python manage.py runmcp

# 3D printer MQTT listener — runs as its OWN compose service (printer_listener).
# It is the only process allowed to connect to a printer; do not scale past 1.
docker compose up -d printer_listener
docker compose logs -f printer_listener
# Capture what the printer actually says (one <serial>.jsonl per printer),
# then replay it through the real ingest path with no network:
docker compose exec django python manage.py run_printer_listener --capture ./captures
docker compose exec django python manage.py run_printer_listener \
  --replay ./captures/00M09A342000000.jsonl --serial 00M09A342000000

# Dev helpers (not for production)
docker compose exec django python manage.py force_drop <username>
docker compose exec django python manage.py force_celebration <username>
docker compose exec django python manage.py set_streak <username> <count>
docker compose exec django python manage.py set_pet_happiness <username> <value>
docker compose exec django python manage.py set_reward_stock <reward_id> <count>
docker compose exec django python manage.py reset_day_counters
docker compose exec django python manage.py tick_perfect_day
docker compose exec django python manage.py expire_journal
```

## Architecture
```
config/              Django project
  settings.py        Single settings module, env-driven
  settings_test.py   LocMem cache + eager Celery for Docker-less local runs
  urls.py            API includes + SPA catch-all (spa_view)
  celery.py          Celery app factory
  health.py          /health endpoint (legacy — now handled by middleware)
  base_models.py     Abstract CreatedAtModel, TimestampedModel,
                     ApprovalWorkflowModel, DailyCounterModel
  permissions.py     IsParent, IsStaffParent DRF permission classes
  services.py        BaseLedgerService, finalize_decision,
                     bump_daily_counter
  viewsets.py        RoleFilteredQuerySetMixin, NestedProjectResourceMixin,
                     ParentWritePermissionMixin, StaffParentWritePermissionMixin,
                     WriteReadSerializerMixin, ApprovalActionMixin,
                     resolve_target_user, get_child_or_404, child_not_found_response
  llm.py             complete_json — shared text-LLM seam
  logging.py         JsonFormatter (LOG_JSON=1) + register_celery_failure_handler
  middleware.py      HealthCheckMiddleware (/health bypass ALLOWED_HOSTS,
                     ?deep=true Ceph probe), NoCacheAPIMiddleware (no-store
                     on /api/*), SentryUserMiddleware (user context for errors)
  url_safety.py      UnsafeURLError + validate_url + safe_get (SSRF guard)
  oauth_views.py     AbbyAuthorizationView, well-known discovery views
  oauth_validator.py AbbyOAuth2Validator (RFC 8707 resource binding)
  tests/factories.py make_family, make_oauth_token

apps/
  accounts/          User (role=parent|child, AUTH_USER_MODEL, family FK),
                     CustomUserManager, UserAdmin, SignupView. Table
                     preserved as projects_user (state-only migration from
                     projects). User.save() auto-attaches to "default-family"
                     when family_id is None — defense in depth for tests.
                     apps.projects.models re-exports User for back-compat.
  families/          Family model (name, slug, timezone, default_theme,
                     primary_parent FK), FamilyService.create_family_with_parent
                     (atomic — Family + parent User + Token in one txn).
                     queries.py: parents_in / children_in helpers used by
                     per-family Celery loops. The scope unit for parent ↔
                     child relationships and per-family content (Reward,
                     ProjectTemplate, Chore). RPG / skills / badges /
                     lorebook stay GLOBAL.
  projects/          Project (payment_kind), Milestone, Step (FK to
                     Milestone), Resource (FK to Step), MaterialItem,
                     ProjectTemplate, ProjectCollaborator, SavingsGoal,
                     Instructables scraper shim, AI suggestions,
                     management/commands/seed_data.py.
                     priority.py: build_next_actions(user) — scored, ranked
                     feed exposed as `next_actions` on /api/dashboard/.
                     User management: ChildViewSet + ParentViewSet share
                     _UserManagementActionsMixin for reset-password /
                     deactivate / reactivate / delete.
  notifications/     Notification model + NotificationType TextChoices,
                     NotificationViewSet, notify() + notify_parents() helpers.
                     Table preserved as projects_notification.
                     Web Push: PushSubscription model, push.py (send_to_user,
                     push_enabled), tasks.py (off-request fan-out),
                     /api/push/{config,subscribe,unsubscribe}/. notify() is
                     the single chokepoint, so push reaches all 40+ types
                     with no per-call-site changes.
  ingestion/         ProjectIngestionJob + Scrapy-style pipeline package.
                     → apps/ingestion/CLAUDE.md
  timecards/         → apps/timecards/CLAUDE.md
  payments/          PaymentLedger (10 entry types), PaymentService (extends
                     BaseLedgerService), Greenlight CSV import,
                     PaymentAdjustmentView.
  achievements/      → apps/achievements/CLAUDE.md
  rewards/           → apps/rewards/CLAUDE.md
  chores/            → apps/chores/CLAUDE.md
  chronicle/         → apps/chronicle/CLAUDE.md
  homework/          → apps/homework/CLAUDE.md
  creations/         → apps/creations/CLAUDE.md
  wellbeing/         → apps/wellbeing/CLAUDE.md
  portfolio/         ProjectPhoto, ZIP export.
  habits/            → apps/habits/CLAUDE.md
  rpg/               → apps/rpg/CLAUDE.md
  pets/              → apps/pets/CLAUDE.md
  quests/            → apps/quests/CLAUDE.md
  mcp_server/        → apps/mcp_server/CLAUDE.md
  movement/          → apps/movement/CLAUDE.md
  printing/          → apps/printing/CLAUDE.md
  activity/          ActivityEvent — append-only audit log of discrete
                     events (clock-in, approvals, XP awards, drops, streaks).
                     Category choices: approval|award|ledger|rpg|quest|habit|
                     timecard|system. JSONField context carries breakdown math.
                     Parent-only ReadOnlyModelViewSet with cursor pagination.
  lorebook/          Lorebook content + parity gate. Kid- and parent-facing
                     explainers authored in content/lorebook/entries.yaml.
                     Parity test in test_parity.py enforces that every trigger
                     type, badge criterion, entry type, and coin reason is
                     covered.
  dev_tools/         Dev-only management commands: force_celebration,
                     force_drop, set_streak, set_pet_happiness,
                     set_reward_stock, reset_day_counters, tick_perfect_day,
                     expire_journal.
  google_integration/GoogleAccount (OneToOne User, Fernet-encrypted OAuth2
                     creds, calendar sync toggle), CalendarEventMapping
                     (maps app objects → Google Calendar events). Daily
                     reminders task at 07:00 via Celery Beat.

frontend/            → frontend/CLAUDE.md (design system / testing / PWA)
  src/pages/         → frontend/src/pages/CLAUDE.md (page architecture)
```

## Auth (important)
- Two auth surfaces, side by side:
  - **`/api/*` (web app)** — DRF **TokenAuthentication**. The SPA's primary auth path.
  - **`/mcp/*` (MCP server)** — OAuth 2.1 **Bearer tokens** issued through the auth-code + PKCE flow at `/oauth/authorize/` → `/oauth/token/`. Only `is_staff=True` parents can complete the consent screen and grant a token. Full surface ladder (discovery URLs, DCR, resource binding, admin revoke, test factory) in [`apps/mcp_server/CLAUDE.md`](apps/mcp_server/CLAUDE.md).
- Login: `POST /api/auth/` with `{action: "login", username, password}` → returns user + `{token}`.
- Logout: `POST /api/auth/` with `{action: "logout"}` revokes the DRF token that authenticated the request. All clients sharing it lose access; an old logout authenticated before a later password login cannot delete that replacement token.
- **Parent self-signup**: `POST /api/auth/signup/` with `{username, password, display_name, family_name}` → creates a new `Family` + founding parent + token, returns `{token, user, family}`. Throttled at `5/hour` per IP via `ScopedRateThrottle scope="signup"`. Disabled when `ALLOW_PARENT_SIGNUP=False` (returns 403). Children can never self-signup — `FamilyService.create_family_with_parent` hard-codes `role="parent"` and any client-supplied `role` is ignored. See [apps/accounts/views.py](apps/accounts/views.py) + [apps/families/services.py](apps/families/services.py). Frontend gates the "Create a family" link on `import.meta.env.VITE_ALLOW_SIGNUP !== 'false'` (default visible). **Staff escape hatch**: `POST /api/admin/families/` ([apps/families/views.py](apps/families/views.py)) lets `is_staff=True` parents create new families from inside `/manage → Admin` even when `ALLOW_PARENT_SIGNUP=False` — same body shape, reuses the same service, no throttle.
- **Co-parent / child management**: parents add, edit, reset-password, deactivate, reactivate, and hard-delete other accounts in their family via `ChildViewSet` and `ParentViewSet`. Both share `_UserManagementActionsMixin` for the three action endpoints; both honor `assert_safe_to_remove` family-integrity guards. Reset rotates the target's `Token` rows (matching the login-rotation invariant); self-target is allowed but does **not** rotate the requester's own token. Deactivate sets `is_active=False` AND drops tokens; reactivate flips the bit. Hard-delete cascades through every `User` FK. Family-integrity guards live in [`apps/families/services.py`](apps/families/services.py): `assert_safe_to_remove` refuses self-removal and refuses to leave the family with zero active parents; `promote_next_primary_parent` auto-rotates `Family.primary_parent` to the next-oldest active parent on departure.
- Frontend stores token in `localStorage` key `abby_auth_token`, sends `Authorization: Token <key>`. See [`frontend/CLAUDE.md`](frontend/CLAUDE.md) for the 401 self-heal and error-shape conventions.
- Unity Web `/play/` reads that same-origin browser token through `Assets/Plugins/WebGL/AbbyBrowserSession.jslib` and validates `/api/auth/me/` before enabling child actions. It never performs password login, so opening the world does not rotate the journal's token. Browser credential changes abort old requests and clear old account presentation; late 401s clear only the matching stored token. Camp sign-out is local, journal logout still revokes the shared token, and editor/native password login retains rotation. See [`unity/AbbyCamp/README.md`](unity/AbbyCamp/README.md).
- Django admin still uses session auth at `/admin/`.
- Parent-only endpoints use `config.permissions.IsParent`; child-scoped querysets use `RoleFilteredQuerySetMixin.get_role_filtered_queryset` (parents see only **their family's** rows, children see rows where `role_filter_field == self`). Global content authoring (`SkillCategory`, `Skill`, `Badge`, `Lorebook`) gates on `config.permissions.IsStaffParent` (parent + `is_staff=True`) so a regular parent can't pollute shared content visible to other families.

## Shared plumbing (`config/`)
- **`config/base_models.py`** — `CreatedAtModel` (auto `created_at`), `TimestampedModel` (adds auto `updated_at`), `ApprovalWorkflowModel` (adds `decided_at` + `decided_by` FK for submit-then-approve flows; subclasses define their own `status` field/choices), and `DailyCounterModel` (per-user per-day anti-farm counter — `(user, occurred_on, count)` row that survives parent-row deletes; concrete subclasses are `CreationDailyCounter`, `MovementDailyCounter`, `HomeworkDailyCounter`). Concrete models across apps inherit from these; abstract bases live in `config/` rather than any single app.
- **`config/services.py`** — `BaseLedgerService` with `ledger_model`, `category_field`, `default_value` class attrs. `PaymentService` and `CoinService` subclass it for `get_balance`/`get_breakdown`; subclasses add their own award/spend helpers. Also exports `finalize_decision(instance, new_status, parent, notes="")` — used by every approval service to stamp `status`/`decided_at`/`decided_by` on pending-decision models — and `bump_daily_counter(counter_model, user, day)` — locked read-modify-write helper for any `DailyCounterModel` subclass; returns the pre-increment count so callers can gate on `prior == 0` for first-of-day.
- **`config/permissions.py`** — `IsParent` (auth + role) and `IsStaffParent` (auth + role + `is_staff`) DRF permission classes. `IsParent.has_object_permission` resolves the object's family via `obj.family_id` / `obj.user.family_id` / `obj.assigned_to.family_id` / `obj.created_by.family_id` and rejects cross-family — defense in depth on top of queryset-level family scoping. `IsStaffParent` gates global content authoring (skills, badges, lorebook) so a regular parent can't pollute shared content. Founding superusers (`createsuperuser`) get `is_staff=True` automatically; signup-created parents do NOT.
- **`config/viewsets.py`** — `RoleFilteredQuerySetMixin` (parents see only their family's rows via `qs.filter(<field>__family=user.family)`; children see their own), `NestedProjectResourceMixin` (for URLs like `projects/<project_pk>/milestones/`), `ParentWritePermissionMixin` (IsParent for CRUD writes, IsAuthenticated for reads — used by 7+ viewsets), `StaffParentWritePermissionMixin` (same shape with IsStaffParent — gates global-content authoring viewsets like Skills, Badges, Sprites, Lorebook), `WriteReadSerializerMixin` (switches `serializer_class` vs. `write_serializer_class` per action), `ApprovalActionMixin` (adds parent-gated `approve`/`reject` detail actions, delegates to a pluggable `approval_service`), `resolve_target_user(request, source)` (resolves `user_id` from query_params or data, family-scoped), plus `get_child_or_404(child_id, requesting_user=None)` + `child_not_found_response` helpers for parent-targeting-child actions. `get_child_or_404` accepts a `requesting_user` and scopes the lookup to that user's family — call sites must pass `requesting_user=request.user` so a parent can't 200 on another family's child by id.
- **`config/tests/factories.py`** — `make_family(name, parents=[...], children=[...])` test helper. Each entry is a dict with at least `username`; other keys flow through to `User.objects.create_user`. Returns a `SimpleNamespace(family, parents=[User], children=[User])`. **Use this in every test setUp** that needs more than one user — it stamps everyone into a single family and the first parent becomes `primary_parent`. Without it, the `User.save()` defense-in-depth lands every user in the same auto-created `default-family`, which masks cross-family scoping bugs. Also exports `make_oauth_token(user, *, application=None, resource=None, scope='mcp', expires_in_seconds=3600)` — mints an `AccessToken` row directly so MCP tests don't have to do the PKCE round-trip.
- **`config/middleware.py`** — `HealthCheckMiddleware` (first in MIDDLEWARE — intercepts `/health` before Django's host validation so Docker/Coolify probes succeed when `ALLOWED_HOSTS` doesn't include `localhost`; `?deep=true` adds a Ceph S3 `HeadBucket` check), `NoCacheAPIMiddleware` (stamps `Cache-Control: no-store` on `/api/*` responses unless the view set its own header), `SentryUserMiddleware` (sets Sentry user context for session-auth'd requests like admin).
- **`config/logging.py`** — `JsonFormatter` (enable with `LOG_JSON=1` — no extra packages) and `register_celery_failure_handler()` for structured Celery task failure logging into the same JSON pipeline.
- **`config/url_safety.py`** — SSRF defense for outbound HTTP from the ingestion pipeline. `validate_url(url)` raises `UnsafeURLError` on private-IP, loopback, or link-local targets. `safe_get(url, **kwargs)` is a drop-in for `requests.get()` with the guard applied.
- **`apps/mcp_server/context.py`** — `get_current_user`, `require_parent`, `require_staff_parent`, `resolve_target_user(user, requested_id)` (child→self + same-family scoping for MCP tools), `get_in_family(model, pk, family)`. Cross-family requests raise `MCPNotFoundError` (NOT permission-denied — never leak existence of a sibling family's user).
- **`apps/families/`** — `Family` model + `FamilyService.create_family_with_parent` for parent self-signup. `Family.parents` / `Family.children` are role-discriminated reverse relations on the `User.family` FK. `apps/families/queries.py::parents_in(family)` + `children_in(family)` are shared helpers used by Celery tasks that need to iterate per-family.

## Cross-cutting gotchas

- **Multi-family scoping**: a deployment hosts many unrelated households. Every `User` belongs to exactly one `Family` via `User.family` FK; per-family content (`Reward`, `ProjectTemplate`, `Chore`) carries its own `family` FK. Global content (skills, badges, lorebook, RPG items, drops, quests) stays family-agnostic. **Never write `User.objects.filter(role="parent")` or `User.objects.filter(role="child")` without a family filter** — it returns rows from every household and is the leakage shape this whole subsystem prevents. Seven chokepoints carry the scoping; touching them propagates to all 26+ historical call sites without per-site editing: (1) `IsParent.has_object_permission` (`config/permissions.py`), (2) `filter_queryset_by_role` (`config/viewsets.py`), (3) `get_child_or_404(..., requesting_user=)` (`config/viewsets.py`), (4) DRF `resolve_target_user` (`config/viewsets.py`), (5) MCP `resolve_target_user` (`apps/mcp_server/context.py`), (6) `notify_parents` (`apps/notifications/services.py`), (7) MCP `get_in_family(model, pk, family)` (`apps/mcp_server/context.py`, added in commit `cbd5182`) — replaces bare `Model.objects.get(pk=...)` calls in MCP tools, raising `MCPNotFoundError` on cross-family probes (existence-leak preventing). The 7 ARE the contract — adding new code just calls them. There is also `require_staff_parent()` (same module, same commit) which gates global-content authoring inside MCP, mirroring the DRF `IsStaffParent` permission. Chronicle services switched from naive UTC dates to `timezone.localdate()` (Phoenix-local) in the same sweep so chapter-year + birthday-event boundaries no longer drift around midnight. **Auto-attach defense in depth**: `User.save()`, `Reward.save()`, and `ProjectTemplate.save()` each fall back to a "Default Family" when `family_id` is None. Production paths (signup, `ChildViewSet.perform_create`, `RewardViewSet.perform_create`, `ProjectTemplateViewSet.perform_create`) always supply an explicit family — auto-attach exists so legacy code paths (tests using `User.objects.create(...)`, fixtures, `loaddata`) don't 500 on the NOT NULL constraint, and so a missing-family bug lands a row in a known place rather than crashing. Tests bypass migrations and rely on this auto-attach to hydrate users without ceremony; production `loadrpgcontent` + `seed_data` create the default family explicitly. **`notify_parents` requires `family=` or `about_user=`** keyword — calling it without one raises `ValueError`. Pass `about_user=<the child the event is about>`; we derive their family. Migration is 3-step (nullable add → backfill default-family → tighten to non-null) so production rollouts are safe; the same pattern is used for `Reward.family`, `ProjectTemplate.family`, and `Chore.family`. Test fixture: `config.tests.factories.make_family(name, parents=[...], children=[...])`. Family-scoping tests live in [`apps/families/tests/`](apps/families/tests/), [`apps/projects/tests/test_child_viewset_family.py`](apps/projects/tests/test_child_viewset_family.py), [`apps/rewards/tests/test_family_scoping.py`](apps/rewards/tests/test_family_scoping.py), [`apps/projects/tests/test_template_family_scoping.py`](apps/projects/tests/test_template_family_scoping.py), and [`apps/mcp_server/tests/test_family_scoping.py`](apps/mcp_server/tests/test_family_scoping.py).

- **Single-origin frontend:** The multi-stage `Dockerfile` builds the React bundle with Node, copies `frontend/dist` into `/app/frontend_dist`, and `collectstatic` pulls it into `STATIC_ROOT` via `STATICFILES_DIRS`. `config/urls.py` ends with a `re_path(r"^(?!static/|\.well-known/|oauth/).*$", spa_view)` catch-all that returns the built `index.html` for any non-API route — React Router handles the rest in the browser. `frontend/vite.config.js` sets `base: '/static/'` for build mode so bundled asset references resolve through WhiteNoise. The API client in `frontend/src/api/client.js` uses relative `/api` URLs. No `VITE_API_URL` env var in production; no separate frontend container. **Three prefixes are excluded** from the catch-all: `static/` so missing assets 404 instead of returning `index.html` as `text/html`; `.well-known/` so MCP-spec OAuth 2.1 discovery probes hit [`WellKnownProtectedResourceView`](config/oauth_views.py) / [`WellKnownAuthorizationServerView`](config/oauth_views.py) and get the right JSON metadata; and `oauth/` so the auth code + token + DCR + login endpoints reach DOT and our wrappers. Without these exclusions the SPA would intercept and return HTML, crashing MCP clients before they ever send an Authorization header. Guard tests live in [`config/tests/test_well_known_urls.py`](config/tests/test_well_known_urls.py). **`frontend/.npmrc` ships `legacy-peer-deps=true`** and is `COPY`'d into the Node build stage of the Dockerfile alongside `package.json` / `package-lock.json` — without it the multi-stage build fails on React 19 peer ranges that some transitive deps haven't caught up to.

- **One MQTT connection per printer, ever** (`apps/printing/`): the Bambu X1's embedded broker accepts roughly **four** simultaneous clients, and Bambu Studio, the Handy app, and Home Assistant each hold one. Connecting from a gunicorn worker or a Celery task would blow the ceiling, and the failure mode is silent — the broker drops the newest (or an existing) client, so our listener and Home Assistant end up kicking each other off in a loop. The connection therefore lives in exactly one place: the `printer_listener` compose service running `manage.py run_printer_listener`. Nothing under `config/`, `apps/*/views.py` or `apps/*/tasks.py` may import `apps.printing.transports`. A Redis advisory lock (`apps/printing/listener.py::PrinterLock`) is the runtime backstop if that service is ever accidentally scaled past one replica. Everything else — the SPA's live view, Home Assistant, anything future — reads state through `apps/printing/fanout.py`: a cache snapshot behind `GET /api/printers/<id>/status/`, a Redis pub/sub channel, and an optional MQTT republish to `PRINT_FANOUT_MQTT_URL`. The same module documents why **reports are deltas** (a `msg: 1` payload carries only changed keys, so the merge rule is keep-previous-on-absent) and why **grams of filament are not in the report at all** (the budget debits the parent's slicer estimate on `PrintRequest.estimated_grams`; minutes are observed).

- **CSRF/proxy:** `SECURE_PROXY_SSL_HEADER`, `USE_X_FORWARDED_HOST=True`, and `CSRF_TRUSTED_ORIGINS` needed behind Traefik/Caddy.

- **Media storage** (`config/settings.py`): every `FileField`/`ImageField` in the codebase routes through Django's `STORAGES["default"]`. Two backends are wired in: local `FileSystemStorage` at `MEDIA_ROOT` (default — used in dev), and `storages.backends.s3.S3Storage` pointed at **Ceph RGW** on `s3.neato.digital` (production — toggle with `USE_S3_STORAGE=true`). Ceph RGW exposes an S3-compatible API, so boto3 / django-storages talks to it exactly like AWS S3. When S3 is on, `config/urls.py` skips the `/media/` static-serve route entirely and serializers emit **presigned** URLs (`AWS_QUERYSTRING_AUTH=True`, default TTL `AWS_QUERYSTRING_EXPIRE=3600` seconds). The browser fetches directly from Ceph — Django never proxies the bytes. **CORS on Ceph RGW is configured per bucket** via `PutBucketCors` (like AWS S3, unlike MinIO's server-wide config); set the `AllowedOrigins` list on each bucket that serves media to the app's origin. Don't cache image URLs in the frontend beyond the page session; they expire. Deletes: `FieldFile.delete(save=False)` in each `destroy`/replace path sends a boto3 `DeleteObject` to Ceph — same call as AWS S3; if the bucket has object versioning on, this creates a delete marker rather than hard-removing bytes (see the "Storage deletes" gotcha). Tests are pinned to `FileSystemStorage` in the `if "test" in sys.argv` block at the bottom of `settings.py` so `SimpleUploadedFile`-based tests never reach for Ceph. If a test needs to assert on URL shape, use `override_settings` to swap the backend explicitly.

- **Storage deletes** (blob + DB together): every endpoint that removes an image — `ProjectPhotoViewSet.destroy`, `HomeworkProofViewSet.destroy`, `MeView.patch` avatar replace/clear — calls `instance.image.delete(save=False)` *before* `instance.delete()`/`save()`. Order is deliberate: if the Ceph `DeleteObject` fails (network, permissions), the view errors out and the DB row stays — no orphan rows pointing at live blobs. The reverse (blob gone, row left) is only possible if the DB connection drops between the two calls, which is vanishingly rare. **Orphaned blobs on CASCADE**: Django's `on_delete=CASCADE` is a SQL operation that removes rows without touching storage, so deleting a parent `Project` orphans its `ProjectPhoto.image` blobs, and deleting a `HomeworkSubmission` orphans its `HomeworkProof.image` blobs. The leak is small (both parent deletes are rare child-facing actions) but real — see `docs/` for the cleanup plan when it becomes worth fixing.

- **Sentry release automation:** `@sentry/vite-plugin` in `frontend/vite.config.js` uploads source maps to `logs.neato.digital` during the Dockerfile's frontend-build stage, then deletes `.map` files so they're never served. Conditional on `SENTRY_AUTH_TOKEN` — local builds skip it. CI passes the token + org + project as Docker build args (stage 1 only, not in final image). After deploy, CI `curl`s the Sentry API to associate commits and create a deployment record. Both backend (`SENTRY_RELEASE` in `.env`) and frontend (`VITE_SENTRY_RELEASE` build arg) share the same 8-char git SHA release tag.

- **LLM backend** (`config/llm.py`): single text-LLM seam shared by ingestion enrichment, project suggestions (`apps/projects/suggestions.py`), and homework AI planning (`apps/homework/services.py::HomeworkService.plan_assignment`). All three call sites import `complete_json(prompt=..., max_tokens=...)` and catch `LLMUnavailable` (no backend configured → fall back to non-AI path) or `LLMError` (transport/parse failure). The active backend is picked by `LLM_BACKEND`: `auto` (default — prefer Anthropic when `ANTHROPIC_API_KEY` is set, then Ollama when `OLLAMA_BASE_URL` is set), `anthropic`, `ollama`, or `none`. The Ollama backend posts to `{OLLAMA_BASE_URL}/api/generate` with `format: "json"` (constrains the sampler to syntactically-valid JSON) and `options.num_predict = max_tokens`. The shared parser strips ` ```json ` fences and last-resort-extracts the first `{...}` / `[...]` block from mixed text — both backends benefit, since smaller local models occasionally pad with prose. Quality tradeoff: a 7B-14B local Ollama model on a home LAN is fine for the single-shot JSON tasks here (enrichment, suggestions, homework planning), but won't match Haiku at depth — pick `LLM_BACKEND=anthropic` if you have a key and want maximum quality. **Adding a new LLM call site:** import `complete_json` from `config.llm`, never the `anthropic` SDK directly. Tests in [`config/tests/test_llm.py`](config/tests/test_llm.py) cover backend resolution + transport happy paths + parse fallbacks.

- **Clock-in rules:** quiet hours 10pm–7am; max 8h single entry; auto clock-out via Celery every 30 min; >4h flagged for review. DB constraint: one active `TimeEntry` per user (partial unique index on `status="active"`). Entries support a `voided` status — parents can void a completed entry via `POST /api/time-entries/{id}/void/`.

- **Weekly timecards** auto-generated Sunday 23:55 local via Celery Beat; weekly email summaries fire Sunday 08:00. Uses `project.hourly_rate_override` or `user.hourly_rate`. `TimecardService.approve_timecard(timecard, parent, notes)` is the single entry point for the approved-state transition. `Timecard` predates `ApprovalWorkflowModel` and still uses `approved_by`/`approved_at` field names, so the service inlines the audit stamp rather than using `finalize_decision`.

- **Project payment kinds:** `Project.payment_kind` is `required` (counts toward allowance) or `bounty` (up-for-grabs cash reward). On completion, the signal posts either `project_bonus` or `bounty_payout` to `PaymentLedger`.

- **Payments page** (`/payments`): `PaymentLedgerViewSet` honors `entry_type` (CSV multi-select), `start_date`, `end_date`, and parent-only `user_id` query params for filtered ledger views. Parents also get a `@action(export)` that streams the filtered ledger as CSV via `StreamingHttpResponse` (children get 403 — they shouldn't pull bulk financial data).

- **Steps vs. Milestones:** `ProjectMilestone` are the *chapters* of a project — parent-authored, optional `bonus_amount` that hits `PaymentLedger.milestone_bonus` via `apps/projects/signals.py:85-125` on completion, optional `MilestoneSkillTag` XP. `ProjectStep` are the *tasks inside a chapter* — instructional walkthrough rows that never award XP, coins, or money. `ProjectStep.milestone` is a nullable FK (`SET_NULL`) so a step can either be grouped under a milestone or "loose". Deleting a milestone un-groups its steps rather than cascading. The frontend's unified **Plan** tab renders milestones as accordions with their nested steps + a per-phase progress bar; projects with zero milestones fall back to a flat step list. **Milestone completion is not auto-triggered** when the last step is checked — parents control bonus payouts manually because the milestone-complete signal posts to PaymentLedger. Templates mirror the same shape and both clone directions preserve the step→milestone linkage by rebuilding `ms_id_map` on each side.

- **Coins economy** (`apps/rewards/`): non-monetary progression currency parallel to `PaymentLedger`. `CoinLedger` is append-only with reasons `hourly|project_bonus|bounty_bonus|milestone_bonus|badge_bonus|redemption|refund|adjustment|chore_reward|exchange|daily_challenge|expedition`. Earn hooks: clock-out awards `settings.COINS_PER_HOUR × hours` (default 5), project completion awards flat×difficulty (bounty pays 2.5×), badge earn awards `settings.COINS_PER_BADGE_RARITY[rarity]`. Spend happens through `RewardService.request_redemption`, which deducts coins immediately into a "held" debit tied to the `RewardRedemption` row. **Lucky Coin boost** (`coin_boost`) doubles every entry whose reason appears in `_BOOSTABLE_COIN_REASONS` in [`apps/rpg/services.py`](apps/rpg/services.py) — currently `hourly / project_bonus / bounty_bonus / milestone_bonus / badge_bonus / chore_reward / daily_challenge / expedition`. The other reasons stay unboosted on purpose: `adjustment` (mixed-sign), `refund` (restores cost rather than earnings), `redemption` (a spend), and `exchange` (has its own 1:1 rate). When adding a new earn-kind reason, decide deliberately and add a regression test in [`apps/rpg/tests/test_boost_multipliers.py`](apps/rpg/tests/test_boost_multipliers.py) — the historic-bug shape is "wired the ledger entry, forgot the whitelist, XP doubled but coins didn't".

- **Money→Coins exchange** (`apps/rewards/`): Children can exchange earned money for coins at a configurable rate (`settings.COINS_PER_DOLLAR`, default 10). `ExchangeRequest` tracks the lifecycle (pending → approved/denied). `ExchangeService.request_exchange` validates balance, snapshots the rate, and notifies parents. On approval, `ExchangeService.approve` atomically debits `PaymentLedger` (`coin_exchange`, negative) and credits `CoinLedger` (`exchange`, positive). Money is **not held** at request time — balance is re-verified at approval.

- **Reward shop** (`apps/rewards/`): Parent-approved redemption flow mirroring timecard approval. Child requests a `Reward` → `RewardRedemption` status `pending` + coins held → parent approves (`fulfilled`) or denies (refund via `CoinLedger.Reason.REFUND`, stock restored). Rewards have rarity tiers and optional stock. **Wishlist** (2026-05): `RewardWishlist(user, reward)` model + bookmark toggle on `RewardCard`. When a parent edits a reward and stock crosses `0 → ≥1`, `RewardService` fans out a `REWARD_RESTOCKED` notification to every wishlist user **once** and clears their wishlist rows in the same transaction. **Out-of-stock fallback** (2026-05): `redeem` returns **`409 Conflict` with `{detail, similar: [...]}`** — peers chosen by same rarity, falling back to a nearby `cost` band. **Low-stock signal**: `RewardService.request_redemption` fires a `LOW_REWARD_STOCK` notification to parents the first time a redemption causes `Reward.stock` to enter 0 or 1.

- **Chores** (`apps/chores/`): recurring household tasks with a submit-then-approve workflow. `Chore` defines the task (title, icon, `reward_amount`, `coin_reward`, recurrence `daily|weekly|one_time`). **Shared-custody support:** `Chore.week_schedule` is `every_week` (default) or `alternating`; when alternating, `schedule_start_date` sets the reference "on" week and `ChoreService.is_active_this_week()` compares ISO week parity. Availability is computed on-the-fly — no pre-generated instances, no Celery. On approval, `ChoreService.approve_completion()` posts `PaymentLedger.EntryType.CHORE_REWARD` and `CoinLedger.Reason.CHORE_REWARD`. **Withdraw** (2026-05): owner-only `POST /api/chore-completions/<id>/withdraw/` hard-deletes a pending row. **Reject sheet** (2026-05): the parent-side reject path opens a `BottomSheet` with an optional note; the note is woven into the rejection-notification body. Frontend page: `/chores` (redirects to `/quests?tab=duties`); user-facing label is "Duties".

- **Habits** (`apps/habits/` + `apps/rpg/`): micro-behaviors distinct from chores — no parent approval, no dollar rewards, **no coin rewards**. User-facing label is "Rituals"; frontend page `/habits` redirects to `/quests?tab=rituals`. `Habit.habit_type` is `positive`/`negative`/`both`. `Habit.max_taps_per_day` (default `1`) caps positive taps per `America/Phoenix` day. Negative taps stay uncapped. The `decay_habit_strength_task` (Celery, 00:05 local) decays untapped habits toward 0 by `max(1, max_taps_per_day // 2)`. Positive taps trigger `GameLoopService.on_task_completed(user, "habit_log", ...)`. **Optimistic taps** (2026-05): the frontend mutates `strength` + `taps_today` immediately on click and rolls back if `logHabitTap` rejects.

- **Notifications:** `apps.notifications.Notification` (table preserved as `projects_notification` for back-compat) with `NotificationType` choices including `redemption_requested`, `chore_submitted`, `chore_approved`, `chore_rejected`, `exchange_requested`, `exchange_approved`, `exchange_denied`, `homework_submitted`, `homework_approved`, `homework_rejected`, `streak_milestone`, `streak_at_risk`, `perfect_day`, `daily_check_in`, `savings_goal_completed`, `birthday`, `chronicle_first_ever`, `comeback_suggested`, `creation_submitted`, `creation_approved`, `creation_rejected`, `chore_proposed`, `habit_proposed`, `chore_proposal_approved`, `habit_proposal_approved`, `chore_proposal_rejected`, `habit_proposal_rejected`, `quest_completed`, `drop_received`, `pet_evolved`, `mount_bred`, `low_reward_stock`, `reward_restocked`, `expedition_returned`, `print_request_submitted`, `print_request_approved`, `print_request_rejected`, `print_started`, `print_finished`, `print_failed`, `print_budget_low`. Routes under `/api/notifications/` with `unread_count`, `mark_all_read`, per-item `mark_read`, and `pending-celebration` (returns the most recent unread `STREAK_MILESTONE` or `PERFECT_DAY` row). See [`frontend/src/pages/CLAUDE.md`](frontend/src/pages/CLAUDE.md) for the parity gate that fails CI when a new backend `NotificationType` lands without a corresponding entry in `notifications.constants.js`.

- **Email:** console backend in dev; `DEFAULT_FROM_EMAIL=noreply@summerforge.local`.

- **Timezone:** `America/Phoenix`.

## Env vars (see `.env.example`)
`SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `DATABASE_URL`, `REDIS_URL`, `CELERY_BROKER_URL`, `CORS_ALLOWED_ORIGINS` (dev-server only), `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `PARENT_PASSWORD`, `CHILD_PASSWORD` (seed), `ALLOW_PARENT_SIGNUP` (default `True` — set to `False` to disable parent self-signup at deploy time; the `POST /api/auth/signup/` endpoint returns 403 and the frontend "Create a family" link is hidden when `VITE_ALLOW_SIGNUP=false`), `DEFAULT_FAMILY_NAME` (optional, default `"Default Family"`), `LLM_BACKEND` (optional, default `auto`), `ANTHROPIC_API_KEY` (optional — enables hosted Claude for ingestion enrichment + project suggestions + homework AI planning), `CLAUDE_MODEL` (optional, default `claude-haiku-4-5-20251001`), `OLLAMA_BASE_URL` (optional — enables a local Ollama server as the LLM backend), `OLLAMA_MODEL` (optional, default `gemma4:latest`), `OLLAMA_TIMEOUT` (optional, default `120` seconds), `GEMINI_API_KEY` (optional — enables the `generate_sprite_sheet` MCP tool), `GEMINI_IMAGE_MODEL` (optional, default `gemini-3-pro-image-preview`). `LOG_JSON` (optional, `1` to enable structured JSON log output). `VITE_SENTRY_RELEASE` (auto-set by CI to 8-char git SHA). CI-only secrets (GitHub repo settings, not `.env`): `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `DISCORD_WEBHOOK_URL` (deploy notifications). `PRINT_BAMBU_CA_CERT` (optional — path to Bambu's CA PEM; when set the LAN MQTT transport verifies the printer's cert chain. Hostname verification is off either way, because the printer's cert CN is its serial, not the IP). `PRINT_BAMBU_CLOUD_HOST` (default `us.mqtt.bambulab.com`), `PRINT_BAMBU_CLOUD_PORT` (default `8883`) — only read by printers set to the `cloud` transport. `PRINT_FANOUT_MQTT_URL` (optional — a relay broker our listener republishes printer snapshots to, so Home Assistant can subscribe to us instead of opening a second connection to the printer). `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (optional — Web Push. Generate with `python manage.py generate_vapid_keys`; with either key blank push is inert and the app behaves exactly as it did before push existed). `SPRITE_S3_BUCKET` (default `abby-sprites`), `SPRITE_S3_ENDPOINT`, `SPRITE_S3_CUSTOM_DOMAIN` — only read when `USE_S3_STORAGE=true`; locally sprites serve from `MEDIA_ROOT/rpg-sprites/`. `MCP_PUBLIC_BASE_URL` (e.g. `https://abby.bos.lol/mcp` — production MUST set this; drives both the OAuth issuer/endpoint URLs in the RFC 9728 / RFC 8414 discovery JSON AND the RFC 8707 resource indicator that tokens are bound to. Without it the discovery JSON advertises `http://localhost:8000` endpoints that MCP clients can't reach).

### Tunable settings (`config/settings.py`)
- `COINS_PER_HOUR` (default `5`) — coins awarded per clock-out hour.
- `COINS_PER_BADGE_RARITY` — per-rarity coin bonus map (common 5 → legendary 150).
- `COINS_PER_DOLLAR` (default `10`) — coins received per $1.00 in money→coins exchange.
- `DATA_UPLOAD_MAX_MEMORY_SIZE` / `FILE_UPLOAD_MAX_MEMORY_SIZE` — 25 MB each, sized for PDF ingestion and photo uploads.
- `HOMEWORK_LATE_CUTOFF_DAYS` (default `3`) — see `apps/homework/CLAUDE.md`.
- `HOMEWORK_SELF_PLAN_LEAD_DAYS` (default `3`) — see `apps/homework/CLAUDE.md`.
- `ALLOW_PARENT_SIGNUP` (default `True`) — toggles parent self-signup at deploy time.
- `SPRITE_GENERATION_MAX_FRAMES` (default `8`) — hard cap on `frame_count` for `generate_sprite_sheet`. Each frame is one Gemini call (~$0.04 per frame at current pricing).
- `BIRTHDAY_COINS_PER_YEAR` (default `100`) — see `apps/chronicle/CLAUDE.md`.
- `CELERY_BEAT_SCHEDULE`: `auto-clock-out` every 30 min; `weekly-timecards` Sun 23:55; `weekly-email-summaries` Sun 08:00; `daily-reminders` 07:00; `rpg-perfect-day` 23:55; `rpg-streak-at-risk` 19:00; `habit-decay` 00:05; `quest-expire` 00:10; `quest-boss-rage` 00:15; `chronicle-birthday-check` 00:20; `chronicle-chapter-transition` 00:25; `daily-challenge-rotation` 00:30; `print-reconcile-stale-jobs` 00:35.

Per-subsystem game-design constants (drop rates, growth caps, rage shield steps) live in the subtree CLAUDE.md files for the apps that own them.

## Conventions
- Inherit concrete models from `config.base_models.{CreatedAtModel,TimestampedModel}` instead of hand-rolling `created_at`/`updated_at`. Submit-then-approve models (ChoreCompletion, HomeworkSubmission, RewardRedemption, ExchangeRequest) inherit from `ApprovalWorkflowModel` for `decided_at`/`decided_by`.
- Subclass `config.services.BaseLedgerService` for any new append-only ledger. Use `config.services.finalize_decision` for approve/reject state transitions rather than hand-stamping `status`/`decided_at`/`decided_by`.
- For new parent-only endpoints: use `IsParent` from `config.permissions`. For global-content-authoring endpoints (skills, badges, lorebook, RPG catalog), use `IsStaffParent`. For parent-targets-child actions, accept `user_id` in the body and use `get_child_or_404(user_id, requesting_user=request.user)` + `child_not_found_response` — passing `requesting_user` is **load-bearing** for cross-family safety.
- For viewsets where parents can CRUD but children can only read: use `ParentWritePermissionMixin` (or `StaffParentWritePermissionMixin` for global-content). For viewsets with separate write/read serializers: use `WriteReadSerializerMixin` (set `write_serializer_class`). For submit-then-approve viewsets: use `ApprovalActionMixin` (set `approval_service`).
- For querysets that should be self-scoped for children but full for the caller's family: use `RoleFilteredQuerySetMixin` and override `get_queryset` to call `get_role_filtered_queryset(super().get_queryset())`. Never write `User.objects.filter(role="parent"|"child")` without a family filter.
- For new per-family content models (rare; current set is `Reward`, `ProjectTemplate`, `Chore`): add `family = ForeignKey("families.Family", on_delete=CASCADE)` and override `get_queryset` + `perform_create` to scope and stamp from `request.user.family`. Mirror the 3-step migration pattern (nullable add → backfill into "default-family" → tighten to non-null) and add a `Model.save()` defense-in-depth auto-attach. Skip global content (skills/badges/lorebook/RPG catalog) — those stay family-agnostic by design.
- When fanning out a notification to parents: import `notify_parents` from `apps.notifications.services` and pass `about_user=<the child the event happened to>` (preferred) or `family=<Family>` — calling without one raises `ValueError`. Never iterate `User.objects.filter(role="parent")` yourself.
- Settings values that belong in Django settings (e.g. `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `LLM_BACKEND`, `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`, `COINS_PER_HOUR`) should be read via `from django.conf import settings`, not `os.environ`.
- For text LLM features, import `complete_json` from `config.llm` rather than the `anthropic` SDK directly. Catch `LLMUnavailable` to fall back when no backend is configured and `LLMError` for transport/parse failures.
- **Lorebook lock-step**: when adding a new `TriggerType` (`apps/rpg/constants.py`), `Badge.CriteriaType` (`apps/achievements/models.py`), `PaymentLedger.EntryType` (`apps/payments/models.py`), `CoinLedger.Reason` (`apps/rewards/models.py`), or a new tunable Django setting referenced by an explainer, update [`content/lorebook/entries.yaml`](content/lorebook/entries.yaml) so the kid- and parent-facing Lorebook still describes how the system works. The parity test in [`apps/lorebook/tests/test_parity.py`](apps/lorebook/tests/test_parity.py) fails CI otherwise — its error message tells you which `LOREBOOK_*_COVERAGE` map to extend.
- Frontend conventions live in [`frontend/CLAUDE.md`](frontend/CLAUDE.md) (form/button/card/type scale + interaction-test rule).

## CI/CD pipeline (`.github/workflows/ci-cd.yml`)
Pipeline runs on `push` to `main` (self-hosted runner):
1. **`frontend-test`** — `npm ci` → `npm run lint` → `npm run test:coverage`
2. **`backend-test`** — Postgres 16 + Redis 7 services, `pip install -r requirements.txt`, `migrate`, `python manage.py test`
3. **`build`** (needs 1+2) — multi-stage Docker build → GHCR push (tag = 8-char SHA). Injects Sentry DSN/token/org/project as build args for source-map upload during Node stage.
4. **`scan`** (needs 3) — Trivy image scan (CRITICAL + HIGH severity, `--exit-code 1`).
5. **`deploy`** (needs 3+4) — SSH to target host, pull image, run migrations + `loadrpgcontent` + `cleanup_rpg_catalog`, rolling-restart `django` → `celery_worker` → `celery_beat`, health-check loop (30 attempts × 5s). On failure: tails logs, rolls back to previous image, posts to Discord. On success: prunes old images, creates Sentry release + deploy record, posts success to Discord.

## Key entry points
- `manage.py`, `config/wsgi.py`, `config/urls.py`, `config/celery.py`, `config/settings.py`, `config/settings_test.py`.
- `frontend/src/main.jsx`, `frontend/src/App.jsx`, `frontend/vite.config.js`, `frontend/vitest.config.js`, `frontend/src/test/{setup,server,handlers,render,factories}` (test scaffolding).
- Seed: `apps/projects/management/commands/seed_data.py`; RPG catalog comes from `content/rpg/initial/*.yaml` via `apps/rpg/management/commands/loadrpgcontent.py` + `apps/rpg/content/loader.py`; wellbeing content from `content/wellbeing/affirmations.yaml` via `apps/wellbeing/management/commands/loadwellbeingcontent.py`; catalog cleanup via `apps/rpg/management/commands/cleanup_rpg_catalog.py`. **Run cleanup after every YAML retirement** because the upsert loader cannot delete.
- Ingestion: `apps/ingestion/pipeline/pipeline.py`, `runner.py`, `apps/ingestion/tasks.py` → see [`apps/ingestion/CLAUDE.md`](apps/ingestion/CLAUDE.md).
- Signals: `apps/projects/signals.py` (project completion → ledger + coin hooks + RPG game loop).
- RPG orchestrator: `apps/rpg/services.py` — `GameLoopService.on_task_completed` is the single entry point. Extend by adding a new step to this method. See [`apps/rpg/CLAUDE.md`](apps/rpg/CLAUDE.md).
- RPG character auto-creation: `apps/rpg/signals.py` — `post_save` on `accounts.User` creates `CharacterProfile`.
- 3D printing: `apps/printing/matching.py` (the deterministic request↔job contract), `apps/printing/jobs.py::PrinterJobTracker.handle` (one merged MQTT report in, timeline rows out), `apps/printing/listener.py` + `management/commands/run_printer_listener.py` (the single connection), `apps/printing/fanout.py` (how everything else reads printer state) → see [`apps/printing/CLAUDE.md`](apps/printing/CLAUDE.md).
- MCP server: `apps/mcp_server/` — 207 tools across 27 modules; entry via `runmcp` management command or OAuth-secured HTTP at `/mcp/*`. See [`apps/mcp_server/CLAUDE.md`](apps/mcp_server/CLAUDE.md).
- Design spec: `docs/superpowers/specs/2026-04-13-rpg-gamification-layer-design.md`; phase plans under `docs/superpowers/plans/`.
