import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChapterCard from './ChapterCard'

describe('ChapterCard', () => {
  describe.each([
    ['current', true],
    ['historical', false],
  ])('%s chapter labels', (_kind, isCurrent) => {
    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
      ['whitespace-only', ' \t\n '],
    ])('uses the August–July span for a %s label', (_case, label) => {
      const { container } = render(<ChapterCard chapter={{
        chapter_year: 2025,
        ...(label === undefined ? {} : { label }),
        is_current: isCurrent,
        stats: {},
        entries: [],
      }} />)

      const title = 'August 2025 – July 2026'
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: title })).toBeInTheDocument()
      expect(container.querySelector('[data-versal="true"]')).toHaveTextContent('A')
      if (isCurrent) {
        expect(screen.getByRole('progressbar', {
          name: `${title} — days elapsed`,
        })).toBeInTheDocument()
      } else {
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      }
    })

    it.each([
      'Kindergarten · 2016-17',
      'Freshman Year',
      'Age 18 · 2029-30',
    ])('preserves the supplied label %s', (label) => {
      render(<ChapterCard chapter={{
        chapter_year: 2025, label, is_current: isCurrent,
        stats: {}, entries: [],
      }} />)

      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: label })).toBeInTheDocument()
      if (isCurrent) {
        expect(screen.getByRole('progressbar', {
          name: `${label} — days elapsed`,
        })).toBeInTheDocument()
      }
    })
  })

  it('carries the fallback span into the next century', () => {
    render(<ChapterCard chapter={{
      chapter_year: 1999, label: null, is_current: false,
      stats: {}, entries: [],
    }} />)
    expect(screen.getByRole('heading', {
      name: 'August 1999 – July 2000',
    })).toBeInTheDocument()
  })

  it('current-chapter shows live progress bar', () => {
    render(<ChapterCard chapter={{
      chapter_year: 2025, label: 'Freshman Year', grade: 9,
      is_current: true, is_post_hs: false,
      stats: { projects_completed: 3, coins_earned: 200 },
      entries: [],
    }} />)
    expect(screen.getByText('Freshman Year')).toBeInTheDocument()
    expect(screen.getByText(/projects completed/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  // The surfaces that generate these entries are labelled Duties and Study in
  // the Quests hub — the kid-facing recap has to speak the same vocabulary.
  it('labels recap stats with the app vocabulary (Duties / Study)', () => {
    render(<ChapterCard chapter={{
      chapter_year: 2024, label: 'Grade 8', grade: 8,
      is_current: false, is_post_hs: false,
      stats: { homework_approved: 12, chores_approved: 30 },
      entries: [],
    }} />)
    expect(screen.getByText(/duties approved/i)).toBeInTheDocument()
    expect(screen.getByText(/study approved/i)).toBeInTheDocument()
    expect(screen.queryByText(/chores approved/i)).toBeNull()
    expect(screen.queryByText(/homework approved/i)).toBeNull()
  })

  it('past-chapter shows frozen stats, no progress bar', () => {
    render(<ChapterCard chapter={{
      chapter_year: 2024, label: 'Grade 8', grade: 8,
      is_current: false, is_post_hs: false,
      stats: { projects_completed: 5 },
      entries: [],
    }} />)
    expect(screen.getByText('Grade 8')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('post-HS chapter renders age-based label', () => {
    render(<ChapterCard chapter={{
      chapter_year: 2029, label: 'Age 18 · 2029-30', grade: 13,
      is_current: false, is_post_hs: true,
      stats: {},
      entries: [],
    }} />)
    expect(screen.getByText('Age 18 · 2029-30')).toBeInTheDocument()
  })

  it('current chapter renders an IncipitBand with the kicker + atlas versal', () => {
    const { container } = render(<ChapterCard chapter={{
      chapter_year: 2025, label: 'Junior · 2025-26', grade: 11,
      is_current: true, is_post_hs: false,
      stats: {},
      entries: [],
    }} />)
    expect(screen.getByText(/current chapter/i)).toBeInTheDocument()
    const versal = container.querySelector('[data-versal="true"]')
    expect(versal).not.toBeNull()
  })

  it('past chapter renders a small atlas versal at gilded tier', () => {
    const { container } = render(<ChapterCard chapter={{
      chapter_year: 2024, label: 'Sophomore · 2024-25', grade: 10,
      is_current: false, is_post_hs: false,
      stats: {},
      entries: [],
    }} />)
    const versal = container.querySelector('[data-versal="true"]')
    expect(versal).not.toBeNull()
    expect(versal.getAttribute('data-tier')).toBe('gilded')
  })
})
