import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, renderWithProviders, screen, userEvent, waitFor, within } from '../../test/render';
import { server } from '../../test/server';
import { spyHandler } from '../../test/spy';
import JournalEntryFormModal from './JournalEntryFormModal';
import { journalDraftKey } from './journalDraft';
import { buildUser } from '../../test/factories';
import * as journalApi from '../../api';

// Modal portals to document.body — query there, not the RTL container.
function getDialog() {
  return screen.getByRole('dialog', { name: /journal/i });
}

// Mock the speech hook so jsdom doesn't need a real SpeechRecognition
// global. Default: supported, never fires. Per-test overrides assign to
// `speech.current` before rendering.
const speech = vi.hoisted(() => ({ current: { supported: true }, onFinal: null }));
const role = vi.hoisted(() => ({ user: null }));
vi.mock('../../hooks/useRole.js', () => ({ useRole: () => ({ user: role.user }) }));
vi.mock('../../hooks/useSpeechDictation.js', () => ({
  useSpeechDictation: (options) => { speech.onFinal = options.onFinal; return speech.current; },
}));

beforeEach(() => {
  speech.current = { supported: true };
  speech.onFinal = null;
  role.user = buildUser();
});

// Stub AnimatePresence so close-on-submit renders synchronously.
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return { ...actual, AnimatePresence: ({ children }) => children };
});

describe('JournalEntryFormModal', () => {
  it('keeps every dictated chunk when multiple final results arrive together', async () => {
    renderWithProviders(<JournalEntryFormModal onClose={() => {}} />);
    await act(async () => { speech.onFinal('First '); speech.onFinal('second '); });
    expect(screen.getByLabelText(/mind/i)).toHaveValue('First second ');
    expect(JSON.parse(localStorage.getItem(journalDraftKey(role.user.id))).summary).toBe('First second ');
  });

  it('restores a device draft and its stable request ID after closing and reopening', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const view = renderWithProviders(<JournalEntryFormModal onClose={onClose} />);
    await user.type(screen.getByLabelText(/mind/i), 'A memory worth keeping');
    await user.click(screen.getByRole('checkbox', { name: /share with my family/i }));
    const first = JSON.parse(localStorage.getItem(journalDraftKey(role.user.id)));
    expect(screen.getByRole('status')).toHaveTextContent(/draft kept on this device/i);
    await user.click(screen.getByRole('button', { name: /keep draft & close/i }));
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    renderWithProviders(<JournalEntryFormModal onClose={() => {}} />);
    expect(screen.getByLabelText(/mind/i)).toHaveValue('A memory worth keeping');
    expect(screen.getByRole('checkbox', { name: /share with my family/i })).toBeChecked();
    await user.type(screen.getByLabelText(/title/i), 'My day');
    const restored = JSON.parse(localStorage.getItem(journalDraftKey(role.user.id)));
    expect(restored.client_entry_id).toBe(first.client_entry_id);
  });

  it('separates drafts when the current account changes', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<JournalEntryFormModal onClose={() => {}} />);
    await user.type(screen.getByLabelText(/mind/i), 'First child private words');
    role.user = buildUser({ id: 2 });
    view.rerender(<JournalEntryFormModal onClose={() => {}} />);
    expect(screen.getByLabelText(/mind/i)).toHaveValue('');
    await user.type(screen.getByLabelText(/mind/i), 'Second child words');
    expect(JSON.parse(localStorage.getItem(journalDraftKey(1))).summary).toBe('First child private words');
    expect(JSON.parse(localStorage.getItem(journalDraftKey(2))).summary).toBe('Second child words');
  });

  it('reconciles an interrupted save after reopening with the exact same request', async () => {
    const requests = [];
    server.use(http.post('*/api/chronicle/journal/', async ({ request }) => {
      const body = await request.json();
      requests.push(body);
      if (requests.length === 1) return HttpResponse.error();
      return HttpResponse.json({
        id: 42, ...body, reward_receipt: { status: 'awarded', xp_awarded: 15 },
      });
    }));
    const user = userEvent.setup();
    const first = renderWithProviders(<JournalEntryFormModal onClose={() => {}} />);
    await user.type(screen.getByLabelText(/mind/i), 'The server might already have this.');
    await user.click(screen.getByRole('button', { name: /save entry/i }));
    await screen.findByText(/we could not confirm the save/i);
    expect(screen.getByLabelText(/mind/i)).toBeDisabled();
    expect(screen.queryByText(/XP earned/i)).not.toBeInTheDocument();
    const pendingDraft = JSON.parse(localStorage.getItem(journalDraftKey(role.user.id)));
    expect(pendingDraft.pending.payload).toEqual(requests[0]);
    first.unmount();

    // Quick Actions can discover the committed row before the child retries.
    // Matching client ID must still recover the original pending POST.
    const onSaved = vi.fn();
    renderWithProviders(<JournalEntryFormModal
      mode="edit" entry={{ id: 42, ...requests[0] }} onSaved={onSaved} onClose={() => {}}
    />);
    expect(screen.getByLabelText(/mind/i)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /check save/i }));
    await screen.findByText('+15 XP earned');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(localStorage.getItem(journalDraftKey(role.user.id))).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
  });

  it.each(['unavailable', 'not_eligible', undefined])('does not invent XP for receipt status %s', async (status) => {
    server.use(http.post('*/api/chronicle/journal/', () => HttpResponse.json({
      id: 42, is_private: true,
      ...(status ? { reward_receipt: { status, xp_awarded: 15 } } : {}),
    })));
    const user = userEvent.setup();
    renderWithProviders(<JournalEntryFormModal onClose={() => {}} />);
    await user.type(screen.getByLabelText(/mind/i), 'A little memory');
    await user.click(screen.getByRole('button', { name: /save entry/i }));
    await screen.findByRole('dialog', { name: 'Memory saved' });
    expect(screen.queryByText(/XP earned/i)).not.toBeInTheDocument();
    if (status === 'unavailable') expect(screen.getByText(/reward could not be confirmed/i)).toBeInTheDocument();
    if (status === 'not_eligible') expect(screen.getByText(/without an extra reward/i)).toBeInTheDocument();
  });

  it('allows family sharing when saving an entry', async () => {
    const spy = spyHandler('post', /\/api\/chronicle\/journal\/$/, {
      id: 42, is_private: false, reward_receipt: { status: 'awarded', xp_awarded: 15 },
    });
    server.use(spy.handler);
    const user = userEvent.setup();
    renderWithProviders(<JournalEntryFormModal onClose={() => {}} />);
    await user.type(screen.getByLabelText(/mind/i), 'I want to share this');
    await user.click(screen.getByRole('checkbox', { name: /share with my family/i }));
    await user.click(screen.getByRole('button', { name: /save entry/i }));
    await screen.findByText(/shared with your family/i);
    expect(spy.calls[0].body.is_private).toBe(false);
  });

  it('rejects an empty contribution without calling the reward endpoint', async () => {
    const spy = spyHandler('post', /\/api\/chronicle\/journal\/$/, { id: 42 });
    server.use(spy.handler);
    const user = userEvent.setup();
    renderWithProviders(<JournalEntryFormModal onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /save entry/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/write a thought or a title/i);
    expect(spy.calls).toHaveLength(0);
  });

  it('keeps a rejected form editable and shows field errors', async () => {
    server.use(http.post('*/api/chronicle/journal/', () => HttpResponse.json({ title: ['Use a shorter title.'] }, { status: 400 })));
    const user = userEvent.setup();
    renderWithProviders(<JournalEntryFormModal onClose={() => {}} />);
    await user.type(screen.getByLabelText(/mind/i), 'A memory');
    await user.click(screen.getByRole('button', { name: /save entry/i }));
    await screen.findByText('Use a shorter title.');
    expect(screen.getByLabelText(/title/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/title/i)).toHaveAttribute('aria-invalid', 'true');
    expect(JSON.parse(localStorage.getItem(journalDraftKey(role.user.id))).pending).toBeNull();
  });

  it('changes historical sharing without resubmitting locked text or claiming the original reward', async () => {
    const spy = spyHandler('patch', /\/api\/chronicle\/17\/journal\/$/, {
      id: 17, is_private: false, reward_receipt: { status: 'awarded', xp_awarded: 15 },
    });
    server.use(spy.handler);
    const user = userEvent.setup();
    renderWithProviders(<JournalEntryFormModal
      mode="edit" entry={{ id: 17, is_private: true, title: 'An older day', summary: 'Old words', occurred_on: '2020-01-01' }}
      onClose={() => {}}
    />);
    expect(screen.getByLabelText(/mind/i)).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /share with my family/i }));
    await user.click(screen.getByRole('button', { name: /update sharing/i }));
    await screen.findByRole('dialog', { name: 'Entry updated' });
    expect(spy.calls[0].body).toEqual({ is_private: false });
    expect(screen.queryByText(/XP earned/i)).not.toBeInTheDocument();
  });

  it('warns when the browser cannot keep the draft', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const user = userEvent.setup();
    renderWithProviders(<JournalEntryFormModal onClose={() => {}} />);
    await user.type(screen.getByLabelText(/mind/i), 'Keep this open');
    expect(screen.getByRole('status')).toHaveTextContent(/cannot keep a draft/i);
    expect(screen.queryByText(/draft kept on this device/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('offers reconciliation when a connection hangs instead of leaving an endless spinner', async () => {
    const spy = vi.spyOn(journalApi, 'writeJournal').mockImplementation(() => new Promise(() => {}));
    const realTimeout = window.setTimeout.bind(window);
    let deadline;
    const timerSpy = vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (delay === 20000) { deadline = callback; return -1; }
      return realTimeout(callback, delay, ...args);
    });
    try {
      const user = userEvent.setup();
      renderWithProviders(<JournalEntryFormModal onClose={() => {}} />, { withAuth: false });
      await user.type(screen.getByLabelText(/mind/i), 'A connection might hang');
      await user.click(screen.getByRole('button', { name: /save entry/i }));
      expect(screen.getByLabelText(/mind/i)).toBeDisabled();
      await act(async () => { deadline(); });
      expect(screen.getByRole('alert')).toHaveTextContent(/could not confirm the save/i);
      expect(screen.getByRole('button', { name: /check save/i })).toBeEnabled();
      expect(JSON.parse(localStorage.getItem(journalDraftKey(role.user.id))).pending).not.toBeNull();
    } finally {
      spy.mockRestore();
      timerSpy.mockRestore();
    }
  });

  it('renders with textarea + mic + save controls', () => {
    renderWithProviders(
      <JournalEntryFormModal mode="create" onClose={() => {}} onSaved={() => {}} />,
    );
    const dialog = getDialog();
    expect(within(dialog).getByLabelText(/title/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/mind/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /dictate/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /save entry/i })).toBeInTheDocument();
  });

  it('posts to /chronicle/journal/ on save', async () => {
    const spy = spyHandler('post', /\/api\/chronicle\/journal\/$/, {
      id: 42, kind: 'journal', is_private: true, title: 'Today',
    });
    server.use(spy.handler);
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <JournalEntryFormModal mode="create" onClose={onClose} onSaved={onSaved} />,
    );
    const dialog = getDialog();
    await user.type(
      within(dialog).getByLabelText(/mind/i),
      'Today I wrote a story.',
    );
    await user.click(within(dialog).getByRole('button', { name: /save entry/i }));
    await waitFor(() => expect(spy.calls).toHaveLength(1));
    expect(spy.calls[0].body).toEqual({
      title: '', summary: 'Today I wrote a story.', is_private: true,
      client_entry_id: expect.stringMatching(/^[\da-f-]{36}$/i),
    });
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('patches to /chronicle/{id}/journal/ in edit mode', async () => {
    const spy = spyHandler('patch', /\/api\/chronicle\/\d+\/journal\/$/, {
      id: 7, title: 'Renamed',
    });
    server.use(spy.handler);
    const user = userEvent.setup();
    renderWithProviders(
      <JournalEntryFormModal
        mode="edit"
        entry={{ id: 7, title: 'Old', summary: 'x', kind: 'journal' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const dialog = getDialog();
    const titleInput = within(dialog).getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed');
    await user.click(within(dialog).getByRole('button', { name: /update entry/i }));
    await waitFor(() => expect(spy.calls).toHaveLength(1));
    expect(spy.calls[0].url).toMatch(/\/chronicle\/7\/journal\/$/);
    expect(spy.calls[0].body).toEqual({ title: 'Renamed', summary: 'x', is_private: true });
  });

  // Declining the mic prompt flips isListening on and straight back off. With
  // no visible feedback the button just reads as broken.
  it('explains a blocked mic instead of failing silently', () => {
    speech.current = {
      supported: true, isListening: false, interim: '', error: 'not-allowed',
      start: vi.fn(), stop: vi.fn(),
    };
    renderWithProviders(
      <JournalEntryFormModal mode="create" onClose={() => {}} onSaved={() => {}} />,
    );
    expect(
      within(getDialog()).getByText(/mic is blocked/i),
    ).toBeInTheDocument();
  });

  it('falls back to a generic hint for an unrecognized dictation error', () => {
    speech.current = {
      supported: true, isListening: false, interim: '', error: 'weird-code',
      start: vi.fn(), stop: vi.fn(),
    };
    renderWithProviders(
      <JournalEntryFormModal mode="create" onClose={() => {}} onSaved={() => {}} />,
    );
    expect(
      within(getDialog()).getByText(/dictation stopped/i),
    ).toBeInTheDocument();
  });

  it('shows no dictation hint when nothing has gone wrong', () => {
    renderWithProviders(
      <JournalEntryFormModal mode="create" onClose={() => {}} onSaved={() => {}} />,
    );
    expect(within(getDialog()).queryByText(/mic is blocked/i)).toBeNull();
    expect(within(getDialog()).queryByText(/dictation stopped/i)).toBeNull();
  });

  it('defaults to only-you and offers an explicit sharing choice', () => {
    renderWithProviders(
      <JournalEntryFormModal mode="create" onClose={() => {}} onSaved={() => {}} />,
    );
    const dialog = getDialog();
    expect(within(dialog).getByText(/only you can read/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /share with my family/i })).not.toBeChecked();
  });

  it('locks a prior-day entry into read-only mode (no Save button, only Close)', async () => {
    // Compute a local-date string for yesterday — matches the modal's
    // ``new Date().toLocaleDateString('en-CA')`` lock check.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-CA');
    renderWithProviders(
      <JournalEntryFormModal
        mode="edit"
        entry={{
          id: 17,
          title: 'Yesterday',
          summary: "yesterday's thoughts",
          kind: 'journal',
          occurred_on: yesterday,
        }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /journal entry — locked/i });
    // No Save / Update button — locked entries can't be edited.
    expect(within(dialog).queryByRole('button', { name: /update entry/i })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /save entry/i })).toBeNull();
    // Close (the only ghost form button) is present — BottomSheet has a
    // duplicate Close icon-button on its header, so just assert ≥1 match.
    expect(within(dialog).getAllByRole('button', { name: /^close$/i }).length)
      .toBeGreaterThanOrEqual(1);
    // Body and title are disabled.
    expect(within(dialog).getByLabelText(/title/i)).toBeDisabled();
    expect(within(dialog).getByLabelText(/mind/i)).toBeDisabled();
    // The lock chip ("part of your chronicle now") is rendered.
    expect(
      within(dialog).getByText(/part of your chronicle now/i),
    ).toBeInTheDocument();
  });

  it("today's entry stays editable (Save/Update + textarea enabled)", async () => {
    const today = new Date().toLocaleDateString('en-CA');
    renderWithProviders(
      <JournalEntryFormModal
        mode="edit"
        entry={{
          id: 17,
          title: 'Today',
          summary: "today's thoughts",
          kind: 'journal',
          occurred_on: today,
        }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /edit your journal entry/i });
    expect(within(dialog).getByLabelText(/mind/i)).not.toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /update entry/i })).toBeInTheDocument();
  });

  it('flips to edit mode when POST returns 409 with the existing entry', async () => {
    // 409 path: the child is in create mode and submits, but the backend
    // (via the unique-per-day constraint) reports that today's entry
    // already exists. The modal should swap to edit mode, preserve the
    // child's in-flight words, and surface a friendly error.
    // Today's entry — use a real "today" date so the modal's lock-after-
    // midnight gate (compares entry.occurred_on to today's local date)
    // doesn't kick in. The 409 path always returns today's row by
    // construction; matching here keeps that contract honest.
    const existing = {
      id: 77,
      kind: 'journal',
      is_private: true,
      title: 'Earlier today',
      summary: 'Some earlier thoughts.',
      occurred_on: new Date().toLocaleDateString('en-CA'),
    };
    server.use(
      http.post('*/api/chronicle/journal/', () =>
        HttpResponse.json(
          {
            detail: 'You already wrote a journal entry today. Edit it instead.',
            existing,
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <JournalEntryFormModal mode="create" onClose={() => {}} onSaved={() => {}} />,
    );
    const dialog = getDialog();
    await user.type(within(dialog).getByLabelText(/mind/i), 'New thought I typed');
    await user.click(within(dialog).getByRole('button', { name: /save entry/i }));

    // Title flips to the BottomSheet title for edit mode.
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /edit your journal entry/i }),
      ).toBeInTheDocument(),
    );
    // Primary button label flips.
    expect(
      screen.getByRole('button', { name: /update entry/i }),
    ).toBeInTheDocument();
    // Friendly 409 error — not a raw status code.
    expect(screen.getByRole('alert').textContent).toMatch(/already wrote today/i);
    // The in-flight text survives, appended after the existing body.
    expect(screen.getByLabelText(/mind/i).value).toContain('Some earlier thoughts.');
    expect(screen.getByLabelText(/mind/i).value).toContain('New thought I typed');
  });
});
