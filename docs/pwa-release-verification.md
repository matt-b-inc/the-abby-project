# PWA release verification

## Scope

This investigation addresses the existing React PWA build and update path, independently of the unmerged Memory Meadow feature. Local verification uses disposable releases and synthetic fixtures only, including API responses used to check caching behavior. It does not load the project's database, use family accounts, merge, or deploy. Public production observations below were unauthenticated reads of build files.

## Production observations: October 10, 2026

Public GETs to `https://abby.bos.lol` on October 10, 2026 (America/Phoenix) returned:

| URL | Status and content type | Relevant evidence |
| --- | --- | --- |
| `/sw.js` | 200, `text/javascript` | 5,695 bytes; imports `./workbox-a665390a`; lists `assets/...` and `index.html` for precaching; configured navigation fallback is `/index.html`. |
| `/workbox-a665390a.js` | 200, `text/html; charset=utf-8` | 5,523 bytes beginning with `<!doctype html>`; `X-Content-Type-Options: nosniff`. |
| `/assets/index-ndmBM9MX.js` | 200, `text/html; charset=utf-8` | React HTML rather than the JavaScript listed in the worker's precache manifest. |
| `/static/assets/index-ndmBM9MX.js` | 200, `text/javascript; charset="utf-8"` | The actual 258,709-byte JavaScript bundle referenced by the production shell. |
| `/push-sw.js` | 200, `text/javascript` | The root push-handler route exists and returns the script. |

SHA-256 fingerprints from these responses:

```text
/sw.js
26b6b86685ca53dae0ace3d845cbeb5b8fa2eb9a38be96512c4f20fe05add812

/workbox-a665390a.js
37ff64fa22adc162ba3b1c8970b758ab53aee76f8c994b13410fd80e1b83a368

/
6ec923c140a3e1b9af7ec344edd925ea59537c2ce6b235fad13d64a421b551e9
```

The worker response's `Last-Modified` was `Sat, 10 Oct 2026 18:27:19 GMT`. The public edge reported `Server: cloudflare` and `Cache-Control: max-age=14400` for `/sw.js`, its missing helper, and `/push-sw.js`. A request carrying `Cache-Control: no-cache` to `/sw.js?verify-pwa=20261010` returned the same worker bytes, the same four-hour response cache lifetime, and `CF-Cache-Status: MISS`. The corresponding helper query also returned the same HTML bytes and four-hour lifetime. These observations establish the public response behavior; they do not establish which hosting or edge rule changed the header.

The live worker source retains the `/play` navigation exclusion and excludes `/api/chronicle/` from its configured API runtime cache.

## Local baseline and failure mechanism

The Docker build copies `frontend/dist` to `frontend_dist`, then runs `collectstatic`. Django serves the React shell from `frontend_dist/index.html`, serves selected PWA files from root, and WhiteNoise serves bundled assets under `/static/`.

Before this fix, Vite's build base was `/static/`, while the PWA plugin base was `/`. Workbox therefore emitted precache URLs under `assets/`, even though the shell requested `/static/assets/`. Its default separate runtime also required a generated root `workbox-<hash>.js` file that Django's named PWA routes did not serve.

A disposable Django test-client check with synthetic files confirmed that `/sw.js` returned JavaScript with `Cache-Control: no-cache`, but an existing synthetic `/workbox-a665390a.js` file still resolved to the SPA and returned HTML. `/assets/index-synthetic.js` also returned SPA HTML, while missing `/static/assets/index-synthetic.js` returned 404. The public responses above show the same route mismatch in the deployed build.

A Chromium run using the exact baseline configuration against disposable Django routes showed that registration can become active while Cache Storage remains empty. The asynchronous helper-load rejection prevents Workbox initialization and precaching without necessarily preventing worker activation. An active registration alone therefore does not establish working offline, navigation, or update routes.

Under a host that does serve the helper, the separate asset URL mismatch can let a faulty worker cache the shell without caching the `/static/assets/` URLs that shell actually uses. After the server removes the previous release's hashes, that cached shell can request missing JavaScript and CSS before React mounts or displays its update banner. The disposable preview symptom is consistent with this mechanism; it is not evidence that production clients currently experience it.

## Minimal fix

Keep the service worker, manifest, and navigation shell at root, with explicit worker scope `/`. Rewrite Workbox precache `assets/` URLs to `/static/assets/`, and match those rewritten content-hashed URLs in `dontCacheBustURLsMatching`. Inline the Workbox runtime so the worker no longer depends on an unrouted generated root helper. The existing `/push-sw.js` import continues to use its explicit Django route.

No Django route expansion or update-UI change is required. Prompt updates, Chronicle's network-only reads, and `/play` navigation exclusions remain in place.

## Release and offline verification

The automated verification uses two disposable releases against production-equivalent Django shell, root PWA, and WhiteNoise static routes. Synthetic API fixtures are the only account-like content used. It checks:

1. A baseline build exhibits the helper and asset URL mismatches through those routes.
2. The fixed worker installs, its imported scripts return JavaScript, and cached bundle responses contain the expected build bytes rather than a successful HTML fallback.
3. Release A still boots after release B replaces its server files and removes A's hashes, while B's worker waits for acceptance.
4. Accepting the update activates B; B then boots offline using its matching shell, JavaScript, and CSS.
5. Chronicle responses are not written to runtime caches and cannot be supplied from cache offline; `/play` and its descendants bypass the React navigation fallback.

Completed validation:

- The exact baseline configuration failed the release protocol as expected: Chromium reported an active registration, but Cache Storage was empty and the required `/static/assets/` bundle was absent.
- Inlining only the runtime still failed the protocol: the cache contained `/assets/` entries instead of the required `/static/assets/` bundles. A separate standalone blank-page transition probe timed out before worker activation and supplied no verified blank-page result.
- The corrected release/offline protocol passed with Python 3.12 and Django 5.1.15, including release replacement, waiting-worker acceptance, offline boot, Chronicle cache exclusions, and `/play` navigation exclusions.
- A full corrected frontend build had 67 unique precache URLs. All returned the exact expected build bytes through Django with `DEBUG=False`, `collectstatic`, and WhiteNoise. Missing static assets returned 404.
- All 57 targeted PWA Vitest tests and 11 Django PWA routing tests passed. The Django tests ran with Python 3.12 and Django 5.1.15.
- The complete frontend coverage run passed all 2,346 tests in 253 files and met the configured coverage thresholds (86.07% lines).
- ESLint passed with no errors and six existing warnings; the Python fixture passed Ruff.

## Impact and rollout limits

The live public build has a confirmed worker dependency and precache URL defect. The production-equivalent baseline demonstrates that registration can become active without Workbox routes or cached assets, leaving its offline and update functionality broken. This is a Workbox initialization/precache failure, not proof that worker installation itself always fails. The number of impacted clients, presence of previously active faulty caches, and production blank-page incidence are unproven; no authenticated client data or affected-client telemetry was inspected.

The observed public four-hour worker cache lifetime can delay delivery of the corrected worker. Django's origin `no-cache` header does not prove that the public edge preserves it. Hosting follow-up should check the public worker response after any separately authorized deployment; this change does not modify edge settings or purge production caches.

There is no forced legacy-cache migration or automated reset of browser storage. A previously broken client may be unable to mount React and offer the update prompt. If support confirms that condition, first close all Abby tabs and installed-app windows, then reopen after the corrected worker is publicly available. If needed, use the browser's controls to unregister the Abby service worker and clear its Cache Storage for this origin. Broader site-data clearing can remove local drafts and sign-in state, so it is a deliberate support action rather than an automatic application behavior.
