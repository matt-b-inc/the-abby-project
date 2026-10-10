import ProgressBar from '../../components/ProgressBar'
import IlluminatedVersal from '../../components/atlas/IlluminatedVersal'
import IncipitBand from '../../components/atlas/IncipitBand'
import { tierForProgress } from '../../components/atlas/mastery.constants'
import TimelineEntry from './TimelineEntry'
import { RECAP_STAT_FIELDS } from './yearbook.constants'

function schoolDaysProgress(chapterYear) {
  // Aug 1 of chapter_year → Jul 31 of chapter_year+1. Percent elapsed.
  const start = new Date(chapterYear, 7, 1).getTime()
  const end = new Date(chapterYear + 1, 6, 31).getTime()
  const now = Date.now()
  if (now <= start) return 0
  if (now >= end) return 100
  return Math.round(((now - start) / (end - start)) * 100)
}

export default function ChapterCard({ chapter }) {
  const { is_current, stats, entries } = chapter
  // ChapterCard has no birth date or school-entry context. Keep supplied
  // school/age labels; otherwise name the actual August–July chapter span.
  const label = typeof chapter.label === 'string' && chapter.label.trim()
    ? chapter.label
    : `August ${chapter.chapter_year} – July ${Number(chapter.chapter_year) + 1}`
  const statLines = RECAP_STAT_FIELDS
    .map((f) => [f, stats?.[f.key]])
    .filter(([, v]) => v !== undefined && v !== null)
  const letter = (label || '✦').charAt(0)

  // The current chapter gets the full IncipitBand hero — drop-cap fills with
  // year progress so the open chapter visibly inks itself as the months pass.
  // Past chapters stay compact (small versal beside the title) since the
  // book has already closed on them.
  if (is_current) {
    const progress = schoolDaysProgress(chapter.chapter_year)
    return (
      <section className="space-y-3" aria-label={label}>
        <IncipitBand
          letter={letter}
          title={label}
          kicker="· current chapter ·"
          meta={
            <>
              <span className="tabular-nums">{progress}%</span>
              <span>through the year</span>
            </>
          }
          progressPct={progress}
        />
        <ProgressBar value={progress} aria-label={`${label} — days elapsed`} />

        {statLines.length > 0 && (
          <dl className="parchment-card p-4 grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
            {statLines.map(([field, value]) => (
              <div key={field.key}>
                <dt className="text-ink-whisper">{field.label}</dt>
                <dd className="text-body font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {entries?.length > 0 && (
          <ul className="parchment-card p-4 divide-y divide-ink-whisper/10">
            {entries.map((entry) => (
              <TimelineEntry key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </section>
    )
  }

  // Past chapters: compact card with a small versal beside the title.
  const tier = tierForProgress({ unlocked: true, progressPct: 100, level: 0 })
  return (
    <section
      className="parchment-card p-4 space-y-3"
      aria-labelledby={`chapter-${chapter.chapter_year}`}
    >
      <header className="flex items-center gap-3">
        <IlluminatedVersal
          letter={letter}
          size="sm"
          tier={tier}
          progressPct={100}
        />
        <h3 id={`chapter-${chapter.chapter_year}`} className="text-lede font-serif flex-1 min-w-0">
          {label}
        </h3>
      </header>

      {statLines.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
          {statLines.map(([field, value]) => (
            <div key={field.key}>
              <dt className="text-ink-whisper">{field.label}</dt>
              <dd className="text-body font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {entries?.length > 0 && (
        <ul className="divide-y divide-ink-whisper/10">
          {entries.map((entry) => (
            <TimelineEntry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  )
}
