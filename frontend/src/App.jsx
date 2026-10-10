import * as Sentry from '@sentry/react';
import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useApi';
import { applyTheme } from './themes';
import { getPendingCelebration, getPendingCelebrationNotification } from './api';
import BirthdayCelebrationModal from './components/BirthdayCelebrationModal';
import CelebrationModal from './components/CelebrationModal';
import { SpriteCatalogProvider } from './providers/SpriteCatalogProvider';
import { PulseProvider } from './providers/PulseProvider';
import SuccessToastProvider from './components/SuccessToast';
import JournalShell from './components/layout/JournalShell';
import { PwaStatusProvider } from './pwa/PwaStatusProvider';
import { InstallPromptProvider } from './pwa/useInstallPrompt';
import UpdateBanner from './pwa/UpdateBanner';
import OfflineReadyToast from './pwa/OfflineReadyToast';
import RouteAnnouncer from './components/RouteAnnouncer';
import ScrollToTop from './components/ScrollToTop';
// Landing views stay eager: Login/Signup are the first paint for logged-out
// users and Dashboard is the first paint for logged-in ones — lazy-loading
// them would just add a skeleton flash to every cold start.
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Loader from './components/Loader';

// Everything else code-splits into per-page chunks (React.lazy + the
// Suspense boundary around JournalShell's Outlet). Keeps the entry chunk
// small on phones and means a deploy only re-downloads the chunks that
// actually changed instead of one monolithic bundle.
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const ProjectNew = lazy(() => import('./pages/ProjectNew'));
const ProjectIngest = lazy(() => import('./pages/ProjectIngest'));
const ClockPage = lazy(() => import('./pages/ClockPage'));
const Manage = lazy(() => import('./pages/Manage'));
const CodexPage = lazy(() => import('./pages/CodexPage'));
const ActivityPage = lazy(() => import('./pages/activity/ActivityPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const QuestsHub = lazy(() => import('./pages/quests'));
const BestiaryHub = lazy(() => import('./pages/bestiary'));
const Character = lazy(() => import('./pages/Character'));
const TreasuryHub = lazy(() => import('./pages/treasury'));
const AtlasHub = lazy(() => import('./pages/atlas'));
const ChronicleHub = lazy(() => import('./pages/chronicle'));
const Meadow = lazy(() => import('./pages/meadow'));
// Dev-only showcase — lazy also drops it from the production entry chunk.
const DesignShowcase = lazy(() => import('./pages/__design'));

function ErrorFallback({ error, resetError }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center parchment-bg p-8 gap-4">
      <h1 className="font-display text-2xl text-ember-deep italic">Ink spilled.</h1>
      <p className="font-body text-ink-secondary text-sm max-w-sm text-center">
        {error?.message || 'An unexpected error occurred while rendering this page.'}
      </p>
      <button
        onClick={resetError}
        className="px-4 py-2 bg-sheikah-teal-deep text-ink-page-rune-glow rounded-lg font-medium hover:bg-sheikah-teal transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Legacy route → new hub (with tab query) redirector. Any bookmark or
 * external link to the old flat routes keeps working.
 */
function LegacyRedirect({ to }) {
  return <Navigate to={to} replace />;
}

/**
 * Like LegacyRedirect but carries the current location's search string
 * through to the destination — needed for /trials?scroll=<itemId>, where
 * QuickActions' "Start a quest with a scroll" deep-link relies on the
 * scroll param surviving the redirect to /quests?tab=trials.
 */
function TrialsLegacyRedirect() {
  const { search } = useLocation();
  // Merge ?scroll=… onto the destination's existing ?tab=trials.
  const params = new URLSearchParams(search);
  params.set('tab', 'trials');
  return <Navigate to={`/quests?${params.toString()}`} replace />;
}

export default function App() {
  const { user, loading, login, signup } = useAuth();
  const [celebration, setCelebration] = useState(null);
  const [celebrationNotice, setCelebrationNotice] = useState(null);

  useEffect(() => {
    if (user?.theme) applyTheme(user.theme);
    else applyTheme('hyrule');
  }, [user?.theme]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getPendingCelebration()
      .then((res) => {
        if (cancelled) return;
        if (res && typeof res === 'object' && res.id) {
          setCelebration(res);
        }
      })
      .catch(() => {
        // 204 / unauthenticated / network — treat as nothing pending.
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Streak / Perfect Day reveal — shown only after any pending birthday
  // is dismissed so the two never compete for attention on the same load.
  useEffect(() => {
    if (!user) return;
    if (celebration) return;
    let cancelled = false;
    getPendingCelebrationNotification()
      .then((res) => {
        if (cancelled) return;
        if (res && typeof res === 'object' && res.id) {
          setCelebrationNotice(res);
        }
      })
      .catch(() => {
        // 204 / network — nothing pending.
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, celebration]);

  // Dev-only design showcase route bypasses auth so primitives can be QA'd
  // without a running backend. Matches the path before any other routing.
  if (typeof window !== 'undefined' && window.location.pathname === '/__design') {
    return (
      <Sentry.ErrorBoundary fallback={ErrorFallback} showDialog={false}>
        <Suspense
          fallback={(
            <div className="min-h-dvh flex items-center justify-center parchment-bg">
              <Loader />
            </div>
          )}
        >
          <DesignShowcase />
        </Suspense>
      </Sentry.ErrorBoundary>
    );
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center parchment-bg">
        <Loader />
      </div>
    );
  }

  if (!user) {
    // Public routes: signup + login. Any other path falls back to Login so
    // bookmarks of authenticated routes still surface the sign-in form.
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/signup" element={<Signup onSignup={signup} />} />
          <Route path="*" element={<Login onLogin={login} />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <Sentry.ErrorBoundary fallback={ErrorFallback} showDialog={false}>
      <InstallPromptProvider>
        <PwaStatusProvider>
          <UpdateBanner />
        {celebration && (
          <BirthdayCelebrationModal
            entry={celebration}
            onDismiss={() => setCelebration(null)}
          />
        )}
        {!celebration && celebrationNotice && (
          <CelebrationModal
            notification={celebrationNotice}
            onDismiss={() => setCelebrationNotice(null)}
          />
        )}
        <SuccessToastProvider>
        <SpriteCatalogProvider>
        {/* One heartbeat for every background signal — see PulseProvider.
            Mounted inside the authed branch so it never polls a logged-out
            shell. */}
        <PulseProvider>
          <BrowserRouter>
            <RouteAnnouncer />
            <ScrollToTop />
            <Routes>
            <Route element={<JournalShell />}>
              {/* Chapter I — Today */}
              <Route path="/" element={<Dashboard />} />
              <Route path="/meadow" element={<Meadow />} />

              {/* Chapter II — Quests (+ deep-link sub-routes for Projects) */}
              <Route path="/quests" element={<QuestsHub />} />
              <Route path="/quests/ventures/new" element={<ProjectNew />} />
              <Route path="/quests/ventures/ingest" element={<ProjectIngest />} />
              <Route path="/quests/ventures/:id" element={<ProjectDetail />} />

              {/* Trials lives inside the Quests hub now (6th tab). Keep
                  /trials as a redirect so external links, the
                  HeaderProgressBand, QuickActions, the HeroPrimaryCard,
                  notification routes, and the Sigil Adventures card all
                  keep working — TrialsLegacyRedirect preserves the
                  ?scroll=<itemId> deep-link param. */}
              <Route path="/trials" element={<TrialsLegacyRedirect />} />

              {/* Chapter III — Bestiary */}
              <Route path="/bestiary" element={<BestiaryHub />} />

              {/* Sigil — the user's character/identity page, surfaced via the avatar menu */}
              <Route path="/sigil" element={<Character />} />

              {/* Chapter IV — Treasury */}
              <Route path="/treasury" element={<TreasuryHub />} />

              {/* Chapter V — Atlas */}
              <Route path="/atlas" element={<AtlasHub />} />

              {/* Chapter VI — Chronicle (memoir: Sketchbook · Journal · Yearbook) */}
              <Route path="/chronicle" element={<ChronicleHub />} />

              {/* Utility */}
              <Route path="/clock" element={<ClockPage />} />
              <Route path="/manage" element={<Manage />} />
              <Route path="/codex" element={<CodexPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/settings" element={<SettingsPage />} />

              {/* Authed users hitting public auth routes bounce home. */}
              <Route path="/signup" element={<LegacyRedirect to="/" />} />
              <Route path="/login" element={<LegacyRedirect to="/" />} />

              {/* Legacy route redirects — keep old bookmarks working */}
              <Route path="/projects" element={<LegacyRedirect to="/quests?tab=ventures" />} />
              <Route path="/projects/new" element={<LegacyRedirect to="/quests/ventures/new" />} />
              <Route path="/projects/ingest" element={<LegacyRedirect to="/quests/ventures/ingest" />} />
              <Route path="/projects/:id" element={<LegacyRedirectWithId />} />
              <Route path="/chores" element={<LegacyRedirect to="/quests?tab=duties" />} />
              <Route path="/homework" element={<LegacyRedirect to="/quests?tab=study" />} />
              <Route path="/habits" element={<LegacyRedirect to="/quests?tab=rituals" />} />
              <Route path="/quests/trials" element={<LegacyRedirect to="/quests?tab=trials" />} />
              <Route path="/inventory" element={<LegacyRedirect to="/treasury?tab=satchel" />} />
              <Route path="/stable" element={<LegacyRedirect to="/bestiary?tab=companions" />} />
              <Route path="/character" element={<LegacyRedirect to="/sigil" />} />
              <Route path="/payments" element={<LegacyRedirect to="/treasury?tab=coffers" />} />
              <Route path="/timecards" element={<LegacyRedirect to="/treasury?tab=wages" />} />
              <Route path="/rewards" element={<LegacyRedirect to="/treasury?tab=bazaar" />} />
              <Route path="/achievements" element={<LegacyRedirect to="/atlas?tab=skills" />} />
              <Route path="/portfolio" element={<LegacyRedirect to="/chronicle?tab=sketchbook" />} />
              <Route path="/lorebook" element={<LegacyRedirect to="/atlas?tab=lorebook" />} />
              <Route path="/yearbook" element={<LegacyRedirect to="/chronicle?tab=yearbook" />} />

              {/* Catch-all — a stale bookmark, a notification whose backend
                  `link` points at a renamed route, or a typo used to render
                  null: no shell, no nav, just the page background. The
                  installed PWA has no URL bar to correct that with, so an
                  unknown path lands on Today instead of stranding the kid on
                  a blank screen. Logged-out users already had this via the
                  Login fallback above. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
            </Routes>
          </BrowserRouter>
          <OfflineReadyToast />
        </PulseProvider>
        </SpriteCatalogProvider>
        </SuccessToastProvider>
        </PwaStatusProvider>
      </InstallPromptProvider>
    </Sentry.ErrorBoundary>
  );
}

// Special-case /projects/:id → /quests/ventures/:id (needs useParams).
function LegacyRedirectWithId() {
  const { id } = useParams();
  return <Navigate to={`/quests/ventures/${id}`} replace />;
}
