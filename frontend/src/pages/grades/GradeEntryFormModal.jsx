import { useRef, useState } from 'react';
import { Check, Heart, Lock, PawPrint } from 'lucide-react';
import BottomSheet from '../../components/BottomSheet';
import Button from '../../components/Button';
import ErrorAlert from '../../components/ErrorAlert';
import GradeRecordDetails from '../../components/chronicle/GradeRecordDetails';
import { SelectField, TextAreaField, TextField } from '../../components/form';
import { useRole } from '../../hooks/useRole';
import { publishChronicleChange } from '../../hooks/useChronicleRevision';
import { updateGradeEntry, writeGrade } from '../../api';
import { fieldErrors } from '../../utils/api';
import { toISODate } from '../../utils/dates';
import { formatDate } from '../../utils/format';
import {
  clearGradeDraft, GRADE_LETTERS, gradePayload, newGradeRequestId,
  readGradeDraft, storeGradeDraft, validateGradeFields,
} from './gradeDraft';

function initialForm(userId, mode, entry) {
  const grade = entry?.metadata?.grade ?? {};
  const baseline = {
    subject: grade.subject || '', assessment: grade.assessment || '',
    grade_format: grade.grade_format || 'percentage',
    score: String(grade.score ?? ''), possible: String(grade.possible ?? ''),
    letter: grade.letter || '', reflection: entry?.summary || '',
    occurred_on: entry?.occurred_on || toISODate(new Date()),
    is_private: entry?.is_private ?? true,
  };
  const pendingCreate = readGradeDraft(userId);
  const draft = pendingCreate?.pending?.method === 'post'
    && pendingCreate.client_entry_id === entry?.client_entry_id
    ? pendingCreate : readGradeDraft(userId, mode, entry?.id);
  const restored = { ...draft };
  if (mode === 'edit' && draft?.baseline && !draft.pending) {
    // Keep fields the author changed, while taking untouched fields from
    // the latest saved result. An old reflection draft must not revert a
    // newer grade or sharing correction made in another Chronicle view.
    const resultFields = ['grade_format', 'score', 'possible', 'letter'];
    const changedResult = resultFields.some((field) => draft[field] !== draft.baseline[field]);
    for (const field of Object.keys(baseline)) {
      // A result is one value in its original format. Keep an intentional
      // score correction with its denominator/format rather than combining
      // that score with a different saved format or points possible.
      if (changedResult && resultFields.includes(field)) continue;
      if (draft[field] === draft.baseline[field]) restored[field] = baseline[field];
    }
  }
  return {
    mode, entry_id: mode === 'edit' ? entry?.id : null,
    client_entry_id: newGradeRequestId(), ...baseline, pending: null,
    ...restored, baseline, restored: Boolean(draft),
    needsDraftReview: mode === 'edit' && Boolean(draft) && !draft.baseline && !draft.pending,
  };
}

async function saveWithDeadline(request) {
  let timer;
  try {
    return await Promise.race([
      request(),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('The connection took too long.')), 20000);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

/** Phone grade capture. onSaved fires when the saved confirmation closes. */
export default function GradeEntryFormModal(props) {
  const { user } = useRole();
  return (
    <GradeEntryForm
      key={`${user?.id ?? 'anonymous'}:${props.mode ?? 'create'}:${props.entry?.id ?? 'new'}`}
      {...props}
      userId={user?.id}
    />
  );
}

function GradeEntryForm({ mode = 'create', entry, userId, onSaved, onClose }) {
  const [form, setForm] = useState(() => initialForm(userId, mode, entry));
  const formRef = useRef(form);
  const inFlight = useRef(false);
  const finished = useRef(false);
  const [storageState, setStorageState] = useState(form.restored ? 'saved' : 'idle');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [savedEntry, setSavedEntry] = useState(null);
  const blocked = saving || Boolean(form.pending);
  const hasChanges = Object.keys(form.baseline).some((field) => form[field] !== form.baseline[field]);
  const dirty = hasChanges && storageState !== 'saved' && !savedEntry;
  const today = toISODate(new Date());

  const changeForm = (changes) => {
    const next = { ...formRef.current, ...changes };
    formRef.current = next;
    setStorageState(storeGradeDraft(userId, next) ? 'saved' : 'unavailable');
    setForm(next);
    setErrors((previous) => Object.fromEntries(Object.entries(previous).filter(([field]) => !(field in changes))));
    return next;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    const current = formRef.current;
    if (!current.pending) {
      const validation = validateGradeFields(current, today);
      setErrors(validation);
      if (Object.keys(validation).length) {
        setError('Check the highlighted fields before saving.');
        return;
      }
    }
    const request = current.pending ?? {
      method: current.mode === 'edit' ? 'patch' : 'post',
      ...(current.mode === 'edit' ? { entry_id: current.entry_id } : {}),
      payload: gradePayload(current, current.mode === 'create' ? current.client_entry_id : undefined),
    };
    // Persist an immutable request before sending so an interrupted iPhone
    // session can check the original save and its original reward receipt.
    changeForm({ pending: request });
    inFlight.current = true;
    setSaving(true);
    setError('');
    setErrors({});
    try {
      const result = await saveWithDeadline(() => request.method === 'post'
        ? writeGrade(request.payload)
        : updateGradeEntry(request.entry_id, request.payload));
      clearGradeDraft(userId, current);
      setSavedEntry(result);
    } catch (err) {
      if (err?.status >= 400 && err?.status < 500) {
        changeForm({ pending: null });
        const fields = fieldErrors(err);
        setErrors(fields);
        setError(Object.keys(fields).length ? 'Check the highlighted fields.' : err.message || 'Could not save this grade.');
      } else {
        setError('We could not confirm the save. Check save when your connection returns to safely finish saving this grade.');
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onSaved?.(savedEntry);
    onClose?.();
    // Keep the saved receipt visible until it is acknowledged. Publishing
    // earlier would unmount the originating form while showing confirmation.
    publishChronicleChange(savedEntry.user);
  };

  if (savedEntry) {
    const receipt = savedEntry.reward_receipt;
    const isCreate = form.mode === 'create';
    const awarded = isCreate && receipt?.status === 'awarded'
      && Number.isFinite(receipt.xp_awarded) && receipt.xp_awarded > 0;
    return (
      <BottomSheet title={isCreate ? 'Grade remembered' : 'Grade corrected'} onClose={finish}>
        <div className="space-y-4 text-center">
          <div className="flex justify-center text-sheikah-teal-deep" aria-hidden="true">
            {awarded ? <PawPrint size={48} className="animate-rune-pulse" /> : <Check size={48} />}
          </div>
          <div role="status" aria-live="polite" className="space-y-2">
            <p className="font-display text-lede text-ink-primary">{isCreate ? 'One more part of your story saved.' : 'Your grade history has been updated.'}</p>
            {awarded && <p className="font-semibold text-body text-sheikah-teal-deep">+{receipt.xp_awarded} XP earned</p>}
            {isCreate && receipt?.status === 'daily_limit' && (
              <p className="text-body text-ink-secondary">You already earned recognition for tracking a grade today. This grade is still remembered in your history.</p>
            )}
            {isCreate && receipt?.status === 'unavailable' && (
              <p className="text-body text-ink-secondary">Your grade is saved. Its reward could not be confirmed.</p>
            )}
            {isCreate && receipt?.status === 'not_eligible' && (
              <p className="text-body text-ink-secondary">This grade is saved without an extra reward.</p>
            )}
            {!isCreate && <p className="text-body text-ink-secondary">Corrections do not earn another reward.</p>}
          </div>
          <p className="text-body text-ink-secondary">
            {savedEntry.is_private === false ? 'Shared with your family. They can leave a response.' : 'Only you can read this grade in the app.'}
          </p>
          <Button variant="primary" className="w-full" onClick={finish}>Done</Button>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet title={form.mode === 'edit' ? 'Correct grade' : 'Log a grade'} onClose={onClose} disabled={saving} dirty={dirty}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-body text-ink-secondary">Keep the result as it was recorded. Recognition is for tracking your story, whatever the grade.</p>
        {form.needsDraftReview && (
          <section aria-label="Latest saved grade" className="rounded-lg border border-ink-page-shadow p-3 space-y-3">
            <p className="text-body">An older correction draft was restored. Review it against the latest saved grade below before saving.</p>
            <GradeRecordDetails entry={entry} />
            <p className="text-caption">{formatDate(entry.occurred_on)} · {entry.is_private === false ? 'Shared with family' : 'Only you'}</p>
            {entry.summary && <p className="text-body whitespace-pre-wrap break-words">{entry.summary}</p>}
          </section>
        )}
        <TextField label="Subject or class" value={form.subject} maxLength={80} disabled={blocked} error={errors.subject} onChange={(event) => changeForm({ subject: event.target.value })} />
        <TextField label="What was graded?" placeholder="Quiz, assignment, report card…" value={form.assessment} maxLength={80} disabled={blocked} error={errors.assessment} onChange={(event) => changeForm({ assessment: event.target.value })} />
        <SelectField label="Grade format" value={form.grade_format} disabled={blocked} error={errors.grade_format} onChange={(event) => changeForm({ grade_format: event.target.value })}>
          <option value="percentage">Percentage</option>
          <option value="points">Points</option>
          <option value="letter">Letter</option>
        </SelectField>
        {form.grade_format === 'letter' ? (
          <SelectField label="Letter grade" value={form.letter} disabled={blocked} error={errors.letter} onChange={(event) => changeForm({ letter: event.target.value })}>
            <option value="">Choose the recorded grade</option>
            {GRADE_LETTERS.map((letter) => <option key={letter} value={letter}>{letter}</option>)}
          </SelectField>
        ) : (
          <div className={form.grade_format === 'points' ? 'grid grid-cols-2 gap-3' : ''}>
            <TextField label={form.grade_format === 'points' ? 'Points earned' : 'Percentage'} type="text" inputMode="decimal" maxLength={32} value={form.score} disabled={blocked} error={errors.score} helpText={form.grade_format === 'percentage' ? 'From 0 to 100. Zero is a valid result.' : 'Extra credit can exceed the points possible.'} onChange={(event) => changeForm({ score: event.target.value })} />
            {form.grade_format === 'points' && (
              <TextField label="Points possible" type="text" inputMode="decimal" maxLength={32} value={form.possible} disabled={blocked} error={errors.possible} onChange={(event) => changeForm({ possible: event.target.value })} />
            )}
          </div>
        )}
        <TextField label="Date received" type="date" value={form.occurred_on} max={today} disabled={blocked} error={errors.occurred_on} onChange={(event) => changeForm({ occurred_on: event.target.value })} />
        <TextAreaField label="Reflection (optional)" rows={3} maxLength={4000} value={form.reflection} disabled={blocked} error={errors.reflection} helpText="What would you like to remember about this? A thought, effort, or next step." onChange={(event) => changeForm({ reflection: event.target.value })} />
        {/* intentional: enclosing label supplies the checkbox's accessible
            name and thumb-sized target outside the text/select primitives. */}
        <label className="flex items-center gap-3 min-h-11 text-body text-ink-primary">
          <input type="checkbox" checked={!form.is_private} disabled={blocked} className="h-5 w-5 shrink-0 accent-sheikah-teal-deep" onChange={(event) => changeForm({ is_private: !event.target.checked })} />
          Share with my family
        </label>
        <p className="flex items-start gap-2 text-caption text-ink-secondary">
          {form.is_private ? <Lock size={14} aria-hidden="true" /> : <Heart size={14} aria-hidden="true" />}
          <span>{form.is_private ? 'Only you can read this grade in the app.' : 'Your parents can read this grade and leave a response.'}</span>
        </p>
        <ErrorAlert message={error} />
        <p role="status" aria-live="polite" className="text-caption text-ink-whisper">
          {saving ? 'Saving this grade to your history…'
            : form.pending ? 'Save not confirmed yet. Check save to safely try again.'
              : storageState === 'saved' ? 'Draft kept on this device. It is not in your history yet.'
                : storageState === 'unavailable' ? 'This browser cannot keep a draft. Keep this window open until you save.'
                  : 'Save when you are ready to remember this grade.'}
        </p>
        {storageState === 'unavailable' && form.pending && <p className="text-caption text-ember-deep">This browser cannot keep a draft. Keep this window open until the save is confirmed.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {!dirty && <Button variant="ghost" onClick={onClose} disabled={saving}>{storageState === 'saved' && hasChanges ? 'Keep draft & close' : 'Close'}</Button>}
          <Button type="submit" loading={saving}>{form.pending ? 'Check save' : form.mode === 'edit' ? 'Save correction' : 'Save grade'}</Button>
        </div>
      </form>
    </BottomSheet>
  );
}
