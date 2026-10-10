import { describe, expect, it, vi } from 'vitest';
import {
  clearGradeDraft, GRADE_LETTERS, gradeDraftKey, gradePayload, newGradeRequestId,
  readGradeDraft, storeGradeDraft, validateGradeFields,
} from './gradeDraft';

function draft(overrides = {}) {
  return {
    mode: 'create', entry_id: null, client_entry_id: newGradeRequestId(),
    subject: 'Math', assessment: 'Quiz', grade_format: 'percentage',
    score: '0', possible: '', letter: '', reflection: '',
    occurred_on: '2026-01-01', is_private: true, pending: null,
    ...overrides,
  };
}

describe('grade fields and payloads', () => {
  it('accepts zero, points with extra credit, and every supported letter without converting their formats', () => {
    expect(validateGradeFields(draft())).toEqual({});
    expect(validateGradeFields(draft({ grade_format: 'points', score: '105.5', possible: '100' }))).toEqual({});
    for (const letter of GRADE_LETTERS) expect(validateGradeFields(draft({ grade_format: 'letter', letter }))).toEqual({});
  });

  it.each([
    [{ score: '' }, 'score'], [{ score: '-1' }, 'score'], [{ score: '101' }, 'score'],
    [{ score: '1e2' }, 'score'], [{ grade_format: 'points', possible: '0' }, 'possible'],
    [{ grade_format: 'points', possible: '' }, 'possible'],
    [{ grade_format: 'letter', letter: 'Z' }, 'letter'],
    [{ subject: ' ' }, 'subject'], [{ assessment: '' }, 'assessment'],
    [{ occurred_on: '2026-02-30' }, 'occurred_on'], [{ occurred_on: '2027-01-01' }, 'occurred_on'],
  ])('validates %j beside its own field', (overrides, field) => {
    expect(validateGradeFields(draft(overrides), '2026-10-09')[field]).toBeTruthy();
  });

  it('enforces text limits and preserves optional reflections', () => {
    const errors = validateGradeFields(draft({ subject: 's'.repeat(81), assessment: 'a'.repeat(81), reflection: 'x'.repeat(4001) }));
    expect(Object.keys(errors)).toEqual(['subject', 'assessment', 'reflection']);
    expect(gradePayload(draft({ reflection: ' A difficult day.\nI tried again.' })).reflection).toBe(' A difficult day.\nI tried again.');
  });

  it('sends only the active format fields and preserves decimal strings', () => {
    const values = draft({ subject: ' Math ', score: '82.50', possible: '100', letter: 'B' });
    expect(gradePayload(values, values.client_entry_id)).toMatchObject({ subject: 'Math', score: '82.50', client_entry_id: values.client_entry_id });
    expect(gradePayload(values)).not.toHaveProperty('possible');
    expect(gradePayload(values)).not.toHaveProperty('letter');
    expect(gradePayload(values)).not.toHaveProperty('client_entry_id');
    expect(gradePayload({ ...values, grade_format: 'points' })).toMatchObject({ score: '82.50', possible: '100' });
    expect(gradePayload({ ...values, grade_format: 'letter' })).toHaveProperty('letter', 'B');
    expect(gradePayload({ ...values, grade_format: 'letter' })).not.toHaveProperty('score');
  });
});

describe('grade device drafts', () => {
  it('separates user/create/edit drafts and whitelists capture and replay fields', () => {
    const values = draft({ token: 'secret-token', entry: { metadata: { unrelated: 'not saved' } } });
    values.pending = { method: 'post', password: 'not saved', payload: { ...gradePayload(values, values.client_entry_id), token: 'not saved' } };
    expect(storeGradeDraft(1, values)).toBe(true);
    expect(readGradeDraft(1)).toMatchObject({ score: '0', pending: { payload: { score: '0' } } });
    expect(localStorage.getItem(gradeDraftKey(1))).not.toMatch(/token|password|unrelated|secret/);
    expect(readGradeDraft(2)).toBeNull();
    const editing = draft({ mode: 'edit', entry_id: 23, score: '91', baseline: { ...draft({ score: '90' }), token: 'not-saved' } });
    storeGradeDraft(1, editing);
    expect(readGradeDraft(1, 'edit', 23).score).toBe('91');
    expect(readGradeDraft(1, 'edit', 23).baseline.score).toBe('90');
    expect(localStorage.getItem(gradeDraftKey(1, 'edit', 23))).not.toMatch(/token|not-saved|client_entry_id.*client_entry_id/);
    expect(readGradeDraft(1).score).toBe('0');
    expect(readGradeDraft(1, 'edit', 24)).toBeNull();
  });

  it('retains incomplete input as a draft while requiring valid immutable replay fields', () => {
    const incomplete = draft({ subject: '', assessment: '', score: 'oops', occurred_on: '' });
    storeGradeDraft(1, incomplete);
    expect(readGradeDraft(1).score).toBe('oops');
    incomplete.pending = { method: 'post', payload: gradePayload(incomplete, incomplete.client_entry_id) };
    storeGradeDraft(1, incomplete);
    expect(readGradeDraft(1)).toBeNull();
  });

  it.each(['format', 'identity', 'extra field', 'different value', 'target', 'privacy'])('rejects a corrupt %s in stored replay state', (corruption) => {
    const values = draft();
    storeGradeDraft(1, values);
    const raw = JSON.parse(localStorage.getItem(gradeDraftKey(1)));
    raw.pending = { method: 'post', payload: gradePayload(values, values.client_entry_id) };
    if (corruption === 'format') raw.grade_format = 'gpa';
    if (corruption === 'identity') raw.pending.payload.client_entry_id = newGradeRequestId();
    if (corruption === 'extra field') raw.pending.payload.possible = '100';
    if (corruption === 'different value') raw.pending.payload.score = '90';
    if (corruption === 'target') raw.pending = { method: 'patch', entry_id: 23, payload: gradePayload(values) };
    if (corruption === 'privacy') raw.is_private = 'false';
    localStorage.setItem(gradeDraftKey(1), JSON.stringify(raw));
    expect(readGradeDraft(1)).toBeNull();
  });

  it('rejects broken JSON and reports unavailable/anonymous storage without claiming a saved draft', () => {
    expect(storeGradeDraft(null, draft())).toBe(false);
    localStorage.setItem(gradeDraftKey(1), 'not-json');
    expect(readGradeDraft(1)).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try { expect(storeGradeDraft(1, draft())).toBe(false); } finally { spy.mockRestore(); }
  });

  it('preserves a newer tab\'s fields when an older save completes', () => {
    const older = draft();
    storeGradeDraft(1, { ...older, reflection: 'A newer thought' });
    clearGradeDraft(1, older);
    expect(readGradeDraft(1).reflection).toBe('A newer thought');
    clearGradeDraft(1, { ...older, reflection: 'A newer thought' });
    expect(readGradeDraft(1)).toBeNull();
  });

  it('generates a Safari-compatible UUID when randomUUID is absent', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes) => { bytes.fill(1); return bytes; } });
    try { expect(newGradeRequestId()).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i); }
    finally { vi.unstubAllGlobals(); }
  });
});
