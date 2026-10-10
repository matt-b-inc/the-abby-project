import { gradeResultText } from './gradeDisplay';

export default function GradeRecordDetails({ entry, showSubject = true }) {
  const grade = entry.metadata?.grade;
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-body">
      {showSubject && <div>
        <dt className="text-caption text-ink-whisper">Subject</dt>
        <dd className="font-semibold break-words">{grade?.subject || 'Not recorded'}</dd>
      </div>}
      <div>
        <dt className="text-caption text-ink-whisper">Assessment</dt>
        <dd className="break-words">{grade?.assessment || 'Not recorded'}</dd>
      </div>
      <div>
        <dt className="text-caption text-ink-whisper">Recorded result</dt>
        <dd className="font-serif text-lede break-words">{gradeResultText(entry)}</dd>
      </div>
    </dl>
  );
}
