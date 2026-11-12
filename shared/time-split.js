/**
 * shared/time-split.js (pure): where the time tickets spend in `in-progress` goes. Spec: docs/metrics.md
 * "Where in-progress time goes". Each in-progress stay is split into four categories, each a union of
 * intervals clipped to the stay; a moment counts once, by precedence:
 *   working (a session turn runs for the ticket) > waiting on CI (a CI run for its branch runs)
 *   > waiting on you (a session for it waits on your reply or a question) > nobody working on it.
 */
import { ticketStays, median } from './flow-metrics.js';
import { ticketFrom } from './session-metrics.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const TOP = 20;

const toMs = v => {
  if (v === undefined || v === null || v === '') return null;
  const ms = typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};
const r2 = n => Math.round(n * 100) / 100;
const share = (x, total) => (total > 0 ? Math.round((x / total) * 1000) / 1000 : 0);

/** Union of [s, e] intervals clipped to [a, b]: sorted, non-overlapping. */
export function clipUnion(list, a, b) {
  const xs = [];
  for (const [s, e] of list || []) {
    const lo = Math.max(s, a);
    const hi = Math.min(e, b);
    if (hi > lo) xs.push([lo, hi]);
  }
  xs.sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

const length = u => u.reduce((n, [s, e]) => n + (e - s), 0);

/**
 * Split one stay [a, b] by precedence. Returns ms per category; they add up to b - a.
 * The union lengths nest: W, W+C, W+C+U, so each category is the growth over the one before.
 */
export function splitStay(a, b, { work = [], ci = [], you = [] }) {
  const w = clipUnion(work, a, b);
  const wc = clipUnion([...w, ...clipUnion(ci, a, b)], a, b);
  const wcu = clipUnion([...wc, ...clipUnion(you, a, b)], a, b);
  const working = length(w);
  const waitCi = length(wc) - working;
  const waitYou = length(wcu) - length(wc);
  return { working, ci: waitCi, you: waitYou, idle: b - a - length(wcu) };
}

/** Ticket id of a CI run from its branch (`fix/fro1610-menus` -> FRO1610), or null. */
export function ciTicket(record) {
  return record && record.branch ? ticketFrom({ branch: record.branch }) : null;
}

/** [[startMs, endMs]] of CI runs per ticket (cancelled runs included: CI was running). */
export function ciIntervals(timings) {
  const out = new Map();
  for (const r of timings || []) {
    if (!r || r.kind !== 'ci') continue;
    const id = ciTicket(r);
    const at = toMs(r.at);
    const sec = Number(r.seconds);
    if (!id || at === null || !(sec > 0)) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push([at, at + sec * 1000]);
  }
  return out;
}

/** Session intervals per ticket for one kind ('work' | 'waitUser'): Map ticket -> [[s, e]]. */
export function sessionIntervals(sessions, kind) {
  const out = new Map();
  for (const s of sessions || []) {
    for (const [a, b, id] of (s && s.intervals && s.intervals[kind]) || []) {
      if (!id) continue;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push([a, b]);
    }
  }
  return out;
}

const empty = () => ({ workingMs: 0, ciMs: 0, youMs: 0, idleMs: 0 });
const add = (acc, p) => { acc.workingMs += p.working; acc.ciMs += p.ci; acc.youMs += p.you; acc.idleMs += p.idle; };
const hoursOf = acc => {
  const total = acc.workingMs + acc.ciMs + acc.youMs + acc.idleMs;
  return {
    hours: r2(total / HOUR), workingH: r2(acc.workingMs / HOUR), ciH: r2(acc.ciMs / HOUR),
    youH: r2(acc.youMs / HOUR), idleH: r2(acc.idleMs / HOUR),
  };
};

/**
 * @param {{doc:object, sessions?:object[], timings?:object[], now?:Date|string|number, since?:Date|string|number,
 *   project?:string, areas?:Record<string,string>, only?:string}} args (`only`: a single ticket id)
 * @returns {{typical: {n, medianHours, shares}, total: object, byTicket: object[], byProject: object, byArea: object, sessionsWithIntervals: number}}
 *   total: {hours, workingH, ciH, youH, idleH, shares:{working, ci, you, idle}}; byTicket: top 20 by idle hours.
 */
export function splitInProgress({ doc, sessions = [], timings = [], now = new Date(), since, project, areas = {}, only } = {}) {
  const nowMs = toMs(now) ?? Date.now();
  const sinceMs = toMs(since) ?? nowMs - 30 * DAY;
  const work = sessionIntervals(sessions, 'work');
  const you = sessionIntervals(sessions, 'waitUser');
  const ci = ciIntervals(timings);

  const byId = new Map();
  for (const sec of doc?.sections || []) for (const t of sec.tasks || []) if (t && t.id && !byId.has(t.id)) byId.set(t.id, t);
  const laneOf = t => {
    for (let cur = t, i = 0; cur && i < 10; cur = byId.get(cur.parentId), i++) if (cur.lane) return cur.lane;
    return 'unassigned';
  };

  const total = empty();
  const projects = new Map();
  const groupAreas = new Map();
  const rows = [];
  const typicalRows = []; // one per ticket with a closed stay in the window
  for (const t of byId.values()) {
    if (t.type === 'epic' || (only && t.id !== only)) continue;
    const proj = t.project || 'none';
    if (project && proj !== project) continue;
    const acc = empty();
    const closed = empty(); // closed stays only, for the typical ticket
    let open = false;
    for (const s of ticketStays(t, { now: nowMs })) {
      if (s.stage !== 'in-progress') continue;
      const a = Math.max(Date.parse(s.from), sinceMs);
      const b = Math.min(Date.parse(s.to), nowMs);
      if (!(b > a)) continue;
      const p = splitStay(a, b, { work: work.get(t.id), ci: ci.get(t.id), you: you.get(t.id) });
      add(acc, p);
      if (s.open) open = true; else add(closed, p);
    }
    const closedSum = closed.workingMs + closed.ciMs + closed.youMs + closed.idleMs;
    if (closedSum > 0) {
      typicalRows.push({ hours: closedSum / HOUR, working: closed.workingMs / closedSum, ci: closed.ciMs / closedSum, you: closed.youMs / closedSum, idle: closed.idleMs / closedSum });
    }
    const sum = acc.workingMs + acc.ciMs + acc.youMs + acc.idleMs;
    if (!(sum > 0)) continue;
    add(total, { working: acc.workingMs, ci: acc.ciMs, you: acc.youMs, idle: acc.idleMs });
    for (const [map, key] of [[projects, proj], [groupAreas, areas[laneOf(t)] || 'other']]) {
      const g = map.get(key) || empty();
      add(g, { working: acc.workingMs, ci: acc.ciMs, you: acc.youMs, idle: acc.idleMs });
      map.set(key, g);
    }
    rows.push({ ticket: t.id, title: t.title || '', open, idleMs: acc.idleMs, ...hoursOf(acc) });
  }
  rows.sort((x, y) => y.idleMs - x.idleMs || (x.ticket < y.ticket ? -1 : 1));
  const sum = total.workingMs + total.ciMs + total.youMs + total.idleMs;
  const groupOut = map => Object.fromEntries([...map].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([k, v]) => [k, hoursOf(v)]));
  // Mean, not median, per category: per-category medians do not add up to 100%, means of shares do.
  const avg = k => (typicalRows.length ? Math.round((typicalRows.reduce((n, r) => n + r[k], 0) / typicalRows.length) * 1000) / 1000 : null);
  return {
    // The typical ticket: average per-category share over tickets whose in-progress stay closed in the window
    // (open stays excluded, so tickets forgotten in progress do not decide it).
    typical: {
      n: typicalRows.length,
      medianHours: typicalRows.length ? r2(median(typicalRows.map(r => r.hours))) : null,
      shares: { working: avg('working'), ci: avg('ci'), you: avg('you'), idle: avg('idle') },
    },
    total: {
      ...hoursOf(total),
      shares: { working: share(total.workingMs, sum), ci: share(total.ciMs, sum), you: share(total.youMs, sum), idle: share(total.idleMs, sum) },
    },
    byTicket: rows.slice(0, TOP).map(({ idleMs, ...r }) => r),
    byProject: groupOut(projects),
    byArea: groupOut(groupAreas),
    sessionsWithIntervals: (sessions || []).filter(s => s && s.intervals).length,
    tickets: rows.length,
  };
}
