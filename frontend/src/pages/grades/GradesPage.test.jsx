import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { renderWithProviders } from '../../test/render';
import { server } from '../../test/server';
import { buildParent, buildUser } from '../../test/factories';
import { useAuth } from '../../hooks/useApi';
import { publishChronicleChange } from '../../hooks/useChronicleRevision';
import GradesPage from './GradesPage';

// These tests exercise the history/form handoff. The form's validation,
// recoverable draft, save receipt, and retry behavior have their own suite.
vi.mock('./GradeEntryFormModal', () => ({
  default: function GradeFormStub({ mode = 'create', entry, onSaved, onClose }) {
    return <div role="dialog" aria-label={mode === 'edit' ? 'Correct recorded grade' : 'Record a grade'}>
      {entry && <p>Correcting {entry.metadata.grade.assessment} from {entry.occurred_on}</p>}
      <button onClick={() => onSaved(entry ?? { id: 99, kind: 'grade' })}>Finish saving grade</button>
      <button onClick={onClose}>Cancel grade form</button>
    </div>;
  },
}));

function gradeEntry(overrides = {}) {
  return {
    id: 23, user: 1, kind: 'grade', title: 'Math · Fractions quiz', summary: 'I tried a new way to study.',
    occurred_on: '2026-09-20', is_private: true,
    metadata: { grade: { subject: 'Math', assessment: 'Fractions quiz', grade_format: 'points', score: '8', possible: '10' } },
    ...overrides,
  };
}

function page(results, count = results.length, next = null) {
  return { count, next, previous: null, results };
}

function mount(user = buildUser(), ui = <GradesPage />) {
  server.use(http.get('*/api/auth/me/', () => HttpResponse.json(user)));
  return renderWithProviders(ui);
}

function OutsideSaveHarness() {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate('/chronicle?tab=grades', { state: { gradeSavedId: 23 } })}>Acknowledge grade saved elsewhere</button>
    <GradesPage />
  </>;
}

function SwitchAccountHarness({ nextUser }) {
  const { setUser } = useAuth();
  return <><button onClick={() => setUser(nextUser)}>Switch account</button><GradesPage /></>;
}

function OtherChildSaveHarness() {
  return <><button onClick={() => publishChronicleChange(7)}>Another child's grade saved</button><GradesPage /></>;
}

describe('GradesPage', () => {
  it('shows native grade formats and reflection while keeping private results Only you', async () => {
    server.use(http.get('*/api/chronicle/grades/', () => HttpResponse.json(page([
      gradeEntry(),
      gradeEntry({ id: 24, metadata: { grade: { subject: 'Science', assessment: 'Lab', grade_format: 'percentage', score: '87.5' } } }),
      gradeEntry({ id: 25, is_private: false, metadata: { grade: { subject: 'English', assessment: 'Essay', grade_format: 'letter', letter: 'B+' } } }),
      gradeEntry({ id: 26, user: 2, summary: 'Someone else’s result' }),
      { id: 27, user: 1, kind: 'journal', title: 'Journal text' },
    ]))));
    mount();
    expect(await screen.findByText('8 / 10 points')).toBeInTheDocument();
    expect(screen.getByText('87.5%')).toBeInTheDocument();
    expect(screen.getByText('B+')).toBeInTheDocument();
    expect(screen.getAllByText('Only you')).toHaveLength(2);
    expect(screen.getByText('Shared with family')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Correct grade or sharing' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Family responses' })).toHaveLength(1);
    expect(screen.queryByText('Someone else’s result')).toBeNull();
    expect(screen.queryByText('Journal text')).toBeNull();
    expect(screen.queryByText(/80%|GPA/)).toBeNull();
  });

  it('loads the rest of paginated history through the known endpoint without losing earlier rows', async () => {
    const requestedPages = [];
    server.use(http.get('*/api/chronicle/grades/', ({ request }) => {
      const params = new URL(request.url).searchParams;
      requestedPages.push(params.get('page') ?? '1');
      return params.get('page') === '2'
        ? HttpResponse.json(page([gradeEntry(), gradeEntry({ id: 24, occurred_on: '2026-08-01', metadata: { grade: { subject: 'Art', assessment: 'Portfolio', grade_format: 'letter', letter: 'A-' } } })], 2))
        : HttpResponse.json(page([gradeEntry()], 2, 'https://api.example.test/api/chronicle/grades/?page=2'));
    }));
    const { user } = mount();
    await screen.findByText('8 / 10 points');
    expect(screen.getByText('Showing 1 of 2 recorded grades')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load earlier grades' }));
    expect(await screen.findByText('A-')).toBeInTheDocument();
    expect(screen.getAllByText('8 / 10 points')).toHaveLength(1);
    expect(screen.getByText('Showing 2 of 2 recorded grades')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load earlier grades' })).toBeNull();
    expect(requestedPages).toEqual(['1', '2']);
  });

  it('keeps loaded grades visible and allows retry when an earlier page fails', async () => {
    let attempts = 0;
    server.use(http.get('*/api/chronicle/grades/', ({ request }) => {
      if (new URL(request.url).searchParams.has('page')) {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json({ error: 'Earlier grades are temporarily unavailable.' }, { status: 503 })
          : HttpResponse.json(page([gradeEntry({ id: 24, summary: 'An earlier reflection' })], 2));
      }
      return HttpResponse.json(page([gradeEntry()], 2, '/api/chronicle/grades/?page=2'));
    }));
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Load earlier grades' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Earlier grades are temporarily unavailable.');
    expect(screen.getByText('8 / 10 points')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try loading earlier grades again' }));
    expect(await screen.findByText('An earlier reflection')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('scopes parent history and every later page to the selected child, showing shared entries only', async () => {
    const targets = [];
    server.use(
      http.get('*/api/children/', () => HttpResponse.json([{ id: 7, display_name: 'Abby Rose', first_name: 'Abby', username: 'abby' }])),
      http.get('*/api/chronicle/grades/', ({ request }) => {
        const params = new URL(request.url).searchParams;
        targets.push(params.get('user_id'));
        return params.has('page')
          ? HttpResponse.json(page([gradeEntry({ id: 30, user: 7, is_private: false, summary: 'Earlier shared result' })], 2))
          : HttpResponse.json(page([
            gradeEntry({ user: 7, is_private: false }),
            gradeEntry({ id: 28, user: 7, summary: 'Private reflection' }),
            gradeEntry({ id: 29, user: 8, is_private: false, summary: 'Another child' }),
          ], 2, '/api/chronicle/grades/?page=2&user_id=8'));
      }),
    );
    const { user } = mount(buildParent());
    await screen.findByText('8 / 10 points');
    expect(screen.getByRole('option', { name: 'Abby Rose' })).toBeInTheDocument();
    expect(screen.queryByText('Private reflection')).toBeNull();
    expect(screen.queryByText('Another child')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log a grade' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Correct grade or sharing' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Load earlier grades' }));
    await screen.findByText('Earlier shared result');
    expect(targets).toEqual(['7', '7']);
  });

  it('removes the previous child’s rows and reply composer as soon as the parent switches children', async () => {
    let finishSecond;
    const secondReady = new Promise((resolve) => { finishSecond = resolve; });
    server.use(
      http.get('*/api/children/', () => HttpResponse.json([{ id: 7, first_name: 'Abby' }, { id: 8, first_name: 'Max' }])),
      http.get('*/api/chronicle/grades/', async ({ request }) => {
        if (new URL(request.url).searchParams.get('user_id') === '8') {
          await secondReady;
          return HttpResponse.json(page([gradeEntry({ id: 24, user: 8, is_private: false, summary: 'Max reflection' })]));
        }
        return HttpResponse.json(page([gradeEntry({ user: 7, is_private: false, summary: 'Abby reflection' })]));
      }),
      http.get('*/api/chronicle/entries/23/comments/', () => HttpResponse.json([])),
    );
    const { user } = mount(buildParent());
    await user.click(await screen.findByRole('button', { name: 'Family responses' }));
    await screen.findByRole('textbox', { name: 'Your family response' });
    await user.selectOptions(screen.getByLabelText('Grades for'), '8');
    expect(screen.queryByText('Abby reflection')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Your family response' })).toBeNull();
    finishSecond();
    expect(await screen.findByText('Max reflection')).toBeInTheDocument();
  });

  it('opens capture and reloads history when the saved result is acknowledged', async () => {
    let reads = 0;
    server.use(http.get('*/api/chronicle/grades/', () => {
      reads += 1;
      return HttpResponse.json(page(reads === 1 ? [] : [gradeEntry()]));
    }));
    const { user } = mount();
    await screen.findByText('No grades recorded yet. Start with any result you want to remember.');
    await user.click(screen.getByRole('button', { name: 'Log a grade' }));
    const dialog = screen.getByRole('dialog', { name: 'Record a grade' });
    await user.click(within(dialog).getByRole('button', { name: 'Finish saving grade' }));
    expect(await screen.findByText('8 / 10 points')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(reads).toBe(2);
  });

  it('hands historical records to the correction form and refreshes their result afterward', async () => {
    let reads = 0;
    const original = gradeEntry({ occurred_on: '2025-02-03' });
    server.use(http.get('*/api/chronicle/grades/', () => {
      reads += 1;
      return HttpResponse.json(page([reads === 1 ? original : { ...original, metadata: { grade: { ...original.metadata.grade, score: '9' } } }]));
    }));
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: 'Correct grade or sharing' }));
    const dialog = screen.getByRole('dialog', { name: 'Correct recorded grade' });
    expect(within(dialog).getByText('Correcting Fractions quiz from 2025-02-03')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Finish saving grade' }));
    expect(await screen.findByText('9 / 10 points')).toBeInTheDocument();
    expect(screen.queryByText('8 / 10 points')).toBeNull();
  });

  it('reloads previously loaded history when navigation acknowledges a grade saved elsewhere', async () => {
    let reads = 0;
    server.use(http.get('*/api/chronicle/grades/', () => {
      reads += 1;
      return HttpResponse.json(page(reads === 1 ? [] : [gradeEntry()]));
    }));
    const { user } = mount(buildUser(), <OutsideSaveHarness />);
    await screen.findByText('No grades recorded yet. Start with any result you want to remember.');
    await user.click(screen.getByRole('button', { name: 'Acknowledge grade saved elsewhere' }));
    expect(await screen.findByText('8 / 10 points')).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it('keeps the parent’s selected child and history when a child-save marker appears', async () => {
    const targets = [];
    server.use(
      http.get('*/api/children/', () => HttpResponse.json([{ id: 7, first_name: 'Abby' }, { id: 8, first_name: 'Max' }])),
      http.get('*/api/chronicle/grades/', ({ request }) => {
        const target = Number(new URL(request.url).searchParams.get('user_id'));
        targets.push(target);
        return HttpResponse.json(page([gradeEntry({ id: target, user: target, is_private: false, summary: `${target} reflection` })]));
      }),
    );
    const { user } = mount(buildParent(), <OutsideSaveHarness />);
    await screen.findByText('7 reflection');
    await user.selectOptions(screen.getByLabelText('Grades for'), '8');
    await screen.findByText('8 reflection');
    await user.click(screen.getByRole('button', { name: 'Acknowledge grade saved elsewhere' }));
    expect(screen.getByLabelText('Grades for')).toHaveValue('8');
    expect(screen.getByText('8 reflection')).toBeInTheDocument();
    expect(targets).toEqual([7, 8]);
  });

  it('keeps the parent’s selected child, response draft, and loaded history when another child’s archive changes', async () => {
    const targets = [];
    server.use(
      http.get('*/api/children/', () => HttpResponse.json([{ id: 7, first_name: 'Abby' }, { id: 8, first_name: 'Max' }])),
      http.get('*/api/chronicle/grades/', ({ request }) => {
        const target = Number(new URL(request.url).searchParams.get('user_id'));
        targets.push(target);
        return HttpResponse.json(page([gradeEntry({ id: target, user: target, is_private: false, summary: `${target} reflection` })]));
      }),
      http.get('*/api/chronicle/entries/8/comments/', () => HttpResponse.json([])),
    );
    const { user } = mount(buildParent(), <OtherChildSaveHarness />);
    await screen.findByText('7 reflection');
    await user.selectOptions(screen.getByLabelText('Grades for'), '8');
    await user.click(await screen.findByRole('button', { name: 'Family responses' }));
    await user.type(await screen.findByLabelText('Your family response'), 'Keep this encouragement.');
    await user.click(screen.getByRole('button', { name: "Another child's grade saved" }));
    expect(screen.getByLabelText('Grades for')).toHaveValue('8');
    expect(screen.getByText('8 reflection')).toBeInTheDocument();
    expect(screen.getByLabelText('Your family response')).toHaveValue('Keep this encouragement.');
    expect(targets).toEqual([7, 8]);
  });

  it.each(['success', 'failure'])('immediately clears the previous parent’s child names and history before a new child-list %s', async (outcome) => {
    let finishChildren;
    const nextChildren = new Promise((resolve) => { finishChildren = resolve; });
    let requests = 0;
    server.use(
      http.get('*/api/children/', async () => {
        requests += 1;
        if (requests === 1) return HttpResponse.json([{ id: 7, first_name: 'Abby' }]);
        await nextChildren;
        return outcome === 'success' ? HttpResponse.json([{ id: 9, first_name: 'Jamie' }])
          : HttpResponse.json({ detail: 'New family list unavailable.' }, { status: 503 });
      }),
      http.get('*/api/chronicle/grades/', ({ request }) => {
        const target = Number(new URL(request.url).searchParams.get('user_id'));
        return HttpResponse.json(page([gradeEntry({ user: target, is_private: false, summary: `${target} family reflection` })]));
      }),
    );
    const { user } = mount(buildParent(), <SwitchAccountHarness nextUser={buildParent({ id: 100 })} />);
    await screen.findByText('7 family reflection');
    await user.click(screen.getByRole('button', { name: 'Switch account' }));
    expect(screen.queryByRole('option', { name: 'Abby' })).toBeNull();
    expect(screen.queryByText('7 family reflection')).toBeNull();
    await waitFor(() => expect(requests).toBe(2));
    finishChildren();
    if (outcome === 'success') expect(await screen.findByRole('option', { name: 'Jamie' })).toBeInTheDocument();
    else expect(await screen.findByRole('alert')).toHaveTextContent('New family list unavailable.');
    expect(screen.queryByRole('option', { name: 'Abby' })).toBeNull();
  });

  it('distinguishes a failed history request from an empty history and offers retry', async () => {
    let reads = 0;
    server.use(http.get('*/api/chronicle/grades/', () => {
      reads += 1;
      return reads === 1
        ? HttpResponse.json({ error: 'Could not reach recorded grades.' }, { status: 503 })
        : HttpResponse.json(page([gradeEntry()]));
    }));
    const { user } = mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach recorded grades.');
    expect(screen.queryByText(/No grades recorded yet/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('8 / 10 points')).toBeInTheDocument();
  });
});
