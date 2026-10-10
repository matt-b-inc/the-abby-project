import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { server } from '../../test/server';
import { buildUser } from '../../test/factories';
import { publishChronicleChange } from '../../hooks/useChronicleRevision';
import ChronicleHub from './index';

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return { ...actual, AnimatePresence: ({ children }) => children };
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});

function mountHistory(initialTab = 'grades') {
  let entries = [{
    id: 23, user: 1, kind: 'grade', title: 'Math · Fractions quiz',
    occurred_on: '2026-09-20', chapter_year: 2026, is_private: true, summary: '',
    metadata: { grade: { subject: 'Math', assessment: 'Fractions quiz', grade_format: 'points', score: '8', possible: '10' } },
    reward_receipt: { status: 'awarded', xp_awarded: 10 },
  }];
  const reads = { grades: 0, yearbook: 0 };
  const writes = [];
  const makeEntry = (payload, existing) => ({
    ...existing, id: existing?.id ?? 24, user: 1, kind: 'grade',
    title: `${payload.subject} · ${payload.assessment}`,
    summary: payload.reflection, occurred_on: payload.occurred_on,
    chapter_year: Number(payload.occurred_on.slice(0, 4)) - (Number(payload.occurred_on.slice(5, 7)) < 8 ? 1 : 0),
    is_private: payload.is_private, client_entry_id: payload.client_entry_id,
    metadata: { grade: Object.fromEntries(['subject', 'assessment', 'grade_format', 'score', 'possible', 'letter']
      .filter((field) => field in payload).map((field) => [field, payload[field]])) },
    reward_receipt: existing?.reward_receipt ?? { status: 'daily_limit', xp_awarded: 0 },
  });
  server.use(
    http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())),
    http.get('*/api/chronicle/grades/', () => {
      reads.grades += 1;
      return HttpResponse.json({ count: entries.length, next: null, previous: null, results: entries });
    }),
    http.get('*/api/chronicle/summary/', () => {
      reads.yearbook += 1;
      const years = [...new Set(entries.map((entry) => entry.chapter_year))];
      return HttpResponse.json({ chapters: years.map((year) => ({
        chapter_year: year, label: `Saved chapter ${year}`, is_current: year === 2026,
        stats: {}, entries: entries.filter((entry) => entry.chapter_year === year),
      })) });
    }),
    http.patch('*/api/chronicle/23/grade/', async ({ request }) => {
      const payload = await request.json();
      writes.push(payload);
      entries = entries.map((entry) => entry.id === 23 ? makeEntry(payload, entry) : entry);
      return HttpResponse.json(entries.find((entry) => entry.id === 23));
    }),
    http.post('*/api/chronicle/grades/', async ({ request }) => {
      const entry = makeEntry(await request.json());
      entries = [...entries, entry];
      return HttpResponse.json(entry, { status: 201 });
    }),
    http.get('*/api/chronicle/entries/23/comments/', () => HttpResponse.json([])),
  );
  const externalCorrection = () => {
    entries = entries.map((entry) => ({
      ...entry, is_private: false, occurred_on: '2025-09-20', chapter_year: 2025,
      metadata: { grade: { ...entry.metadata.grade, score: '10' } },
    }));
    publishChronicleChange(1);
  };
  return { ...renderWithProviders(<ChronicleHub />, { route: `/chronicle?tab=${initialTab}` }), reads, writes, externalCorrection };
}

async function visit(user, tab) {
  await user.click(screen.getByRole('tab', { name: tab }));
}

describe('retained Chronicle grade histories', () => {
  it('refreshes a previously visited Yearbook after a Grades correction and preserves confirmation until Done', async () => {
    const { user, reads, writes } = mountHistory();
    await screen.findByRole('article', { name: 'Math' });
    await visit(user, 'Yearbook');
    await screen.findByRole('button', { name: /Math · Fractions quiz/ });
    await visit(user, 'Grades');
    await user.click(screen.getByRole('button', { name: 'Correct grade or sharing' }));
    const form = screen.getByRole('dialog', { name: 'Correct grade' });
    await user.clear(within(form).getByLabelText('Points earned'));
    await user.type(within(form).getByLabelText('Points earned'), '9');
    await user.click(within(form).getByLabelText('Share with my family'));
    await user.click(within(form).getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('dialog', { name: 'Grade corrected' })).toBeInTheDocument();
    expect(reads.yearbook).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(reads.yearbook).toBe(2));
    await visit(user, 'Yearbook');
    const row = await screen.findByRole('button', { name: /Math · Fractions quiz/ });
    expect(row).toHaveTextContent('Shared with family');
    expect(row).toHaveTextContent('9 / 10 points');
    await user.click(row);
    await user.click(screen.getByRole('button', { name: 'Correct grade or sharing' }));
    const freshForm = screen.getByRole('dialog', { name: 'Correct grade' });
    expect(within(freshForm).getByLabelText('Points earned')).toHaveValue('9');
    expect(within(freshForm).getByLabelText('Share with my family')).toBeChecked();
    expect(writes).toHaveLength(1);
  });

  it('refreshes a visited Grades tab after a Yearbook correction, including a move to another chapter', async () => {
    const { user, reads } = mountHistory('yearbook');
    await screen.findByRole('button', { name: /Math · Fractions quiz/ });
    await visit(user, 'Grades');
    await screen.findByRole('article', { name: 'Math' });
    await visit(user, 'Yearbook');
    await user.click(screen.getByRole('button', { name: /Math · Fractions quiz/ }));
    await user.click(screen.getByRole('button', { name: 'Correct grade or sharing' }));
    const form = screen.getByRole('dialog', { name: 'Correct grade' });
    await user.clear(within(form).getByLabelText('Points earned'));
    await user.type(within(form).getByLabelText('Points earned'), '10');
    await user.clear(within(form).getByLabelText('Date received'));
    await user.type(within(form).getByLabelText('Date received'), '2025-09-20');
    await user.click(within(form).getByRole('button', { name: 'Save correction' }));
    await screen.findByRole('dialog', { name: 'Grade corrected' });
    expect(reads.grades).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(reads.grades).toBe(2));
    expect(await screen.findByRole('region', { name: 'Saved chapter 2025' })).toBeInTheDocument();
    await visit(user, 'Grades');
    const card = await screen.findByRole('article', { name: 'Math' });
    expect(card).toHaveTextContent('10 / 10 points');
    expect(card).toHaveTextContent(new Date(2025, 8, 20).toLocaleDateString());
    await user.click(within(card).getByRole('button', { name: 'Correct grade or sharing' }));
    expect(screen.getByRole('dialog', { name: 'Correct grade' })).toBeInTheDocument();
    expect(screen.getByLabelText('Points earned')).toHaveValue('10');
    expect(screen.getByLabelText('Date received')).toHaveValue('2025-09-20');
  });

  it('adds a newly captured grade to the already mounted Yearbook after acknowledgment', async () => {
    const { user, reads } = mountHistory('yearbook');
    await screen.findByRole('button', { name: /Math · Fractions quiz/ });
    await visit(user, 'Grades');
    await user.click(await screen.findByRole('button', { name: 'Log a grade' }));
    const form = screen.getByRole('dialog', { name: 'Log a grade' });
    await user.type(within(form).getByLabelText('Subject or class'), 'Science');
    await user.type(within(form).getByLabelText('What was graded?'), 'Lab report');
    await user.type(within(form).getByLabelText('Percentage'), '0');
    await user.click(within(form).getByRole('button', { name: 'Save grade' }));
    await screen.findByRole('dialog', { name: 'Grade remembered' });
    expect(reads.yearbook).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(reads.yearbook).toBe(2));
    await visit(user, 'Yearbook');
    const row = await screen.findByRole('button', { name: /Science · Lab report/ });
    expect(row).toHaveTextContent('Only you');
    expect(row).toHaveTextContent('0%');
  });

  it.each(['detail', 'correction'])('clears an open stale Yearbook %s and rebases a kept reflection draft on the current result', async (mode) => {
    const { user, externalCorrection, writes } = mountHistory('yearbook');
    await user.click(await screen.findByRole('button', { name: /Math · Fractions quiz/ }));
    if (mode === 'correction') {
      await user.click(screen.getByRole('button', { name: 'Correct grade or sharing' }));
      await user.type(screen.getByLabelText('Reflection (optional)'), 'A reflection to keep.');
    }
    act(() => externalCorrection());
    expect(screen.queryByRole('dialog')).toBeNull();
    const row = await screen.findByRole('button', { name: /Math · Fractions quiz/ });
    expect(row).toHaveTextContent('10 / 10 points');
    expect(row).toHaveTextContent('Shared with family');
    await user.click(row);
    await user.click(screen.getByRole('button', { name: 'Correct grade or sharing' }));
    expect(screen.getByLabelText('Points earned')).toHaveValue('10');
    expect(screen.getByLabelText('Share with my family')).toBeChecked();
    expect(screen.getByLabelText('Date received')).toHaveValue('2025-09-20');
    if (mode === 'correction') {
      expect(screen.getByLabelText('Reflection (optional)')).toHaveValue('A reflection to keep.');
      await user.click(screen.getByRole('button', { name: 'Save correction' }));
      await screen.findByRole('dialog', { name: 'Grade corrected' });
      expect(writes[0]).toMatchObject({ score: '10', is_private: false, reflection: 'A reflection to keep.' });
    }
  });
});
