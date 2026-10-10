import { useEffect, useMemo, useState } from 'react';
import { Lock, PenTool, Users } from 'lucide-react';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import ErrorAlert from '../../components/ErrorAlert';
import Loader from '../../components/Loader';
import RuneBadge from '../../components/journal/RuneBadge';
import JournalConversation from '../../components/chronicle/JournalConversation';
import { SelectField } from '../../components/form';
import TomeShelf from '../../components/atlas/TomeShelf';
import { chapterMark, PROGRESS_TIER } from '../../components/atlas/mastery.constants';
import { useRole } from '../../hooks/useRole';
import { getChildren, getChronicleSummary, getTodayJournal } from '../../api';
import { normalizeList } from '../../utils/api';
import JournalEntryFormModal from '../yearbook/JournalEntryFormModal';

const ACTIVE_CHAPTER_KEY_PREFIX = 'atlas:journal:active-chapter:';

/**
 * JournalReader — Chronicle's middle tab. A continuous-reading view of the
 * user's journal entries (newest-first), with a write/edit affordance for
 * children. Parents pick a child and read their entries; the write button
 * never appears for parents because the journal endpoint is self-scoped on
 * the backend (writes are bound to request.user).
 *
 * Reuses JournalEntryFormModal — same modal that the Quick Actions FAB row
 * launches — so create/edit semantics (409 race recovery, same-day edit
 * lock, dictation) stay in lockstep across both entry points.
 */
export default function JournalReader() {
  const { user, isParent } = useRole();

  // children === null means "not fetched yet" — distinct from [] which
  // means "fetched, parent has no kids." Without this distinction the
  // no-children empty state would flash on parent mount before getChildren
  // resolves.
  const [children, setChildren] = useState(null);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const targetUserId = isParent ? selectedChildId : user?.id;

  const [todayJournal, setTodayJournal] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [modalEntry, setModalEntry] = useState(null);

  // chapters === null means "haven't fetched yet" — distinct from "fetched
  // and got zero." Re-fetches keep the prior chapters visible until the new
  // ones arrive (no flash of loader).
  const [loadedChapters, setLoadedChapters] = useState(null);
  // A child switch must not briefly relabel another child's memories or
  // leave their reply composer active while the next request is loading.
  const chapters = loadedChapters && loadedChapters.userId === targetUserId ? loadedChapters.chapters : null;
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Per-(target child) override for the active chapter-year tome. Effective
  // active id is derived during render so the shelf self-heals when the
  // chapter list shifts beneath us.
  const [activeChapterOverride, setActiveChapterOverride] = useState({});

  // Parent path: load child list, default-select the first.
  useEffect(() => {
    if (!isParent) return undefined;
    let cancelled = false;
    getChildren()
      .then((res) => {
        if (cancelled) return;
        const list = normalizeList(res);
        setChildren(list);
        if (list.length > 0) {
          setSelectedChildId((prev) => prev ?? list[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [isParent]);

  // Child path: pre-fetch today's entry to label the write button.
  useEffect(() => {
    if (isParent) return undefined;
    let cancelled = false;
    getTodayJournal()
      .then((res) => {
        if (!cancelled) setTodayJournal(res && res.id ? res : null);
      })
      .catch(() => {
        if (!cancelled) setTodayJournal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isParent, user?.id]);

  // Fetch the chronicle summary once we have a target. Error clearing
  // happens in the .then() / .catch() callbacks (not synchronously in the
  // effect body) so the success path naturally heals stale errors.
  useEffect(() => {
    if (!targetUserId) return undefined;
    let cancelled = false;
    getChronicleSummary(isParent ? targetUserId : undefined)
      .then((res) => {
        if (cancelled) return;
        setLoadedChapters({ userId: targetUserId, chapters: res?.chapters ?? [] });
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [targetUserId, isParent, reloadKey]);

  // Group journal entries by chapter year — preserves the year for the
  // shelf-of-tomes UX so kids can flip between Sophomore Year / Freshman
  // Year / Grade 8, mirroring how the Yearbook tab shows the same chapters.
  // Sorted chronologically (oldest → newest) so §I → §N reads left-to-right.
  const journalChapters = useMemo(() => {
    if (!chapters) return null;
    const buckets = chapters
      .map((c) => ({
        chapter_year: c.chapter_year,
        label: c.label || `Chapter ${c.chapter_year}`,
        is_current: !!c.is_current,
        entries: (c.entries ?? [])
          .filter((e) => e.kind === 'journal' && (!isParent || e.is_private === false))
          .sort((a, b) => (b.occurred_on || '').localeCompare(a.occurred_on || '')),
      }))
      .filter((c) => c.entries.length > 0)
      .sort((a, b) => a.chapter_year - b.chapter_year);
    return buckets;
  }, [chapters, isParent]);

  const activeChapterId = useMemo(() => {
    if (!journalChapters || !journalChapters.length || !targetUserId) return null;
    const override = activeChapterOverride[targetUserId];
    if (override && journalChapters.some((c) => String(c.chapter_year) === override)) {
      return override;
    }
    let stored = null;
    try {
      stored = window.localStorage?.getItem(
        `${ACTIVE_CHAPTER_KEY_PREFIX}${targetUserId}`,
      );
    } catch {
      stored = null;
    }
    if (stored && journalChapters.some((c) => String(c.chapter_year) === stored)) {
      return stored;
    }
    const current = journalChapters.find((c) => c.is_current);
    return current
      ? String(current.chapter_year)
      : String(journalChapters[journalChapters.length - 1].chapter_year);
  }, [journalChapters, targetUserId, activeChapterOverride]);

  const setActiveChapterId = (id) => {
    if (!targetUserId) return;
    setActiveChapterOverride((prev) => ({ ...prev, [targetUserId]: id }));
    try {
      window.localStorage?.setItem(`${ACTIVE_CHAPTER_KEY_PREFIX}${targetUserId}`, id);
    } catch {
      // ignore quota / disabled storage
    }
  };

  const activeChapter = useMemo(() => {
    if (!journalChapters) return null;
    return (
      journalChapters.find((c) => String(c.chapter_year) === activeChapterId)
      || journalChapters[journalChapters.length - 1]
      || null
    );
  }, [journalChapters, activeChapterId]);

  const shelfItems = useMemo(() => {
    if (!journalChapters) return [];
    return journalChapters.map((chapter, idx) => ({
      id: String(chapter.chapter_year),
      name: chapter.label,
      icon: chapterMark(idx),
      chip: `×${chapter.entries.length}`,
      // A chapter year isn't a "completion" concept, so the foot band stays
      // a thin hairline. Tier just colors the band (rising for current).
      progressPct: null,
      tier: chapter.is_current ? PROGRESS_TIER.rising : PROGRESS_TIER.nascent,
      ariaLabel: `${chapter.label}, ${chapter.entries.length} journal entr${chapter.entries.length === 1 ? 'y' : 'ies'}`,
    }));
  }, [journalChapters]);

  const openWriteModal = () => {
    if (todayJournal && todayJournal.id) {
      setModalMode('edit');
      setModalEntry(todayJournal);
    } else {
      setModalMode('create');
      setModalEntry(null);
    }
    setModalOpen(true);
  };

  const handleSaved = (saved) => {
    setModalOpen(false);
    if (saved && saved.id) setTodayJournal(saved);
    setReloadKey((k) => k + 1);
  };

  const writeLabel = todayJournal && todayJournal.id
    ? "Edit today’s entry"
    : "Write today’s entry";

  return (
    <div className="space-y-4">
      <p className="font-script text-sm text-ink-whisper text-center max-w-xl mx-auto">
        a continuous record of your days · written in your own hand
      </p>

      {isParent && (children?.length ?? 0) > 0 && (
        <div className="flex items-end justify-between gap-3">
          <SelectField
            id="journal-child-picker"
            label="Reading"
            value={selectedChildId ?? ''}
            onChange={(e) => setSelectedChildId(parseInt(e.target.value, 10))}
            className="flex-1 max-w-xs"
          >
            {children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.first_name || child.username}
              </option>
            ))}
          </SelectField>
        </div>
      )}

      {!isParent && (
        <div className="flex justify-center">
          <Button
            variant="primary"
            onClick={openWriteModal}
            className="inline-flex items-center gap-2"
          >
            <PenTool size={16} aria-hidden="true" />
            {writeLabel}
          </Button>
        </div>
      )}

      <JournalBody
        error={error}
        chapters={journalChapters}
        activeChapter={activeChapter}
        shelfItems={shelfItems}
        activeChapterId={activeChapterId}
        onSelectChapter={setActiveChapterId}
        isParent={isParent}
        kids={children}
        targetUserId={targetUserId}
      />

      {modalOpen && (
        <JournalEntryFormModal
          mode={modalMode}
          entry={modalEntry}
          onClose={() => setModalOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function JournalBody({
  error, chapters, activeChapter, shelfItems, activeChapterId, onSelectChapter,
  isParent, kids, targetUserId,
}) {
  if (error) {
    return <ErrorAlert message={error?.message || 'Could not load journal entries.'} />;
  }
  // Parent whose child fetch resolved with an empty list — show the
  // "create a child" empty state. `kids === null` means "still loading" so
  // we fall through to the loader instead of flashing the empty state.
  if (isParent && kids !== null && kids.length === 0) {
    return (
      <EmptyState>
        <p className="font-semibold mb-1">No children yet</p>
        <p>Create a child account on the Manage page to read their journal.</p>
      </EmptyState>
    );
  }
  // While the parent has selected nothing yet (children loading or auto-
  // selecting), show the loader rather than the empty-entries state.
  if (isParent && !targetUserId) return <Loader />;
  if (chapters === null) return <Loader />;
  if (chapters.length === 0) {
    return (
      <EmptyState>
        <p className="font-semibold mb-1">No entries yet</p>
        {/* Kid-agnostic surface — the parent may have picked any child, so
            the copy stays pronoun-neutral rather than assuming a daughter. */}
        <p>{isParent
          ? "When they share a journal entry with the family, it'll appear here."
          : "Write your first entry above. One per day, in your own words."}</p>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      {shelfItems.length > 1 && (
        <TomeShelf
          items={shelfItems}
          activeId={activeChapterId}
          onSelect={onSelectChapter}
          ariaLabel="Journal chapters"
        />
      )}
      {activeChapter && (
        <section aria-label={activeChapter.label}>
          <ul className="space-y-4">
            {activeChapter.entries.map((entry) => (
              <JournalEntryCard key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function JournalEntryCard({ entry }) {
  const isPrivate = entry.is_private !== false;
  const dateLabel = useMemo(() => formatDate(entry.occurred_on), [entry.occurred_on]);
  return (
    <li>
      <article
        className="parchment-card p-4 space-y-2"
        aria-labelledby={`journal-entry-${entry.id}-title`}
      >
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="font-script text-tiny text-ink-whisper uppercase tracking-wider">
              {dateLabel}
            </div>
            <h3
              id={`journal-entry-${entry.id}-title`}
              className="text-lede font-serif"
            >
              {entry.title || 'Untitled entry'}
            </h3>
          </div>
          <RuneBadge tone="ink" size="sm" icon={isPrivate ? <Lock size={10} aria-hidden="true" /> : <Users size={10} aria-hidden="true" />}>
            {isPrivate ? 'Only you' : 'Shared with family'}
          </RuneBadge>
        </header>
        {entry.summary && (
          <p className="text-body whitespace-pre-wrap leading-relaxed text-ink-primary">
            {entry.summary}
          </p>
        )}
        <JournalConversation entry={entry} />
      </article>
    </li>
  );
}

function formatDate(occurredOn) {
  if (!occurredOn) return '';
  // occurred_on is "YYYY-MM-DD" — parse without TZ shift.
  const [y, m, d] = occurredOn.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return occurredOn;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return occurredOn;
  return date.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}
