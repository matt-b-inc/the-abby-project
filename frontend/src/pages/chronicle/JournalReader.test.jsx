import { describe, expect, it, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import JournalReader from './JournalReader.jsx';
import { AuthProvider } from '../../hooks/useApi.js';
import { server } from '../../test/server.js';
import { spyHandler } from '../../test/spy.js';
import { buildUser, buildParent } from '../../test/factories.js';

vi.mock('framer-motion', async () => {
  const a = await vi.importActual('framer-motion');
  return { ...a, AnimatePresence: ({ children }) => children };
});

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView — the chapter-year shelf calls
  // it whenever activeId changes.
  Element.prototype.scrollIntoView = vi.fn();
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

function summaryPayload(entries) {
  // Wrap entries in a single-chapter summary (the shape Yearbook reads).
  return {
    chapters: [
      { chapter_year: 2025, label: 'Chapter 2025–26', is_current: true, stats: {}, entries },
    ],
    current_chapter_year: 2025,
  };
}

function renderReader() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <JournalReader />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('JournalReader — child view', () => {
  it('renders existing journal entries newest-first and skips other kinds', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      http.get('*/api/chronicle/summary/', () =>
        HttpResponse.json(summaryPayload([
          { id: 10, kind: 'journal',  occurred_on: '2026-04-10', title: 'Earlier',  summary: 'older entry', is_private: true },
          { id: 11, kind: 'birthday', occurred_on: '2026-04-15', title: 'Birthday', summary: '', is_private: false },
          { id: 12, kind: 'journal',  occurred_on: '2026-04-20', title: 'Today',    summary: 'newer entry', is_private: true },
        ])),
      ),
    );

    renderReader();

    await waitFor(() => expect(screen.getByText('Today')).toBeInTheDocument());
    expect(screen.getByText('Earlier')).toBeInTheDocument();
    expect(screen.queryByText('Birthday')).toBeNull();

    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles.indexOf('Today')).toBeLessThan(titles.indexOf('Earlier'));
  });

  it('identifies a private journal as Only you', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      http.get('*/api/chronicle/summary/', () =>
        HttpResponse.json(summaryPayload([
          { id: 1, kind: 'journal', occurred_on: '2026-04-10', title: 'Mine', summary: 'secret words', is_private: true },
        ])),
      ),
    );

    renderReader();

    await waitFor(() => expect(screen.getByText('Mine')).toBeInTheDocument());
    expect(screen.getByText('Only you')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /family responses/i })).toBeNull();
  });

  it('lets the child read and respond to family encouragement on a shared entry', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      http.get('*/api/chronicle/summary/', () => HttpResponse.json(summaryPayload([
        { id: 23, user: 1, kind: 'journal', occurred_on: '2026-04-10', title: 'My afternoon', summary: 'I made something.', is_private: false },
      ]))),
      http.get('*/api/chronicle/entries/23/comments/', () => HttpResponse.json([
        { id: 5, author: 99, author_name: 'Dad', body: 'What did you make?', created_at: '2026-04-10T16:00:00Z' },
      ])),
      http.post('*/api/chronicle/entries/23/comments/', async ({ request }) => {
        const payload = await request.json();
        return HttpResponse.json({ id: 6, author: 1, author_name: 'Abby', body: payload.body, created_at: '2026-04-10T17:00:00Z' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: 'Family responses' }));
    expect(await screen.findByText('What did you make?')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Your family response' }), 'A birthday card!');
    await user.click(screen.getByRole('button', { name: 'Send response' }));
    expect(await screen.findByText('A birthday card!')).toBeInTheDocument();
    expect(screen.getByText('Abby (you)')).toBeInTheDocument();
  });

  it('renders a chapter-year shelf when entries span multiple chapters', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      http.get('*/api/chronicle/summary/', () =>
        HttpResponse.json({
          chapters: [
            {
              chapter_year: 2024,
              label: 'Grade 8',
              is_current: false,
              stats: {},
              entries: [
                { id: 1, kind: 'journal', occurred_on: '2024-09-10', title: 'Year-before', summary: 'last-year body', is_private: true },
              ],
            },
            {
              chapter_year: 2025,
              label: 'Freshman Year',
              is_current: true,
              stats: {},
              entries: [
                { id: 2, kind: 'journal', occurred_on: '2026-04-10', title: 'This-year', summary: 'current body', is_private: true },
              ],
            },
          ],
          current_chapter_year: 2025,
        }),
      ),
    );

    const user = userEvent.setup();
    renderReader();

    // The shelf renders with one tab per chapter, default-active = current.
    await waitFor(() =>
      expect(screen.getByRole('tablist', { name: /journal chapters/i })).toBeInTheDocument(),
    );
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('This-year')).toBeInTheDocument();
    expect(screen.queryByText('Year-before')).toBeNull();

    // Switching the spine swaps which chapter's entries are rendered.
    await user.click(screen.getByRole('tab', { name: /Grade 8/i }));
    expect(screen.getByText('Year-before')).toBeInTheDocument();
    expect(screen.queryByText('This-year')).toBeNull();
  });

  it('renders empty-state when child has no entries yet', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      http.get('*/api/chronicle/summary/', () => HttpResponse.json(summaryPayload([]))),
    );

    renderReader();

    await waitFor(() => expect(screen.getByText(/no entries yet/i)).toBeInTheDocument());
    expect(screen.getByText(/Write your first entry above/i)).toBeInTheDocument();
  });

  it('shows "Write today’s entry" when no entry exists, and POSTs the body', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      http.get('*/api/chronicle/summary/', () => HttpResponse.json(summaryPayload([]))),
      http.get('*/api/chronicle/journal/today/', () => new HttpResponse(null, { status: 204 })),
    );
    const create = spyHandler('post', /\/api\/chronicle\/journal\/$/, {
      id: 99, kind: 'journal', is_private: true, title: 'Hello', summary: 'world',
    });
    server.use(create.handler);

    const user = userEvent.setup();
    renderReader();

    const writeBtn = await screen.findByRole('button', { name: /write today’s entry/i });
    await user.click(writeBtn);

    // BottomSheet portals into document.body — query off body.
    const dialog = await within(document.body).findByRole('dialog', {
      name: /write in your journal/i,
    });
    await user.type(within(dialog).getByLabelText(/title/i), 'Hello');
    await user.type(within(dialog).getByLabelText(/what's on your mind/i), 'world');
    await user.click(within(dialog).getByRole('button', { name: /save entry/i }));

    await waitFor(() => expect(create.calls).toHaveLength(1));
    expect(create.calls[0].body).toMatchObject({ title: 'Hello', summary: 'world', is_private: true });
    expect(create.calls[0].body.client_entry_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(create.calls[0].url).toMatch(/\/chronicle\/journal\/$/);
  });

  it('shows "Edit today’s entry" when today\'s entry already exists', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      http.get('*/api/chronicle/summary/', () => HttpResponse.json(summaryPayload([]))),
      http.get('*/api/chronicle/journal/today/', () =>
        HttpResponse.json({
          id: 50, kind: 'journal', is_private: true, title: 'A title', summary: 'a body',
        }),
      ),
    );

    renderReader();

    expect(await screen.findByRole('button', { name: /edit today’s entry/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write today’s entry/i })).toBeNull();
  });
});

describe('JournalReader — parent view', () => {
  it('renders the child picker and never shows the write button', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
      http.get('*/api/children/', () =>
        HttpResponse.json([{ id: 7, first_name: 'Abby', username: 'abby' }]),
      ),
      http.get('*/api/chronicle/summary/', () =>
        HttpResponse.json(summaryPayload([
          { id: 1, user: 7, kind: 'journal', occurred_on: '2026-04-10', title: 'Hers', summary: 'shared words', is_private: false },
        ])),
      ),
    );

    renderReader();

    await waitFor(() => expect(screen.getByText('Hers')).toBeInTheDocument());
    expect(screen.getByLabelText(/reading/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write today’s entry/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit today’s entry/i })).toBeNull();
    expect(screen.getByText('Shared with family')).toBeInTheDocument();
  });

  it('omits private journals even if an old summary includes one', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
      http.get('*/api/children/', () => HttpResponse.json([{ id: 7, first_name: 'Abby' }])),
      http.get('*/api/chronicle/summary/', () => HttpResponse.json(summaryPayload([
        { id: 1, user: 7, kind: 'journal', title: 'Only mine', summary: 'Private words', is_private: true },
      ]))),
    );
    renderReader();
    await screen.findByText('No entries yet');
    expect(screen.queryByText('Private words')).toBeNull();
    expect(screen.queryByRole('button', { name: /family responses/i })).toBeNull();
  });

  it('unmounts the previous child conversation immediately when changing the reader', async () => {
    let finishSecond;
    const secondReady = new Promise((resolve) => { finishSecond = resolve; });
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
      http.get('*/api/children/', () => HttpResponse.json([{ id: 7, first_name: 'Abby' }, { id: 8, first_name: 'Max' }])),
      http.get('*/api/chronicle/summary/', async ({ request }) => {
        const child = new URL(request.url).searchParams.get('user_id');
        if (child === '8') {
          await secondReady;
          return HttpResponse.json(summaryPayload([]));
        }
        return HttpResponse.json(summaryPayload([
          { id: 23, user: 7, kind: 'journal', title: 'Abby shared', summary: 'Her afternoon', is_private: false },
        ]));
      }),
      http.get('*/api/chronicle/entries/23/comments/', () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderReader();
    await user.click(await screen.findByRole('button', { name: 'Family responses' }));
    await screen.findByRole('textbox', { name: 'Your family response' });
    await user.selectOptions(screen.getByLabelText('Reading'), '8');
    expect(screen.queryByText('Abby shared')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Your family response' })).toBeNull();
    finishSecond();
    await screen.findByText('No entries yet');
  });

  // The parent may have picked any child, so the empty state can't assume a
  // daughter — this app hosts many households now.
  it('uses pronoun-neutral copy in the parent empty state', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
      http.get('*/api/children/', () =>
        HttpResponse.json([{ id: 7, first_name: 'Max', username: 'max' }]),
      ),
      http.get('*/api/chronicle/summary/', () => HttpResponse.json(summaryPayload([]))),
    );

    renderReader();

    await waitFor(() =>
      expect(screen.getByText(/when they share a journal entry with the family/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/when she writes her first/i)).toBeNull();
  });

  it('renders no-children empty-state when parent has no children', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
      http.get('*/api/children/', () => HttpResponse.json([])),
    );

    renderReader();

    await waitFor(() => expect(screen.getByText(/no children yet/i)).toBeInTheDocument());
  });
});
