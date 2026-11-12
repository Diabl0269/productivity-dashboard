/**
 * shared/build-freshness-rollup.js — which PR links a Ready-for-review card checks, and the one
 * line they roll up to (AGE35). An epic has no PR links of its own: its children carry them, so
 * the card gathers theirs, checks each, and shows the worst state with the tickets that are behind.
 * Pure (no fs, no git, no DOM); the fetching lives in dashboard/js/build-freshness-note.js.
 */

import { freshnessLine } from './build-freshness.js';

const PR_LINK = /\/pull\/\d+/;
const RANK = { current: 0, unknown: 1, stale: 2 };

const prUrls = (task) => (Array.isArray(task?.links) ? task.links : [])
  .map(l => l?.url).filter(u => typeof u === 'string' && PR_LINK.test(u));

/**
 * The PR links a card should check: [{ ticketId, url }]. The ticket's own links first, then those
 * of every ticket under it (children, and their children), so an epic card sees its children's PRs.
 * `tasks` is a flat list of dashboard-shaped tickets ({ taskId, parentId, links }).
 */
export function cardPrLinks(task, tasks) {
  const out = [];
  const seen = new Set();
  const add = (t) => prUrls(t).forEach(url => {
    const key = `${t.taskId}\n${url}`;
    if (!seen.has(key)) { seen.add(key); out.push({ ticketId: t.taskId, url }); }
  });
  if (!task) return out;
  add(task);
  const visited = new Set([task.taskId]);
  let level = [task.taskId];
  while (level.length) {
    const next = [];
    for (const t of tasks || []) {
      if (!t || visited.has(t.taskId) || !level.includes(t.parentId)) continue;
      visited.add(t.taskId);
      next.push(t.taskId);
      add(t);
    }
    level = next;
  }
  return out;
}

/**
 * Roll per-link results up to one card line. `entries` are [{ ticketId, result }] with result
 * undefined (still loading), null or { state: null } (no rule matches that link), or a freshness
 * result. Returns null when nothing is known yet or no link has a rule, else
 * { text, command?, kind: 'current'|'stale'|'unknown', staleIds? } (worst state wins:
 * stale, then unknown, then current). `staleIds` omits `ownId` (a ticket's own PR needs no label).
 */
export function rollUpFreshness(entries, ownId = null) {
  const applicable = entries.filter(e => e.result && e.result.state);
  if (!applicable.length || entries.some(e => e.result === undefined)) return null;
  let worst = 'current';
  for (const e of applicable) if (RANK[e.result.state] > RANK[worst]) worst = e.result.state;
  const pool = applicable.filter(e => e.result.state === worst);
  // Of several stale PRs, describe the newest merge: it is the one that decides the update.
  const pick = pool.reduce((a, b) => (String(b.result.mergedAt || '') > String(a.result.mergedAt || '') ? b : a));
  const line = freshnessLine(pick.result);
  if (!line) return null;
  const out = { ...line, kind: worst };
  if (worst === 'stale') {
    const ids = [...new Set(pool.map(e => e.ticketId).filter(id => id && id !== ownId))];
    if (ids.length) out.staleIds = ids;
  }
  return out;
}
