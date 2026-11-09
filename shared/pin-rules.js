/**
 * Pin rules (PRO61): a pin means "this week's focus". An epic pins itself when it moves to
 * in-progress; any other pin is one Tal made by hand (`ch tasks plan --pin`), remembered in
 * meta.dailyPlan.handPinnedIds (task history records no pin events). Pure functions that
 * change the passed doc in place.
 */

const FINISHED = new Set(['done', 'review', 'archive']);

function ensurePlan(doc) {
  if (!doc.meta) doc.meta = {};
  if (!doc.meta.dailyPlan || typeof doc.meta.dailyPlan !== 'object') doc.meta.dailyPlan = { date: null, taskIds: [], carriedIds: [] };
  const plan = doc.meta.dailyPlan;
  if (!Array.isArray(plan.taskIds)) plan.taskIds = [];
  if (!Array.isArray(plan.handPinnedIds)) plan.handPinnedIds = [];
  return plan;
}

/** Remember `id` as a hand pin (idempotent). */
export function handPin(doc, id) {
  const plan = ensurePlan(doc);
  if (!plan.handPinnedIds.includes(id)) plan.handPinnedIds.push(id);
}

/** Forget a hand pin. */
export function handUnpin(doc, id) {
  const plan = ensurePlan(doc);
  plan.handPinnedIds = plan.handPinnedIds.filter(x => x !== id);
}

/**
 * Unpin every pinned epic that is not in-progress and not a hand pin; epics that are finished
 * (done, review, archive) or no longer exist are dropped even when hand-pinned. Pinned tickets
 * that are not epics are left alone. With `dryRun` nothing changes.
 * @returns {{ id: string, title: string, section: string|null, why: string }[]} what was (or would be) unpinned
 */
export function cleanupPins(doc, { dryRun = false } = {}) {
  const plan = ensurePlan(doc);
  const where = new Map();
  for (const sec of doc.sections || []) for (const t of sec.tasks || []) if (!where.has(t.id)) where.set(t.id, { t, section: sec.id });
  const hand = new Set(plan.handPinnedIds);
  const out = [];
  const drop = new Set();
  for (const id of new Set([...(plan.taskIds || []), ...(plan.carriedIds || [])])) {
    const row = where.get(id);
    if (!row) { out.push({ id, title: '(missing)', section: null, why: 'ticket no longer exists' }); drop.add(id); continue; }
    if (row.t.type !== 'epic') continue;
    let why = null;
    if (FINISHED.has(row.section)) why = `epic is in ${row.section}`;
    else if (row.section !== 'in-progress' && !hand.has(id)) why = 'not in-progress and not pinned by hand';
    if (why) { out.push({ id, title: row.t.title || '', section: row.section, why }); drop.add(id); }
  }
  if (!dryRun && drop.size) {
    plan.taskIds = plan.taskIds.filter(id => !drop.has(id));
    plan.carriedIds = (plan.carriedIds || []).filter(id => !drop.has(id));
    plan.handPinnedIds = plan.handPinnedIds.filter(id => !drop.has(id));
  }
  return out;
}
