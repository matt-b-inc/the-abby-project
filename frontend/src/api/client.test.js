import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/react';
import { server } from '../test/server.js';
import {
  api, getBlob, getToken, setToken, OFFLINE_MESSAGE,
} from './client.js';

describe('token helpers', () => {
  it('returns empty string when no token is stored', () => {
    expect(getToken()).toBe('');
  });

  it('persists and retrieves a token via localStorage', () => {
    setToken('abc123');
    expect(getToken()).toBe('abc123');
    expect(localStorage.getItem('abby_auth_token')).toBe('abc123');
  });

  it('clears the token when called with a falsy value', () => {
    setToken('abc');
    setToken(null);
    expect(getToken()).toBe('');
    setToken('');
    expect(getToken()).toBe('');
  });
});

describe('api.get', () => {
  it('returns parsed JSON from a 200 response', async () => {
    server.use(
      http.get('*/api/ping/', () => HttpResponse.json({ pong: true })),
    );
    await expect(api.get('/ping/')).resolves.toEqual({ pong: true });
  });

  it('sends the Authorization header when a token is present', async () => {
    setToken('tok');
    let captured;
    server.use(
      http.get('*/api/auth-check/', ({ request }) => {
        captured = request.headers.get('authorization');
        return HttpResponse.json({});
      }),
    );
    await api.get('/auth-check/');
    expect(captured).toBe('Token tok');
  });

  it('returns null for 204 No Content responses', async () => {
    server.use(
      http.get('*/api/empty/', () => new HttpResponse(null, { status: 204 })),
    );
    await expect(api.get('/empty/')).resolves.toBeNull();
  });
});

describe('api errors', () => {
  beforeEach(() => {
    Sentry.addBreadcrumb.mockClear();
    Sentry.captureException.mockClear();
  });

  it('uses error field from JSON error body', async () => {
    server.use(
      http.get('*/api/bad/', () =>
        HttpResponse.json({ error: 'nope' }, { status: 400 }),
      ),
    );
    await expect(api.get('/bad/')).rejects.toThrow('nope');
    expect(Sentry.addBreadcrumb).toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('falls back to detail field', async () => {
    server.use(
      http.get('*/api/bad/', () =>
        HttpResponse.json({ detail: 'auth failed' }, { status: 401 }),
      ),
    );
    await expect(api.get('/bad/')).rejects.toThrow('auth failed');
  });

  it('falls back to serialized error body when neither error nor detail set', async () => {
    server.use(
      http.get('*/api/bad/', () =>
        HttpResponse.json({ field: ['bad'] }, { status: 400 }),
      ),
    );
    await expect(api.get('/bad/')).rejects.toThrow('{"field":["bad"]}');
  });

  it('falls back to statusText when body is not JSON', async () => {
    server.use(
      http.get('*/api/bad/', () => new HttpResponse('not json', { status: 400, statusText: 'Bad Request' })),
    );
    await expect(api.get('/bad/')).rejects.toThrow();
  });

  it('captures 5xx responses to Sentry', async () => {
    server.use(
      http.get('*/api/boom/', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    await expect(api.get('/boom/')).rejects.toThrow('boom');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('attaches .status + .response to the thrown error so callers can branch on HTTP code', async () => {
    // Pin the error-shape contract used by JournalEntryFormModal (409 → edit)
    // and the 403 "entry locked" path. String-matching .message is fragile;
    // callers read .status and .response directly.
    server.use(
      http.post('*/api/chronicle/journal/', () =>
        HttpResponse.json(
          { detail: 'You already wrote a journal entry today.', existing: { id: 77 } },
          { status: 409 },
        ),
      ),
    );
    let caught;
    try {
      await api.post('/chronicle/journal/', { title: '', summary: 'x' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.status).toBe(409);
    expect(caught.response).toEqual({
      detail: 'You already wrote a journal entry today.',
      existing: { id: 77 },
    });
    expect(caught.message).toBe('You already wrote a journal entry today.');
  });
});

describe('network failures', () => {
  // A dead connection rejects fetch with the browser's own wording — "Failed
  // to fetch" on Chrome, "Load failed" on Safari — and ~79 call sites render
  // err.message straight into an ErrorAlert. Translating at this seam covers
  // all of them at once.
  it('translates a fetch rejection into kid-readable copy', async () => {
    server.use(http.get('*/api/projects/', () => HttpResponse.error()));
    await expect(api.get('/projects/')).rejects.toThrow(OFFLINE_MESSAGE);
  });

  it('leaves the error without a status so HTTP branching still works', async () => {
    server.use(http.get('*/api/projects/', () => HttpResponse.error()));
    const err = await api.get('/projects/').catch((e) => e);
    expect(err.status).toBeUndefined();
    expect(err.offline).toBe(true);
  });

  it('keeps server error messages verbatim', async () => {
    server.use(http.get('*/api/projects/', () =>
      HttpResponse.json({ error: 'You already logged that today.' }, { status: 409 }),
    ));
    const err = await api.get('/projects/').catch((e) => e);
    expect(err.message).toBe('You already logged that today.');
    expect(err.status).toBe(409);
    expect(err.offline).toBeUndefined();
  });

  // useApi keys cancellation off err.name, so an abort must never be
  // relabelled as a connection failure. `request()` takes no signal today, so
  // the guard is exercised by rejecting at the fetch boundary directly.
  it('lets an AbortError through untouched', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortErr);
    const err = await api.get('/projects/').catch((e) => e);
    expect(err.name).toBe('AbortError');
    expect(err.message).not.toBe(OFFLINE_MESSAGE);
    fetchSpy.mockRestore();
  });

  it('translates a failed blob download too', async () => {
    server.use(http.get('*/api/payments/export/', () => HttpResponse.error()));
    await expect(getBlob('/payments/export/')).rejects.toThrow(OFFLINE_MESSAGE);
  });
});

describe('cache bypass', () => {
  it('sends cache: "no-store" on every request so disk-cached HTML errors can never poison the API surface', async () => {
    // Spy directly on fetch — MSW runs at the network layer and swallows the
    // fetch init object. We just want to verify the init the client builds.
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}),
      }),
    );
    try {
      await api.get('/anything/');
      const init = fetchSpy.mock.calls.at(-1)[1];
      expect(init.cache).toBe('no-store');
    } finally {
      fetchSpy.mockRestore();
      globalThis.fetch = realFetch;
    }
  });
});

describe('non-JSON 200 guard', () => {
  beforeEach(() => {
    Sentry.addBreadcrumb.mockClear();
    Sentry.captureException.mockClear();
  });

  it('throws a clear error when a 200 response has HTML content-type (stale upstream error page)', async () => {
    server.use(
      http.get('*/api/notifications/unread_count/', () =>
        new HttpResponse('<!DOCTYPE html><title>oops</title>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      ),
    );
    await expect(api.get('/notifications/unread_count/')).rejects.toThrow(
      /non-JSON response/i,
    );
    // Must surface to Sentry so we notice it happening in prod.
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('throws when the 200 response has no content-type at all', async () => {
    server.use(
      http.get('*/api/thing/', () =>
        // HttpResponse with a plain string body and explicit empty headers.
        new HttpResponse('not json', { status: 200, headers: {} }),
      ),
    );
    await expect(api.get('/thing/')).rejects.toThrow(/non-JSON response/i);
  });

  it('accepts application/json with a charset suffix', async () => {
    server.use(
      http.get('*/api/thing/', () =>
        new HttpResponse(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
      ),
    );
    await expect(api.get('/thing/')).resolves.toEqual({ ok: true });
  });
});

describe('api.post / patch / delete', () => {
  it('stringifies a plain object body and sets JSON Content-Type', async () => {
    let seen;
    server.use(
      http.post('*/api/things/', async ({ request }) => {
        seen = {
          ct: request.headers.get('content-type'),
          body: await request.json(),
        };
        return HttpResponse.json({ id: 1 });
      }),
    );
    await api.post('/things/', { name: 'abby' });
    expect(seen.ct).toBe('application/json');
    expect(seen.body).toEqual({ name: 'abby' });
  });

  it('uploads FormData without a json Content-Type header', async () => {
    let contentType;
    server.use(
      http.post('*/api/upload/', ({ request }) => {
        contentType = request.headers.get('content-type') || '';
        return HttpResponse.json({ id: 1 });
      }),
    );
    const fd = new FormData();
    fd.append('file', new Blob(['x']));
    await api.upload('/upload/', fd);
    // FormData Content-Type is `multipart/form-data; boundary=...` — never
    // application/json.
    expect(contentType.startsWith('multipart/form-data')).toBe(true);
  });

  it('PATCHes via api.patch', async () => {
    let method;
    server.use(
      http.patch('*/api/things/1/', ({ request }) => {
        method = request.method;
        return HttpResponse.json({});
      }),
    );
    await api.patch('/things/1/', { name: 'x' });
    expect(method).toBe('PATCH');
  });

  it('DELETEs via api.delete', async () => {
    let method;
    server.use(
      http.delete('*/api/things/1/', ({ request }) => {
        method = request.method;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await api.delete('/things/1/');
    expect(method).toBe('DELETE');
  });
});

describe('getBlob', () => {
  afterEach(() => {
    Sentry.captureException.mockClear();
    Sentry.addBreadcrumb.mockClear();
  });

  it('returns a blob-like object on success', async () => {
    server.use(
      http.get('*/api/file/', () => new HttpResponse('binary-data')),
    );
    const blob = await getBlob('/file/');
    // jsdom and undici ship separate Blob classes, so instanceof is
    // unreliable. Duck-type the result instead.
    expect(typeof blob.size).toBe('number');
    expect(blob.size).toBe('binary-data'.length);
  });

  it('attaches Authorization when present', async () => {
    setToken('tok');
    let auth;
    server.use(
      http.get('*/api/file/', ({ request }) => {
        auth = request.headers.get('authorization');
        return new HttpResponse('binary-data');
      }),
    );
    await getBlob('/file/');
    expect(auth).toBe('Token tok');
  });

  it('throws and breadcrumbs on 4xx', async () => {
    server.use(
      http.get('*/api/file/', () => new HttpResponse(null, { status: 404, statusText: 'Not Found' })),
    );
    await expect(getBlob('/file/')).rejects.toThrow();
    expect(Sentry.addBreadcrumb).toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures 5xx in Sentry', async () => {
    server.use(
      http.get('*/api/file/', () => new HttpResponse(null, { status: 500 })),
    );
    await expect(getBlob('/file/')).rejects.toThrow();
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

describe('401 self-heal', () => {
  // jsdom marks Location.reload as non-configurable, so we can't redefine the
  // method on the real object. Swap the whole `window.location` with a plain
  // stub that only exposes what the client's 401 branch touches (reload).
  // Scoped to this describe so the rest of the suite keeps the real location.
  let reloadSpy;
  let originalLocation;

  beforeEach(async () => {
    // Audit L5: the self-heal-reload coalescer is module-level state.
    // In production the flag self-resets via the reload (the module is
    // re-imported on the new page load); in tests we mock reload so the
    // flag would otherwise leak across cases.
    const { __resetSelfHealForTesting } = await import('./client');
    __resetSelfHealForTesting();

    reloadSpy = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      // Preserve the URL-ish fields fetch() uses to resolve relative URLs
      // (origin, href, etc.); only stub the one method our code calls.
      value: {
        href: originalLocation.href,
        origin: originalLocation.origin,
        protocol: originalLocation.protocol,
        host: originalLocation.host,
        hostname: originalLocation.hostname,
        port: originalLocation.port,
        pathname: originalLocation.pathname,
        search: originalLocation.search,
        hash: originalLocation.hash,
        reload: reloadSpy,
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('clears the token and reloads when request() gets a 401 on an authed call', async () => {
    setToken('stale-token');
    server.use(
      http.get('*/api/dashboard/', () =>
        HttpResponse.json({ detail: 'Invalid token.' }, { status: 401 }),
      ),
    );

    await expect(api.get('/dashboard/')).rejects.toThrow();

    expect(localStorage.getItem('abby_auth_token')).toBeNull();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload when request() gets a 401 without an Authorization header (boot-time getMe)', async () => {
    // No token stored — first-time visitor or freshly-cleared localStorage.
    server.use(
      http.get('*/api/auth/me/', () =>
        HttpResponse.json(
          { detail: 'Authentication credentials were not provided.' },
          { status: 401 },
        ),
      ),
    );

    await expect(api.get('/auth/me/')).rejects.toThrow();

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('does NOT reload on a failed login attempt (no auth header sent)', async () => {
    server.use(
      http.post('*/api/auth/', () =>
        HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
      ),
    );

    await expect(
      api.post('/auth/', { action: 'login', username: 'x', password: 'y' }),
    ).rejects.toThrow('Invalid credentials');

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('clears the token and reloads when getBlob() gets a 401 on an authed call', async () => {
    setToken('stale-token');
    server.use(
      http.get('*/api/timecards/export.csv', () =>
        HttpResponse.json({ detail: 'Invalid token.' }, { status: 401 }),
      ),
    );

    await expect(getBlob('/timecards/export.csv')).rejects.toThrow();

    expect(localStorage.getItem('abby_auth_token')).toBeNull();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload when getBlob() gets a 401 without a stored token', async () => {
    server.use(
      http.get('*/api/timecards/export.csv', () =>
        HttpResponse.json(
          { detail: 'Authentication credentials were not provided.' },
          { status: 401 },
        ),
      ),
    );

    await expect(getBlob('/timecards/export.csv')).rejects.toThrow();

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['request', () => api.get('/dashboard/')],
    ['blob download', () => getBlob('/dashboard/')],
  ])('preserves a replacement session after a delayed %s 401', async (_name, sendRequest) => {
    setToken('old-session');
    let releaseResponse;
    let signalStarted;
    const started = new Promise((resolve) => { signalStarted = resolve; });
    const responseReady = new Promise((resolve) => { releaseResponse = resolve; });
    server.use(http.get('*/api/dashboard/', async ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Token old-session');
      signalStarted();
      await responseReady;
      return HttpResponse.json({ detail: 'Invalid token.' }, { status: 401 });
    }));

    const pending = sendRequest().catch((err) => err);
    await started;
    // Another tab/client switched accounts or rotated the token while the
    // old account's request was in flight.
    setToken('replacement-session');
    releaseResponse();
    expect(await pending).toBeInstanceOf(Error);

    expect(getToken()).toBe('replacement-session');
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['request', () => api.get('/dashboard/')],
    ['blob download', () => getBlob('/dashboard/')],
  ])('ignores a delayed %s 401 after logout', async (_name, sendRequest) => {
    setToken('old-session');
    let releaseResponse;
    let signalStarted;
    const started = new Promise((resolve) => { signalStarted = resolve; });
    const responseReady = new Promise((resolve) => { releaseResponse = resolve; });
    server.use(http.get('*/api/dashboard/', async () => {
      signalStarted();
      await responseReady;
      return HttpResponse.json({ detail: 'Invalid token.' }, { status: 401 });
    }));

    const pending = sendRequest().catch((err) => err);
    await started;
    setToken(null);
    releaseResponse();
    expect(await pending).toBeInstanceOf(Error);

    expect(getToken()).toBe('');
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('coalesces concurrent 401s into a single reload (audit L5)', async () => {
    setToken('stale-token');
    server.use(
      http.get('*/api/dashboard/', () =>
        HttpResponse.json({ detail: 'Invalid token.' }, { status: 401 }),
      ),
    );

    // Fire three parallel requests that all 401 on the same stale token.
    // Pre-fix each one called window.location.reload() independently.
    await Promise.allSettled([
      api.get('/dashboard/'),
      api.get('/dashboard/'),
      api.get('/dashboard/'),
    ]);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('abby_auth_token')).toBeNull();
  });
});
