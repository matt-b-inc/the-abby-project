import { useState } from 'react'
import { Lock, Pencil, Users } from 'lucide-react'
import BottomSheet from '../../components/BottomSheet'
import Button from '../../components/Button'
import RuneBadge from '../../components/journal/RuneBadge'
import JournalConversation from '../../components/chronicle/JournalConversation'
import GradeRecordDetails from '../../components/chronicle/GradeRecordDetails'
import JournalEntryFormModal from './JournalEntryFormModal'
import GradeEntryFormModal from '../grades/GradeEntryFormModal'
import { useRole } from '../../hooks/useRole'
import { formatDate } from '../../utils/format'

function todayISO() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function EntryDetailSheet({ entry, onClose, onUpdated }) {
  const { user, isParent } = useRole()
  const [editing, setEditing] = useState(false)
  const isJournal = entry.kind === 'journal'
  const isGrade = entry.kind === 'grade'
  const isPersonalEntry = isJournal || isGrade
  const isOwner = isPersonalEntry && entry.user === user?.id
  const isSameDay = isJournal && entry.occurred_on === todayISO()
  const canEdit = isOwner && isSameDay
  const isPrivate = isPersonalEntry && entry.is_private !== false

  if (isPrivate && isParent) {
    return (
      <BottomSheet title={isGrade ? 'Private grade entry' : 'Private journal entry'} onClose={onClose}>
        <p className="text-body">This {isGrade ? 'grade' : 'journal'} entry is only visible to its author.</p>
      </BottomSheet>
    )
  }

  if (editing) {
    const EntryForm = isGrade ? GradeEntryFormModal : JournalEntryFormModal
    return (
      <EntryForm
        mode="edit"
        entry={entry}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          onUpdated?.(saved)
          setEditing(false)
          onClose()
        }}
      />
    )
  }

  return (
    <BottomSheet title={entry.title} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-caption text-ink-whisper">
          <span>{formatDate(entry.occurred_on)}</span>
          {isPersonalEntry && (
            <RuneBadge
              tone="ink"
              size="sm"
              icon={isPrivate ? <Lock size={10} aria-hidden="true" /> : <Users size={10} aria-hidden="true" />}
            >
              {isPrivate ? 'Only you' : 'Shared with family'}
            </RuneBadge>
          )}
        </div>
        {isGrade && <GradeRecordDetails entry={entry} />}
        {entry.summary && (
          <div className="space-y-2">
            {isGrade && <p className="font-semibold text-caption">Reflection</p>}
          <p className="text-body whitespace-pre-wrap break-words font-body leading-relaxed">
            {entry.summary}
          </p>
          </div>
        )}
        {entry.metadata?.gift_coins && (
          <p className="text-body">🎁 {entry.metadata.gift_coins} coins</p>
        )}
        <JournalConversation entry={entry} defaultOpen />
        {isOwner && (
          <div className="flex justify-end pt-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-2"
            >
              {canEdit || isGrade ? <Pencil size={14} aria-hidden="true" /> : <Users size={14} aria-hidden="true" />}
              {isGrade ? 'Correct grade or sharing' : canEdit ? 'Edit' : 'Change sharing'}
            </Button>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
