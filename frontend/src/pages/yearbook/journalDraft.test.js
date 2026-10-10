import { describe, it, expect, vi } from 'vitest';
import {
  clearJournalDraft, journalDraftKey, newJournalRequestId, readJournalDraft, storeJournalDraft,
} from './journalDraft';

function draft(overrides = {}) {
  return {
    mode: 'create', title: 'Today', summary: 'I tried something new.',
    is_private: true, client_entry_id: newJournalRequestId(), pending: null,
    ...overrides,
  };
}

describe('journal draft storage', () => {
  it('keeps capture fields per user without persisting an entry or credentials', () => {
    const data = draft({ token: 'never-store', entry: { id: 2, private_metadata: 'exclude' } });
    expect(storeJournalDraft(10, data)).toBe(true);
    expect(readJournalDraft(10)).toMatchObject({ title: 'Today', entry_id: 2 });
    expect(readJournalDraft(11)).toBeNull();
    expect(localStorage.getItem(journalDraftKey(10))).not.toMatch(/never-store|private_metadata/);
    clearJournalDraft(10);
    expect(readJournalDraft(10)).toBeNull();
  });

  it('does not persist an anonymous shared-device draft', () => {
    expect(storeJournalDraft(null, draft())).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('does not let a late response erase another tab\'s newer draft', () => {
    const older = draft();
    const newer = draft({ summary: 'Another memory' });
    storeJournalDraft(1, newer);
    clearJournalDraft(1, older.client_entry_id);
    expect(readJournalDraft(1).summary).toBe('Another memory');
    clearJournalDraft(1, newer.client_entry_id);
    expect(readJournalDraft(1)).toBeNull();
  });

  it('preserves words added in another tab even when both opened the same draft', () => {
    const original = draft();
    storeJournalDraft(1, { ...original, summary: 'An extra thought' });
    clearJournalDraft(1, original.client_entry_id, original);
    expect(readJournalDraft(1).summary).toBe('An extra thought');
  });

  it('rejects corrupt storage and malformed replay requests', () => {
    localStorage.setItem(journalDraftKey(1), 'not-json');
    expect(readJournalDraft(1)).toBeNull();
    const data = draft({ pending: { method: 'post', payload: { client_entry_id: 'different', is_private: true } } });
    storeJournalDraft(1, data);
    expect(readJournalDraft(1)).toBeNull();
  });

  it('reports unavailable storage without claiming a draft was kept', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(storeJournalDraft(1, draft())).toBe(false);
    spy.mockRestore();
  });

  it('can generate a UUID with Safari getRandomValues when randomUUID is absent', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes) => { bytes.fill(1); return bytes; } });
    expect(newJournalRequestId()).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
    vi.unstubAllGlobals();
  });
});
