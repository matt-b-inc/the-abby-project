import { describe, it, expect, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { buildUser, buildParent } from '../../test/factories'
import TimelineEntry from './TimelineEntry'

vi.mock('../grades/GradeEntryFormModal', () => ({
  default: function GradeFormStub({ entry, onSaved }) {
    return <div role="dialog" aria-label="Correct grade">
      <button onClick={() => onSaved({ ...entry, metadata: { grade: { ...entry.metadata.grade, score: '9' } } })}>Confirm grade correction</button>
    </div>
  },
}))

// Stub AnimatePresence so the EntryDetailSheet portal mounts synchronously.
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion')
  return { ...actual, AnimatePresence: ({ children }) => children }
})

function mountAsUser(entry, userFixture) {
  server.use(
    http.get('*/api/auth/me/', () => HttpResponse.json(userFixture)),
  )
  return renderWithProviders(<TimelineEntry entry={entry} />)
}

describe('TimelineEntry', () => {
  it('renders title + kind icon', () => {
    renderWithProviders(
      <TimelineEntry entry={{
        id: 1, kind: 'birthday', title: 'Turned 15',
        occurred_on: '2026-04-21', metadata: {},
      }} />,
    )
    expect(screen.getByText('Turned 15')).toBeInTheDocument()
    expect(screen.getByText('🎂')).toBeInTheDocument()
  })

  it('opening entry shows EntryDetailSheet', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TimelineEntry entry={{
        id: 1, kind: 'manual', title: 'Rode bike',
        summary: 'Big day', occurred_on: '2026-04-21', metadata: {},
      }} />,
    )
    await user.click(screen.getByRole('button', { name: /rode bike/i }))
    expect(screen.getByRole('dialog', { name: /rode bike/i })).toBeInTheDocument()
    expect(screen.getByText('Big day')).toBeInTheDocument()
  })

  // The raw DRF "YYYY-MM-DD" leaked into the timeline; it also has to parse
  // as a LOCAL day so an entry never shows up dated the evening before.
  it('renders occurred_on in the reader\'s date format, not the raw ISO', () => {
    renderWithProviders(
      <TimelineEntry entry={{
        id: 5, kind: 'manual', title: 'Rode bike',
        occurred_on: '2026-09-03', metadata: {},
      }} />,
    )
    expect(
      screen.getByText(new Date(2026, 8, 3).toLocaleDateString()),
    ).toBeInTheDocument()
    expect(screen.queryByText('2026-09-03')).toBeNull()
  })

  it('renders the quill glyph for journal kind', () => {
    renderWithProviders(
      <TimelineEntry entry={{
        id: 2, kind: 'journal', is_private: true, title: 'Good day',
        occurred_on: '2026-04-21', metadata: {},
      }} />,
    )
    expect(screen.getByText('🪶')).toBeInTheDocument()
  })

  it("omits a private journal from the parent's timeline", async () => {
    mountAsUser(
      {
        id: 3, kind: 'journal', is_private: true, title: 'Private thought',
        occurred_on: '2026-04-21', metadata: {}, user: 1,
      },
      buildParent(),
    )
    await waitFor(() => expect(screen.queryByText('Private thought')).toBeNull())
  })

  it("shows the child that a journal is only visible to them", async () => {
    mountAsUser(
      {
        id: 4, kind: 'journal', is_private: true, title: 'My journal',
        occurred_on: '2026-04-21', metadata: {}, user: 1,
      },
      buildUser({ id: 1 }),
    )
    // Wait for AuthProvider to settle /auth/me/ before asserting absence.
    await waitFor(() => expect(screen.getByText('My journal')).toBeInTheDocument())
    expect(screen.getByText('Only you')).toBeInTheDocument()
  })

  it('identifies a shared journal for family readers', async () => {
    mountAsUser(
      { id: 6, kind: 'journal', is_private: false, title: 'Our afternoon', occurred_on: '2026-04-21', user: 1 },
      buildParent(),
    )
    expect(await screen.findByText('Shared with family')).toBeInTheDocument()
  })

  it('shows the grade icon and updates a corrected native result immediately in the timeline', async () => {
    const view = mountAsUser(
      { id: 31, kind: 'grade', user: 1, is_private: true, title: 'Math quiz', occurred_on: '2025-02-03', metadata: { grade: { subject: 'Math', assessment: 'Fractions quiz', grade_format: 'points', score: '8', possible: '10' } } },
      buildUser(),
    )
    expect(screen.getByText('📚')).toBeInTheDocument()
    await view.user.click(screen.getByRole('button', { name: /Math quiz/ }))
    await view.user.click(await screen.findByRole('button', { name: 'Correct grade or sharing' }))
    await view.user.click(screen.getByRole('button', { name: 'Confirm grade correction' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('9 / 10 points')).toBeInTheDocument()
    expect(screen.queryByText('8 / 10 points')).toBeNull()
  })

  it('omits a private grade from the parent timeline', async () => {
    mountAsUser(
      { id: 34, kind: 'grade', user: 1, is_private: true, title: 'Private result', occurred_on: '2025-02-03', metadata: { grade: { grade_format: 'percentage', score: '50' } } },
      buildParent(),
    )
    await waitFor(() => expect(screen.queryByText('Private result')).toBeNull())
    expect(screen.queryByText('50%')).toBeNull()
  })
})
