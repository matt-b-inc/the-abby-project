import { useEffect, useId, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import Button from '../Button';
import ErrorAlert from '../ErrorAlert';
import { TextAreaField } from '../form';
import { useRole } from '../../hooks/useRole';
import { addChronicleComment, getChronicleComments } from '../../api';
import { fieldErrors, normalizeList } from '../../utils/api';

const DRAFT_PREFIX = 'abby:journal-response:';

function readDraft(key) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key));
    if (typeof saved?.body !== 'string') return { body: '', pending: null };
    const pending = saved.pending;
    if (pending && typeof pending.body === 'string'
        && typeof pending.client_comment_id === 'string') {
      return { body: pending.body, pending };
    }
    return { body: saved.body, pending: null };
  } catch {
    return { body: '', pending: null };
  }
}

function persistDraft(key, draft) {
  try {
    if (!draft.body && !draft.pending) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function clearSavedDraft(key, payload) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key));
    // Another browser tab can have started a newer response while this
    // request was in flight. Only erase the exact capture we just confirmed.
    if (stored?.pending?.client_comment_id === payload.client_comment_id
      && stored.pending.body === payload.body && stored.body === payload.body) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Confirmation is on the server; disabled storage must not undo it.
  }
}

function mergeComments(existing, incoming) {
  const byId = new Map((existing ?? []).map((comment) => [comment.id, comment]));
  for (const comment of incoming) {
    if (!byId.has(comment.id)) byId.set(comment.id, comment);
  }
  // Reads can predate a completed write, so retain known comments and put
  // both sources back into chronological order after merging.
  return [...byId.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

async function sendWithDeadline(request) {
  let timer;
  try {
    return await Promise.race([
      request(),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('The connection took too long.')), 20000);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

function commentId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function JournalConversation({ entry, defaultOpen = false }) {
  const { user, isParent } = useRole();
  if (!user || !['journal', 'grade'].includes(entry.kind) || entry.is_private !== false) return null;
  if (!isParent && entry.user !== user.id) return null;
  // Entry and author scope both the mounted state and the recoverable draft.
  return (
    <ConversationThread
      key={`${entry.id}:${user.id}`}
      entryId={entry.id}
      userId={user.id}
      defaultOpen={defaultOpen}
    />
  );
}

function ConversationThread({ entryId, userId, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [comments, setComments] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const draftKey = `${DRAFT_PREFIX}${userId}:${entryId}`;
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [bodyError, setBodyError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const panelId = useId();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    getChronicleComments(entryId)
      .then((response) => {
        if (!cancelled) {
          setComments((prev) => mergeComments(prev, normalizeList(response)));
          setLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'Could not load family responses.');
      });
    return () => { cancelled = true; };
  }, [entryId, open, reloadKey]);

  const changeDraft = (next) => {
    setDraft(next);
    setStorageFailed(!persistDraft(draftKey, next));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    const body = draft.pending?.body ?? draft.body.trim();
    if (!body) {
      setBodyError('Write a response before sending.');
      return;
    }
    const payload = draft.pending ?? { body, client_comment_id: commentId() };
    changeDraft({ body, pending: payload });
    inFlight.current = true;
    setSaving(true);
    setSaveError(null);
    setBodyError(null);
    setSaved(false);
    try {
      const response = await sendWithDeadline(() => addChronicleComment(entryId, payload));
      clearSavedDraft(draftKey, payload);
      if (!alive.current) return;
      setComments((prev) => mergeComments(prev, [response]));
      setDraft({ body: '', pending: null });
      setSaved(true);
    } catch (err) {
      if (!alive.current) return;
      if (err.status >= 400 && err.status < 500) {
        changeDraft({ body, pending: null });
        const fields = fieldErrors(err);
        if (fields.body) setBodyError(fields.body);
        else setSaveError(err.message || 'Could not save this response.');
      } else {
        setSaveError('We could not confirm whether your response saved. Check again to safely finish saving the same response.');
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return (
    <section className="border-t border-ink-page-shadow pt-3 space-y-3" aria-label="Family responses">
      <Button
        variant="ghost"
        className="inline-flex items-center gap-2"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) {
            setLoadError(null);
          }
          setOpen((value) => !value);
        }}
      >
        <MessageCircle size={16} aria-hidden="true" /> Family responses
        {comments?.length > 0 && <span>({comments.length})</span>}
      </Button>
      {open && (
        <div id={panelId} className="space-y-3">
          <p className="text-caption text-ink-whisper">Your family can respond here. Responses stay with this shared memory.</p>
          {loadError ? (
            <ErrorAlert message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
          ) : comments === null ? (
            <p role="status" aria-busy="true" className="text-body">Loading family responses…</p>
          ) : (
            <>
              {comments.length === 0 ? (
                <p className="text-body text-ink-whisper">No responses yet. Leave a little encouragement or start a conversation.</p>
              ) : (
                <ol className="space-y-3" aria-label="Responses to this memory">
                  {comments.map((comment) => (
                    <li key={comment.id} className="rounded-lg border border-ink-page-shadow p-3 space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-caption">
                        <span className="font-semibold">{comment.author_name}{comment.author === userId ? ' (you)' : ''}</span>
                        <time dateTime={comment.created_at} className="text-ink-whisper">
                          {new Date(comment.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                        </time>
                      </div>
                      <p className="text-body whitespace-pre-wrap break-words leading-relaxed">{comment.body}</p>
                    </li>
                  ))}
                </ol>
              )}
              <form onSubmit={submit} className="space-y-3">
                <TextAreaField
                  label="Your family response"
                  value={draft.body}
                  rows={3}
                  maxLength={2000}
                  disabled={saving || !!draft.pending}
                  error={bodyError}
                  helpText={draft.pending ? 'This response is waiting for confirmation. Check again before writing another.' : 'A note, a question, or a little encouragement.'}
                  onChange={(event) => {
                    changeDraft({ body: event.target.value, pending: null });
                    setBodyError(null);
                    setSaved(false);
                  }}
                />
                <ErrorAlert message={saveError} />
                {storageFailed && <p role="status" className="text-caption text-ink-whisper">This browser could not keep your response draft. Keep this open until saving finishes.</p>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p role="status" aria-live="polite" className="text-caption text-moss-deep">{saved ? 'Response saved with this memory.' : ''}</p>
                  <Button type="submit" loading={saving} disabled={saving || !draft.body.trim()}>
                    {draft.pending ? 'Check response' : 'Send response'}
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}
