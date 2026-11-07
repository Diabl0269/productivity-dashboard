/**
 * Next-ticket picker — which ready ticket to start next (docs/metrics.md, "Next-ticket picker").
 * Pure and read-only: it suggests, it never starts or moves anything.
 *
 * Input is the tasks.json document shape: { sections: [{ id, tasks: [...] }], meta }.
 */

import { computeRunPlan, isPickGate } from './run-plan.js';

const DAY = 24 * 3600 * 1000;
const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };
const FINISHED = new Set(['done', 'review', 'archive']);
const BEYOND_LANE = 1000;

/** A gate for the human rather than build work: Co-task, Design: or a design label. */
function isGate(t) {
  if (isPickGate(t)) return true;
  if (/^\s*design\s*:/i.test(String(t.title || ''))) return true;
  return (t.labels || []).some(l => /^design$/i.test(String(l).trim()));
}

/**
 * Ready tickets ranked best first: in `todo`, every blockedBy done or in review, not a gate,
 * not flagged blocked or waiting on someone, parent epic not done. Order: epic already in progress, epic's position in its lane (from the
 * run plan; first epic first), priority, due date (earliest first), age (oldest first).
 *
 * @param {object} doc
 * @param {{n?: number, project?: string, now?: Date|string}} [opts]
 * @returns {{id:string,title:string,project:string,lane:string,priority:string,epicId:string|null,
 *   epicTitle:string|null,score:number,reasons:string[]}[]}
 */
export function rankReadyTickets(doc, { n = 5, project, now = new Date(), spread = true } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const byId = new Map();
  const sectionOf = new Map();
  for (const sec of doc?.sections || []) {
    for (const t of sec.tasks || []) {
      if (t && t.id && !byId.has(t.id)) { byId.set(t.id, t); sectionOf.set(t.id, sec.id); }
    }
  }
  const epicOf = t => {
    const seen = new Set();
    for (let cur = byId.get(t.parentId); cur && !seen.has(cur.id); cur = byId.get(cur.parentId)) {
      if (cur.type === 'epic') return cur;
      seen.add(cur.id);
    }
    return null;
  };
  const epicInProgress = new Set();
  for (const t of byId.values()) {
    if (sectionOf.get(t.id) !== 'in-progress') continue;
    const e = t.type === 'epic' ? t : epicOf(t);
    if (e) epicInProgress.add(e.id);
  }

  // Position of each epic within its lane, in the run plan's order (now cards, then later).
  const position = new Map();
  for (const l of computeRunPlan(doc).lanes || []) {
    [...l.now, ...l.later].forEach((c, i) => {
      if (!position.has(c.id) || i < position.get(c.id)) position.set(c.id, i);
    });
  }

  const rows = [];
  for (const [id, t] of byId) {
    if (sectionOf.get(id) !== 'todo' || t.type === 'epic' || isGate(t)) continue;
    if (project && t.project !== project) continue;
    if (t.blocked || (typeof t.waitingOn === 'string' && t.waitingOn.trim())) continue;
    if ((t.blockedBy || []).some(b => byId.has(b) && !FINISHED.has(sectionOf.get(b)))) continue;
    const epic = epicOf(t);
    if (epic && ['done', 'archive'].includes(sectionOf.get(epic.id))) continue;
    const pos = epic && position.has(epic.id) ? position.get(epic.id) : BEYOND_LANE;
    const prio = PRIORITY_RANK[t.priority] || 0;
    const due = t.due ? Date.parse(t.due) : NaN;
    const created = t.created ? Date.parse(t.created) : NaN;
    const inProg = !!(epic && epicInProgress.has(epic.id));

    const reasons = [];
    if (inProg) reasons.push('epic already in progress');
    if (pos === 0) reasons.push(`first in lane ${epic.lane || 'unassigned'}`);
    if (prio >= 3) reasons.push(`priority ${t.priority}`);
    let dueDays = null;
    if (Number.isFinite(due)) {
      dueDays = Math.ceil((due - nowMs) / DAY);
      if (dueDays < 0) reasons.push(`overdue by ${-dueDays} day${dueDays === -1 ? '' : 's'}`);
      else if (dueDays === 0) reasons.push('due today');
      else if (dueDays <= 7) reasons.push(`due in ${dueDays} day${dueDays === 1 ? '' : 's'}`);
    }
    const ageDays = Number.isFinite(created) ? Math.floor((nowMs - created) / DAY) : 0;
    if (ageDays >= 7) reasons.push(`waiting ${ageDays} days`);

    // The score only summarises the order (the sort below is lexicographic): epic in progress,
    // lane position, priority, due, age, each in its own band.
    const score = (inProg ? 100000 : 0)
      + (pos < 10 ? (10 - pos) * 5000 : 0)
      + prio * 500
      + (dueDays === null ? 0 : Math.max(0, 30 - Math.max(dueDays, 0)) * 10)
      + Math.min(ageDays, 9);
    rows.push({
      id, inProg, pos, prio, due, created, score, reasons,
      out: {
        id, title: t.title || '', project: t.project || '', lane: t.lane || epic?.lane || 'unassigned',
        priority: t.priority || '', epicId: epic ? epic.id : null, epicTitle: epic ? (epic.title || '') : null,
      },
    });
  }
  const finite = x => (Number.isFinite(x) ? x : Infinity);
  rows.sort((a, b) => (Number(b.inProg) - Number(a.inProg))
    || (a.pos - b.pos)
    || (b.prio - a.prio)
    || (finite(a.due) === finite(b.due) ? 0 : finite(a.due) < finite(b.due) ? -1 : 1)
    || (finite(a.created) === finite(b.created) ? 0 : finite(a.created) < finite(b.created) ? -1 : 1)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Lanes run in parallel, so spread the list across lanes: each lane's best ticket first (lanes
  // ordered by that ticket), then each lane's second, and so on. `spread: false` keeps the raw order.
  let ordered = rows;
  if (spread) {
    const byLane = new Map();
    for (const r of rows) {
      const k = r.out.lane;
      if (!byLane.has(k)) byLane.set(k, []);
      byLane.get(k).push(r);
    }
    ordered = [];
    for (let round = 0; ordered.length < rows.length; round++) {
      for (const list of byLane.values()) if (list[round]) ordered.push(list[round]);
    }
  }
  return ordered.slice(0, n).map(r => ({ ...r.out, score: r.score, reasons: r.reasons }));
}
