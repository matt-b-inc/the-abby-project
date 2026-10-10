import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server.js';
import { buildUser } from '../test/factories.js';
import * as apiIndex from '../api/index.js';
import { setToken } from '../api/client.js';
import { STORAGE_KEYS } from '../constants/storage.js';
import {
  AuthProvider, OFFLINE_MESSAGE, useApi, useAuth,
} from './useApi.js';

describe('useApi', () => {
  it('starts in loading state, then resolves data', async () => {
    const fn = vi.fn().mockResolvedValue({ value: 42 });
    const { result } = renderHook(() => useApi(fn, []));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
  });

  it('surfaces error messages', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.data).toBeNull();
  });

  it('reload() re-invokes the fn', async () => {
    let call = 0;
    const fn = vi.fn(async () => ({ n: ++call }));
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    let confirmed;
    await act(async () => { confirmed = await result.current.reload(); });
    expect(result.current.data).toEqual({ n: 2 });
    expect(confirmed).toEqual({ n: 2 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Almost every page early-returns a full-page Loader/skeleton on `loading`,
  // so a reload() that raised it unmounted the page the action was fired from
  // — every habit tap and step toggle blanked the screen and lost scroll.
  it('reload() keeps loading false and holds the old data while re-fetching', async () => {
    let resolveSecond;
    let call = 0;
    const fn = vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ n: 1 });
      return new Promise((res) => { resolveSecond = () => res({ n: 2 }); });
    });
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    act(() => { result.current.reload(); });
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ n: 1 });

    await act(async () => { resolveSecond(); });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.data).toEqual({ n: 2 });
  });

  it('setData mutates locally without re-fetching', async () => {
    const fn = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.setData(99));
    expect(result.current.data).toBe(99);
  });

  it('setData accepts an updater and keeps reload() off the full-page loader', async () => {
    const fn = vi.fn().mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    act(() => result.current.setData((prev) => ({ n: prev.n + 1 })));
    expect(result.current.data).toEqual({ n: 2 });
    await act(async () => { await result.current.reload(); });
    expect(result.current.loading).toBe(false);
  });

  // A dead connection used to render the browser's own wording inside
  // ErrorAlert — "Failed to fetch" on Chrome, "Load failed" on Safari — on
  // every page a kid opened without signal.
  it('translates a network failure into kid-readable copy', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.error).toBe(OFFLINE_MESSAGE));
    expect(result.current.error).not.toMatch(/failed to fetch/i);
  });

  it('translates Safari\'s "Load failed" wording too', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Load failed'));
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.error).toBe(OFFLINE_MESSAGE));
  });

  // api/client.js attaches .status to every HTTP error; those messages come
  // from the server and are already written for humans, so they pass through.
  it('keeps server error messages verbatim', async () => {
    const err = new Error('You already logged that today.');
    err.status = 409;
    const fn = vi.fn().mockRejectedValue(err);
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.error).toBe('You already logged that today.'));
  });

  it('silently ignores AbortError', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    const fn = vi.fn().mockRejectedValue(err);
    const { result } = renderHook(() => useApi(fn, []));
    // Loading may still flip because the finally block doesn't run when
    // the signal is aborted — but the error must never surface.
    await waitFor(() => expect(result.current.error).toBeNull(), { timeout: 50 });
    expect(result.current.error).toBeNull();
  });

  it('re-fetches when deps change', async () => {
    const fn = vi.fn(async (_signal) => fn.mock.calls.length);
    let dep = 'a';
    const { result, rerender } = renderHook(() => useApi(fn, [dep]));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    dep = 'b';
    rerender();
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    // waitFor: the call-count assertion above passes the moment the second
    // fetch STARTS (loading just flipped back to true) — the resolved state
    // lands a microtask later, which loses the race under a loaded CI run.
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('aborts in-flight requests on unmount', async () => {
    let abortedSignal = null;
    const fn = vi.fn((signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        abortedSignal = signal;
        const err = new Error('abort');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const { unmount } = renderHook(() => useApi(fn, []));
    unmount();
    await waitFor(() => expect(abortedSignal?.aborted).toBe(true));
  });

  it('aborts a prior request when deps change before it completes', async () => {
    const signals = [];
    const fn = vi.fn((signal) => {
      signals.push(signal);
      return new Promise(() => {}); // never resolves
    });
    let dep = 'a';
    const { rerender } = renderHook(() => useApi(fn, [dep]));
    await waitFor(() => expect(signals).toHaveLength(1));
    dep = 'b';
    rerender();
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
  });
});

describe('AuthProvider + useAuth', () => {
  it('throws if used outside the provider', () => {
    // renderHook's wrapper defaults to a no-op; useAuth should throw inside
    // the hook body.
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
  });

  it('fetches the current user on mount', async () => {
    const user = buildUser();
    server.use(http.get('*/api/auth/me/', () => HttpResponse.json(user)));
    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual(user);
  });

  it('sets user to null when /me/ fails', async () => {
    server.use(
      http.get('*/api/auth/me/', () =>
        HttpResponse.json({ detail: 'nope' }, { status: 401 }),
      ),
    );
    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('stashes the user snapshot in localStorage on a successful boot fetch', async () => {
    const user = buildUser();
    server.use(http.get('*/api/auth/me/', () => HttpResponse.json(user)));
    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.offline).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CACHED_USER))).toEqual(user);
  });

  describe('offline boot hydration', () => {
    const cached = buildUser({ first_name: 'Cached' });

    it('hydrates from the cached user + flags offline when getMe network-errors and a token is present', async () => {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'tok-123');
      localStorage.setItem(STORAGE_KEYS.CACHED_USER, JSON.stringify(cached));
      // HttpResponse.error() = a fetch/network rejection — the thrown error
      // has no .status, unlike HTTP errors from api/client.js.
      server.use(http.get('*/api/auth/me/', () => HttpResponse.error()));
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.user).toEqual(cached);
      expect(result.current.offline).toBe(true);
    });

    it('does NOT hydrate on an HTTP rejection — a .status error keeps the logged-out path', async () => {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'tok-123');
      localStorage.setItem(STORAGE_KEYS.CACHED_USER, JSON.stringify(cached));
      // 403 (not 401) so the api client's 401 self-heal reload stays out of
      // the picture; any err.status must skip the cache.
      server.use(
        http.get('*/api/auth/me/', () =>
          HttpResponse.json({ detail: 'forbidden' }, { status: 403 }),
        ),
      );
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.user).toBeNull();
      expect(result.current.offline).toBe(false);
    });

    it('does NOT hydrate without an auth token, even on a network error', async () => {
      localStorage.setItem(STORAGE_KEYS.CACHED_USER, JSON.stringify(cached));
      server.use(http.get('*/api/auth/me/', () => HttpResponse.error()));
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.user).toBeNull();
      expect(result.current.offline).toBe(false);
    });
  });

  describe('login/logout callbacks', () => {
    let loginSpy;
    let logoutSpy;

    beforeEach(() => {
      loginSpy = vi.spyOn(apiIndex, 'login').mockResolvedValue(buildUser({ id: 7 }));
      logoutSpy = vi.spyOn(apiIndex, 'logout').mockResolvedValue();
    });

    afterEach(() => {
      loginSpy.mockRestore();
      logoutSpy.mockRestore();
    });

    it('login() updates user', async () => {
      server.use(
        http.get('*/api/auth/me/', () => HttpResponse.json(null, { status: 401 })),
      );
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result } = renderHook(() => useAuth(), { wrapper });
      // wait for boot
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => { await result.current.login('abby', 'x'); });
      expect(result.current.user).toEqual(buildUser({ id: 7 }));
      expect(loginSpy).toHaveBeenCalledWith('abby', 'x');
    });

    it('logout() clears user and the cached snapshot', async () => {
      server.use(
        http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      );
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.user).not.toBeNull());
      expect(localStorage.getItem(STORAGE_KEYS.CACHED_USER)).not.toBeNull();
      await act(async () => { await result.current.logout(); });
      expect(result.current.user).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.CACHED_USER)).toBeNull();
      expect(logoutSpy).toHaveBeenCalled();
    });

    it('a delayed logout does not clear a newer login or its cached user', async () => {
      setToken('old-session');
      server.use(http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())));
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      let finishLogout;
      logoutSpy.mockImplementationOnce(() => new Promise((resolve) => { finishLogout = resolve; }));
      const newerUser = buildUser({ id: 77, username: 'new-account' });
      loginSpy.mockImplementationOnce(async () => {
        setToken('new-session');
        return newerUser;
      });
      let pending;
      act(() => { pending = result.current.logout(); });
      await act(async () => { await result.current.login('new-account', 'synthetic-password'); });
      await act(async () => {
        finishLogout();
        await pending;
      });

      expect(result.current.user).toEqual(newerUser);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CACHED_USER))).toEqual(newerUser);
      expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('new-session');
    });
  });

  describe('shared browser session changes', () => {
    let originalLocation;
    let reloadSpy;

    beforeEach(() => {
      reloadSpy = vi.fn();
      originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
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
      setToken('old-session');
      server.use(http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())));
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    });

    it.each(['new-session', null])('reloads after another tab changes auth to %s', async (newToken) => {
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(localStorage.getItem(STORAGE_KEYS.CACHED_USER)).not.toBeNull();

      setToken(newToken);
      act(() => window.dispatchEvent(new StorageEvent('storage', {
        key: STORAGE_KEYS.AUTH_TOKEN,
        oldValue: 'old-session',
        newValue: newToken,
        storageArea: localStorage,
      })));

      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe(newToken);
      expect(localStorage.getItem(STORAGE_KEYS.CACHED_USER)).toBeNull();
    });

    it('reloads after another tab clears localStorage', async () => {
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      localStorage.clear();
      act(() => window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage })));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('does not repopulate the old user cache from a delayed boot response', async () => {
      let releaseResponse;
      let signalStarted;
      const started = new Promise((resolve) => { signalStarted = resolve; });
      const responseReady = new Promise((resolve) => { releaseResponse = resolve; });
      server.use(http.get('*/api/auth/me/', async () => {
        signalStarted();
        await responseReady;
        return HttpResponse.json(buildUser());
      }));
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result } = renderHook(() => useAuth(), { wrapper });
      await started;
      setToken('new-session');
      act(() => window.dispatchEvent(new StorageEvent('storage', {
        key: STORAGE_KEYS.AUTH_TOKEN, oldValue: 'old-session', newValue: 'new-session', storageArea: localStorage,
      })));
      await act(async () => { releaseResponse(); });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.user).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.CACHED_USER)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBe('new-session');
    });

    it('ignores unrelated, unchanged, or sessionStorage events and detaches on unmount', async () => {
      const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
      const { result, unmount } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      const cachedUser = localStorage.getItem(STORAGE_KEYS.CACHED_USER);
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: STORAGE_KEYS.CACHED_USER, oldValue: null, newValue: cachedUser, storageArea: localStorage,
        }));
        window.dispatchEvent(new StorageEvent('storage', {
          key: STORAGE_KEYS.AUTH_TOKEN, oldValue: 'old-session', newValue: 'old-session', storageArea: localStorage,
        }));
        window.dispatchEvent(new StorageEvent('storage', {
          key: STORAGE_KEYS.AUTH_TOKEN, oldValue: 'old-session', newValue: 'new-session', storageArea: sessionStorage,
        }));
      });
      expect(reloadSpy).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEYS.CACHED_USER)).toBe(cachedUser);

      unmount();
      window.dispatchEvent(new StorageEvent('storage', {
        key: STORAGE_KEYS.AUTH_TOKEN, oldValue: 'old-session', newValue: 'new-session', storageArea: localStorage,
      }));
      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });

  it('consumes ?token= from the URL and cleans history', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    // Seed the URL with a token query param. jsdom allows this via
    // window.history.pushState.
    window.history.pushState({}, '', '/?token=from-oauth');
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
    );
    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(localStorage.getItem('abby_auth_token')).toBe('from-oauth');
    expect(replaceState).toHaveBeenCalled();
    setToken(null);
    replaceState.mockRestore();
  });
});
