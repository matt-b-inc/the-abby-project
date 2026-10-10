import { Suspense } from 'react';
import { useOutlet } from 'react-router-dom';
import { ChapterSidebar, ChapterBottomBar } from './ChapterNav';
import ParchmentSkeleton from '../ParchmentSkeleton';
import QuickActionsFab from './QuickActionsFab';
import NotificationBell from '../NotificationBell';
import AvatarMenu from '../AvatarMenu';
import DropToastStack from '../DropToastStack';
import FirstEncounterSheet from '../lorebook/FirstEncounterSheet';
import SavingsToastStack from '../SavingsToastStack';
import ApprovalToastStack from '../ApprovalToastStack';
import QuestProgressToastStack from '../QuestProgressToastStack';
import CompanionGrowthToastStack from '../CompanionGrowthToastStack';
import ExpeditionToastStack from '../ExpeditionToastStack';
import PageTurnTransition from '../journal/PageTurnTransition';
import HeaderStatusPips from './HeaderStatusPips';
import HeaderProgressBand from './HeaderProgressBand';
import { useAuth } from '../../hooks/useApi';

/**
 * JournalShell — the Hyrule Field Notes outer layout.
 *
 *   ┌──────────────┬────────────────────────────────────────┐
 *   │              │  [avatar]  [status pips]   [🔔 bell]   │
 *   │  Chapter     │  ── HeaderProgressBand (quest) ──────  │
 *   │  Sidebar     │                                        │
 *   │  (desktop)   │   <Outlet />                           │
 *   └──────────────┴────────────────────────────────────────┘
 *   [Mobile: bottom ChapterBottomBar + QuickActionsFab bottom-right]
 */
export default function JournalShell() {
  const { user, logout, offline } = useAuth();
  // Capture the matched element for each transition. A retained <Outlet>
  // reads the live route context and would render the incoming page again
  // inside the outgoing page's animation, duplicating its IDs and controls.
  const outlet = useOutlet();

  return (
    <div className="flex min-h-dvh relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-sheikah-teal-deep focus:text-ink-page focus:rounded-lg focus:font-display focus:text-sm"
      >
        Skip to content
      </a>
      {/* Toasts sit in the thumb zone on phones — stacked ABOVE the FAB, not
          beside it — and return to the top-right corner at lg where the bottom
          bar doesn't exist. The 9.5rem anchor clears the whole FAB zone (nav
          + 6rem offset + ~3rem button), which the old 5.5rem/right-20 reserve
          did not once the FAB grows into a clocked-in timer pill; toasts were
          landing on top of the running timer and eating taps meant for it. */}
      <div
        className="fixed z-50 space-y-2 pointer-events-none
                   bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] left-4 right-4
                   lg:bottom-auto lg:left-auto lg:right-4 lg:top-[calc(env(safe-area-inset-top)+1rem)]
                   lg:w-80 lg:max-w-[calc(100vw-2rem)]"
        aria-live="polite"
        aria-atomic="false"
      >
        <DropToastStack inline />
        <SavingsToastStack inline />
        <CompanionGrowthToastStack inline />
        <ExpeditionToastStack inline />
        <ApprovalToastStack inline />
        <QuestProgressToastStack inline />
      </div>
      <FirstEncounterSheet />
      <ChapterSidebar user={user} onLogout={logout} />

      {/* The bottom padding clears the fixed ChapterBottomBar, which is
          min-h-16 PLUS the home-indicator inset — a flat pb-20 left the last
          ~18px of every page hidden behind the bar on notched iPhones. */}
      <main
        id="main-content"
        className="flex-1 ml-0 lg:ml-60 min-w-0
                   pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8"
      >
        {/* pt-[env(safe-area-inset-top)] keeps the header clear of the iOS
            status bar in the installed PWA (viewport-fit=cover draws the
            page under it); the parchment backdrop still extends beneath.
            The left/right insets matter in landscape, where the notch eats
            ~47px on the sensor-housing side. */}
        <div className="sticky top-0 z-30 bg-ink-page backdrop-blur-[2px] pt-[env(safe-area-inset-top)]">
          <header
            className="flex items-center gap-3 pt-3 lg:pt-4 pb-3 lg:pb-4
                       pl-[max(1rem,env(safe-area-inset-left))]
                       pr-[max(1rem,env(safe-area-inset-right))] lg:px-6"
          >
            {/* min-w-0 + a width cap (NOT shrink-0) so AvatarMenu's own
                truncate can fire — a long display name plus the family line
                used to squeeze the status pips, and the coin count, off the
                right edge at 360px. */}
            <div className="lg:hidden min-w-0 max-w-[38vw]">
              <AvatarMenu user={user} compact />
            </div>
            <div className="flex-1 min-w-0 flex justify-end lg:justify-center">
              <HeaderStatusPips user={user} />
            </div>
            <div className="shrink-0">
              <NotificationBell />
            </div>
          </header>

          <HeaderProgressBand />

          {/* Offline banner — shown when AuthProvider hydrated the session
              from the cached /auth/me/ snapshot because the network was
              unreachable at boot. Lives inside the sticky band so it stays
              visible while scrolling a stale page. */}
          {offline && (
            <div
              role="status"
              className="bg-ink-page-aged border-y border-ink-page-shadow px-4 lg:px-6 py-1.5 text-center font-body text-caption text-ink-secondary"
            >
              Offline — showing your last journal
            </div>
          )}
        </div>

        <div
          className="pt-3 lg:pt-6
                     pl-[max(1rem,env(safe-area-inset-left))]
                     pr-[max(1rem,env(safe-area-inset-right))] lg:px-6"
        >
          {/* Suspense boundary for the lazy page chunks (App.jsx). Sitting
              inside <main> keeps the sticky header + nav mounted while a
              chunk downloads; the parchment skeleton fills the content well
              so the page structure reads as "loading", not "blank". */}
          <Suspense
            fallback={(
              <div className="space-y-3">
                <ParchmentSkeleton variant="hero" />
                <ParchmentSkeleton variant="list" />
              </div>
            )}
          >
            <PageTurnTransition>
              {outlet}
            </PageTurnTransition>
          </Suspense>
        </div>
      </main>

      <ChapterBottomBar user={user} />
      <QuickActionsFab />
    </div>
  );
}
