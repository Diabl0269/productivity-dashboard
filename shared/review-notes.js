/**
 * shared/review-notes.js — notes written while reviewing a shipped ticket.
 *
 * A ticket in `review` can carry `reviewNotes`, beside its `checks`:
 *   { n, at, text, kind: 'fix'|'idea'|'design', check?, area?, images?, state: 'new'|'filed'|'dismissed', filed? }
 * `images` (optional) are attachment paths `<ticketId>/<file>` (shared/note-images.js); text may be empty then.
 * `n` is a per-ticket counter that is never reused; a note's handle is `<ticketId>#<n>`.
 * `area` (optional) is a lane slug that overrides the noted ticket's own lane when filing.
 * `check` is the text of the check the note was written against (absent = general note).
 * Notes in state `new` are "unsent": they block the ticket from finishing review until
 * they are filed as tickets or dismissed.
 *
 * Free notes (PRO121) have no ticket: they live in `doc.meta.freeNotes` (see the section at the end).
 *
 * Pure (no fs, no DOM); used by the CLI, the run plan and the dashboard.
 */

export const NOTE_KINDS = ['fix', 'idea', 'design'];
export const NOTE_STATES = ['new', 'filed', 'dismissed'];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;
const HANDLE_RE = /^([A-Za-z][A-Za-z0-9]*-?\d+)#(\d+)$/;

/** Add a note to a ticket. Returns the note. */
export function addReviewNote(task, { text, kind = 'fix', check, area, images, now = new Date().toISOString() } = {}) {
  const clean = String(text ?? '').trim();
  const imgs = Array.isArray(images) ? images.filter(i => typeof i === 'string' && i) : [];
  if (!clean && !imgs.length) throw new Error('note text is empty');
  if (!NOTE_KINDS.includes(kind)) throw new Error(`unknown note kind "${kind}". Valid: ${NOTE_KINDS.join(', ')}`);
  if (!Array.isArray(task.reviewNotes)) task.reviewNotes = [];
  const n = task.reviewNotes.reduce((m, x) => Math.max(m, Number(x?.n) || 0), 0) + 1;
  const note = { n, at: now, text: clean, kind, state: 'new', ...(check ? { check } : {}), ...(area ? { area } : {}), ...(imgs.length ? { images: imgs } : {}) };
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

/** Change an unsent note's text and/or kind. Returns the note. */
export function editReviewNote(task, n, { text, kind } = {}) {
  const note = (task?.reviewNotes || []).find(x => x && x.n === n);
  if (!note) throw new Error(`no review note #${n} on ${task?.id ?? 'ticket'}`);
  if (note.state !== 'new') throw new Error(`review note #${n} is already ${note.state}`);
  if (kind !== undefined && !NOTE_KINDS.includes(kind)) throw new Error(`unknown note kind "${kind}". Valid: ${NOTE_KINDS.join(', ')}`);
  if (text !== undefined) {
    const clean = String(text).trim();
    if (!clean && !note.images?.length) throw new Error('note text is empty');
    note.text = clean;
  }
  if (kind !== undefined) note.kind = kind;
  return note;
}

/** Parse an answer-note handle `PRO19#ask2` into { id, askN }, else null (PRO109). */
export function parseAskHandle(str) {
  const m = /^(.+)#ask(\d+)$/.exec(String(str ?? '').trim());
  return m ? { id: m[1], askN: parseInt(m[2], 10) } : null;
}

/** Dismiss an answered ask the notes run would file: marks it `filedAs: 'dismissed'` (pendingAnswers skips it). Returns the ask. */
export function dismissAnswer(task, askN) {
  const ask = (task?.asks || []).find(a => a && a.n === askN);
  if (!ask) throw new Error(`no question #${askN} on ${task?.id ?? 'ticket'}`);
  if (ask.filedAs) throw new Error(`${task?.id ?? 'ticket'}#ask${askN} is already ${ask.filedAs === 'dismissed' ? 'dismissed' : `filed (${ask.filedAs})`}`);
  ask.filedAs = 'dismissed';
  return ask;
}

/** Parse `PRO19#3` into { id, n }, or `free#3` into { id: 'free', n, free: true }; else null. */
export function parseNoteHandle(str) {
  const free = parseFreeHandle(str);
  if (free) return free;
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
  const pics = note.images?.length ? ` (${note.images.length} image${note.images.length > 1 ? 's' : ''})` : '';
  return `${taskId}#${note.n} [${note.kind}]${on}: ${note.text || '(image only)'}${pics}`;
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
    const hasImages = Array.isArray(x.images) && x.images.length > 0;
    if (typeof x.text !== 'string' || (!x.text.trim() && !hasImages)) errors.push(`${at}.text must be a non-empty string (empty only when the note has images)`);
    if (x.images !== undefined && (!Array.isArray(x.images) || x.images.some(i => typeof i !== 'string' || !i))) errors.push(`${at}.images must be an array of attachment paths`);
    if (!NOTE_KINDS.includes(x.kind)) errors.push(`${at}.kind must be one of ${NOTE_KINDS.join(', ')}`);
    if (!NOTE_STATES.includes(x.state)) errors.push(`${at}.state must be one of ${NOTE_STATES.join(', ')}`);
    if (x.check !== undefined && typeof x.check !== 'string') errors.push(`${at}.check must be a string`);
    if (x.area !== undefined && typeof x.area !== 'string') errors.push(`${at}.area must be a string`);
    if (x.filed !== undefined && typeof x.filed !== 'string') errors.push(`${at}.filed must be a string`);
  });
  return errors;
}

/**
 * Every ticket with unsent notes, in document order, then one entry per unsent free note (PRO121):
 * { id: 'free', title: 'Free note', type: 'free', lane: note.area, project: note.project, section: null, notes: [note] }.
 */
export function pendingReviewNotes(doc) {
  const out = [];
  for (const section of doc?.sections || []) {
    for (const task of section.tasks || []) {
      const notes = unsentNotes(task);
      if (!notes.length) continue;
      out.push({ id: task.id, title: task.title, type: task.type, lane: task.lane, section: section.id, notes });
    }
  }
  for (const note of freeNotes(doc)) {
    if (note && note.state === 'new') out.push({ ...freeSource(note), section: null, notes: [note] });
  }
  return out;
}

// ---- free notes (PRO121) ------------------------------------------------------------------
// A note with no ticket: `doc.meta.freeNotes[]`, the same shape as a review note plus `project`
// (required: picks the filed ticket's id prefix) and `where` (a map box id, optional). Handle
// `free#<n>`; `n` is never reused. Filing routes it by its own `area` only.

export const FREE_ID = 'free';
const FREE_HANDLE_RE = /^free#(\d+)$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** The free notes of a doc (the stored array, or an empty one). */
export function freeNotes(doc) {
  const list = doc?.meta?.freeNotes;
  return Array.isArray(list) ? list : [];
}

/** True for the pseudo ticket a free note is filed from. */
export const isFreeSource = (src) => src?.id === FREE_ID;

/** The source object a free note stands on in listings and filing. */
export function freeSource(note) {
  return { id: FREE_ID, title: 'Free note', type: 'free', lane: note?.area, project: note?.project || null };
}

/** `free#3`. */
export const freeHandle = (note) => `${FREE_ID}#${note.n}`;

/** Parse `free#3` into { id: 'free', n, free: true }, else null. */
export function parseFreeHandle(str) {
  const m = FREE_HANDLE_RE.exec(String(str ?? '').trim());
  return m ? { id: FREE_ID, n: parseInt(m[1], 10), free: true } : null;
}

/**
 * A ticket-shaped holder over `doc.meta.freeNotes` ({ id, taskId, reviewNotes }), so the review-note
 * helpers (edit, state, UI rows) work on free notes unchanged. `create` makes the array when missing.
 */
export function freeHolder(doc, { create = false } = {}) {
  if (create) {
    if (!doc.meta || typeof doc.meta !== 'object') doc.meta = {};
    if (!Array.isArray(doc.meta.freeNotes)) doc.meta.freeNotes = [];
  }
  return { id: FREE_ID, taskId: FREE_ID, title: 'Free note', type: 'free', reviewNotes: freeNotes(doc) };
}

/** Add a free note to `doc.meta.freeNotes`. Returns the note. */
export function addFreeNote(doc, { text, kind = 'fix', project, area, where, images, now = new Date().toISOString() } = {}) {
  const proj = String(project ?? '').trim();
  if (!proj) throw new Error('a free note needs a project (it picks the new ticket\'s id prefix)');
  if (area && !SLUG_RE.test(String(area))) throw new Error(`invalid area "${area}". Use lowercase letters, digits and hyphens`);
  const holder = freeHolder(doc, { create: true });
  const note = addReviewNote(holder, { text, kind, area: area || undefined, images, now });
  note.project = proj;
  if (where) note.where = String(where);
  return note;
}

function findFree(doc, n) {
  const note = freeNotes(doc).find(x => x && x.n === n);
  if (!note) throw new Error(`no free note free#${n}`);
  return note;
}

/** Change an unsent free note's text, kind, area or place. Returns the note. */
export function editFreeNote(doc, n, { text, kind, area, where } = {}) {
  const note = findFree(doc, n);
  if (note.state !== 'new') throw new Error(`free#${n} is already ${note.state}`);
  if (area && !SLUG_RE.test(String(area))) throw new Error(`invalid area "${area}". Use lowercase letters, digits and hyphens`);
  if (text !== undefined || kind !== undefined) editReviewNote(freeHolder(doc), n, { text, kind });
  if (area !== undefined) { if (area) note.area = area; else delete note.area; }
  if (where !== undefined) { if (where) note.where = String(where); else delete note.where; }
  return note;
}

/** Set a free note's state (and the filed ticket id). Returns the note. */
export function setFreeNoteState(doc, n, state, { filed } = {}) {
  const note = findFree(doc, n);
  if (state === 'dismissed' && note.state !== 'new') throw new Error(`free#${n} is already ${note.state}${note.filed ? ` (${note.filed})` : ''}`);
  return setNoteState(freeHolder(doc), n, state, { filed });
}

/** Keep well-formed free notes only (the dashboard's and the CLI's meta normalisers share this). */
export function normalizeFreeNotes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object' || !Number.isInteger(x.n) || x.n < 1) continue;
    const images = Array.isArray(x.images) ? x.images.filter(i => typeof i === 'string' && i) : [];
    if (typeof x.text !== 'string' || (!x.text.trim() && !images.length) || typeof x.at !== 'string') continue;
    if (!NOTE_KINDS.includes(x.kind) || !NOTE_STATES.includes(x.state)) continue;
    if (typeof x.project !== 'string' || !x.project.trim()) continue;
    const e = { n: x.n, at: x.at, text: x.text, kind: x.kind, state: x.state, project: x.project };
    if (typeof x.area === 'string' && x.area) e.area = x.area;
    if (typeof x.where === 'string' && x.where) e.where = x.where;
    if (images.length) e.images = images;
    if (typeof x.filed === 'string' && x.filed) e.filed = x.filed;
    out.push(e);
  }
  return out;
}

/** Schema errors for a stored meta.freeNotes value (empty when valid). */
export function freeNoteErrors(notes) {
  if (!Array.isArray(notes)) return ['doc.meta.freeNotes must be an array'];
  const errors = reviewNoteErrors(notes, 'doc.meta').map(e => e.replace('doc.meta.reviewNotes', 'doc.meta.freeNotes'));
  notes.forEach((x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return;
    const at = `doc.meta.freeNotes[${i}]`;
    if (typeof x.project !== 'string' || !x.project.trim()) errors.push(`${at}.project must be a non-empty string`);
    if (x.where !== undefined && typeof x.where !== 'string') errors.push(`${at}.where must be a string`);
    if (x.check !== undefined) errors.push(`${at}.check is not allowed (a free note has no ticket)`);
  });
  return errors;
}

/** Total unsent notes across the doc. */
export function countUnsentNotes(doc) {
  return pendingReviewNotes(doc).reduce((sum, t) => sum + t.notes.length, 0);
}
