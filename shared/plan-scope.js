/**
 * Plan scope — narrow a computed run plan (shared/run-plan.js computeRunPlan) to a set of epics,
 * for Home's Lanes view when a place is selected. Pure: no DOM, no second readiness rule; the plan
 * is computed on the whole doc first, then rows outside the set are left out.
 *
 * A ticket is in scope when it, or any ticket above it (parentId chain), is in the set.
 * `scope` is a Set of epic ids, or null for "no filter" (everything passes unchanged).
 */

import { autoQueue, groupQueue } from './auto-queue.js';
import { AUTO_PRIORITIES } from './epic-ready.js';

/** Map id -> parentId over a tasks.json-shaped doc. */
function parentsOf(doc) {
  const parent = new Map();
  for (const sec of doc?.sections || []) for (const t of sec.tasks || []) if (t?.id) parent.set(t.id, t.parentId || null);
  return parent;
}

/**
 * A predicate id -> boolean: true when the ticket or one of its ancestors is in `scope`.
 * With no scope every id passes.
 */
export function scopeTest(doc, scope) {
  if (!scope) return () => true;
  const parent = parentsOf(doc);
  const memo = new Map();
  const test = (id) => {
    if (memo.has(id)) return memo.get(id);
    const seen = new Set();
    let ok = false;
    for (let x = id; x && !seen.has(x); x = parent.get(x)) {
      seen.add(x);
      if (scope.has(x)) { ok = true; break; }
    }
    memo.set(id, ok);
    return ok;
  };
  return test;
}

/** "A, B and C" (the same rule run-plan.js uses for these cards). */
function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A design-lane card's title, why and command, retold for fewer tickets (counts and id lists). */
function retellCard(card, ids) {
  const n = ids.length;
  const swap = s => (typeof s === 'string' ? s.split(joinList(card.ticketIds)).join(joinList(ids)) : s);
  let title = card.title;
  if (card.id === 'design-canvases') title = `Draw the ${n} pick ${n === 1 ? 'canvas' : 'canvases'}`;
  if (card.id === 'design-publish') title = `Publish the ${n} picked ${n === 1 ? 'design' : 'designs'} to the Design System`;
  return { ...card, title, why: swap(card.why), command: swap(card.command), ticketIds: ids, openTickets: n };
}

/** A card of a lane narrowed to the scope, or null when nothing of it is left. */
function scopeCard(card, test) {
  if (!card.ticketIds) return test(card.id) ? card : null;
  const ids = card.ticketIds.filter(test);
  if (!ids.length) return null;
  return ids.length === card.ticketIds.length ? card : retellCard(card, ids);
}

/**
 * Review notes in scope: a ticket's notes when the ticket is in scope; a free note (no ticket) when
 * its area is the lane of an epic in scope. `pending` is shared/review-notes.js pendingReviewNotes(doc).
 */
export function scopeNotes(pending, doc, scope) {
  if (!scope) return pending;
  const test = scopeTest(doc, scope);
  const lanes = new Set();
  for (const sec of doc?.sections || []) for (const t of sec.tasks || []) if (t?.type === 'epic' && scope.has(t.id) && t.lane) lanes.add(t.lane);
  return pending.filter(e => (e.type === 'free' ? !!e.lane && lanes.has(e.lane) : test(e.id)));
}

/**
 * The plan with only the scope's rows. Lanes keep `index`, their place in the whole plan (so a
 * lane keeps its colour); lanes left empty are dropped. `totals` is kept as computed (whole plan).
 */
export function scopePlan(plan, doc, scope) {
  const lanes = (plan.lanes || []).map((lane, index) => ({ ...lane, index }));
  if (!scope) return { ...plan, lanes };
  const test = scopeTest(doc, scope);
  const keep = list => (list || []).map(c => scopeCard(c, test)).filter(Boolean);
  return {
    ...plan,
    lanes: lanes
      .map(lane => ({ ...lane, now: keep(lane.now), later: keep(lane.later), laterEpics: (lane.laterEpics || []).filter(c => test(c.id)) }))
      .filter(lane => lane.now.length || lane.later.length || lane.laterEpics.length),
    readiness: (plan.readiness || []).filter(r => test(r.id)),
    review: (plan.review || []).filter(item => test(item.id)),
    openChecks: (plan.openChecks || []).filter(item => test(item.id)),
    doneEpics: (plan.doneEpics || []).filter(test),
    picks: (plan.picks || []).filter(p => test(p.id)),
  };
}

/** Decision cards (`ids`) and interpretation cards (`id`) in scope. */
export function scopeForYou(doc, scope, asks = [], interps = []) {
  if (!scope) return { asks, interps };
  const test = scopeTest(doc, scope);
  return {
    asks: asks.filter(card => (card.ids || []).some(test)),
    interps: interps.filter(card => test(card.id)),
  };
}

/**
 * The count line: "Showing Mixer: 4 of 61 epics." `place` is the selected place's name.
 * @param {{place?: string, shown: number, total: number}} p
 */
export function scopeLine({ place, shown, total }) {
  const what = `${shown} of ${total} ${total === 1 ? 'epic' : 'epics'}`;
  return `Showing ${place || 'the chosen epics'}: ${what}.`;
}

/** `?hmEpics=A1,B2` from a location.search string: a Set of ids, or null when absent or empty. */
export function epicsFromSearch(search) {
  let raw = null;
  try { raw = new URLSearchParams(search || '').get('hmEpics'); } catch { raw = null; }
  const ids = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

/**
 * Turn a move made among the shown rows of a narrowed Auto queue into the same move in the whole
 * queue, so the epics left out keep their places (shared/auto-queue.js moveInQueue renumbers a
 * group 1..n, so it must see the whole group).
 * @param {object[]} full    the whole queue (autoQueue order)
 * @param {Set<string>} shown  ids of the rows shown
 * @param {string} id        the row being moved
 * @param {{priority: string, index: number}} target  index among the shown rows of that group, the row itself left out
 * @returns {{priority: string, index: number}} the target in the whole queue
 */
export function fullQueueTarget(full, shown, id, target) {
  const groups = groupQueue(full);
  const others = groups[target.priority].filter(r => r.id !== id);
  const visible = others.filter(r => shown.has(r.id));
  if (target.index < visible.length) return { priority: target.priority, index: others.indexOf(visible[target.index]) };
  if (visible.length) return { priority: target.priority, index: others.indexOf(visible[visible.length - 1]) + 1 };
  // No shown row in that group: moving up lands at its end, moving down (or a drop) at its start.
  const from = full.find(r => r.id === id);
  const up = AUTO_PRIORITIES.indexOf(target.priority) < AUTO_PRIORITIES.indexOf(from?.priority);
  return { priority: target.priority, index: up ? others.length : 0 };
}

/** The Auto queue of a readiness list narrowed to the scope (order kept). */
export function scopedQueue(readiness, doc, scope) {
  const full = autoQueue(readiness);
  if (!scope) return { full, shown: full };
  const test = scopeTest(doc, scope);
  return { full, shown: full.filter(r => test(r.id)) };
}
