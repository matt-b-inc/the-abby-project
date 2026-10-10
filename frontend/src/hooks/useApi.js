import * as Sentry from '@sentry/react';
import {
  createContext, createElement, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import {
  getMe, login as apiLogin, logout as apiLogout, signup as apiSignup,
} from '../api';
import { getToken, setToken, OFFLINE_MESSAGE } from '../api/client';
import { STORAGE_KEYS } from '../constants/storage';

// A fetch that never reaches the server rejects with browser-internal text —
// "Failed to fetch" in Chrome, the even more cryptic "Load failed" in Safari —
// which used to render verbatim inside ErrorAlert on every page a kid opened
// without signal. api/client.js now translates that at the wrapper, so every
// call site benefits, not just the ones going through useApi; the wording is
// re-exported here because callers already import it from this module.
export { OFFLINE_MESSAGE };

export function isNetworkError(err) {
  if (!err || err.status !== undefined) return false;
  // `offline` is stamped by api/client.js; the TypeError / navigator checks
  // still catch a rejection raised outside that wrapper.
  if (err.offline === true) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return err.name === 'TypeError';
}

/**
 * Kid-readable text for a rejected API call. Network failures become
 * OFFLINE_MESSAGE; everything else keeps the server's own message, which is
 * already written for humans. Exported so mutation call sites (which catch
 * their own errors rather than going through useApi) can share the wording.
 */
export function friendlyErrorMessage(err) {
  if (isNetworkError(err)) return OFFLINE_MESSAGE;
  return err?.message || 'Something went wrong.';
}

export function useApi(apiFn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Unmount guard + per-request AbortController. Without these, a fetch
  // that resolves after the caller has navigated away still calls setState
  // on the gone component and races with the next page's own fetches —
  // which is how transient errors silently left the content area blank.
  const mountedRef = useRef(true);
  const controllerRef = useRef(null);
  // Nearly every call site gates a full-page Loader/skeleton on `loading`, so
  // it has to mean "nothing to show yet" rather than "a request is in flight".
  // A reload() after an action keeps the rendered page mounted and raises
  // `refreshing` instead — otherwise every habit tap, step toggle and pet feed
  // unmounted the page it was fired from and threw away scroll position.
  const dataRef = useRef(null);

  // ``deps`` is dynamic — callers pass an array literal that changes per
  // call site, so this hook intentionally trusts them rather than statically
  // verifying. ``apiFn`` is captured by closure on each render and re-bound
  // when ``deps`` changes; including it would re-fetch on every render.
  const load = useCallback(async () => {
    // Abort any prior in-flight request before starting a new one
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (dataRef.current === null) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      // Pass the signal through — endpoint functions that opt in can abort;
      // those that ignore the argument are unaffected.
      const result = await apiFn(controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      dataRef.current = result;
      setData(result);
      // A caller refreshing after a save may need the confirmed response.
      // Return only a current, mounted result; older loads stay fenced above.
      return result;
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (err?.name === 'AbortError') return;
      setError(friendlyErrorMessage(err));
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [load]);

  // Optimistic writes have to move dataRef too, or a reload() straight after
  // one would read the ref as empty and re-raise the full-page loader.
  const setDataTracked = useCallback((next) => {
    setData((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      dataRef.current = value;
      return value;
    });
  }, []);

  return {
    data, loading, refreshing, error, reload: load, setData: setDataTracked,
  };
}

// --- Auth context ----------------------------------------------------------
// Single source of truth for the logged-in user. Wrap the app in
// <AuthProvider> and every useAuth() / useRole() call reads the same state,
// so logout propagates globally and /api/users/me is fetched once per session.

const AuthContext = createContext(null);

// Best-effort read/write of the last-known-good /auth/me/ payload. Both
// swallow storage errors (private mode, quota, corrupt JSON) — the cache is
// a convenience for the offline-hydrate path, never a hard dependency.
function readCachedUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CACHED_USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(u) {
  try {
    if (u) {
      localStorage.setItem(STORAGE_KEYS.CACHED_USER, JSON.stringify(u));
    } else {
      localStorage.removeItem(STORAGE_KEYS.CACHED_USER);
    }
  } catch {
    // best-effort — ignore storage failures
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True only when the session was hydrated from the CACHED_USER snapshot
  // because boot-time getMe() failed with a network error. Cleared by any
  // successful live auth (boot fetch, login, signup) and by logout.
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // Another same-origin tab (including /play/) shares the credential.
    // Reload so rendered user/role and in-flight page data cannot stay on
    // the old account while new requests use the replacement credential.
    const onStorage = (event) => {
      if (event.storageArea !== localStorage) return;
      if (event.key !== null && event.key !== STORAGE_KEYS.AUTH_TOKEN) return;
      if (event.key !== null && event.oldValue === event.newValue) return;
      writeCachedUser(null);
      window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    // Handle token from Google OAuth callback redirect
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get('token');
    if (oauthToken) {
      setToken(oauthToken);
      // Clean the URL so the token isn't visible / bookmarkable
      window.history.replaceState({}, '', window.location.pathname);
    }

    const token = getToken();
    getMe()
      .then((u) => {
        // A storage change or logout may have replaced this boot session
        // before /me/ finished. Do not cache the previous account again.
        if (getToken() !== token) return;
        setUser(u);
        setOffline(false);
        writeCachedUser(u);
        Sentry.setUser(u ? { id: u.id, username: u.username, role: u.role } : null);
      })
      .catch((err) => {
        if (getToken() !== token) return;
        // Distinguish "the server said no" from "we never reached the
        // server". api/client.js attaches ``.status`` to every HTTP error,
        // so a rejection WITHOUT one is a fetch/network failure — e.g. the
        // service worker served the app shell but the wifi is out. In that
        // case a kid with a perfectly valid token should land on their
        // journal (hydrated from the last-known-good snapshot), not the
        // Login form. HTTP rejections (401 invalid token, etc.) keep the
        // logged-out path.
        const cached = err?.status === undefined && getToken()
          ? readCachedUser()
          : null;
        if (cached) {
          setUser(cached);
          setOffline(true);
          Sentry.setUser({ id: cached.id, username: cached.username, role: cached.role });
        } else {
          setUser(null);
          Sentry.setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const u = await apiLogin(username, password);
    setUser(u);
    setOffline(false);
    writeCachedUser(u);
    Sentry.setUser(u ? { id: u.id, username: u.username, role: u.role } : null);
    return u;
  }, []);

  const signup = useCallback(async (payload) => {
    // apiSignup returns { token, user, family }; the user object has the
    // family nested under user.family, so we drop the separate family
    // field on the floor and just hydrate user state.
    const data = await apiSignup(payload);
    const u = data?.user || null;
    setUser(u);
    setOffline(false);
    writeCachedUser(u);
    Sentry.setUser(u ? { id: u.id, username: u.username, role: u.role } : null);
    return u;
  }, []);

  const logout = useCallback(async () => {
    const token = getToken();
    try {
      await apiLogout();
    } finally {
      // Even if the logout POST fails (offline), drop all local session
      // state unless a newer sign-in replaced the session during the POST.
      // apiLogout's own finally conditionally clears the original token.
      const currentToken = getToken();
      if (!currentToken || currentToken === token) {
        writeCachedUser(null);
        setUser(null);
        setOffline(false);
        Sentry.setUser(null);
      }
    }
  }, []);

  const value = { user, loading, offline, login, signup, logout, setUser };
  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
