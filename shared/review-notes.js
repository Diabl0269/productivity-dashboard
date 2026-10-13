/**
 * shared/review-notes.js — notes written while reviewing a shipped ticket.
 *
 * A ticket in `review` can carry `reviewNotes`, beside its `checks`:
 *   { n, at, text, kind: 'fix'|'idea'|'design', check?, area?, state: 'new'|'filed'|'dismissed', filed? }
 * `n` is a per-ticket counter that is never reused; a note's handle is `<ticketId>#<n>`.
 * `area` (optional) is a lane slug that overrides the noted ticket's own lane when filing.
 * `check` is the text of the check the note was written against (absent = general note).
 * Notes in state `new` are "unsent": they block the ticket from finishing review until
 * they are filed as tickets or dismissed.
 *
 * Pure (no fs, no DOM); used by the CLI, the run plan and the dashboard.
 */

export const NOTE_KINDS = ['fix', 'idea', 'design'];
export const NOTE_STATES = ['new', 'filed', 'dismissed'];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;
const HANDLE_RE = /^([A-Za-z][A-Za-z0-9]*-?\d+)#(\d+)$/;

/** Add a note to a ticket. Returns the note. */
export function addReviewNote(task, { text, kind = 'fix', check, area, now = new Date().toISOString() } = {}) {
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('note text is empty');
  if (!NOTE_KINDS.includes(kind)) throw new Error(`unknown note kind "${kind}". Valid: ${NOTE_KINDS.join(', ')}`);
  if (!Array.isArray(task.reviewNotes)) task.reviewNotes = [];
  const n = task.reviewNotes.reduce((m, x) => Math.max(m, Number(x?.n) || 0), 0) + 1;
  const note = { n, at: now, text: clean, kind, state: 'new', ...(check ? { check } : {}), ...(area ? { area } : {}) };
  task.reviewNotes.push(note);
  return note;
}

/** Notes not yet sent (filed or dismissed). */
export function unsentNotes(task) {
  return (task?.reviewNotes || []).filter(x => x && x.state === 'new');
}

/** True when the ticket has notes in state `new`. */
export function hasUnsentNotes(task) {
  return unsentNotes(task).length > 0;
}

/** Set a note's state (and the filed ticket id). Returns the note. */
export function setNoteState(task, n, state, { filed } = {}) {
  if (!NOTE_STATES.includes(state)) throw new Error(`unknown note state "${state}". Valid: ${NOTE_STATES.join(', ')}`);
  const note = (task?.reviewNotes || []).find(x => x && x.n === n);
  if (!note) throw new Error(`no review note #${n} on ${task?.id ?? 'ticket'}`);
  note.state = state;
  if (filed) note.filed = filed;
  return note;
}

/** Parse `PRO19#3` into { id, n }, else null. */
export function parseNoteHandle(str) {
  const m = HANDLE_RE.exec(String(str ?? '').trim());
  return m ? { id: m[1], n: parseInt(m[2], 10) } : null;
}

/** One line for a note: `PRO19#2 [fix] on "check": text`. */
export function noteLine(taskId, note) {
  let on = '';
  if (note.check) {
    const c = note.check.length > 50 ? `${note.check.slice(0, 50)}…` : note.check;
    on = ` on "${c}"`;
  }
  return `${taskId}#${note.n} [${note.kind}]${on}: ${note.text}`;
}

/** Schema errors for a stored reviewNotes value (empty when valid). */
export function reviewNoteErrors(notes, ref) {
  if (!Array.isArray(notes)) return [`${ref}.reviewNotes must be an array`];
  const errors = [];
  const seen = new Set();
  notes.forEach((x, i) => {
    const at = `${ref}.reviewNotes[${i}]`;
    if (!x || typeof x !== 'object' || Array.isArray(x)) { errors.push(`${at} must be an object`); return; }
    if (!Number.isInteger(x.n) || x.n < 1) errors.push(`${at}.n must be an integer >= 1`);
    else if (seen.has(x.n)) errors.push(`${at}.n ${x.n} is not unique`);
    else seen.add(x.n);
    if (typeof x.at !== 'string' || !ISO_RE.test(x.at)) errors.push(`${at}.at must be an ISO string`);
    if (typeof x.text !== 'string' || !x.text.trim()) errors.push(`${at}.text must be a non-empty string`);
    if (!NOTE_KINDS.includes(x.kind)) errors.push(`${at}.kind must be one of ${NOTE_KINDS.join(', ')}`);
    if (!NOTE_STATES.includes(x.state)) errors.push(`${at}.state must be one of ${NOTE_STATES.join(', ')}`);
    if (x.check !== undefined && typeof x.check !== 'string') errors.push(`${at}.check must be a string`);
    if (x.area !== undefined && typeof x.area !== 'string') errors.push(`${at}.area must be a string`);
    if (x.filed !== undefined && typeof x.filed !== 'string') errors.push(`${at}.filed must be a string`);
  });
  return errors;
}

/** Every ticket with unsent notes, in document order. */
export function pendingReviewNotes(doc) {
  const out = [];
  for (const section of doc?.sections || []) {
    for (const task of section.tasks || []) {
      const notes = unsentNotes(task);
      if (!notes.length) continue;
      out.push({ id: task.id, title: task.title, type: task.type, lane: task.lane, section: section.id, notes });
    }
  }
  return out;
}

/** Total unsent notes across the doc. */
export function countUnsentNotes(doc) {
  return pendingReviewNotes(doc).reduce((sum, t) => sum + t.notes.length, 0);
}
