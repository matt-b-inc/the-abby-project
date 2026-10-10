import { useEffect, useMemo, useState } from 'react'

import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import ErrorAlert from '../components/ErrorAlert'
import Loader from '../components/Loader'
import { SelectField } from '../components/form'
import TomeShelf from '../components/atlas/TomeShelf'
import {
  chapterMark,
  PROGRESS_TIER,
} from '../components/atlas/mastery.constants'
import { useRole } from '../hooks/useRole'
import useChronicleRevision from '../hooks/useChronicleRevision'
import { getChildren, getChronicleSummary } from '../api'
import { normalizeList } from '../utils/api'
import ChapterCard from './yearbook/ChapterCard'
import ManualEntryFormModal from './yearbook/ManualEntryFormModal'

const ACTIVE_CHAPTER_KEY_PREFIX = 'atlas:yearbook:active-chapter:'

export default function Yearbook() {
  const { user, isParent } = useRole()
  if (!user?.id) return <Loader />

  // Auth can change without this page unmounting. Keep the child list and
  // selection inside an account-scoped tree so neither survives that change.
  return <AccountYearbook key={`${user.id}:${user.role}`} user={user} isParent={isParent} />
}

function AccountYearbook({ user, isParent }) {
  const [childState, setChildState] = useState({ loading: true, children: [], error: null })
  const [childrenRequest, setChildrenRequest] = useState(0)
  const [selectedChildId, setSelectedChildId] = useState(null)
  const targetUserId = isParent ? selectedChildId ?? childState.children[0]?.id : user.id
  const revision = useChronicleRevision(targetUserId)

  useEffect(() => {
    if (!isParent) return undefined
    let cancelled = false
    getChildren()
      .then((res) => {
        if (!cancelled) {
          setChildState({ loading: false, children: normalizeList(res), error: null })
        }
      })
      .catch((err) => {
        if (!cancelled) setChildState({ loading: false, children: [], error: err })
      })
    return () => {
      cancelled = true
    }
  }, [isParent, childrenRequest])

  if (isParent && childState.loading) return <Loader />
  if (isParent && childState.error) {
    return <YearbookLoadError error={childState.error} onRetry={() => setChildrenRequest((n) => n + 1)} />
  }
  if (isParent && childState.children.length === 0) {
    return (
      <EmptyState>
        <p className="font-semibold mb-1">No children yet</p>
        <p>Create a child account on the Manage page to start a yearbook.</p>
      </EmptyState>
    )
  }

  // A signed-in child can read saved memories without a birthday on file.
  return (
    <YearbookHistory
      key={`${targetUserId}:${revision}`}
      targetUserId={targetUserId}
      isParent={isParent}
      childOptions={childState.children}
      onSelectChild={setSelectedChildId}
    />
  )
}

function YearbookLoadError({ error, onRetry }) {
  return (
    <div className="space-y-3 max-w-xl mx-auto">
      <ErrorAlert message={error?.message || 'Could not load the yearbook.'} />
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function YearbookHistory({ targetUserId, isParent, childOptions, onSelectChild }) {
  // Remounting this tree on a target change immediately clears history,
  // entry dialogs/replies, and the add-memory draft together.
  const [state, setState] = useState({ loading: true, chapters: [], error: null })
  const [showAdd, setShowAdd] = useState(false)
  const [summaryRequest, setSummaryRequest] = useState(0)
  // User-clicked override per (target child). Derived effective active id
  // below uses this when valid and falls back when the chapter list shifts
  // — avoids a setState-in-effect for the "data changed" reconciliation.
  const [activeChapterOverride, setActiveChapterOverride] = useState({})

  // Initial loads, retries and post-save refreshes share the same cleanup
  // guard. A late response cannot replace another child/account's archive.
  const fetchSummary = () => setSummaryRequest((n) => n + 1)

  useEffect(() => {
    let cancelled = false
    getChronicleSummary(isParent ? targetUserId : undefined)
      .then((res) => {
        if (cancelled) return
        const chapters = res?.chapters ?? []
        setState({ loading: false, chapters, error: null })
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, chapters: [], error: err })
      })
    return () => {
      cancelled = true
    }
  }, [targetUserId, isParent, summaryRequest])

  // Sort chronologically so §I → §N reads left-to-right on the shelf, with
  // the current chapter on the right edge — same as flipping through a
  // book's spines.
  const view = state

  const sortedChapters = useMemo(
    () => [...(view.chapters || [])].sort((a, b) => a.chapter_year - b.chapter_year),
    [view.chapters],
  )

  // Effective active chapter id — derived during render, per child.
  // Priority: (1) in-memory override for this child, (2) localStorage for
  // this child, (3) the chapter marked `is_current` by the backend,
  // (4) the latest chapter in the sorted list.
  const activeChapterId = useMemo(() => {
    if (!sortedChapters.length || !targetUserId) return null
    const override = activeChapterOverride[targetUserId]
    if (override && sortedChapters.some((c) => String(c.chapter_year) === override)) {
      return override
    }
    let stored = null
    try {
      stored = window.localStorage?.getItem(
        `${ACTIVE_CHAPTER_KEY_PREFIX}${targetUserId}`,
      )
    } catch {
      stored = null
    }
    if (stored && sortedChapters.some((c) => String(c.chapter_year) === stored)) {
      return stored
    }
    const current = sortedChapters.find((c) => c.is_current)
    return current
      ? String(current.chapter_year)
      : String(sortedChapters[sortedChapters.length - 1].chapter_year)
  }, [sortedChapters, targetUserId, activeChapterOverride])

  const setActiveChapterId = (id) => {
    if (!targetUserId) return
    setActiveChapterOverride((prev) => ({ ...prev, [targetUserId]: id }))
    try {
      window.localStorage?.setItem(`${ACTIVE_CHAPTER_KEY_PREFIX}${targetUserId}`, id)
    } catch {
      // ignore quota / disabled storage
    }
  }

  const shelfItems = sortedChapters.map((chapter, idx) => ({
    id: String(chapter.chapter_year),
    name: chapter.label || `Chapter ${idx + 1}`,
    icon: chapterMark(idx),
    chip: String(chapter.chapter_year),
    // Years aren't a completion concept — they're a calendar — so we hand
    // the spine a null progressPct. TomeSpine renders a thin hairline.
    progressPct: null,
    tier: chapter.is_current ? PROGRESS_TIER.rising : PROGRESS_TIER.nascent,
    ariaLabel: `${chapter.label || `Chapter ${idx + 1}`}, ${chapter.chapter_year}`,
  }))

  const activeChapter =
    sortedChapters.find((c) => String(c.chapter_year) === activeChapterId)
    || sortedChapters[sortedChapters.length - 1]

  return (
    <div className="space-y-4">
      {/* Below md the Chronicle hub's tab strip already names this page —
          the stacked h1 + explainer ate ~100px above the fold on phones.
          Same treatment as the Skills tab (pages/Achievements.jsx). */}
      <header className="hidden md:block text-center max-w-xl mx-auto">
        <h1 className="font-display italic text-3xl md:text-4xl text-ink-primary leading-tight">
          The Yearbook
        </h1>
        <p className="font-script text-body text-ink-whisper mt-1">
          a lifelong journal of chapters, milestones, and daily entries · birthdays and graduations land here too
        </p>
      </header>
      {isParent && (
        <div className="flex items-end justify-between gap-3">
          <SelectField
            id="yearbook-child-picker"
            label="Viewing"
            value={targetUserId}
            onChange={(e) => onSelectChild(parseInt(e.target.value, 10))}
            className="flex-1 max-w-xs"
          >
            {childOptions.map((child) => (
              <option key={child.id} value={child.id}>
                {child.first_name || child.username}
              </option>
            ))}
          </SelectField>
          <Button
            variant="secondary"
            onClick={() => setShowAdd(true)}
            disabled={!targetUserId}
          >
            Add memory
          </Button>
        </div>
      )}
      {view.loading ? <Loader /> : view.error ? (
        <YearbookLoadError error={view.error} onRetry={fetchSummary} />
      ) : (
        <>
          {shelfItems.length > 0 && (
            <TomeShelf
              items={shelfItems}
              activeId={activeChapterId}
              onSelect={setActiveChapterId}
              ariaLabel="Yearbook chapters"
            />
          )}
          {activeChapter && (
            <ChapterCard key={activeChapter.chapter_year} chapter={activeChapter} />
          )}
        </>
      )}
      {showAdd && targetUserId && (
        <ManualEntryFormModal
          userId={targetUserId}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false)
            fetchSummary()
          }}
        />
      )}
    </div>
  )
}
