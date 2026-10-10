import { toISODate } from '../../utils/dates';

const PREFIX = 'abby:grade-draft:v1:';
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const FORM_FIELDS = ['subject', 'assessment', 'grade_format', 'score', 'possible', 'letter', 'reflection', 'occurred_on', 'is_private'];
export const GRADE_LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'P', 'NP', 'I'];

export function newGradeRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function gradeDraftKey(userId, mode = 'create', entryId) {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (mode === 'edit' && (!Number.isInteger(entryId) || entryId <= 0)) return null;
  return `${PREFIX}${userId}:${mode === 'edit' ? entryId : 'new'}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && toISODate(date) === value;
}

function validDecimal(value) {
  return typeof value === 'string' && DECIMAL.test(value.trim()) && Number.isFinite(Number(value));
}

export function validateGradeFields(fields, today = toISODate(new Date())) {
  const errors = {};
  if (!fields.subject?.trim()) errors.subject = 'Add the subject or class.';
  else if (fields.subject.trim().length > 80) errors.subject = 'Keep the subject to 80 characters.';
  if (!fields.assessment?.trim()) errors.assessment = 'Add what was graded.';
  else if (fields.assessment.trim().length > 80) errors.assessment = 'Keep the assessment to 80 characters.';
  if (!['percentage', 'points', 'letter'].includes(fields.grade_format)) errors.grade_format = 'Choose how this grade was recorded.';
  if (['percentage', 'points'].includes(fields.grade_format)) {
    if (!validDecimal(fields.score) || Number(fields.score) < 0) errors.score = 'Enter a score of zero or more.';
    else if (fields.grade_format === 'percentage' && Number(fields.score) > 100) errors.score = 'Enter a percentage between 0 and 100.';
  }
  if (fields.grade_format === 'points' && (!validDecimal(fields.possible) || Number(fields.possible) <= 0)) {
    errors.possible = 'Enter the points possible, greater than zero.';
  }
  if (fields.grade_format === 'letter' && !GRADE_LETTERS.includes(fields.letter)) errors.letter = 'Choose the recorded letter grade.';
  if (typeof fields.reflection !== 'string' || fields.reflection.length > 4000) errors.reflection = 'Keep your reflection to 4,000 characters.';
  if (!validDate(fields.occurred_on)) errors.occurred_on = 'Choose a valid date.';
  else if (fields.occurred_on > today) errors.occurred_on = 'Choose today or an earlier date.';
  if (typeof fields.is_private !== 'boolean') errors.is_private = 'Choose who can see this grade.';
  return errors;
}

export function gradePayload(fields, clientEntryId) {
  const payload = {
    subject: fields.subject.trim(),
    assessment: fields.assessment.trim(),
    grade_format: fields.grade_format,
    reflection: fields.reflection,
    occurred_on: fields.occurred_on,
    is_private: fields.is_private,
  };
  if (fields.grade_format === 'letter') payload.letter = fields.letter;
  else {
    payload.score = fields.score.trim();
    if (fields.grade_format === 'points') payload.possible = fields.possible.trim();
  }
  if (clientEntryId) payload.client_entry_id = clientEntryId;
  return payload;
}

function captureFields(source) {
  return Object.fromEntries(FORM_FIELDS.map((field) => [field, source[field]]));
}

function schemaValidFields(fields) {
  return fields && ['subject', 'assessment', 'score', 'possible', 'letter', 'reflection', 'occurred_on'].every((field) => typeof fields[field] === 'string')
    && fields.subject.length <= 80 && fields.assessment.length <= 80 && fields.reflection.length <= 4000
    && fields.score.length <= 32 && fields.possible.length <= 32
    && ['percentage', 'points', 'letter'].includes(fields.grade_format)
    && (fields.letter === '' || GRADE_LETTERS.includes(fields.letter))
    && (fields.occurred_on === '' || validDate(fields.occurred_on))
    && typeof fields.is_private === 'boolean';
}

function validPending(pending, draft) {
  if (!pending) return pending === null;
  if (!['post', 'patch'].includes(pending.method)) return false;
  if (pending.method === 'patch' && (draft.mode !== 'edit' || pending.entry_id !== draft.entry_id)) return false;
  if (pending.method === 'post' && (draft.mode !== 'create' || pending.payload?.client_entry_id !== draft.client_entry_id)) return false;
  const payload = pending.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const allowed = ['subject', 'assessment', 'grade_format', 'reflection', 'occurred_on', 'is_private', ...(pending.method === 'post' ? ['client_entry_id'] : [])];
  if (payload.grade_format === 'letter') allowed.push('letter');
  else if (payload.grade_format === 'percentage') allowed.push('score');
  else if (payload.grade_format === 'points') allowed.push('score', 'possible');
  else return false;
  if (Object.keys(payload).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in payload))) return false;
  const fields = { score: '', possible: '', letter: '', ...payload };
  if (Object.keys(validateGradeFields(fields)).length) return false;
  // Persisted immutable writes must still correspond to the displayed draft.
  return JSON.stringify(gradePayload(draft, pending.method === 'post' ? draft.client_entry_id : undefined)) === JSON.stringify(payload);
}

export function readGradeDraft(userId, mode = 'create', entryId) {
  const key = gradeDraftKey(userId, mode, entryId);
  if (!key) return null;
  try {
    const draft = JSON.parse(localStorage.getItem(key));
    if (draft?.version !== 1 || draft.mode !== mode || !UUID.test(draft.client_entry_id)
      || (mode === 'edit' && draft.entry_id !== entryId) || !schemaValidFields(draft)
      || !validPending(draft.pending, draft)) return null;
    return {
      version: 1, mode, entry_id: mode === 'edit' ? entryId : null,
      client_entry_id: draft.client_entry_id, ...captureFields(draft),
      ...(mode === 'edit' && schemaValidFields(draft.baseline) ? { baseline: captureFields(draft.baseline) } : {}),
      pending: draft.pending ? {
        method: draft.pending.method,
        ...(mode === 'edit' ? { entry_id: entryId } : {}),
        payload: gradePayload(draft, mode === 'create' ? draft.client_entry_id : undefined),
      } : null,
    };
  } catch {
    return null;
  }
}

export function storeGradeDraft(userId, draft) {
  const key = gradeDraftKey(userId, draft.mode, draft.entry_id);
  if (!key) return false;
  try {
    const safe = {
      version: 1, mode: draft.mode, entry_id: draft.mode === 'edit' ? draft.entry_id : null,
      client_entry_id: draft.client_entry_id, ...captureFields(draft),
      ...(draft.mode === 'edit' && !draft.needsDraftReview && schemaValidFields(draft.baseline) ? { baseline: captureFields(draft.baseline) } : {}),
      pending: draft.pending ? {
        method: draft.pending.method,
        ...(draft.mode === 'edit' ? { entry_id: draft.entry_id } : {}),
        payload: gradePayload(draft.pending.payload, draft.mode === 'create' ? draft.client_entry_id : undefined),
      } : null,
    };
    localStorage.setItem(key, JSON.stringify(safe));
    return true;
  } catch {
    return false;
  }
}

export function clearGradeDraft(userId, savedDraft) {
  const key = gradeDraftKey(userId, savedDraft.mode, savedDraft.entry_id);
  if (!key) return;
  try {
    const current = readGradeDraft(userId, savedDraft.mode, savedDraft.entry_id);
    if (current?.client_entry_id !== savedDraft.client_entry_id
      || FORM_FIELDS.some((field) => current?.[field] !== savedDraft[field])) return;
    localStorage.removeItem(key);
  } catch {
    // The confirmed server entry remains available if device cleanup fails.
  }
}
