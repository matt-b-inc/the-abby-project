import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BookOpen, Lock, Pencil, Users } from 'lucide-react';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import ErrorAlert from '../../components/ErrorAlert';
import Loader from '../../components/Loader';
import RuneBadge from '../../components/journal/RuneBadge';
import GradeRecordDetails from '../../components/chronicle/GradeRecordDetails';
import JournalConversation from '../../components/chronicle/JournalConversation';
import { SelectField } from '../../components/form';
import { useRole } from '../../hooks/useRole';
import useChronicleRevision from '../../hooks/useChronicleRevision';
import { getChildren, getGrades } from '../../api';
import { formatDate } from '../../utils/format';
import { normalizeList } from '../../utils/api';
import GradeEntryFormModal from './GradeEntryFormModal';

export default function GradesPage() {
  const { user, isParent } = useRole();
  if (!user?.id) return <Loader />;
  return <AccountGradesPage key={`${user.id}:${user.role}`} user={user} isParent={isParent} />;
}

function AccountGradesPage({ user, isParent }) {
  const location = useLocation();
  const [children, setChildren] = useState(null);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [childError, setChildError] = useState(null);
  const [retryChildren, setRetryChildren] = useState(0);

  useEffect(() => {
    if (!isParent) return undefined;
    let cancelled = false;
    getChildren()
      .then((response) => {
        if (cancelled) return;
        const list = normalizeList(response);
        setChildren(list);
        setSelectedChildId((selected) => list.some((child) => child.id === selected) ? selected : list[0]?.id ?? null);
        setChildError(null);
      })
      .catch((err) => { if (!cancelled) setChildError(err.message); });
    return () => { cancelled = true; };
  }, [isParent, user?.id, retryChildren]);

  const targetUserId = isParent ? selectedChildId : user?.id;
  const revision = useChronicleRevision(targetUserId);
  const savedGradeMarker = isParent ? '' : location.state?.gradeSavedId ?? '';
  return (
    <section className="space-y-4" aria-label="Recorded grades">
      <div className="space-y-2">
        <h1 className="font-display text-lede">Grades over time</h1>
        <p className="text-body text-ink-secondary">{isParent
          ? 'Shared school results and reflections, saved over time.'
          : 'Record a school result and what you want to remember. Recording it counts; the reward does not depend on the grade.'}</p>
      </div>
      {isParent && children?.length > 0 && (
        <SelectField
          label="Grades for"
          value={selectedChildId ?? ''}
          onChange={(event) => setSelectedChildId(Number(event.target.value))}
          className="max-w-xs"
        >
          {children.map((child) => <option key={child.id} value={child.id}>{child.display_name || child.first_name || child.username}</option>)}
        </SelectField>
      )}
      {childError ? (
        <ErrorAlert message={childError} onRetry={() => setRetryChildren((value) => value + 1)} />
      ) : isParent && children?.length === 0 ? (
        <EmptyState><p>No children yet. Add a child account to see shared grades here.</p></EmptyState>
      ) : targetUserId ? (
        <GradeHistory key={`${user?.id}:${targetUserId}:${isParent}:${savedGradeMarker}:${revision}`} targetUserId={targetUserId} isParent={isParent} />
      ) : <Loader />}
    </section>
  );
}

function GradeHistory({ targetUserId, isParent }) {
  const [state, setState] = useState({ entries: null, count: 0, next: null, loading: true, error: null, moreError: null, loadingMore: false });
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const generation = useRef(0);
  const pendingPage = useRef(null);

  const filterEntries = (response) => normalizeList(response).filter((entry) =>
    entry.kind === 'grade' && entry.user === targetUserId && (!isParent || entry.is_private === false));

  useEffect(() => {
    const version = ++generation.current;
    getGrades(isParent ? { user_id: targetUserId } : {})
      .then((response) => {
        if (generation.current !== version) return;
        const entries = normalizeList(response).filter((entry) =>
          entry.kind === 'grade' && entry.user === targetUserId && (!isParent || entry.is_private === false));
        setState({ entries, count: response?.count ?? entries.length, next: response?.next ?? null, loading: false, error: null, moreError: null, loadingMore: false });
      })
      .catch((err) => {
        if (generation.current === version) setState((prev) => ({ ...prev, loading: false, error: err.message }));
      });
    return () => { generation.current += 1; };
  }, [targetUserId, isParent, reloadKey]);

  const reload = () => {
    generation.current += 1;
    pendingPage.current = null;
    setState((prev) => ({ ...prev, loading: true, loadingMore: false, error: null, moreError: null }));
    setReloadKey((value) => value + 1);
  };

  const loadMore = async () => {
    if (!state.next || state.loading || pendingPage.current) return;
    const request = Symbol('grade page');
    const version = generation.current;
    pendingPage.current = request;
    setState((prev) => ({ ...prev, loadingMore: true, moreError: null }));
    try {
      const nextParams = Object.fromEntries(new URL(state.next, window.location.origin).searchParams);
      // Query parameters continue through the known API helper. A server next
      // URL never becomes a fetch destination, and the selected child wins.
      const response = await getGrades({ ...nextParams, user_id: isParent ? targetUserId : undefined });
      if (generation.current !== version) return;
      setState((prev) => {
        const entries = new Map((prev.entries ?? []).map((entry) => [entry.id, entry]));
        for (const entry of filterEntries(response)) entries.set(entry.id, entry);
        return { ...prev, entries: [...entries.values()], count: response?.count ?? prev.count, next: response?.next ?? null, loadingMore: false, moreError: null };
      });
    } catch (err) {
      if (generation.current === version) setState((prev) => ({ ...prev, loadingMore: false, moreError: err.message || 'Could not load earlier grades.' }));
    } finally {
      if (pendingPage.current === request) pendingPage.current = null;
    }
  };

  return (
    <div className="space-y-4">
      {!isParent && (
        <Button onClick={() => setCreating(true)} className="inline-flex items-center gap-2">
          <BookOpen size={16} aria-hidden="true" /> Log a grade
        </Button>
      )}
      <ErrorAlert message={state.error} onRetry={reload} />
      {state.entries === null ? (state.error ? null : <Loader />) : (
        <>
          {state.entries.length === 0 && (
            <EmptyState><p>{state.next
              ? 'No visible results on this page. Load earlier entries to continue.'
              : isParent ? 'No shared grades yet. They will appear here when a school result is shared with the family.'
                : 'No grades recorded yet. Start with any result you want to remember.'}</p></EmptyState>
          )}
          {state.entries.length > 0 && (
            <>
              <p className="text-caption text-ink-whisper">Showing {state.entries.length} of {state.count} recorded grades</p>
              <ul className="space-y-4" aria-label="Grade history">
                {state.entries.map((entry) => <GradeRecordCard key={entry.id} entry={entry} canEdit={!isParent} onUpdated={reload} />)}
              </ul>
            </>
          )}
          <ErrorAlert message={state.moreError} />
          {state.next && (
            <Button variant="secondary" loading={state.loadingMore} disabled={state.loading || state.loadingMore} onClick={loadMore}>
              {state.moreError ? 'Try loading earlier grades again' : 'Load earlier grades'}
            </Button>
          )}
          {state.loading && <p role="status" className="text-body">Refreshing recorded grades…</p>}
        </>
      )}
      {creating && (
        <GradeEntryFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />
      )}
    </div>
  );
}

function GradeRecordCard({ entry, canEdit, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const isPrivate = entry.is_private !== false;
  const grade = entry.metadata?.grade;
  return (
    <li>
      <article className="parchment-card p-4 space-y-3" aria-labelledby={`grade-entry-${entry.id}-title`}>
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id={`grade-entry-${entry.id}-title`} className="font-serif text-lede">{grade?.subject || entry.title || 'School result'}</h2>
            <p className="text-caption text-ink-whisper">{formatDate(entry.occurred_on)}</p>
          </div>
          <RuneBadge tone="ink" size="sm" icon={isPrivate ? <Lock size={10} aria-hidden="true" /> : <Users size={10} aria-hidden="true" />}>
            {isPrivate ? 'Only you' : 'Shared with family'}
          </RuneBadge>
        </header>
        <GradeRecordDetails entry={entry} showSubject={false} />
        {entry.summary && <div className="space-y-2"><p className="font-semibold text-caption">Reflection</p><p className="text-body whitespace-pre-wrap break-words leading-relaxed">{entry.summary}</p></div>}
        <JournalConversation entry={entry} />
        {canEdit && <Button variant="secondary" onClick={() => setEditing(true)} className="inline-flex items-center gap-2"><Pencil size={14} aria-hidden="true" /> Correct grade or sharing</Button>}
      </article>
      {editing && <GradeEntryFormModal mode="edit" entry={entry} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onUpdated(); }} />}
    </li>
  );
}
