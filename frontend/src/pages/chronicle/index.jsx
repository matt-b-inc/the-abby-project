import ChapterHub from '../../components/layout/ChapterHub';
import Portfolio from '../Portfolio';
import Yearbook from '../Yearbook';
import JournalReader from './JournalReader';
import GradesPage from '../grades/GradesPage';

/**
 * Chronicle — hub page for "what she's lived through and made."
 *
 * Sketchbook (artifacts she's made) · Journal (her own daily words) ·
 * Grades (school results) · Yearbook (the chronological chapter timeline). Atlas is the résumé;
 * Chronicle is the memoir.
 */
export default function ChronicleHub() {
  return (
    <ChapterHub
      title="Chronicle"
      kicker="Chapter VI · The Memoir of Days"
      glyph="compass-rose"
      defaultTabId="sketchbook"
      tabs={[
        { id: 'sketchbook', label: 'Sketchbook', render: () => <Portfolio /> },
        { id: 'journal',    label: 'Journal',    render: () => <JournalReader /> },
        { id: 'grades',     label: 'Grades',     render: () => <GradesPage /> },
        { id: 'yearbook',   label: 'Yearbook',   render: () => <Yearbook /> },
      ]}
    />
  );
}
