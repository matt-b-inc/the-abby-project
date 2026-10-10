import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { buildUser, buildParent } from '../test/factories'
import { spyHandler } from '../test/spy'
import { useAuth } from '../hooks/useApi'
import * as api from '../api'
import Yearbook from './Yearbook'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const childOptions = [
  buildUser({ id: 7, username: 'abby', first_name: 'Abby' }),
  buildUser({ id: 8, username: 'ben', first_name: 'Ben' }),
]

function summaryFor(name, userId = 7) {
  return {
    chapters: [{
      chapter_year: 2025,
      label: `${name}'s chapter`,
      is_current: true,
      stats: {},
      entries: [
        { id: userId * 10, user: userId, title: `${name}'s journal`, kind: 'journal', occurred_on: '2026-04-21', summary: `${name}'s saved journal`, is_private: false },
        { id: userId * 10 + 1, user: userId, title: `${name}'s grade`, kind: 'grade', occurred_on: '2026-04-21', is_private: false },
      ],
    }],
    current_chapter_year: 2025,
  }
}

function SwitchAccount({ nextUser }) {
  const { setUser } = useAuth()
  return <button onClick={() => setUser(nextUser)}>Switch account</button>
}

function parentHandlers() {
  server.use(
    http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
    http.get('*/api/children/', () => HttpResponse.json(childOptions)),
  )
}

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView — TomeShelf calls it whenever
  // activeId changes.
  Element.prototype.scrollIntoView = vi.fn()
  try { window.localStorage.clear() } catch { /* ignore */ }
})

afterEach(() => vi.restoreAllMocks())

describe('Yearbook page', () => {
  it('loads saved journal and grade memories for a child without a birthday', async () => {
    const child = buildUser({ role: 'child', date_of_birth: null })
    const summarySpy = spyHandler('get', /\/api\/chronicle\/summary\/$/, summaryFor('Abby', child.id))
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(child)),
      summarySpy.handler,
    )
    renderWithProviders(<Yearbook />)
    expect(await screen.findByRole('button', { name: /Abby's journal/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Abby's grade/ })).toBeInTheDocument()
    expect(screen.queryByText(/set your date of birth/i)).not.toBeInTheDocument()
    expect(summarySpy.calls).toHaveLength(1)
    expect(summarySpy.calls[0].url).not.toContain('user_id')
  })

  it('renders a TomeShelf of chapter spines and opens the current chapter by default', async () => {
    const child = buildUser({ role: 'child', date_of_birth: '2011-09-22' })
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(child)),
      http.get('*/api/chronicle/summary/', () =>
        HttpResponse.json({
          chapters: [
            { chapter_year: 2025, grade: 9, label: 'Freshman Year', is_current: true, is_post_hs: false, stats: {}, entries: [] },
            { chapter_year: 2024, grade: 8, label: 'Grade 8', is_current: false, is_post_hs: false, stats: { projects_completed: 5 }, entries: [] },
          ],
          current_chapter_year: 2025,
        }),
      ),
    )
    renderWithProviders(<Yearbook />)
    // Shelf has one tab per chapter
    await waitFor(() =>
      expect(screen.getByRole('tablist', { name: /yearbook chapters/i })).toBeInTheDocument(),
    )
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    // The current chapter opens by default — region role disambiguates from
    // the spine title (the spine carries Freshman Year as aria-hidden text).
    expect(screen.getByRole('region', { name: 'Freshman Year' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Grade 8' })).toBeNull()
  })

  it('switches the rendered chapter when a different spine is selected', async () => {
    const child = buildUser({ role: 'child', date_of_birth: '2011-09-22' })
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(child)),
      http.get('*/api/chronicle/summary/', () =>
        HttpResponse.json({
          chapters: [
            { chapter_year: 2025, grade: 9, label: 'Freshman Year', is_current: true, is_post_hs: false, stats: {}, entries: [] },
            { chapter_year: 2024, grade: 8, label: 'Grade 8', is_current: false, is_post_hs: false, stats: { projects_completed: 5 }, entries: [] },
          ],
          current_chapter_year: 2025,
        }),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<Yearbook />)
    await waitFor(() =>
      expect(screen.getByRole('tablist', { name: /yearbook chapters/i })).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('tab', { name: /Grade 8/ }))
    expect(screen.getByRole('region', { name: 'Grade 8' })).toBeInTheDocument()
    // Freshman Year's region disappears; the spine text stays.
    expect(screen.queryByRole('region', { name: 'Freshman Year' })).toBeNull()
  })
})

describe('Yearbook — parent add-memory interaction', () => {
  it('child selector defaults to first kid and scopes the summary fetch', async () => {
    const summarySpy = spyHandler(
      'get',
      /\/api\/chronicle\/summary\/(\?user_id=\d+)?$/,
      {
        chapters: [
          { chapter_year: 2025, grade: 9, label: 'Freshman Year', is_current: true, is_post_hs: false, stats: {}, entries: [] },
        ],
        current_chapter_year: 2025,
      },
    )
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
      http.get('*/api/children/', () =>
        HttpResponse.json([
          { id: 7, username: 'abby', first_name: 'Abby', role: 'child' },
          { id: 8, username: 'ben', first_name: 'Ben', role: 'child' },
        ]),
      ),
      summarySpy.handler,
    )
    renderWithProviders(<Yearbook />)
    await waitFor(() => expect(summarySpy.calls.length).toBeGreaterThan(0))
    // Default-selected the first child in the list.
    expect(summarySpy.calls[0].url).toMatch(/user_id=7/)
    expect(await screen.findByRole('combobox', { name: /viewing/i })).toHaveValue('7')
  })

  it('submitting ManualEntryFormModal POSTs /api/chronicle/manual/ with the selected child id', async () => {
    const parent = buildParent()
    const createSpy = spyHandler('post', /\/api\/chronicle\/manual\/$/, { id: 99 })
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(parent)),
      http.get('*/api/children/', () =>
        HttpResponse.json([{ id: 7, username: 'abby', first_name: 'Abby', role: 'child' }]),
      ),
      http.get(/\/api\/chronicle\/summary\//, () =>
        HttpResponse.json({
          chapters: [
            { chapter_year: 2025, grade: 9, label: 'Freshman Year', is_current: true, is_post_hs: false, stats: {}, entries: [] },
          ],
          current_chapter_year: 2025,
        }),
      ),
      createSpy.handler,
    )

    const user = userEvent.setup()
    renderWithProviders(<Yearbook />)

    await user.click(await screen.findByRole('button', { name: /add memory/i }))

    await user.type(await screen.findByLabelText(/title/i), 'Rode a bike')
    await user.type(screen.getByLabelText(/when/i), '2026-04-21')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(createSpy.calls).toHaveLength(1))
    expect(createSpy.calls[0].body).toMatchObject({
      user_id: 7,
      title: 'Rode a bike',
      occurred_on: '2026-04-21',
    })
  })

  it('shows empty-state when a parent has no children yet', async () => {
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
      http.get('*/api/children/', () => HttpResponse.json([])),
    )
    renderWithProviders(<Yearbook />)
    expect(await screen.findByText(/no children yet/i)).toBeInTheDocument()
  })

  it('retries the child-list request when loading the parent picker fails', async () => {
    const childrenSpy = spyHandler('get', /\/api\/children\/$/, () =>
      childrenSpy.calls.length === 1
        ? HttpResponse.json({ detail: 'Child list unavailable' }, { status: 503 })
        : childOptions,
    )
    const summarySpy = spyHandler('get', /\/api\/chronicle\/summary\/(\?user_id=\d+)?$/, summaryFor('Abby'))
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
      childrenSpy.handler,
      summarySpy.handler,
    )
    const user = userEvent.setup()
    renderWithProviders(<Yearbook />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Child list unavailable')
    expect(summarySpy.calls).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByRole('button', { name: /Abby's journal/ })).toBeInTheDocument()
    expect(childrenSpy.calls).toHaveLength(2)
    expect(summarySpy.calls[0].url).toMatch(/user_id=7/)
  })

  it('keeps parent actions hidden until the child picker request resolves', async () => {
    const childList = deferred()
    vi.spyOn(api, 'getChildren').mockReturnValue(childList.promise)
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())),
    )
    renderWithProviders(<Yearbook />)
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add memory/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await act(async () => childList.resolve([]))
    expect(screen.getByText(/no children yet/i)).toBeInTheDocument()
  })

  it('child does not see Add memory button', async () => {
    const child = buildUser({ role: 'child', date_of_birth: '2011-09-22' })
    server.use(
      http.get('*/api/auth/me/', () => HttpResponse.json(child)),
      http.get('*/api/chronicle/summary/', () =>
        HttpResponse.json({ chapters: [], current_chapter_year: 2025 }),
      ),
    )
    renderWithProviders(<Yearbook />)
    await screen.findByRole('heading', { name: 'The Yearbook' })
    expect(screen.queryByRole('button', { name: /add memory/i })).toBeNull()
  })
})

describe('Yearbook archive identity and delayed requests', () => {
  it('clears the previous child history and reply dialog immediately while the next child loads', async () => {
    const ben = deferred()
    const summary = vi.spyOn(api, 'getChronicleSummary').mockImplementation((userId) =>
      userId === 7 ? Promise.resolve(summaryFor('Abby')) : ben.promise,
    )
    parentHandlers()
    const user = userEvent.setup()
    renderWithProviders(<Yearbook />)

    await user.click(await screen.findByRole('button', { name: /Abby's journal/ }))
    await user.type(await screen.findByLabelText('Your family response'), 'A reply for Abby')
    expect(screen.getByRole('dialog', { name: "Abby's journal" })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: /viewing/i }), { target: { value: '8' } })
    expect(screen.getByRole('combobox', { name: /viewing/i })).toHaveValue('8')
    expect(screen.queryByRole('region', { name: "Abby's chapter" })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Abby's journal/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Your family response')).not.toBeInTheDocument()
    expect(summary).toHaveBeenLastCalledWith(8)

    await act(async () => ben.resolve(summaryFor('Ben', 8)))
    await user.click(screen.getByRole('button', { name: /Ben's journal/ }))
    expect(await screen.findByLabelText('Your family response')).toHaveValue('')
    expect(screen.getByRole('dialog', { name: "Ben's journal" })).toBeInTheDocument()
  })

  it('discards the old add-memory composer and saves a fresh draft for the selected child', async () => {
    const ben = deferred()
    vi.spyOn(api, 'getChronicleSummary').mockImplementation((userId) =>
      userId === 7 ? Promise.resolve(summaryFor('Abby')) : ben.promise,
    )
    const createSpy = spyHandler('post', /\/api\/chronicle\/manual\/$/, { id: 99 })
    parentHandlers()
    server.use(createSpy.handler)
    const user = userEvent.setup()
    renderWithProviders(<Yearbook />)
    await screen.findByRole('button', { name: /Abby's journal/ })
    await user.click(screen.getByRole('button', { name: /add memory/i }))
    await user.type(screen.getByLabelText('Title'), 'Abby draft')

    fireEvent.change(screen.getByRole('combobox', { name: /viewing/i }), { target: { value: '8' } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Abby draft')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add memory/i }))
    expect(screen.getByLabelText('Title')).toHaveValue('')
    await user.type(screen.getByLabelText('Title'), 'Ben memory')
    await user.type(screen.getByLabelText('When'), '2026-04-21')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(createSpy.calls).toHaveLength(1))
    expect(createSpy.calls[0].body).toMatchObject({ user_id: 8, title: 'Ben memory', occurred_on: '2026-04-21' })
    await act(async () => ben.resolve(summaryFor('Ben', 8)))
    expect(await screen.findByRole('button', { name: /Ben's journal/ })).toBeInTheDocument()
  })

  it.each(['success', 'failure'])('ignores a late %s from a previous child post-save refresh', async (outcome) => {
    const refresh = deferred()
    let abbyRequests = 0
    const summary = vi.spyOn(api, 'getChronicleSummary').mockImplementation((userId) => {
      if (userId === 8) return Promise.resolve(summaryFor('Ben', 8))
      abbyRequests += 1
      return abbyRequests === 1 ? Promise.resolve(summaryFor('Abby')) : refresh.promise
    })
    const createSpy = spyHandler('post', /\/api\/chronicle\/manual\/$/, { id: 99 })
    parentHandlers()
    server.use(createSpy.handler)
    const user = userEvent.setup()
    renderWithProviders(<Yearbook />)
    await screen.findByRole('button', { name: /Abby's journal/ })
    await user.click(screen.getByRole('button', { name: /add memory/i }))
    await user.type(screen.getByLabelText('Title'), 'New Abby memory')
    await user.type(screen.getByLabelText('When'), '2026-04-21')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2))

    await user.selectOptions(screen.getByRole('combobox', { name: /viewing/i }), '8')
    await screen.findByRole('button', { name: /Ben's journal/ })
    await act(async () => {
      if (outcome === 'success') refresh.resolve(summaryFor('Old Abby response'))
      else refresh.reject(new Error('Old Abby request failed'))
    })

    expect(screen.getByRole('region', { name: "Ben's chapter" })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Old Abby response/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(summary).toHaveBeenCalledTimes(3)
  })

  it('does not close the new child composer or fetch old history when an earlier save completes', async () => {
    const save = deferred()
    const create = vi.spyOn(api, 'createManualChronicleEntry').mockReturnValue(save.promise)
    const summary = vi.spyOn(api, 'getChronicleSummary').mockImplementation((userId) =>
      Promise.resolve(summaryFor(userId === 7 ? 'Abby' : 'Ben', userId)),
    )
    parentHandlers()
    const user = userEvent.setup()
    renderWithProviders(<Yearbook />)
    await screen.findByRole('button', { name: /Abby's journal/ })
    await user.click(screen.getByRole('button', { name: /add memory/i }))
    await user.type(screen.getByLabelText('Title'), 'Abby memory')
    await user.type(screen.getByLabelText('When'), '2026-04-21')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(create).toHaveBeenCalledWith({ user_id: 7, title: 'Abby memory', summary: '', occurred_on: '2026-04-21' })

    fireEvent.change(screen.getByRole('combobox', { name: /viewing/i }), { target: { value: '8' } })
    await screen.findByRole('button', { name: /Ben's journal/ })
    await user.click(screen.getByRole('button', { name: /add memory/i }))
    await user.type(screen.getByLabelText('Title'), 'Ben draft')
    await act(async () => save.resolve({ id: 99 }))

    expect(screen.getByRole('dialog', { name: /add memory/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Ben draft')
    expect(summary.mock.calls).toEqual([[7], [8]])
  })

  it('ignores the first child request even after switching away and back to the same child', async () => {
    const oldAbby = deferred()
    const newAbby = deferred()
    let abbyRequests = 0
    const summary = vi.spyOn(api, 'getChronicleSummary').mockImplementation((userId) => {
      if (userId === 8) return Promise.resolve(summaryFor('Ben', 8))
      abbyRequests += 1
      return abbyRequests === 1 ? oldAbby.promise : newAbby.promise
    })
    parentHandlers()
    const user = userEvent.setup()
    renderWithProviders(<Yearbook />)
    await waitFor(() => expect(summary).toHaveBeenCalledWith(7))
    await user.selectOptions(screen.getByRole('combobox', { name: /viewing/i }), '8')
    await screen.findByRole('button', { name: /Ben's journal/ })
    await user.selectOptions(screen.getByRole('combobox', { name: /viewing/i }), '7')
    expect(screen.queryByRole('button', { name: /Ben's journal/ })).not.toBeInTheDocument()
    await act(async () => oldAbby.resolve(summaryFor('Stale Abby')))
    expect(screen.queryByRole('button', { name: /Stale Abby/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()

    await act(async () => newAbby.resolve(summaryFor('Fresh Abby')))
    expect(screen.getByRole('button', { name: /Fresh Abby's journal/ })).toBeInTheDocument()
    expect(summary.mock.calls).toEqual([[7], [8], [7]])
  })

  it('starts a new unscoped archive and removes the old edit composer on a child account switch', async () => {
    const nextSummary = deferred()
    const summary = vi.spyOn(api, 'getChronicleSummary')
      .mockResolvedValueOnce(summaryFor('Abby', 7))
      .mockReturnValueOnce(nextSummary.promise)
    server.use(http.get('*/api/auth/me/', () => HttpResponse.json(childOptions[0])))
    const user = userEvent.setup()
    renderWithProviders(<><SwitchAccount nextUser={childOptions[1]} /><Yearbook /></>)
    await user.click(await screen.findByRole('button', { name: /Abby's journal/ }))
    await user.click(screen.getByRole('button', { name: /edit|change sharing/i }))
    const oldDialog = screen.getByRole('dialog')
    expect(within(oldDialog).getByLabelText(/title/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Abby's journal/ })).not.toBeInTheDocument()
    expect(summary.mock.calls).toEqual([[undefined], [undefined]])
    await act(async () => nextSummary.resolve(summaryFor('Ben', 8)))
    expect(screen.getByRole('button', { name: /Ben's journal/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refetches the children and default selection when the parent account changes', async () => {
    const oldSummary = deferred()
    const newChildren = deferred()
    const summary = vi.spyOn(api, 'getChronicleSummary').mockImplementation((userId) =>
      userId === 7 ? oldSummary.promise : Promise.resolve(summaryFor('Cara', 9)),
    )
    vi.spyOn(api, 'getChildren')
      .mockResolvedValueOnce(childOptions)
      .mockReturnValueOnce(newChildren.promise)
    server.use(http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())))
    const user = userEvent.setup()
    renderWithProviders(<><SwitchAccount nextUser={buildParent({ id: 100 })} /><Yearbook /></>)
    expect(await screen.findByRole('combobox', { name: /viewing/i })).toHaveValue('7')
    await user.click(screen.getByRole('button', { name: /add memory/i }))
    await user.type(screen.getByLabelText('Title'), 'Old parent draft')

    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await act(async () => oldSummary.resolve(summaryFor('Old family')))
    expect(screen.queryByRole('button', { name: /Old family/ })).not.toBeInTheDocument()
    expect(summary).toHaveBeenCalledTimes(1)

    await act(async () => newChildren.resolve([buildUser({ id: 9, first_name: 'Cara' })]))
    expect(await screen.findByRole('button', { name: /Cara's journal/ })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /viewing/i })).toHaveValue('9')
    expect(screen.queryByRole('option', { name: 'Abby' })).not.toBeInTheDocument()
    expect(summary.mock.calls).toEqual([[7], [9]])
  })

  it('ignores a delayed child-list response from the previous parent account', async () => {
    const oldChildren = deferred()
    const children = vi.spyOn(api, 'getChildren')
      .mockReturnValueOnce(oldChildren.promise)
      .mockResolvedValueOnce([buildUser({ id: 9, first_name: 'Cara' })])
    const summary = vi.spyOn(api, 'getChronicleSummary').mockResolvedValue(summaryFor('Cara', 9))
    server.use(http.get('*/api/auth/me/', () => HttpResponse.json(buildParent())))
    const user = userEvent.setup()
    renderWithProviders(<><SwitchAccount nextUser={buildParent({ id: 100 })} /><Yearbook /></>)
    await waitFor(() => expect(children).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Switch account' }))
    await screen.findByRole('button', { name: /Cara's journal/ })
    await act(async () => oldChildren.resolve(childOptions))

    expect(screen.getByRole('combobox', { name: /viewing/i })).toHaveValue('9')
    expect(screen.queryByRole('option', { name: 'Abby' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: "Cara's chapter" })).toBeInTheDocument()
    expect(summary.mock.calls).toEqual([[9]])
  })
})
