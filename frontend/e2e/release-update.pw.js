import { expect, test } from '@playwright/test';
import { buildReleases, startServer } from './pwa-fixture';

let fixtures;
let server;

test.beforeAll(async () => {
  fixtures = await buildReleases();
  server = await startServer(fixtures.releases.A);
});

test.afterAll(async () => {
  await server?.stop();
  await fixtures?.cleanup();
});

async function cacheUrls(page) {
  return page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
}

async function expectOfflineShell(page, origin, label, path = '/synthetic/deep-route') {
  const responses = [];
  const capture = (response) => {
    if (new URL(response.url()).pathname.startsWith('/static/assets/')) responses.push(response);
  };
  page.on('response', capture);
  try {
    const response = await page.goto(`${origin}${path}`);
    expect(response.fromServiceWorker()).toBe(true);
    await expect(page.locator('#release')).toHaveText(`Release ${label}`);
    await expect(page.locator('#release')).toHaveCSS('color', label === 'A' ? 'rgb(17, 34, 51)' : 'rgb(51, 34, 17)');
    await page.getByRole('button', { name: 'Load lazy fixture' }).click();
    await expect(page.locator('#lazy')).toHaveText(`Lazy ${label}`);
    await expect(page.locator('#lazy')).toHaveCSS('font-weight', label === 'A' ? '600' : '700');
    expect(responses.some((r) => new URL(r.url()).pathname.endsWith('.js'))).toBe(true);
    expect(responses.some((r) => new URL(r.url()).pathname.endsWith('.css'))).toBe(true);
    expect(responses.some((r) => /\/lazy-[^/]+\.js$/.test(new URL(r.url()).pathname))).toBe(true);
    expect(responses.some((r) => /\/lazy-[^/]+\.css$/.test(new URL(r.url()).pathname))).toBe(true);
    expect(responses.every((r) => r.fromServiceWorker())).toBe(true);
  } finally {
    page.off('response', capture);
  }
}

test('production Django routes survive offline boots and replacement releases until the update is accepted', async ({ page, context, request }) => {
  const origin = server.origin;
  for (const release of Object.values(fixtures.releases)) {
    expect(release.entryAssets.length).toBeGreaterThanOrEqual(2);
    expect(release.html).toContain('href="/manifest.webmanifest"');
  }
  const sw = await request.get(`${origin}/sw.js`);
  expect(sw.headers()['cache-control']).toBe('no-cache');
  expect(sw.headers()['content-type']).toContain('javascript');
  const manifest = await request.get(`${origin}/manifest.webmanifest`);
  expect(manifest.headers()['content-type']).toContain('application/manifest+json');
  expect(await manifest.json()).toMatchObject({ scope: '/', start_url: '/' });

  await page.goto(origin);
  await expect(page.locator('#release')).toHaveText('Release A');
  // Unlike jsdom mocks, this proves the generated worker evaluates, finishes
  // precaching through production routes, and controls the root application.
  await expect.poll(() => page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration('/'))?.active?.state), {
    message: 'The production-routed worker must install and become active',
  }).toBe('activated');
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${origin}/sw.js`);

  const urls = await cacheUrls(page);
  await test.info().attach('release-a-cache-urls', { body: JSON.stringify(urls, null, 2), contentType: 'application/json' });
  for (const asset of fixtures.releases.A.entryAssets) expect(urls).toContain(`${origin}${asset}`);
  expect(urls.some((url) => new URL(url).pathname.startsWith('/assets/'))).toBe(false);

  expect(await page.evaluate(async () => (await fetch('/api/pwa-fixture/')).json())).toEqual({ synthetic: '/api/pwa-fixture/' });
  expect(await page.evaluate(async () => (await fetch('/api/chronicle/')).json())).toEqual({ synthetic: '/api/chronicle/' });
  await expect.poll(async () => (await cacheUrls(page)).includes(`${origin}/api/pwa-fixture/`)).toBe(true);
  expect((await cacheUrls(page)).some((url) => new URL(url).pathname.startsWith('/api/chronicle/'))).toBe(false);
  // A stale pre-existing sensitive entry must never be exposed by the
  // general API fallback, even when its bytes already exist in api-reads.
  await page.evaluate(async () => {
    const cache = await caches.open('api-reads');
    await cache.put('/api/chronicle/private-sentinel', new Response('{"private":"synthetic stale sentinel"}', {
      headers: { 'Content-Type': 'application/json' },
    }));
  });
  const unityPaths = ['/play', '/play/', '/play/synthetic-deep-route'];
  for (const path of unityPaths) {
    const unity = await context.newPage();
    const response = await unity.goto(`${origin}${path}`);
    expect(response.fromServiceWorker()).toBe(false);
    await expect(unity.getByRole('heading')).toHaveText('Synthetic Unity host');
    await unity.close();
  }

  await context.setOffline(true);
  await expectOfflineShell(page, origin, 'A');
  // Keep the exclusion's path boundary narrow: /playground is a SPA route.
  await expectOfflineShell(page, origin, 'A', '/playground');
  expect(await page.evaluate(async () => (await fetch('/api/pwa-fixture/')).json())).toEqual({ synthetic: '/api/pwa-fixture/' });
  for (const path of ['/api/chronicle/', '/api/chronicle/private-sentinel']) {
    expect(await page.evaluate(async (url) => {
      try { await fetch(url); return 'unexpected response'; } catch { return 'network failure'; }
    }, path)).toBe('network failure');
  }
  for (const path of unityPaths) {
    const unity = await context.newPage();
    await expect(unity.goto(`${origin}${path}`)).rejects.toThrow();
    await unity.close();
  }

  await context.setOffline(false);
  const port = server.port;
  await server.stop();
  server = await startServer(fixtures.releases.B, port);
  // A new process has an isolated collectstatic directory and a new imported
  // index.html, just as the Docker deployment removes release A's files.
  const removedAssets = fixtures.releases.A.entryAssets.filter((asset) => !fixtures.releases.B.entryAssets.includes(asset));
  expect(removedAssets.some((asset) => asset.endsWith('.js'))).toBe(true);
  expect(removedAssets.some((asset) => asset.endsWith('.css'))).toBe(true);
  for (const asset of removedAssets) expect((await request.get(`${origin}${asset}`)).status()).toBe(404);
  expect(await (await request.get(`${origin}/synthetic/deep-route`)).text()).toBe(fixtures.releases.B.html);

  const oldResponses = [];
  page.on('response', (response) => {
    if (removedAssets.includes(new URL(response.url()).pathname)) oldResponses.push(response);
  });
  await page.reload();
  await expect(page.locator('#release')).toHaveText('Release A');
  expect(oldResponses.length).toBe(removedAssets.length);
  expect(oldResponses.every((response) => response.fromServiceWorker())).toBe(true);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/')).update());
  await expect(page.getByText('New version available.', { exact: true })).toBeVisible();
  await expect(page.locator('#release')).toHaveText('Release A');
  // Defer the update while offline: the waiting release must leave the
  // active release's complete shell available until the user accepts it.
  await context.setOffline(true);
  await expectOfflineShell(page, origin, 'A');
  await expect(page.getByText('New version available.', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.locator('#release')).toHaveText('Release B');
  await expect(page.getByText('New version available.', { exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await expectOfflineShell(page, origin, 'B');
});
