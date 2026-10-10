export const GRADE_LABELS = {
  9: 'Freshman Year',
  10: 'Sophomore Year',
  11: 'Junior Year',
  12: 'Senior Year',
}

export const KIND_ICON = {
  birthday: '🎂',
  chapter_start: '📖',
  chapter_end: '📕',
  first_ever: '✨',
  milestone: '🏆',
  recap: '📜',
  manual: '🖋️',
  journal: '🪶',
  grade: '📚',
  creation: '🎨',
}

// Labels track the app's own vocabulary (Quests hub tabs: Study, Duties);
// keys stay aligned with the backend recap payload.
export const RECAP_STAT_FIELDS = [
  { key: 'projects_completed', label: 'Projects completed' },
  { key: 'homework_approved',  label: 'Study approved' },
  { key: 'chores_approved',    label: 'Duties approved' },
  { key: 'coins_earned',       label: 'Coins earned' },
]
