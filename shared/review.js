/**
 * shared/review.js — "Ready for review": shipped work waiting for Tal's own look.
 *
 * A ticket lands in the `review` section (between In progress and Done) when its PR has
 * merged. It carries:
 *   - `result`  what shipped, set by the session that shipped it (see normalizeResult)
 *   - `checks`  the "worth checking yourself" list, ticked one by one in the tracker
 * Ticking the last check moves it to Done. A ticket opened while reviewing another one
 * records `reviewOf: <id>`, so the Plan page can show the relation both ways.
 *
 * Pure (no fs, no DOM); used by the CLI, the run plan and the dashboard.
 */

export const REVIEW_SECTION = 'review';
export const REVIEW_SECTION_NAME = 'Ready for review';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

/** True when every check is ticked (also when there are none). */
export function allChecksTicked(task) {
  return (task?.checks || []).every(c => c && c.checked);
}

/** { done, total } for a ticket's checks. */
export function checkProgress(task) {
  const checks = task?.checks || [];
  return { done: checks.filter(c => c && c.checked).length, total: checks.length };
}

/**
 * Should a review ticket move to Done now? Only after a tick in this action, so a ticket
 * with no checks doesn't jump to Done on an unrelated edit.
 */
export function reviewComplete(task, sectionId, { ticked }) {
  return sectionId === REVIEW_SECTION && !!ticked && allChecksTicked(task);
}

/** When the ticket entered review: last history move to `review`, else result.at, else updated. */
export function enteredReviewAt(task) {
  const history = Array.isArray(task?.history) ? task.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.to === REVIEW_SECTION && typeof h.at === 'string') return h.at;
  }
  if (task?.result && typeof task.result.at === 'string') return task.result.at;
  return task?.updated || task?.created || '';
}

function cleanList(value, name) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    if (typeof item !== 'string') throw new Error(`result.${name} must be a list of strings`);
    return item.trim();
  }).filter(Boolean);
}

/**
 * Validate and tidy a ship result. Shape on the ticket:
 *   { at: ISO, shipped: string[], left?: string[], tests?: string[], ci: string }
 * `left` (blocked or left over) and `tests` (added or changed) are omitted when empty;
 * `ci` defaults to "all passed".
 */
export function normalizeResult(input, { now = new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('result must be an object');
  }
  const shipped = cleanList(input.shipped, 'shipped');
  if (!shipped.length) throw new Error('result.shipped needs at least one line');
  const out = { at: typeof input.at === 'string' && ISO_RE.test(input.at) ? input.at : now, shipped };
  const left = cleanList(input.left, 'left');
  if (left.length) out.left = left;
  const tests = cleanList(input.tests, 'tests');
  if (tests.length) out.tests = tests;
  const ci = typeof input.ci === 'string' && input.ci.trim() ? input.ci.trim() : 'all passed';
  out.ci = ci;
  return out;
}

/** Schema errors for a stored result (empty when valid). */
export function resultErrors(result, ref) {
  try {
    if (result && typeof result === 'object' && typeof result.at !== 'string') {
      return [`${ref}.result.at must be an ISO string`];
    }
    normalizeResult(result);
    return [];
  } catch (e) {
    return [`${ref}.${e.message}`];
  }
}

/** Add checks, skipping texts already on the ticket. Returns how many were added. */
export function addChecks(task, texts, { now = new Date().toISOString() } = {}) {
  if (!Array.isArray(task.checks)) task.checks = [];
  const have = new Set(task.checks.map(c => String(c.text).trim()));
  let added = 0;
  for (const raw of texts) {
    const text = String(raw || '').trim();
    if (!text || have.has(text)) continue;
    task.checks.push({ text, checked: false, addedAt: now });
    have.add(text);
    added++;
  }
  return added;
}

/** Plain lines describing a result, for `ch tasks get` and the markdown export. */
export function resultLines(result) {
  if (!result) return [];
  const lines = [];
  for (const s of result.shipped || []) lines.push(`Shipped: ${s}`);
  for (const s of result.left || []) lines.push(`Left: ${s}`);
  for (const s of result.tests || []) lines.push(`Tests: ${s}`);
  if (result.ci) lines.push(`CI: ${result.ci}`);
  return lines;
}

function flat(doc) {
  const rows = [];
  for (const section of doc?.sections || []) {
    for (const task of section.tasks || []) rows.push({ task, section: section.id });
  }
  return rows;
}

/** Tickets opened from reviewing `id`: [{ id, title, section }] in id order of appearance. */
export function followUpsOf(doc, id) {
  return flat(doc)
    .filter(({ task }) => task.reviewOf === id)
    .map(({ task, section }) => ({ id: task.id, title: task.title, section }));
}

/**
 * Everything waiting for review, oldest first (the order it shipped in).
 * @returns {Array<{ id, title, project, parentId, enteredAt, checks: {done,total}, result, followUps, reviewOf }>}
 */
export function reviewQueue(doc) {
  const rows = flat(doc).filter(({ section }) => section === REVIEW_SECTION);
  return rows
    .map(({ task }) => ({
      id: task.id,
      title: task.title,
      project: task.project || null,
      parentId: task.parentId || null,
      reviewOf: task.reviewOf || null,
      enteredAt: enteredReviewAt(task),
      checks: checkProgress(task),
      result: task.result || null,
      followUps: followUpsOf(doc, task.id),
    }))
    .sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : 0));
}
