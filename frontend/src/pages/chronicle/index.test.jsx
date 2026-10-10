import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ChronicleHub from './index.jsx';
import { AuthProvider } from '../../hooks/useApi.js';
import { server } from '../../test/server.js';
import { buildUser } from '../../test/factories.js';

vi.mock('framer-motion', async () => {
  const a = await vi.importActual('framer-motion');
  return { ...a, AnimatePresence: ({ children }) => children };
});

function renderHub(initialEntries = ['/chronicle']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <ChronicleHub />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('ChronicleHub', () => {
  it('renders the Chronicle hub with the Sketchbook tab default', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
    );
    renderHub();
    // Hub no longer renders an h1; check the tablist aria-label instead.
    const tablist = await screen.findByRole('tablist', { name: /chronicle sections/i });
    expect(tablist).toHaveTextContent(/sketchbook/i);
    expect(tablist).toHaveTextContent(/journal/i);
    expect(tablist).toHaveTextContent(/grades/i);
    expect(tablist).toHaveTextContent(/yearbook/i);
  });

  it('switches tabs when clicked', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
    );
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('tablist');
    const journalTab = screen.getByRole('tab', { name: /journal/i });
    await user.click(journalTab);
    await waitFor(() => expect(journalTab).toHaveAttribute('aria-selected', 'true'));
  });

  it('honors ?tab=journal deep-link', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
    );
    renderHub(['/chronicle?tab=journal']);
    await screen.findByRole('tablist');
    const journalTab = screen.getByRole('tab', { name: /journal/i });
    expect(journalTab).toHaveAttribute('aria-selected', 'true');
  });

  it('honors the grades tab route and exposes child capture', async () => {
    server.use(http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())));
    renderHub(['/chronicle?tab=grades']);
    const tab = await screen.findByRole('tab', { name: 'Grades' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: 'Log a grade' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });
});
