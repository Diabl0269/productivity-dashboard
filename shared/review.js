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

/**
 * When the ticket shipped into review: its result's time (set when the work shipped, so a
 * backfilled result keeps its original date), else the last history move to `review`,
 * else updated.
 */
export function enteredReviewAt(task) {
  if (task?.result && typeof task.result.at === 'string') return task.result.at;
  const history = Array.isArray(task?.history) ? task.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.to === REVIEW_SECTION && typeof h.at === 'string') return h.at;
  }
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
 *   { at: ISO, shipped: string[], left?: string[], tests?: string[], ci: string,
 *     unverified?: string[], risks?: string[], fixed?: string[], opened?: string[] }
 * Optional lists are omitted when empty: `left` (blocked or left over), `tests` (added or
 * changed), `unverified` (major things not checked for real), `risks`, `fixed` (fixed on
 * the way) and `opened` (tickets opened). Judgment calls go in the ticket's `decisions`;
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
  for (const key of ['unverified', 'risks', 'fixed', 'opened']) {
    const list = cleanList(input[key], key);
    if (list.length) out[key] = list;
  }
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
  for (const s of result.unverified || []) lines.push(`Unverified: ${s}`);
  for (const s of result.risks || []) lines.push(`Risk: ${s}`);
  for (const s of result.fixed || []) lines.push(`Fixed: ${s}`);
  for (const s of result.opened || []) lines.push(`Opened: ${s}`);
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

function findRow(doc, id) {
  return flat(doc).find(({ task }) => task.id === id) || null;
}

/** The nearest ancestor of `task` that is an epic, or null (standalone tickets have none). */
export function epicOf(doc, task) {
  const seen = new Set([task.id]);
  let parentId = task.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const row = findRow(doc, parentId);
    if (!row) return null;
    if (row.task.type === 'epic') return row;
    parentId = row.task.parentId;
  }
  return null;
}

/** Every ticket under `epicId`, at any depth. */
function descendantsOf(doc, epicId) {
  const rows = flat(doc);
  const out = [];
  const queue = [epicId];
  while (queue.length) {
    const parent = queue.shift();
    for (const row of rows) {
      if (row.task.parentId === parent) { out.push(row); queue.push(row.task.id); }
    }
  }
  return out;
}

/**
 * Fold a shipped child's result and checks into its epic, so the Plan page's "Ready for
 * review" holds one card per epic. Lines are prefixed with the child's id; the child keeps
 * its own result and goes to Done. Returns { epic, epicSection, moveEpicToReview } for the
 * caller to apply, or null when the ticket has no epic.
 *
 * The epic moves to review once every other ticket under it is Done or Ready for review
 * (checks ticked on it finish it as for any ticket). An epic already in Done comes back to
 * review only when the child added checks.
 */
export function rollUpIntoEpic(doc, task, checkTexts, { now = new Date().toISOString() } = {}) {
  const found = epicOf(doc, task);
  if (!found) return null;
  const { task: epic, section: epicSection } = found;
  const prefix = (s) => `${task.id}: ${s}`;

  const result = task.result;
  const already = (epic.result?.shipped || []);
  const fresh = (result?.shipped || []).map(prefix).filter(l => !already.includes(l));
  if (result && fresh.length) {
    const mine = epic.result || { at: result.at, shipped: [], ci: result.ci || 'all passed' };
    mine.shipped = [...(mine.shipped || []), ...fresh];
    for (const key of ['left', 'tests', 'unverified', 'risks', 'fixed', 'opened']) {
      const lines = (result[key] || []).map(prefix);
      if (lines.length) mine[key] = [...(mine[key] || []), ...lines];
    }
    if (mine.ci === 'all passed' && result.ci && result.ci !== 'all passed') mine.ci = prefix(result.ci);
    epic.result = mine;
  }
  const added = addChecks(epic, checkTexts.map(prefix), { now });

  const siblingsOpen = descendantsOf(doc, epic.id).some(
    ({ task: t, section }) => t.id !== task.id && t.type !== 'epic' && section !== 'done' && section !== REVIEW_SECTION,
  );
  const moveEpicToReview = epicSection !== REVIEW_SECTION && !siblingsOpen && (epicSection !== 'done' || added > 0);
  return { epic, epicSection, added, moveEpicToReview };
}

const CLOSED_SECTIONS = new Set(['done', REVIEW_SECTION, 'archive']);

/**
 * Epics to drop from the day plan now that `task` has closed (done, review or archive):
 * the ticket itself when it is an epic, and each enclosing epic once nothing under it is
 * still open. Call after the move, so sections reflect the new state.
 */
export function epicsToUnpin(doc, task) {
  const row = findRow(doc, task.id);
  if (!row || !CLOSED_SECTIONS.has(row.section)) return [];
  const out = task.type === 'epic' ? [task.id] : [];
  let found = epicOf(doc, task);
  while (found) {
    const { task: epic } = found;
    const open = descendantsOf(doc, epic.id).some(
      ({ task: t, section }) => t.type !== 'epic' && !CLOSED_SECTIONS.has(section),
    );
    if (open) break;
    out.push(epic.id);
    found = epicOf(doc, epic);
  }
  return out;
}
