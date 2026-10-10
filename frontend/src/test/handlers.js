import { http, HttpResponse } from 'msw';

// Permissive defaults: every /api endpoint returns an empty-but-valid shape
// so a test that mounts a page without caring about its network state still
// renders past the loading spinner. Per-test `server.use(...)` overrides the
// specific routes that matter for each case.

const empty = () => HttpResponse.json([]);
const ok = () => HttpResponse.json({ ok: true });
const nullBody = () => new HttpResponse(null, { status: 204 });

// Order matters inside MSW — more specific paths first.
export const handlers = [
  // Auth
  http.post('*/api/auth/', ok),
  http.post('*/api/auth/signup/', () =>
    HttpResponse.json({
      token: 'test-token',
      user: {
        id: 1, username: 'mike', role: 'parent',
        family: { id: 1, name: 'Test Family' },
      },
      family: { id: 1, name: 'Test Family' },
    }, { status: 201 }),
  ),
  http.get('*/api/auth/me/', () =>
    HttpResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 }),
  ),
  http.patch('*/api/auth/me/', ok),
  http.get('*/api/auth/google/', () => HttpResponse.json({ authorization_url: '' })),
  http.get('*/api/auth/google/login/', () => HttpResponse.json({ authorization_url: '' })),
  http.get('*/api/auth/google/account/', () => HttpResponse.json({ linked: false })),
  http.delete('*/api/auth/google/account/', nullBody),
  http.get('*/api/auth/google/calendar/', () => HttpResponse.json({ sync_enabled: false })),
  http.patch('*/api/auth/google/calendar/', ok),
  http.post('*/api/auth/google/calendar/sync/', ok),

  // Dashboard / Balance
  http.get('*/api/dashboard/', () =>
    HttpResponse.json({ next_actions: [], newly_unlocked_lorebook: [] }),
  ),
  http.get('*/api/balance/', () => HttpResponse.json({ balance: 0, breakdown: {} })),
  http.get('*/api/lorebook/', () =>
    HttpResponse.json({ entries: [], counts: { unlocked: 0, total: 0 } }),
  ),

  // Projects
  http.get('*/api/projects/', empty),
  http.post('*/api/projects/', ok),
  http.get('*/api/projects/suggestions/', empty),
  http.get(/\/api\/projects\/\d+\/$/, () => HttpResponse.json({ id: 1 })),
  http.patch(/\/api\/projects\/\d+\/$/, ok),
  http.post(/\/api\/projects\/\d+\/(activate|submit|approve|request-changes)\/$/, ok),

  // Ingest
  http.post('*/api/projects/ingest/', ok),
  http.get(/\/api\/projects\/ingest\/[^/]+\/$/, () =>
    HttpResponse.json({ status: 'pending', result_json: {} }),
  ),
  http.patch(/\/api\/projects\/ingest\/[^/]+\/$/, ok),
  http.post(/\/api\/projects\/ingest\/[^/]+\/commit\/$/, ok),
  http.delete(/\/api\/projects\/ingest\/[^/]+\/$/, nullBody),

  // Milestones, Steps, Resources, Materials (project-scoped)
  http.get(/\/api\/projects\/\d+\/(milestones|steps|resources|materials|collaborators)\//, empty),
  http.post(/\/api\/projects\/\d+\/(milestones|steps|resources|materials|collaborators)\//, ok),
  http.patch(/\/api\/projects\/\d+\/(milestones|steps|resources|materials)\/\d+\/$/, ok),
  http.delete(/\/api\/projects\/\d+\/(milestones|steps|resources|materials)\/\d+\/$/, nullBody),
  http.post(/\/api\/projects\/\d+\/milestones\/\d+\/complete\/$/, ok),
  http.post(/\/api\/projects\/\d+\/steps\/\d+\/(complete|uncomplete)\/$/, ok),
  http.post(/\/api\/projects\/\d+\/steps\/reorder\/$/, ok),
  http.post(/\/api\/projects\/\d+\/materials\/\d+\/mark-purchased\/$/, ok),
  http.get(/\/api\/projects\/\d+\/qr\/$/, () => new HttpResponse('png-bytes')),

  // Clock / Time Entries / Timecards
  http.get('*/api/clock/', () => HttpResponse.json({ active: null })),
  http.post('*/api/clock/', ok),
  http.get('*/api/time-entries/', empty),
  http.post(/\/api\/time-entries\/\d+\/void\/$/, ok),
  http.get('*/api/timecards/', empty),
  http.get(/\/api\/timecards\/\d+\/$/, () => HttpResponse.json({ id: 1, entries: [] })),
  http.post(/\/api\/timecards\/\d+\/(approve|dispute|mark-paid)\/$/, ok),

  // Payments
  http.get('*/api/payments/summary-by-day/', () => HttpResponse.json({ days: 30, series: [] })),
  http.get('*/api/payments/', empty),
  http.post('*/api/payments/payout/', ok),
  http.post('*/api/payments/adjust/', ok),

  // Achievements
  http.get('*/api/badges/', empty),
  http.post('*/api/badges/', ok),
  http.patch(/\/api\/badges\/\d+\/$/, ok),
  http.delete(/\/api\/badges\/\d+\/$/, nullBody),
  http.get('*/api/badges/earned/', empty),
  http.get('*/api/subjects/', empty),
  http.post('*/api/subjects/', ok),
  http.patch(/\/api\/subjects\/\d+\/$/, ok),
  http.delete(/\/api\/subjects\/\d+\/$/, nullBody),
  http.get('*/api/skills/', empty),
  http.post('*/api/skills/', ok),

  // Creations
  http.get('*/api/movement-types/', empty),
  http.get('*/api/movement-sessions/', empty),
  http.post('*/api/movement-sessions/', ok),
  http.delete(/\/api\/movement-sessions\/\d+\/$/, nullBody),

  http.get('*/api/creations/', empty),
  http.get('*/api/creations/today_status/', () =>
    HttpResponse.json({ count: 0, limit: 2, remaining_with_xp: 2 }),
  ),
  http.post('*/api/creations/', ok),
  http.delete(/\/api\/creations\/\d+\/$/, nullBody),
  http.post(/\/api\/creations\/\d+\/submit\/$/, ok),
  http.post(/\/api\/creations\/\d+\/approve\/$/, ok),
  http.post(/\/api\/creations\/\d+\/reject\/$/, ok),
  http.get('*/api/creations/pending/', empty),
  http.patch(/\/api\/skills\/\d+\/$/, ok),
  http.delete(/\/api\/skills\/\d+\/$/, nullBody),
  http.get(/\/api\/skills\/tree\/\d+\/$/, () =>
    HttpResponse.json({ subjects: [], skills: [] }),
  ),
  http.get('*/api/skill-progress/', empty),
  http.get('*/api/achievements/summary/', () => HttpResponse.json({ badges_earned: 0 })),

  // Rewards / Coins
  http.get('*/api/rewards/', empty),
  http.post('*/api/rewards/', ok),
  http.patch(/\/api\/rewards\/\d+\/$/, ok),
  http.delete(/\/api\/rewards\/\d+\/$/, nullBody),
  http.post(/\/api\/rewards\/\d+\/redeem\/$/, ok),
  http.get('*/api/redemptions/', empty),
  http.post(/\/api\/redemptions\/\d+\/(approve|reject)\/$/, ok),
  http.get('*/api/coins/', () => HttpResponse.json({ balance: 0, recent: [] })),
  http.post('*/api/coins/adjust/', ok),
  http.get('*/api/coins/summary-by-day/', () => HttpResponse.json({ days: 30, series: [] })),
  http.get('*/api/coins/exchange/rate/', () =>
    HttpResponse.json({ coins_per_dollar: 10 }),
  ),
  http.post('*/api/coins/exchange/', ok),
  http.get('*/api/coins/exchange/list/', empty),
  http.post(/\/api\/coins\/exchange\/\d+\/(approve|reject)\/$/, ok),

  // Portfolio / Photos
  http.get('*/api/portfolio/', () => HttpResponse.json({ projects: [] })),
  http.get('*/api/photos/', empty),
  http.post('*/api/photos/', ok),

  // Categories
  http.get('*/api/categories/', empty),
  http.post('*/api/categories/', ok),
  http.patch(/\/api\/categories\/\d+\/$/, ok),
  http.delete(/\/api\/categories\/\d+\/$/, nullBody),

  // Notifications
  http.get('*/api/notifications/', empty),
  http.get('*/api/notifications/unread_count/', () =>
    HttpResponse.json({ unread: 0 }),
  ),
  http.post('*/api/notifications/mark_all_read/', ok),
  http.post(/\/api\/notifications\/\d+\/mark_read\/$/, ok),

  // Instructables
  http.get('*/api/instructables/preview/', () =>
    HttpResponse.json({ title: '', description: '' }),
  ),

  // Templates
  http.get('*/api/templates/', empty),
  http.get(/\/api\/templates\/\d+\/$/, () => HttpResponse.json({ id: 1 })),
  http.patch(/\/api\/templates\/\d+\/$/, ok),
  http.delete(/\/api\/templates\/\d+\/$/, nullBody),
  http.post(/\/api\/templates\/\d+\/create-project\/$/, ok),
  http.post('*/api/templates/from-project/', ok),

  // Savings Goals
  http.get('*/api/savings-goals/', empty),
  http.post('*/api/savings-goals/', ok),
  http.patch(/\/api\/savings-goals\/\d+\/$/, ok),
  http.delete(/\/api\/savings-goals\/\d+\/$/, nullBody),

  // Children
  http.get('*/api/children/', empty),
  http.post('*/api/children/', () =>
    HttpResponse.json({ id: 99, username: 'newkid', role: 'child' }, { status: 201 }),
  ),
  http.patch(/\/api\/children\/\d+\/$/, ok),
  http.delete(/\/api\/children\/\d+\/$/, nullBody),
  http.post(/\/api\/children\/\d+\/reset-password\/$/, nullBody),
  http.post(/\/api\/children\/\d+\/deactivate\/$/, ok),
  http.post(/\/api\/children\/\d+\/reactivate\/$/, ok),

  // Parents (co-parent management)
  http.get('*/api/parents/', empty),
  http.post('*/api/parents/', () =>
    HttpResponse.json({ id: 99, username: 'newparent', role: 'parent' }, { status: 201 }),
  ),
  http.patch(/\/api\/parents\/\d+\/$/, ok),
  http.delete(/\/api\/parents\/\d+\/$/, nullBody),
  http.post(/\/api\/parents\/\d+\/reset-password\/$/, nullBody),
  http.post(/\/api\/parents\/\d+\/deactivate\/$/, ok),
  http.post(/\/api\/parents\/\d+\/reactivate\/$/, ok),

  // Admin (staff-only)
  http.get('*/api/admin/families/', () => new HttpResponse(null, { status: 403 })),
  http.post('*/api/admin/families/', () =>
    HttpResponse.json({}, { status: 403 }),
  ),

  // Chores
  http.get('*/api/chores/', empty),
  http.post('*/api/chores/', ok),
  http.get(/\/api\/chores\/\d+\/$/, () => HttpResponse.json({ id: 1 })),
  http.patch(/\/api\/chores\/\d+\/$/, ok),
  http.delete(/\/api\/chores\/\d+\/$/, nullBody),
  http.post(/\/api\/chores\/\d+\/complete\/$/, ok),
  http.get('*/api/chore-completions/', empty),
  http.post(/\/api\/chore-completions\/\d+\/(approve|reject)\/$/, ok),
  http.post(/\/api\/chores\/\d+\/approve\/$/, ok),

  // Greenlight
  http.post('*/api/greenlight/import/', ok),

  // Homework
  http.get('*/api/homework/dashboard/', () => HttpResponse.json({ assignments: [] })),
  http.get('*/api/homework/', empty),
  http.post('*/api/homework/', ok),
  http.get(/\/api\/homework\/\d+\/$/, () => HttpResponse.json({ id: 1 })),
  http.patch(/\/api\/homework\/\d+\/$/, ok),
  http.delete(/\/api\/homework\/\d+\/$/, nullBody),
  http.post(/\/api\/homework\/\d+\/submit\/$/, ok),
  http.post(/\/api\/homework\/\d+\/save-template\/$/, ok),
  http.post(/\/api\/homework\/\d+\/plan\/$/, ok),
  http.get('*/api/homework-submissions/', empty),
  http.post(/\/api\/homework-submissions\/\d+\/(approve|reject)\/$/, ok),
  http.get('*/api/homework-templates/', empty),
  http.post('*/api/homework-templates/', ok),
  http.delete(/\/api\/homework-templates\/\d+\/$/, nullBody),
  http.post(/\/api\/homework-templates\/\d+\/create-assignment\/$/, ok),

  // RPG
  http.get('*/api/character/', () => HttpResponse.json({ login_streak: 0 })),
  http.post('*/api/character/equip/', ok),
  http.post('*/api/character/unequip/', ok),
  http.get('*/api/streaks/', () => HttpResponse.json({ streak: 0 })),
  http.get('*/api/habits/history/', () => HttpResponse.json({ days: 14, start: '', histories: {} })),
  http.get('*/api/habits/', empty),
  http.post('*/api/habits/', ok),
  http.patch(/\/api\/habits\/\d+\/$/, ok),
  http.delete(/\/api\/habits\/\d+\/$/, nullBody),
  http.post(/\/api\/habits\/\d+\/log\/$/, ok),
  http.post(/\/api\/habits\/\d+\/approve\/$/, ok),
  http.get('*/api/inventory/', empty),
  http.get('*/api/push/config/', () =>
    HttpResponse.json({ enabled: false, public_key: '' }),
  ),
  http.post('*/api/push/subscribe/', () => HttpResponse.json({ ok: true }, { status: 201 })),
  http.post('*/api/push/unsubscribe/', () => HttpResponse.json({ ok: true, removed: 0 })),
  http.get('*/api/pulse/', () =>
    HttpResponse.json({
      unread_count: 0,
      notifications: [],
      recent_drops: [],
      active_quest: null,
      companion_growth: { events: [] },
      expeditions_ready: [],
      savings_goals: [],
      newly_unlocked_lorebook: [],
      header: { active_timer: null, coin_balance: 0, streak_days: 0 },
    }),
  ),
  http.get('*/api/drops/recent/', empty),
  http.get('*/api/cosmetics/', empty),
  http.get('*/api/items/catalog/', empty),
  http.get('*/api/pets/species/catalog/', empty),
  http.get('*/api/quests/catalog/', empty),

  // Pets
  http.get('*/api/pets/stable/', () => HttpResponse.json({ pets: [], mounts: [] })),
  http.get('*/api/pets/codex/', () =>
    HttpResponse.json({ species: [], potions: [], totals: { species: 0, discovered_species: 0, mounts_possible: 0, mounts_owned: 0 } }),
  ),
  http.post('*/api/pets/hatch/', ok),
  http.post(/\/api\/pets\/\d+\/feed\/$/, ok),
  http.post(/\/api\/pets\/\d+\/activate\/$/, ok),
  http.get('*/api/mounts/', empty),
  http.post(/\/api\/mounts\/\d+\/activate\/$/, ok),
  http.post('*/api/mounts/breed/', () =>
    HttpResponse.json({
      egg_item_id: 11, egg_item_name: 'Companion Egg', egg_item_icon: '🥚', egg_item_sprite_key: 'big-egg',
      potion_item_id: 22, potion_item_name: 'Fire Potion', potion_item_icon: '🧪', potion_item_sprite_key: '',
      picked_species: 'Companion', picked_species_slug: 'companion',
      picked_potion: 'Fire', picked_potion_slug: 'fire',
      chromatic: false, cooldown_days: 7,
    }),
  ),
  http.get('*/api/pets/companion-growth/recent/', () => HttpResponse.json({ events: [] })),
  http.post('*/api/pets/companion-growth/seen/', ok),
  http.get('*/api/expeditions/', () => HttpResponse.json({ expeditions: [] })),
  http.post(/\/api\/mounts\/\d+\/expedition\/$/, () =>
    HttpResponse.json({ id: 1, status: 'active', tier: 'short' }, { status: 201 })),
  http.post(/\/api\/expeditions\/\d+\/claim\/$/, () =>
    HttpResponse.json({
      expedition_id: 1, tier: 'short', coins_awarded: 0, items: [], freshly_claimed: false,
      mount: { id: 1, species_name: '', species_sprite_key: '', species_icon: '', potion_name: '', potion_slug: '' },
    })),

  // Wellbeing — Finch-inspired daily affirmation + gratitude card
  http.get('*/api/wellbeing/today/', () =>
    HttpResponse.json({
      id: 1, date: new Date().toISOString().slice(0, 10), is_today: true,
      affirmation: { slug: 'small-step-counts', text: 'Even a small step today is still a step forward.', tone: 'gentle' },
      gratitude_lines: [], gratitude_paid: false,
      max_lines: 3, max_line_chars: 200, coin_reward: 2,
    })),
  http.post('*/api/wellbeing/today/gratitude/', () =>
    HttpResponse.json({
      id: 1, date: new Date().toISOString().slice(0, 10), is_today: true,
      affirmation: { slug: 'small-step-counts', text: 'Even a small step today is still a step forward.', tone: 'gentle' },
      gratitude_lines: ['ok'], gratitude_paid: true,
      max_lines: 3, max_line_chars: 200, coin_reward: 2,
      coin_awarded: 2, freshly_paid: true,
    })),

  // Quests
  http.get('*/api/quests/active/', () => HttpResponse.json(null)),
  http.get('*/api/quests/available/', empty),
  http.post('*/api/quests/start/', ok),
  http.get('*/api/quests/history/', empty),
  http.post('*/api/quests/', ok),
  http.post(/\/api\/quests\/\d+\/assign\/$/, ok),
  http.get('*/api/quests/family/', empty),

  // Forge — 3D print requests. Every endpoint in the `Forge` block of
  // src/api/index.js needs a default here: setup.js runs MSW with
  // `onUnhandledRequest: 'error'`, so an uncovered route fails any test
  // that transitively mounts the Quests hub.
  http.post('*/api/print-requests/preview/', () =>
    HttpResponse.json({
      title: '', thumbnail_url: '', author: '',
      source_kind: 'other_url', error: null,
    }),
  ),
  http.get('*/api/print-requests/', () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.post('*/api/print-requests/', () => HttpResponse.json({ id: 1 }, { status: 201 })),
  http.post(/\/api\/print-requests\/\d+\/(approve|reject|cancel)\/$/, () =>
    HttpResponse.json({ id: 1, status: 'approved', plate_filename: 'req-0001-thing.3mf' }),
  ),
  http.patch(/\/api\/print-requests\/\d+\/$/, () => HttpResponse.json({ id: 1 })),
  http.delete(/\/api\/print-requests\/\d+\/$/, nullBody),

  http.get('*/api/print-jobs/', () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.post(/\/api\/print-jobs\/\d+\/(link|unlink|dismiss|restore)\/$/, () => HttpResponse.json({ id: 1 })),
  http.delete(/\/api\/print-jobs\/\d+\/$/, () => new HttpResponse(null, { status: 204 })),

  http.get(/\/api\/print-budgets\/\d+\/ledger\/$/, empty),
  http.get('*/api/print-budgets/', () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.patch(/\/api\/print-budgets\/\d+\/$/, () => HttpResponse.json({ id: 1 })),
  http.post(/\/api\/print-budgets\/\d+\/adjust\/$/, () => HttpResponse.json({ id: 1 })),

  http.get(/\/api\/printers\/\d+\/status\/$/, () =>
    HttpResponse.json({ printer: null, live: null, connected: false, job: null }),
  ),
  http.get('*/api/printers/', () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.post('*/api/printers/', () => HttpResponse.json({ id: 1 }, { status: 201 })),
  http.patch(/\/api\/printers\/\d+\/$/, () => HttpResponse.json({ id: 1 })),
  http.delete(/\/api\/printers\/\d+\/$/, nullBody),

  // Activity log (parent-only)
  http.get('*/api/activity/', () =>
    HttpResponse.json({ results: [], next: null, previous: null })),

  // Dev tools — default to disabled so the Test tab stays hidden in
  // tests that don't explicitly opt in.
  http.get('*/api/dev/ping/', () => new HttpResponse(null, { status: 403 })),
  http.get('*/api/dev/children/', empty),
  http.get('*/api/dev/rewards/', empty),
  http.get('*/api/dev/items/', empty),
  http.get('*/api/dev/pet-species/', empty),
  http.get('*/api/dev/potion-types/', empty),
  http.get('*/api/dev/checklist/', () => HttpResponse.json({ markdown: '' })),

  // Sprites
  http.get('*/api/sprites/catalog/', () =>
    HttpResponse.json({ sprites: {}, etag: 'test-default-empty' }),
  ),
  http.get('*/api/sprites/admin/', empty),
  http.post('*/api/sprites/admin/generate/', () =>
    HttpResponse.json({ slug: 'x', frame_count: 1, frame_width_px: 64, frame_height_px: 64, fps: 0 }, { status: 201 }),
  ),
  http.post(/\/api\/sprites\/admin\/[^/]+\/reroll\/$/, () =>
    HttpResponse.json({ slug: 'x', frame_count: 1, frame_width_px: 64, frame_height_px: 64, fps: 0 }),
  ),
  http.patch(/\/api\/sprites\/admin\/[^/]+\/$/, ok),
  http.delete(/\/api\/sprites\/admin\/[^/]+\/$/, () => HttpResponse.json({ deleted: true })),

  // Chronicle / Yearbook
  http.get('*/api/chronicle/grades/', () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  http.get(/\/api\/chronicle\/entries\/\d+\/comments\/$/, empty),
  http.get('*/api/chronicle/', () => HttpResponse.json([])),
  http.get('*/api/chronicle/summary/', () =>
    HttpResponse.json({ chapters: [], current_chapter_year: 2025 }),
  ),
  http.get('*/api/chronicle/pending-celebration/', () => new HttpResponse(null, { status: 204 })),
  http.post(/\/api\/chronicle\/\d+\/mark-viewed\/$/, () => HttpResponse.json({})),
  http.post('*/api/chronicle/manual/', () => HttpResponse.json({ id: 1 }, { status: 201 })),
  http.post('*/api/chronicle/journal/', () =>
    HttpResponse.json({ id: 1, kind: 'journal', is_private: true, title: 'Today' }, { status: 201 }),
  ),
  http.patch(/\/api\/chronicle\/\d+\/journal\/$/, () =>
    HttpResponse.json({ id: 1, kind: 'journal', is_private: true, title: 'Today' }),
  ),
  // Default: no journal entry for today. Individual tests override with
  // server.use() to simulate the "already wrote today" path.
  http.get('*/api/chronicle/journal/today/', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/chronicle/meadow/', () => HttpResponse.json({
    schema_version: 1, keepsake_count: 0, journal_xp_awarded: 0, keepsakes: [],
  })),
  http.patch(/\/api\/chronicle\/\d+\/$/, () => HttpResponse.json({})),
  http.delete(/\/api\/chronicle\/\d+\/$/, () => new HttpResponse(null, { status: 204 })),
];
