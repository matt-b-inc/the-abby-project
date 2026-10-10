import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, renderWithProviders, screen, waitFor, within } from '../../test/render';
import { buildUser } from '../../test/factories';
import { server } from '../../test/server';
import { spyHandler } from '../../test/spy';
import { toISODate } from '../../utils/dates';
import * as chronicleApi from '../../api';
import GradeEntryFormModal from './GradeEntryFormModal';
import { gradeDraftKey, newGradeRequestId, storeGradeDraft } from './gradeDraft';

const role = vi.hoisted(() => ({ user: null }));
vi.mock('../../hooks/useRole.js', () => ({ useRole: () => ({ user: role.user }) }));
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return { ...actual, AnimatePresence: ({ children }) => children };
});

beforeEach(() => { role.user = buildUser(); });

function savedGrade(payload, overrides = {}) {
  const { subject, assessment, grade_format, score, possible, letter } = payload;
  return {
    id: 50, user: 1, kind: 'grade', occurred_on: payload.occurred_on,
    summary: payload.reflection, is_private: payload.is_private,
    client_entry_id: payload.client_entry_id,
    metadata: { grade: { subject, assessment, grade_format, score, possible, letter } },
    reward_receipt: { status: 'awarded', xp_awarded: 15 },
    ...overrides,
  };
}

function mount(props = {}) {
  return renderWithProviders(<GradeEntryFormModal onClose={() => {}} {...props} />, { withAuth: false });
}

async function completeBasics(user, score = '82.5') {
  await user.type(screen.getByRole('textbox', { name: 'Subject or class' }), 'Math');
  await user.type(screen.getByRole('textbox', { name: 'What was graded?' }), 'Unit quiz');
  await user.type(screen.getByRole('textbox', { name: 'Percentage' }), score);
}

describe('GradeEntryFormModal', () => {
  it('starts with a percentage, today, and an explicit private-by-default choice', () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'Log a grade' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Grade format' })).toHaveValue('percentage');
    expect(screen.getByLabelText('Date received')).toHaveValue(toISODate(new Date()));
    expect(screen.getByRole('textbox', { name: 'Percentage' })).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByRole('checkbox', { name: 'Share with my family' })).not.toBeChecked();
    expect(screen.getByText(/Only you can read this grade/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Points possible' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Letter grade' })).toBeNull();
  });

  it('accepts zero, submits a stable private capture, and displays exact boosted receipt XP until Done', async () => {
    const spy = spyHandler('post', /\/api\/chronicle\/grades\/$/, ({ body }) => savedGrade(body, { reward_receipt: { status: 'awarded', xp_awarded: 30 } }));
    server.use(spy.handler);
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const { user } = mount({ onSaved, onClose });
    await completeBasics(user, '0');
    const draft = JSON.parse(localStorage.getItem(gradeDraftKey(1)));
    await user.click(screen.getByRole('button', { name: 'Save grade' }));
    await screen.findByText('+30 XP earned');
    expect(spy.calls[0].body).toEqual({
      subject: 'Math', assessment: 'Unit quiz', grade_format: 'percentage',
      score: '0', reflection: '', occurred_on: toISODate(new Date()),
      is_private: true, client_entry_id: draft.client_entry_id,
    });
    expect(localStorage.getItem(gradeDraftKey(1))).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 50 }));
    expect(onClose).toHaveBeenCalled();
  });

  it('saves point grades with extra credit, an earlier date, reflection, and family sharing', async () => {
    const spy = spyHandler('post', /\/api\/chronicle\/grades\/$/, ({ body }) => savedGrade(body));
    server.use(spy.handler);
    const { user } = mount();
    await completeBasics(user, '105.5');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grade format' }), 'points');
    await user.type(screen.getByRole('textbox', { name: 'Points possible' }), '100');
    await user.clear(screen.getByLabelText('Date received'));
    await user.type(screen.getByLabelText('Date received'), '2026-01-02');
    await user.type(screen.getByRole('textbox', { name: 'Reflection (optional)' }), 'I want to remember the effort.');
    await user.click(screen.getByRole('checkbox', { name: 'Share with my family' }));
    await user.click(screen.getByRole('button', { name: 'Save grade' }));
    await screen.findByRole('dialog', { name: 'Grade remembered' });
    expect(spy.calls[0].body).toMatchObject({
      grade_format: 'points', score: '105.5', possible: '100', occurred_on: '2026-01-02',
      reflection: 'I want to remember the effort.', is_private: false,
    });
    expect(spy.calls[0].body).not.toHaveProperty('letter');
    expect(screen.getByText(/Shared with your family/i)).toBeInTheDocument();
  });

  it.each(['F', 'NP', 'A+'])('remembers the letter %s and omits numbers from an earlier format', async (letter) => {
    const spy = spyHandler('post', /\/api\/chronicle\/grades\/$/, ({ body }) => savedGrade(body));
    server.use(spy.handler);
    const { user } = mount();
    await completeBasics(user, '82.5');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grade format' }), 'points');
    await user.type(screen.getByRole('textbox', { name: 'Points possible' }), '100');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grade format' }), 'letter');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Letter grade' }), letter);
    await user.click(screen.getByRole('button', { name: 'Save grade' }));
    await screen.findByText('+15 XP earned');
    expect(spy.calls[0].body).toMatchObject({ grade_format: 'letter', letter });
    expect(spy.calls[0].body).not.toHaveProperty('score');
    expect(spy.calls[0].body).not.toHaveProperty('possible');
  });

  it('validates blank capture fields without calling the API', async () => {
    const spy = spyHandler('post', /\/api\/chronicle\/grades\/$/, {});
    server.use(spy.handler);
    const { user } = mount();
    await user.click(screen.getByRole('button', { name: 'Save grade' }));
    expect(screen.getByRole('textbox', { name: 'Subject or class' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'What was graded?' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'Percentage' })).toHaveAttribute('aria-invalid', 'true');
    expect(spy.calls).toHaveLength(0);
  });

  it('validates an excessive percentage, zero denominator, and future date beside the right controls', async () => {
    const spy = spyHandler('post', /\/api\/chronicle\/grades\/$/, {});
    server.use(spy.handler);
    const { user } = mount();
    await completeBasics(user, '101');
    await user.click(screen.getByRole('button', { name: 'Save grade' }));
    expect(screen.getByText(/percentage between 0 and 100/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grade format' }), 'points');
    await user.type(screen.getByRole('textbox', { name: 'Points possible' }), '0');
    await user.clear(screen.getByLabelText('Date received'));
    await user.type(screen.getByLabelText('Date received'), '2099-01-01');
    await user.click(screen.getByRole('button', { name: 'Save grade' }));
    expect(screen.getByText(/points possible, greater than zero/i)).toBeInTheDocument();
    expect(screen.getByText(/today or an earlier date/i)).toBeInTheDocument();
    expect(spy.calls).toHaveLength(0);
  });

  it('restores text, format, sharing, date, and request identity after close/reopen', async () => {
    const onClose = vi.fn();
    const first = mount({ onClose });
    await completeBasics(first.user);
    await first.user.selectOptions(screen.getByRole('combobox', { name: 'Grade format' }), 'letter');
    await first.user.selectOptions(screen.getByRole('combobox', { name: 'Letter grade' }), 'B-');
    await first.user.click(screen.getByRole('checkbox', { name: 'Share with my family' }));
    await first.user.type(screen.getByRole('textbox', { name: 'Reflection (optional)' }), 'Remember this.');
    const draft = JSON.parse(localStorage.getItem(gradeDraftKey(1)));
    await first.user.click(screen.getByRole('button', { name: 'Keep draft & close' }));
    expect(onClose).toHaveBeenCalled();
    first.unmount();
    const second = mount();
    expect(screen.getByRole('textbox', { name: 'Subject or class' })).toHaveValue('Math');
    expect(screen.getByRole('combobox', { name: 'Letter grade' })).toHaveValue('B-');
    expect(screen.getByRole('checkbox', { name: 'Share with my family' })).toBeChecked();
    expect(screen.getByLabelText('Date received')).toHaveValue(draft.occurred_on);
    await second.user.type(screen.getByRole('textbox', { name: 'Reflection (optional)' }), ' Another thought.');
    expect(JSON.parse(localStorage.getItem(gradeDraftKey(1))).client_entry_id).toBe(draft.client_entry_id);
  });

  it('remounts capture state when the account changes and keeps both device drafts separate', async () => {
    const view = mount();
    await completeBasics(view.user);
    role.user = buildUser({ id: 2 });
    view.rerender(<GradeEntryFormModal onClose={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Subject or class' })).toHaveValue('');
    await view.user.type(screen.getByRole('textbox', { name: 'Subject or class' }), 'Science');
    expect(JSON.parse(localStorage.getItem(gradeDraftKey(1))).subject).toBe('Math');
    expect(JSON.parse(localStorage.getItem(gradeDraftKey(2))).subject).toBe('Science');
  });

  it('recovers an interrupted POST after reopening and checks the exact original payload', async () => {
    const requests = [];
    server.use(http.post('*/api/chronicle/grades/', async ({ request }) => {
      const payload = await request.json();
      requests.push(payload);
      return requests.length === 1 ? HttpResponse.error() : HttpResponse.json(savedGrade(payload));
    }));
    const first = mount();
    await completeBasics(first.user, '0');
    await first.user.click(screen.getByRole('button', { name: 'Save grade' }));
    await screen.findByText(/We could not confirm the save/i);
    expect(screen.getByRole('textbox', { name: 'Percentage' })).toBeDisabled();
    expect(screen.queryByText(/XP earned/i)).toBeNull();
    expect(JSON.parse(localStorage.getItem(gradeDraftKey(1))).pending.payload).toEqual(requests[0]);
    first.unmount();
    // A history refresh can discover the committed row before retrying.
    const second = mount({ mode: 'edit', entry: savedGrade(requests[0]) });
    expect(screen.getByRole('textbox', { name: 'Percentage' })).toBeDisabled();
    await second.user.click(screen.getByRole('button', { name: 'Check save' }));
    await screen.findByText('+15 XP earned');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(localStorage.getItem(gradeDraftKey(1))).toBeNull();
  });

  it('recovers a stalled request with the original UUID and body', async () => {
    const spy = vi.spyOn(chronicleApi, 'writeGrade').mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce((payload) => Promise.resolve(savedGrade(payload)));
    const realTimeout = window.setTimeout.bind(window);
    let deadline;
    const timerSpy = vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (delay === 20000) { deadline = callback; return -1; }
      return realTimeout(callback, delay, ...args);
    });
    try {
      const { user } = mount();
      await completeBasics(user);
      await user.click(screen.getByRole('button', { name: 'Save grade' }));
      await act(async () => { deadline(); });
      expect(screen.getByRole('button', { name: 'Check save' })).toBeEnabled();
      expect(screen.getByRole('textbox', { name: 'Percentage' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Check save' }));
      await screen.findByText('+15 XP earned');
      expect(spy.mock.calls[1][0]).toEqual(spy.mock.calls[0][0]);
    } finally { spy.mockRestore(); timerSpy.mockRestore(); }
  });

  it.each(['daily_limit', 'unavailable', 'not_eligible', undefined])('does not claim XP for receipt status %s', async (status) => {
    server.use(http.post('*/api/chronicle/grades/', async ({ request }) => HttpResponse.json(savedGrade(await request.json(), { reward_receipt: status ? { status, xp_awarded: 30 } : undefined }))));
    const { user } = mount();
    await completeBasics(user);
    await user.click(screen.getByRole('button', { name: 'Save grade' }));
    await screen.findByRole('dialog', { name: 'Grade remembered' });
    expect(screen.queryByText(/XP earned/i)).toBeNull();
    if (status === 'daily_limit') expect(screen.getByText(/This grade is still remembered/i)).toBeInTheDocument();
    if (status === 'unavailable') expect(screen.getByText(/reward could not be confirmed/i)).toBeInTheDocument();
    if (status === 'not_eligible') expect(screen.getByText(/without an extra reward/i)).toBeInTheDocument();
  });

  it('corrects historical grades and changes format/sharing without stale fields or another reward', async () => {
    const older = savedGrade({ subject: 'Math', assessment: 'Old quiz', grade_format: 'points', score: '7', possible: '10', reflection: 'A first thought', occurred_on: '2020-01-01', is_private: true });
    const spy = spyHandler('patch', /\/api\/chronicle\/50\/grade\/$/, ({ body }) => savedGrade(body));
    server.use(spy.handler);
    const { user } = mount({ mode: 'edit', entry: older });
    expect(screen.getByRole('dialog', { name: 'Correct grade' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Points earned' })).toBeEnabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grade format' }), 'letter');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Letter grade' }), 'B');
    await user.click(screen.getByRole('checkbox', { name: 'Share with my family' }));
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    await screen.findByRole('dialog', { name: 'Grade corrected' });
    expect(spy.calls[0].body).toEqual({
      subject: 'Math', assessment: 'Old quiz', grade_format: 'letter', letter: 'B',
      reflection: 'A first thought', occurred_on: '2020-01-01', is_private: false,
    });
    expect(screen.queryByText(/XP earned/i)).toBeNull();
    expect(screen.getByText('Corrections do not earn another reward.')).toBeInTheDocument();
  });

  it('keeps an uncertain correction request immutable when reopening against a newer saved result', async () => {
    const original = savedGrade({ subject: 'Math', assessment: 'Quiz', grade_format: 'points', score: '7', possible: '10', reflection: '', occurred_on: '2026-01-01', is_private: true });
    const spy = vi.spyOn(chronicleApi, 'updateGradeEntry')
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockImplementationOnce((_id, payload) => Promise.resolve(savedGrade(payload)));
    try {
      const first = mount({ mode: 'edit', entry: original });
      await first.user.type(screen.getByLabelText('Reflection (optional)'), 'My correction draft');
      await first.user.click(screen.getByRole('button', { name: 'Save correction' }));
      await screen.findByRole('button', { name: 'Check save' });
      const request = spy.mock.calls[0];
      first.unmount();
      const latest = { ...original, is_private: false, metadata: { grade: { ...original.metadata.grade, score: '9' } } };
      const second = mount({ mode: 'edit', entry: latest });
      expect(screen.getByLabelText('Points earned')).toHaveValue('7');
      expect(screen.getByLabelText('Points earned')).toBeDisabled();
      await second.user.click(screen.getByRole('button', { name: 'Check save' }));
      await screen.findByRole('dialog', { name: 'Grade corrected' });
      expect(spy.mock.calls[1]).toEqual(request);
    } finally { spy.mockRestore(); }
  });

  it('preserves intentionally changed score and sharing while restoring a correction draft against a newer date', async () => {
    const original = savedGrade({ subject: 'Math', assessment: 'Quiz', grade_format: 'points', score: '7', possible: '10', reflection: '', occurred_on: '2026-01-01', is_private: false });
    const first = mount({ mode: 'edit', entry: original });
    await first.user.clear(screen.getByLabelText('Points earned'));
    await first.user.type(screen.getByLabelText('Points earned'), '6');
    await first.user.click(screen.getByLabelText('Share with my family'));
    first.unmount();
    const latest = { ...original, occurred_on: '2025-09-20', metadata: { grade: { ...original.metadata.grade, score: '9' } } };
    mount({ mode: 'edit', entry: latest });
    expect(screen.getByLabelText('Points earned')).toHaveValue('6');
    expect(screen.getByLabelText('Share with my family')).not.toBeChecked();
    expect(screen.getByLabelText('Date received')).toHaveValue('2025-09-20');
  });

  it('keeps an intentional points correction with its denominator when the saved grade changes format', async () => {
    const original = savedGrade({ subject: 'Math', assessment: 'Quiz', grade_format: 'points', score: '7', possible: '10', reflection: '', occurred_on: '2026-01-01', is_private: true });
    const first = mount({ mode: 'edit', entry: original });
    await first.user.clear(screen.getByLabelText('Points earned'));
    await first.user.type(screen.getByLabelText('Points earned'), '9');
    first.unmount();
    const latest = { ...original, metadata: { grade: { ...original.metadata.grade, grade_format: 'percentage', score: '92', possible: undefined } } };
    mount({ mode: 'edit', entry: latest });
    expect(screen.getByLabelText('Grade format')).toHaveValue('points');
    expect(screen.getByLabelText('Points earned')).toHaveValue('9');
    expect(screen.getByLabelText('Points possible')).toHaveValue('10');
  });

  it('keeps an older correction draft intact and shows the latest saved result for review when its original baseline is unknown', async () => {
    storeGradeDraft(1, {
      mode: 'edit', entry_id: 50, client_entry_id: newGradeRequestId(), pending: null,
      subject: 'Math', assessment: 'Quiz', grade_format: 'points', score: '6', possible: '10', letter: '',
      reflection: 'An older reflection draft.', occurred_on: '2026-01-01', is_private: true,
    });
    const latest = savedGrade({ subject: 'Math', assessment: 'Quiz', grade_format: 'points', score: '9', possible: '10', reflection: 'Latest saved reflection.', occurred_on: '2025-09-20', is_private: false });
    const { user } = mount({ mode: 'edit', entry: latest });
    expect(screen.getByLabelText('Points earned')).toHaveValue('6');
    expect(screen.getByLabelText('Reflection (optional)')).toHaveValue('An older reflection draft.');
    expect(screen.getByLabelText('Share with my family')).not.toBeChecked();
    const comparison = screen.getByRole('region', { name: 'Latest saved grade' });
    expect(within(comparison).getByText('9 / 10 points')).toBeInTheDocument();
    expect(comparison).toHaveTextContent('Shared with family');
    expect(comparison).toHaveTextContent('Latest saved reflection.');
    await user.type(screen.getByLabelText('Reflection (optional)'), ' More to remember.');
    expect(JSON.parse(localStorage.getItem(gradeDraftKey(1, 'edit', 50)))).not.toHaveProperty('baseline');
  });

  it('keeps server-rejected capture editable with errors beside the relevant fields', async () => {
    server.use(http.post('*/api/chronicle/grades/', () => HttpResponse.json({ assessment: ['Please shorten this assessment.'] }, { status: 400 })));
    const { user } = mount();
    await completeBasics(user);
    await user.click(screen.getByRole('button', { name: 'Save grade' }));
    await screen.findByText('Please shorten this assessment.');
    expect(screen.getByRole('textbox', { name: 'What was graded?' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'What was graded?' })).toHaveAttribute('aria-invalid', 'true');
    expect(JSON.parse(localStorage.getItem(gradeDraftKey(1))).pending).toBeNull();
  });

  it('warns honestly when storage fails and uses the sheet\'s guarded dismissal', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try {
      const { user } = mount();
      await user.type(screen.getByRole('textbox', { name: 'Subject or class' }), 'Math');
      expect(screen.getByRole('status')).toHaveTextContent(/cannot keep a draft/i);
      expect(screen.queryByText(/Draft kept on this device/i)).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    } finally { spy.mockRestore(); }
  });

  it('preserves a newer device draft when an older tab\'s save response arrives', async () => {
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const spy = vi.spyOn(chronicleApi, 'writeGrade').mockReturnValue(pending);
    try {
      const first = mount();
      await completeBasics(first.user);
      await first.user.click(screen.getByRole('button', { name: 'Save grade' }));
      const raw = JSON.parse(localStorage.getItem(gradeDraftKey(1)));
      raw.reflection = 'A newer thought from another tab';
      raw.pending = null;
      localStorage.setItem(gradeDraftKey(1), JSON.stringify(raw));
      first.unmount();
      await act(async () => { finish(savedGrade(spy.mock.calls[0][0])); await pending; });
      await waitFor(() => expect(JSON.parse(localStorage.getItem(gradeDraftKey(1))).reflection).toBe(raw.reflection));
    } finally { finish?.(savedGrade(spy.mock.calls[0]?.[0] ?? {})); spy.mockRestore(); }
  });
});
