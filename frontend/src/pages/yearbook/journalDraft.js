const KEY_PREFIX = 'abby:journal-draft:v1:';
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function journalDraftKey(userId) {
  return userId ? `${KEY_PREFIX}${userId}` : null;
}

export function newJournalRequestId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  // Safari supports getRandomValues in contexts where randomUUID is absent.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function readJournalDraft(userId) {
  const key = journalDraftKey(userId);
  if (!key) return null;
  try {
    const draft = JSON.parse(window.localStorage.getItem(key));
    if (!draft || draft.version !== 1 || !UUID_PATTERN.test(draft.client_entry_id)
      || typeof draft.title !== 'string' || typeof draft.summary !== 'string'
      || typeof draft.is_private !== 'boolean'
      || !['create', 'edit'].includes(draft.mode)) return null;
    // Validate persisted pending writes before replaying anything to the API.
    const pending = draft.pending;
    if (pending && (!['post', 'patch'].includes(pending.method)
      || (pending.method === 'patch' && !Number.isInteger(pending.entry_id))
      || !pending.payload || typeof pending.payload.is_private !== 'boolean'
      || (pending.method === 'post' && pending.payload.client_entry_id !== draft.client_entry_id)
      || (pending.method === 'post' && (typeof pending.payload.title !== 'string'
        || typeof pending.payload.summary !== 'string')))) return null;
    return draft;
  } catch {
    return null;
  }
}

export function storeJournalDraft(userId, draft) {
  const key = journalDraftKey(userId);
  if (!key) return false;
  try {
    // Keep only the capture fields and replay request, never credentials or
    // an entire API entry (which can contain family replies and other data).
    window.localStorage.setItem(key, JSON.stringify({
      version: 1,
      client_entry_id: draft.client_entry_id,
      mode: draft.mode,
      entry_id: draft.entry?.id ?? null,
      title: draft.title,
      summary: draft.summary,
      is_private: draft.is_private,
      pending: draft.pending ?? null,
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearJournalDraft(userId, clientEntryId, savedDraft) {
  const key = journalDraftKey(userId);
  if (!key) return;
  try {
    // A response from another tab must not erase a newer capture draft.
    const current = readJournalDraft(userId);
    if (clientEntryId && current?.client_entry_id !== clientEntryId) return;
    if (savedDraft && ['title', 'summary', 'is_private'].some((field) => current?.[field] !== savedDraft[field])) return;
    window.localStorage.removeItem(key);
  } catch {
    // A saved entry is already on the server, even if device cleanup fails.
  }
}
