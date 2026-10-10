import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import QuickActionsSheet from './QuickActionsSheet';
import SuccessToastProvider from '../SuccessToast';
import { AuthProvider } from '../../hooks/useApi';
import { server } from '../../test/server';
import { spyHandler } from '../../test/spy';
import { buildUser, buildParent } from '../../test/factories';
import { STORAGE_KEYS } from '../../constants/storage';

// Bypass exit animation on the BottomSheet so unmount assertions don't hang.
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return { ...actual, AnimatePresence: ({ children }) => children };
});

function renderSheet(userFixture, handlers = [], props = {}) {
  server.use(
    http.get('*/api/auth/me/', () => HttpResponse.json(userFixture)),
    ...handlers,
  );
  return render(
    <MemoryRouter>
      <AuthProvider>
        <QuickActionsSheet
          status={null}
          isClocked={false}
          elapsedSecs={0}
          onClose={props.onClose || (() => {})}
          onClockReload={props.onClockReload || (async () => {})}
        />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('QuickActionsSheet', () => {
  it('shows child actions including Clock in and Add study', async () => {
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
    ]);
    await waitFor(() => expect(screen.getByText(/clock in/i)).toBeInTheDocument());
    // Study rows speak the tab's name with "homework" demoted to the hint,
    // matching the duty / ritual rows in the same sheet.
    expect(screen.getByText('Add study')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log a grade/i })).toBeInTheDocument();
    expect(screen.getByText(/self-assign homework/i)).toBeInTheDocument();
    // With zero goals the hoard affordance labels as "Set a savings goal".
    await waitFor(() =>
      expect(screen.getByText(/set a savings goal/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/view hoards/i)).not.toBeInTheDocument();
    // Guarded actions are NOT shown because preconditions aren't met.
    expect(screen.queryByText(/turn in study/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/start a quest/i)).not.toBeInTheDocument();
    // Reward shop is intentionally excluded from quick actions.
    expect(screen.queryByText(/request a reward/i)).not.toBeInTheDocument();
  });

  it('swaps hoard label to "View hoards" when the child has an active goal', async () => {
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
      http.get('*/api/savings-goals/', () =>
        HttpResponse.json([
          { id: 1, title: 'Bike', target_amount: '100.00', is_completed: false },
        ]),
      ),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
    ]);
    await waitFor(() =>
      expect(screen.getByText(/view hoards/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/set a savings goal/i)).not.toBeInTheDocument();
  });

  it('reveals Turn in study when an assignment is due', async () => {
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () =>
        HttpResponse.json({
          today: [{ id: 7, title: 'Math packet' }],
          overdue: [],
          pending_submissions: [],
        }),
      ),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
    ]);
    await waitFor(() => expect(screen.getByText(/turn in study/i)).toBeInTheDocument());
  });

  // The row used to navigate to /quests?tab=study&submit=<id>, a param the
  // Study tab never read — the kid landed on the tab with nothing open.
  it('Turn in study opens the submit sheet for the due assignment in place', async () => {
    const u = userEvent.setup();
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () =>
        HttpResponse.json({
          today: [{ id: 7, title: 'Math packet', subject: 'math' }],
          overdue: [],
          pending_submissions: [],
        }),
      ),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
    ]);

    const row = await screen.findByRole('button', { name: /turn in study/i });
    await u.click(row);

    // The proof sheet opens on top of the quick-actions sheet, carrying the
    // assignment it was opened for.
    await screen.findByRole('button', { name: /submit for review/i });
    const submitSheet = screen
      .getAllByRole('dialog')
      .find((d) => within(d).queryByRole('button', { name: /submit for review/i }));
    expect(submitSheet).toBeTruthy();
    expect(within(submitSheet).getByText('Math packet')).toBeInTheDocument();
  });

  it('reveals Start a quest when a quest scroll is in inventory', async () => {
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () =>
        HttpResponse.json([
          { id: 1, quantity: 2, item: { id: 9, item_type: 'quest_scroll', name: 'Boss Scroll' } },
        ]),
      ),
    ]);
    await waitFor(() => expect(screen.getByText(/start a quest/i)).toBeInTheDocument());
  });

  it('shows parent actions (Assign study, Adjust coins, Adjust payment)', async () => {
    renderSheet(buildParent());
    await waitFor(() => expect(screen.getByText('Assign study')).toBeInTheDocument());
    expect(screen.getByText(/homework for a kid/i)).toBeInTheDocument();
    expect(screen.getByText(/adjust coins/i)).toBeInTheDocument();
    expect(screen.getByText(/adjust payment/i)).toBeInTheDocument();
    // No child-only actions surface for parents.
    expect(screen.queryByText(/add study/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /log a grade/i })).not.toBeInTheDocument();
    // "Write in journal" is a child self-authoring affordance only.
    expect(screen.queryByText(/write in journal/i)).not.toBeInTheDocument();
  });

  it('shows "Write in journal" on the child menu', async () => {
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
    ]);
    await waitFor(() =>
      expect(screen.getByText(/write in journal/i)).toBeInTheDocument(),
    );
  });

  it('opens grade capture above quick actions and keeps the draft when returning', async () => {
    const u = userEvent.setup();
    renderSheet(buildUser());
    await u.click(await screen.findByRole('button', { name: /log a grade/i }));
    const capture = await screen.findByRole('dialog', { name: 'Log a grade' });
    await u.type(within(capture).getByRole('textbox', { name: /subject/i }), 'Biology');
    await u.click(within(capture).getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log a grade' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /log a grade/i }));
    const restored = await screen.findByRole('dialog', { name: 'Log a grade' });
    expect(within(restored).getByRole('textbox', { name: /subject/i })).toHaveValue('Biology');
  });

  it('opens the JournalEntryFormModal in create mode when no entry exists yet', async () => {
    const u = userEvent.setup();
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
    ]);
    const row = await screen.findByRole('button', { name: /write in journal/i });
    await u.click(row);
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /write in your journal/i }),
      ).toBeInTheDocument(),
    );
  });

  it('flips label to "Edit today\u2019s journal" and opens the modal in edit mode when today\u2019s entry exists', async () => {
    const u = userEvent.setup();
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
      http.get('*/api/chronicle/journal/today/', () =>
        HttpResponse.json({
          id: 42, kind: 'journal', is_private: true,
          title: 'Earlier', summary: 'I already started',
          // Real today date so the form modal's lock-after-midnight gate
          // doesn't flip the title to "locked".
          occurred_on: new Date().toLocaleDateString('en-CA'),
        }),
      ),
    ]);
    const row = await screen.findByRole('button', { name: /edit today.s journal/i });
    expect(row).toBeInTheDocument();
    await u.click(row);
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /edit your journal entry/i }),
      ).toBeInTheDocument(),
    );
  });

  it('one-taps clock-in for the remembered venture and POSTs the clock action', async () => {
    const u = userEvent.setup();
    localStorage.setItem(STORAGE_KEYS.LAST_CLOCK_PROJECT, '7');
    const clock = spyHandler('post', /\/api\/clock\/$/, { ok: true });
    const onClose = vi.fn();
    renderSheet(
      buildUser(),
      [
        http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
        http.get('*/api/savings-goals/', () => HttpResponse.json([])),
        http.get('*/api/inventory/', () => HttpResponse.json([])),
        http.get('*/api/projects/', () =>
          HttpResponse.json([
            { id: 7, title: 'Birdhouse', status: 'active' },
            { id: 8, title: 'Robot', status: 'active' },
          ]),
        ),
        clock.handler,
      ],
      { onClose },
    );

    const row = await screen.findByRole('button', { name: /clock in · birdhouse/i });
    await u.click(row);

    await waitFor(() => expect(clock.calls).toHaveLength(1));
    expect(clock.calls[0].body).toMatchObject({ action: 'in', project_id: 7 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // SuccessToastProvider is the canonical confirmation channel and had zero
  // consumers — a one-tap clock-in closed the sheet and said nothing.
  it('confirms a one-tap clock-in with a success toast', async () => {
    const u = userEvent.setup();
    localStorage.setItem(STORAGE_KEYS.LAST_CLOCK_PROJECT, '7');
    const clock = spyHandler('post', /\/api\/clock\/$/, { ok: true });
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
      http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
      http.get('*/api/projects/', () =>
        HttpResponse.json([{ id: 7, title: 'Birdhouse', status: 'active' }]),
      ),
      clock.handler,
    );
    render(
      <MemoryRouter>
        <AuthProvider>
          <SuccessToastProvider>
            <QuickActionsSheet
              status={null}
              isClocked={false}
              elapsedSecs={0}
              onClose={() => {}}
              onClockReload={async () => {}}
            />
          </SuccessToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await u.click(await screen.findByRole('button', { name: /clock in · birdhouse/i }));

    expect(await screen.findByText(/clocked in · birdhouse/i)).toBeInTheDocument();
  });

  it('keeps the plain Clock in row (opening the picker pane) when nothing is remembered', async () => {
    const u = userEvent.setup();
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
      http.get('*/api/projects/', () =>
        HttpResponse.json([
          { id: 7, title: 'Birdhouse', status: 'active' },
          { id: 8, title: 'Robot', status: 'active' },
        ]),
      ),
    ]);

    const row = await screen.findByRole('button', { name: /^clock in/i });
    await u.click(row);
    // The pane opens with the venture picker rather than firing a request.
    await waitFor(() =>
      expect(screen.getByLabelText(/which venture/i)).toBeInTheDocument(),
    );
  });

  it('Add study opens the canonical HomeworkFormModal and POSTs a self-assign payload', async () => {
    const u = userEvent.setup();
    const create = spyHandler('post', /\/api\/homework\/$/, { ok: true, id: 42 });
    renderSheet(buildUser(), [
      http.get('*/api/homework/dashboard/', () => HttpResponse.json({ today: [], overdue: [], pending_submissions: [] })),
      http.get('*/api/savings-goals/', () => HttpResponse.json([])),
      http.get('*/api/inventory/', () => HttpResponse.json([])),
      create.handler,
    ]);

    // Quick-add reuses the same HomeworkFormModal used on /quests?tab=study,
    // which opens as a dialog titled "New assignment" and includes the
    // canonical fields (title, description, subject, due-date chips).
    const addRow = await screen.findByRole('button', { name: /add study/i });
    await u.click(addRow);

    const dialog = await screen.findByRole('dialog', { name: /new assignment/i });
    await u.type(within(dialog).getByPlaceholderText(/^title$/i), 'Science poster');
    // Use a quick-due chip so the required date input is populated without
    // driving the native date picker.
    await u.click(within(dialog).getByRole('button', { name: /tomorrow/i }));
    await u.click(within(dialog).getByRole('button', { name: /create assignment/i }));

    await waitFor(() => expect(create.calls).toHaveLength(1));
    expect(create.calls[0].body).toMatchObject({
      title: 'Science poster',
      subject: 'math',
    });
    expect(create.calls[0].body.due_date).toBeTruthy();
    // Child path doesn't surface effort_level or assigned_to.
    expect(create.calls[0].body.effort_level).toBeUndefined();
    expect(create.calls[0].body.assigned_to).toBeUndefined();
  });
});
