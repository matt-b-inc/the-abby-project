import { describe, it, expect, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { buildUser, buildParent } from '../../test/factories'
import EntryDetailSheet from './EntryDetailSheet'

vi.mock('../grades/GradeEntryFormModal', () => ({
  default: function GradeFormStub({ entry, onSaved }) {
    return <div role="dialog" aria-label="Correct grade">
      <p>Correcting {entry.metadata.grade.assessment} from {entry.occurred_on}</p>
      <button onClick={() => onSaved({ ...entry, metadata: { grade: { ...entry.metadata.grade, score: '9' } } })}>Confirm grade correction</button>
    </div>
  },
}))

// Stub AnimatePresence so the modal mounts + unmounts synchronously.
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion')
  return { ...actual, AnimatePresence: ({ children }) => children }
})

// Compute the ISO date string the component uses (local today).
function todayISO() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function mountWithUser(entry, userFixture) {
  server.use(
    http.get('*/api/auth/me/', () => HttpResponse.json(userFixture)),
  )
  return renderWithProviders(
    <EntryDetailSheet entry={entry} onClose={() => {}} />,
  )
}

describe('EntryDetailSheet', () => {
  it('renders occurred_on + summary for a plain entry', () => {
    renderWithProviders(
      <EntryDetailSheet
        entry={{
          id: 1, kind: 'manual', title: 'Rode bike',
          summary: 'Big day', occurred_on: '2026-04-21', metadata: {},
        }}
        onClose={() => {}}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: /rode bike/i })
    // A memoir surface reads the reader's own date format, never the raw
    // DRF "YYYY-MM-DD" — and the date-only string parses as a LOCAL day, so
    // it never renders as the evening before.
    expect(
      within(dialog).getByText(new Date(2026, 3, 21).toLocaleDateString()),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText('2026-04-21')).toBeNull()
    expect(within(dialog).getByText('Big day')).toBeInTheDocument()
  })

  it("shows the 'Edit' button for the owner's same-day journal entry", async () => {
    mountWithUser(
      {
        id: 7, kind: 'journal', is_private: true,
        title: 'Today', summary: 'Wrote a story.',
        occurred_on: todayISO(), metadata: {}, user: 1,
      },
      buildUser({ id: 1 }),
    )
    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /today/i })
      expect(within(dialog).getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })
  })

  it("offers sharing changes rather than text editing on a prior-day entry", async () => {
    mountWithUser(
      {
        id: 8, kind: 'journal', is_private: true,
        title: 'Yesterday', summary: 'Locked now.',
        occurred_on: '2026-04-20', metadata: {}, user: 1,
      },
      buildUser({ id: 1 }),
    )
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /yesterday/i })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change sharing/i })).toBeInTheDocument()
  })

  it("hides the 'Edit' button for the parent viewing a child's entry", async () => {
    mountWithUser(
      {
        id: 9, kind: 'journal', is_private: false,
        title: 'Abby today', summary: 'Her words.',
        occurred_on: todayISO(), metadata: {}, user: 1,
      },
      buildParent(),
    )
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /abby today/i })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  it('omits a private journal body when an outdated entry reaches a parent view', async () => {
    mountWithUser(
      {
        id: 10, kind: 'journal', is_private: true,
        title: 'Entry', summary: 'body',
        occurred_on: todayISO(), metadata: {}, user: 1,
      },
      buildParent(),
    )
    await screen.findByText('This journal entry is only visible to its author.')
    expect(screen.queryByText('body')).toBeNull()
    expect(screen.queryByRole('textbox', { name: /family response/i })).toBeNull()
  })

  it('shows the owner a clear Only you status', async () => {
    mountWithUser(
      { id: 12, kind: 'journal', is_private: true, user: 1, title: 'Mine', occurred_on: todayISO() },
      buildUser(),
    )
    expect(await screen.findByText('Only you')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /family responses/i })).toBeNull()
  })

  it('lets a parent respond from a shared memory detail', async () => {
    server.use(
      http.get('*/api/chronicle/entries/13/comments/', () => HttpResponse.json([])),
      http.post('*/api/chronicle/entries/13/comments/', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({ id: 1, author: 99, author_name: 'Dad', created_at: '2026-10-09T15:00:00Z', body: body.body }, { status: 201 })
      }),
    )
    mountWithUser(
      { id: 13, kind: 'journal', is_private: false, user: 1, title: 'Shared memory', summary: 'My day', occurred_on: todayISO() },
      buildParent(),
    )
    const user = userEvent.setup()
    const textbox = await screen.findByRole('textbox', { name: 'Your family response' })
    expect(screen.getByText('Shared with family')).toBeInTheDocument()
    await user.type(textbox, 'Tell me more at dinner!')
    await user.click(screen.getByRole('button', { name: 'Send response' }))
    expect(await screen.findByText('Tell me more at dinner!')).toBeInTheDocument()
  })

  it('shows a shared grade and reflection with family responses from Yearbook', async () => {
    mountWithUser(
      { id: 31, kind: 'grade', user: 1, is_private: false, title: 'Math quiz', summary: 'I want to try a study group.', occurred_on: '2025-02-03', metadata: { grade: { subject: 'Math', assessment: 'Fractions quiz', grade_format: 'points', score: '8', possible: '10' } } },
      buildParent(),
    )
    expect(await screen.findByRole('textbox', { name: 'Your family response' })).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: 'Math quiz' })
    expect(within(dialog).getByText('Math')).toBeInTheDocument()
    expect(within(dialog).getByText('Fractions quiz')).toBeInTheDocument()
    expect(within(dialog).getByText('8 / 10 points')).toBeInTheDocument()
    expect(within(dialog).getByText('I want to try a study group.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Correct grade or sharing' })).toBeNull()
  })

  it('allows the owner to correct an older grade and returns the updated entry to Yearbook', async () => {
    const onUpdated = vi.fn()
    const onClose = vi.fn()
    server.use(http.get('*/api/auth/me/', () => HttpResponse.json(buildUser())))
    const { user } = renderWithProviders(<EntryDetailSheet
      entry={{ id: 32, kind: 'grade', user: 1, is_private: true, title: 'Math quiz', occurred_on: '2025-02-03', metadata: { grade: { subject: 'Math', assessment: 'Fractions quiz', grade_format: 'points', score: '8', possible: '10' } } }}
      onClose={onClose} onUpdated={onUpdated}
    />)
    await user.click(await screen.findByRole('button', { name: 'Correct grade or sharing' }))
    const dialog = screen.getByRole('dialog', { name: 'Correct grade' })
    expect(within(dialog).getByText('Correcting Fractions quiz from 2025-02-03')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm grade correction' }))
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ metadata: { grade: expect.objectContaining({ score: '9' }) } }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('omits a private grade if an outdated detail reaches a parent view', async () => {
    mountWithUser(
      { id: 33, kind: 'grade', user: 1, is_private: true, title: 'Private result', summary: 'Private reflection', metadata: { grade: { subject: 'Math', assessment: 'Quiz', grade_format: 'letter', letter: 'C' } } },
      buildParent(),
    )
    await screen.findByText('This grade entry is only visible to its author.')
    expect(screen.queryByText('Private reflection')).toBeNull()
    expect(screen.queryByText('C')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
