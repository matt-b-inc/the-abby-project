import { useState } from 'react'
import { Lock, Users } from 'lucide-react'
import { KIND_ICON } from './yearbook.constants'
import EntryDetailSheet from './EntryDetailSheet'
import RuneBadge from '../../components/journal/RuneBadge'
import { useRole } from '../../hooks/useRole'
import { formatDate } from '../../utils/format'
import { gradeResultText } from '../../components/chronicle/gradeDisplay'

export default function TimelineEntry({ entry }) {
  const [open, setOpen] = useState(false)
  const [savedEdit, setSavedEdit] = useState(null)
  const currentEntry = savedEdit?.source === entry ? savedEdit.value : entry
  const { isParent } = useRole()
  const isPersonalEntry = ['journal', 'grade'].includes(currentEntry.kind)
  const isPrivate = isPersonalEntry && currentEntry.is_private !== false
  if (isPrivate && isParent) return null

  return (
    <>
      <li>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 py-2 text-left hover:bg-ink-whisper/5"
        >
          <span aria-hidden="true" className="text-lede">{KIND_ICON[currentEntry.kind] ?? '•'}</span>
          <span className="flex-1">
            <span className="flex flex-wrap items-center gap-2 text-body">
              <span>{currentEntry.title}</span>
              {isPersonalEntry && (
                <RuneBadge
                  tone="ink"
                  size="sm"
                  icon={isPrivate ? <Lock size={10} aria-hidden="true" /> : <Users size={10} aria-hidden="true" />}
                >
                  {isPrivate ? 'Only you' : 'Shared with family'}
                </RuneBadge>
              )}
            </span>
            {currentEntry.kind === 'grade' && <span className="block text-body">{gradeResultText(currentEntry)}</span>}
            <span className="block text-caption text-ink-whisper">{formatDate(currentEntry.occurred_on)}</span>
          </span>
        </button>
      </li>
      {open && <EntryDetailSheet entry={currentEntry} onClose={() => setOpen(false)} onUpdated={(saved) => { if (saved) setSavedEdit({ source: entry, value: saved }) }} />}
    </>
  )
}
