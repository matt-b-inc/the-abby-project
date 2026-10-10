import { lazy, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import JournalShell from './JournalShell.jsx';
import { AuthProvider } from '../../hooks/useApi.js';
import { server } from '../../test/server.js';
import { buildUser } from '../../test/factories.js';
import { STORAGE_KEYS } from '../../constants/storage.js';
import MockPulse from '../../test/pulse.jsx';
import { emptyPulse } from '../../test/pulseFixtures.js';
import ChronicleHub from '../../pages/chronicle';

function renderShell({ route = '/', element }) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <Routes>
          <Route element={<JournalShell />}>
            <Route path="/" element={element || <div>home</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('JournalShell', () => {
  it('renders nav + outlet content', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
    );
    renderShell({ element: <div>page-body</div> });
    await waitFor(() => expect(screen.getByText('page-body')).toBeInTheDocument());
    // Chapter sidebar labels are rendered regardless of auth state.
    expect(screen.getAllByText('Today').length).toBeGreaterThan(0);
    // No offline banner on a live-auth boot.
    expect(screen.queryByText(/offline — showing your last journal/i)).toBeNull();
  });

  it('hydrates from the cached user and shows the offline banner when boot getMe network-errors', async () => {
    const cached = buildUser({ display_name: 'Cached Abby' });
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'tok-123');
    localStorage.setItem(STORAGE_KEYS.CACHED_USER, JSON.stringify(cached));
    // HttpResponse.error() rejects the fetch itself (no .status on the
    // thrown error) — the flaky-wifi shape, not an HTTP 401.
    server.use(http.get('*/api/auth/me/', () => HttpResponse.error()));

    renderShell({ element: <div>page-body</div> });

    const banner = await screen.findByText('Offline — showing your last journal');
    expect(banner).toHaveAttribute('role', 'status');
    // The shell rendered the cached identity (AvatarMenu shows the cached
    // display name), proving the session hydrated instead of logging out.
    await waitFor(() =>
      expect(screen.getAllByText('Cached Abby').length).toBeGreaterThan(0),
    );
  });

  it('renders one journal after a phone reply notification navigates from another lazy route', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    let resolveChronicle;
    const LazyChronicle = lazy(() => new Promise((resolve) => {
      resolveChronicle = () => resolve({ default: ChronicleHub });
    }));
    const originalUrl = window.location.pathname + window.location.search;
    window.history.replaceState({}, '', '/settings');
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      http.get('*/api/chronicle/summary/', () => HttpResponse.json({ chapters: [
        { chapter_year: 2025, label: 'This year', entries: [
          { id: 23, user: 1, kind: 'journal', is_private: false, title: 'Our afternoon', summary: 'A memory to revisit', occurred_on: '2026-10-09' },
        ] },
      ] })),
    );
    const pulse = emptyPulse({ notifications: [
      { id: 7, notification_type: 'journal_reply', title: 'Dad responded to your memory', is_read: true, link: '/chronicle?tab=journal', created_at: '2026-10-09T15:00:00Z' },
    ] });
    const user = userEvent.setup();
    const view = render(
      <StrictMode>
        <BrowserRouter>
          <AuthProvider>
            <MockPulse pulse={pulse}>
              <Routes>
                <Route element={<JournalShell />}>
                  <Route path="/settings" element={<p>Settings route</p>} />
                  <Route path="/chronicle" element={<LazyChronicle />} />
                </Route>
              </Routes>
            </MockPulse>
          </AuthProvider>
        </BrowserRouter>
      </StrictMode>,
    );
    try {
      await user.click(screen.getByRole('button', { name: 'Notifications' }));
      const sheet = await screen.findByRole('dialog', { name: 'Notifications' });
      await user.click(within(sheet).getByText('Dad responded to your memory'));
      await waitFor(() => expect(resolveChronicle).toBeTypeOf('function'));
      await act(async () => { resolveChronicle(); });
      await screen.findByText('A memory to revisit');
      expect(window.location.pathname + window.location.search).toBe('/chronicle?tab=journal');
      expect(screen.getAllByRole('tablist', { name: 'Chronicle sections' })).toHaveLength(1);
      expect(screen.getAllByRole('heading', { name: 'Our afternoon' })).toHaveLength(1);
      expect(document.querySelectorAll('#journal-entry-23-title')).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Family responses' })).toHaveLength(1);
    } finally {
      view.unmount();
      await act(async () => { await Promise.resolve(); });
      window.history.replaceState({}, '', originalUrl);
      scrollTo.mockRestore();
    }
  });
});
