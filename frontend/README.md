# The Abby Project — Frontend

React 19 + Vite 8 + Tailwind 4 frontend for The Abby Project. See the [root README](../README.md) for full project documentation.

## Scripts

```bash
npm run dev            # Dev server on :3000 with /api proxy to :8000
npm run build          # Production build into dist/
npm run lint           # ESLint check
npm run test           # Vitest watcher (interactive)
npm run test:run       # One-shot test run (no watch)
npm run test:coverage  # Run tests with v8 coverage report → coverage/
npm run test:pwa       # Chromium: real Django static routing, two releases, offline
```

## Testing

Tests live next to source as `*.test.{js,jsx}`. The shared scaffolding in
`src/test/` provides:

- `setup.js` — jest-dom matchers, jsdom polyfills (`matchMedia`, `IntersectionObserver`, `createImageBitmap`, canvas), Sentry mock, MSW lifecycle, and `localStorage` reset between tests.
- `server.js` + `handlers.js` — MSW node server with permissive default handlers for every `/api` route. Override with `server.use(http.get(…))` per test for specific responses.
- `render.jsx` — `renderWithProviders(ui, { route, routePath, withAuth })` wraps in `<MemoryRouter>` + `<AuthProvider>`. Re-exports RTL helpers and a configured `userEvent`.
- `factories.js` — `buildUser`, `buildParent`, `buildProject`, `buildBadge`, `buildChore`, `buildNotification` fixture builders.
- `pwa-register-stub.js` — vitest aliases `virtual:pwa-register` to this stub so PWA-aware components don't choke on Vite's virtual module under jsdom.
- `spy.js` — `spyHandler(method, urlPattern, response)` for interaction tests that need to assert on the exact body / URL of an outgoing API call.

Coverage thresholds are enforced in CI (see `vitest.config.js > coverage.thresholds`). Decorative SVGs, framer-motion animation primitives, and the dev-only `/__design` route are excluded.

When you need to stub framer-motion's `AnimatePresence` so exit animations don't keep nodes mounted past your assertion, mock at the file level:

```js
vi.mock('framer-motion', async () => {
  const a = await vi.importActual('framer-motion');
  return { ...a, AnimatePresence: ({ children }) => children };
});
```

Modal components use `createPortal(…, document.body)`, so query their backdrop and contents off `document.body` rather than the RTL container.

### Browser PWA release verification

Install the repository's Python requirements and run `npx playwright install chromium`
from `frontend/` before `npm run test:pwa`. If Python is in a separate virtual
environment, set `PWA_PYTHON` to that environment's Python executable.

The browser test builds two small synthetic React/CSS releases using the real
`vite.config.js`, `PwaStatusProvider`, and `UpdateBanner`. It serves each through
the actual Django URL configuration and WhiteNoise with `DEBUG=False` and
`CompressedStaticFilesStorage`, restarting the server on the same loopback port
to replace the first release completely. All builds/static files are temporary,
and API/Unity responses are synthetic. It uses no application database or
credentials, does not read `.env`, and disables Sentry uploads.

It verifies that root worker and manifest routing works, the offline shell can
load its JS/CSS and a previously unopened lazy chunk, Chronicle requests remain
network-only even if a stale sentinel was planted in `api-reads`, ordinary API
reads retain their offline fallback, and `/play`, `/play/`, plus a descendant
bypass the SPA while `/playground` remains an offline SPA route.
After replacement, the old release must boot from precached assets whose network
URLs now return 404, show the real update banner, activate the new worker on
Reload, and boot the new release offline. It also keeps release A usable offline
while release B is waiting for the user to accept the update. The independent
`pwa-release-test.yml` workflow runs this on relevant pull requests and pushes.

To verify that a prior configuration fails the same test, copy that config into
`frontend/` under a temporary filename and set `PWA_VITE_CONFIG` to its absolute
path. The file must remain inside the frontend package so its plugin imports can
resolve. Playwright retains a browser trace under `test-results/` on failure.
