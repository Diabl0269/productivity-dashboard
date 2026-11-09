/**
 * Auto queue: the Auto epics in the order they start (shared/epic-ready.js autoQueueOrder),
 * grouped High / Normal / Low, and the pure "move one row" logic behind the Plan page's queue
 * (drag or Alt+Arrow). A move returns the epics whose `autoPriority` / `autoRank` must change;
 * the caller writes them. No DOM here.
 */

import { AUTO_PRIORITIES, autoQueueOrder } from './epic-ready.js';

/** Group an ordered queue: { high: [...], normal: [...], low: [...] } (each keeps queue order). */
export function groupQueue(queue) {
  const groups = { high: [], normal: [], low: [] };
  for (const r of queue || []) groups[AUTO_PRIORITIES.includes(r.priority) ? r.priority : 'normal'].push(r);
  return groups;
}

/** The Auto epics of `readiness`, in start order. */
export function autoQueue(readiness) {
  return autoQueueOrder((readiness || []).filter(r => r.auto));
}

/**
 * Move row `id` to `target` = { priority, index } (index among that group's other rows, 0 = first;
 * clamped). Ranks of the target group (and of the group it left) are renumbered 1..n in the new order.
 * @param {{id: string, priority: string, autoRank?: number|null}[]} queue  ordered queue
 * @returns {{ order: string[], changes: {id: string, priority: string, autoRank: number}[] }}
 *   order: every id in the new queue order; changes: only rows whose priority or rank differ now.
 */
export function moveInQueue(queue, id, target) {
  const from = (queue || []).find(r => r.id === id);
  if (!from) return { order: (queue || []).map(r => r.id), changes: [] };
  const to = AUTO_PRIORITIES.includes(target?.priority) ? target.priority : from.priority;
  const groups = groupQueue(queue);
  const rowsOf = p => groups[p].filter(r => r.id !== id).map(r => ({ id: r.id, priority: p }));
  const index = Math.max(0, Math.min(Number.isFinite(target?.index) ? Math.trunc(target.index) : Infinity, rowsOf(to).length));

  const next = {};
  for (const p of AUTO_PRIORITIES) next[p] = rowsOf(p);
  next[to].splice(index, 0, { id, priority: to });

  const before = new Map(queue.map(r => [r.id, r]));
  const changes = [];
  for (const p of [...new Set([from.priority, to])]) {
    next[p].forEach((row, i) => {
      const old = before.get(row.id);
      if (old.priority !== p || old.autoRank !== i + 1) changes.push({ id: row.id, priority: p, autoRank: i + 1 });
    });
  }
  return { order: AUTO_PRIORITIES.flatMap(p => next[p].map(r => r.id)), changes };
}

/**
 * Where Alt+ArrowUp (dir -1) or Alt+ArrowDown (+1) puts row `id`: one place within its group, or,
 * at the group's edge (the group's end groups are always shown, even empty), into the end of the group above / the start of the group below (its
 * priority changes). Returns { priority, index } for moveInQueue, or null at the very top / bottom.
 */
export function stepTarget(queue, id, dir) {
  const row = (queue || []).find(r => r.id === id);
  if (!row) return null;
  const groups = groupQueue(queue);
  const g = AUTO_PRIORITIES.indexOf(row.priority);
  const at = groups[row.priority].findIndex(r => r.id === id);
  if (dir < 0) {
    if (at > 0) return { priority: row.priority, index: at - 1 };
    if (g === 0) return null;
    const above = AUTO_PRIORITIES[g - 1];
    return { priority: above, index: groups[above].length };
  }
  if (at < groups[row.priority].length - 1) return { priority: row.priority, index: at + 1 };
  if (g === AUTO_PRIORITIES.length - 1) return null;
  return { priority: AUTO_PRIORITIES[g + 1], index: 0 };
}
