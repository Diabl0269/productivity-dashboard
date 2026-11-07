/**
 * Flow metrics — cycle/lead time, stage dwell, bottleneck, WIP and forgotten epics, from the
 * `moved` events in ticket history (docs/metrics.md, "Ticket flow"). Pure module: no I/O.
 *
 * Input is the tasks.json document shape: { sections: [{ id, tasks: [...] }], meta }.
 * History may be missing on old tickets; those tickets simply have no stays and are skipped
 * (except for the forgotten-epic check, which falls back to `created`).
 */

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const STAGES = ['todo', 'in-progress', 'review'];
const FINISH = new Set(['review', 'done']);
const REOPEN_FROM = new Set(['review', 'done']);
const REOPEN_TO = new Set(['in-progress', 'todo']);

const toMs = v => {
  if (v === undefined || v === null || v === '') return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};
const iso = ms => new Date(ms).toISOString();
const r1 = n => Math.round(n * 10) / 10;
const hours = ms => ms / HOUR;

/** The p-th percentile (0-100, linear interpolation) of numbers; null for an empty list. */
export function percentile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (p / 100) * (v.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** Median of numbers; null for an empty list. */
export function median(values) {
  return percentile(values, 50);
}

/** { n, median, p75, p90 } of hour values, rounded to 1 decimal (nulls when empty). */
function summary(values) {
  const round = x => (x === null ? null : r1(x));
  return { n: values.length, median: round(median(values)), p75: round(percentile(values, 75)), p90: round(percentile(values, 90)) };
}

function moves(task) {
  return (task?.history || [])
    .filter(e => e && e.event === 'moved' && toMs(e.at) !== null)
    .map(e => ({ at: toMs(e.at), from: e.from, to: e.to }))
    .sort((a, b) => a.at - b.at);
}

/**
 * The stays of one ticket in each section, derived from `created` and its `moved` events:
 * [{ stage, from, to, open }] (ISO strings; the current stay has open = true and ends at `now`).
 * A ticket with no history has no stays.
 */
export function ticketStays(task, { now = new Date() } = {}) {
  const nowMs = toMs(now) ?? Date.now();
  const history = task?.history || [];
  const mv = moves(task);
  const createdEvent = history.find(e => e && e.event === 'created');
  const startMs = toMs(task?.created) ?? toMs(createdEvent?.at) ?? (mv.length ? mv[0].at : null);
  let stage = mv.length ? mv[0].from : createdEvent?.to;
  if (!stage && !mv.length) return [];
  if (startMs === null) return [];
  const stays = [];
  let from = startMs;
  for (const m of mv) {
    if (stage) stays.push({ stage, from: iso(from), to: iso(Math.max(from, m.at)), open: false });
    stage = m.to;
    from = Math.max(from, m.at);
  }
  if (stage) stays.push({ stage, from: iso(from), to: iso(Math.max(from, nowMs)), open: true });
  return stays;
}

function isoDay(ms) {
  return iso(ms).slice(0, 10);
}

/** Monday (UTC) of the week containing ms, as a day start in ms. */
function mondayMs(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

/**
 * Flow numbers for a window. See docs/metrics.md. Hours everywhere, 1 decimal.
 *
 * Interpretations: a ticket counts once per measure by its FIRST move into review/done
 * (shipped/lead) and first move into in-progress (started); stage n/median/p75 use closed
 * stays only, while totalHours (and so the bottleneck) also counts open stays up to now.
 *
 * @param {object} doc
 * @param {{now?: Date|string, since?: Date|string, project?: string, lane?: string,
 *   areas?: Record<string,string>, forgottenEpicDays?: number}} [opts]
 */
export function flowMetrics(doc, {
  now = new Date(), since, project, lane, areas = {}, forgottenEpicDays = 3,
} = {}) {
  const nowMs = toMs(now) ?? Date.now();
  const sinceMs = toMs(since) ?? nowMs - 30 * DAY;
  const untilMs = nowMs;

  const byId = new Map();
  const sectionOf = new Map();
  for (const sec of doc?.sections || []) {
    for (const t of sec.tasks || []) {
      if (t && t.id && !byId.has(t.id)) { byId.set(t.id, t); sectionOf.set(t.id, sec.id); }
    }
  }
  const laneOf = t => {
    for (let cur = t, i = 0; cur && i < 10; cur = byId.get(cur.parentId), i++) {
      if (cur.lane) return cur.lane;
    }
    return 'unassigned';
  };
  const projectOf = t => t.project || 'none';
  const keep = t => (!project || projectOf(t) === project) && (!lane || laneOf(t) === lane);

  const all = [...byId.values()].filter(keep);
  const work = all.filter(t => t.type !== 'epic');
  const epics = all.filter(t => t.type === 'epic');
  const inWindow = ms => ms !== undefined && ms !== null && ms >= sinceMs && ms <= untilMs;

  /** Per-ticket facts used by every group. */
  function facts(t) {
    const mv = moves(t);
    const firstStart = mv.find(m => m.to === 'in-progress');
    const firstFinish = mv.find(m => FINISH.has(m.to));
    const noWork = !!firstFinish && !(firstStart && firstStart.at <= firstFinish.at);
    const finishAfterStart = firstStart ? mv.find(m => FINISH.has(m.to) && m.at >= firstStart.at) : null;
    return {
      t,
      started: firstStart?.at,
      finish: firstFinish?.at,
      noWork,
      cycleEnd: finishAfterStart?.at,
      created: toMs(t.created) ?? toMs((t.history || []).find(e => e && e.event === 'created')?.at),
      reopened: mv.filter(m => REOPEN_FROM.has(m.from) && REOPEN_TO.has(m.to)).map(m => m.at),
      stays: ticketStays(t, { now: nowMs }),
    };
  }
  const facts0 = work.map(facts);

  /** counts, cycle, lead, stages and bottleneck for a set of ticket facts. */
  function compute(list) {
    const counts = { started: 0, shipped: 0, reopened: 0, closedWithoutWork: 0 };
    const cycle = [];
    const lead = [];
    const stageVals = Object.fromEntries(STAGES.map(s => [s, { closed: [], total: 0, openN: 0, oldest: 0 }]));
    for (const f of list) {
      if (inWindow(f.started)) counts.started++;
      if (inWindow(f.finish)) {
        if (f.noWork) counts.closedWithoutWork++;
        else {
          counts.shipped++;
          if (f.created !== null) lead.push(hours(f.finish - f.created));
        }
      }
      counts.reopened += f.reopened.filter(inWindow).length;
      if (f.started !== undefined && f.cycleEnd !== undefined && inWindow(f.cycleEnd)) {
        cycle.push(hours(f.cycleEnd - f.started));
      }
      for (const s of f.stays) {
        const v = stageVals[s.stage];
        if (!v) continue;
        const a = Date.parse(s.from);
        const b = Date.parse(s.to);
        if (!(a < untilMs && b > sinceMs)) continue;
        const dwell = hours(Math.min(b, untilMs) - Math.max(a, sinceMs));
        v.total += dwell;
        if (s.open) { v.openN++; v.oldest = Math.max(v.oldest, hours(nowMs - a)); } else v.closed.push(dwell);
      }
    }
    const stages = {};
    let grand = 0;
    for (const s of STAGES) grand += stageVals[s].total;
    let best = null;
    for (const s of STAGES) {
      const v = stageVals[s];
      const sum = summary(v.closed);
      stages[s] = {
        n: sum.n, median: sum.median, p75: sum.p75, totalHours: r1(v.total),
        open: { n: v.openN, oldestHours: r1(v.oldest) },
      };
      if (v.total > 0 && (!best || v.total > best.raw)) best = { stage: s, raw: v.total };
    }
    return {
      counts, cycle: summary(cycle), lead: summary(lead), stages,
      bottleneck: best ? { stage: best.stage, totalHours: r1(best.raw), share: Math.round((best.raw / grand) * 1000) / 1000 } : null,
    };
  }

  const top = compute(facts0);

  const groupBy = keyOf => {
    const buckets = new Map();
    for (const f of facts0) {
      const k = keyOf(f.t);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(f);
    }
    const out = {};
    for (const [k, list] of [...buckets].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const { counts, cycle, stages, bottleneck } = compute(list);
      out[k] = { counts, cycle, stages, bottleneck };
    }
    return out;
  };

  // WIP: end-of-day count in in-progress, tickets and epics.
  const ticketStayLists = facts0.map(f => f.stays);
  const epicStayLists = epics.map(e => ticketStays(e, { now: nowMs }));
  const wip = [];
  const s0 = new Date(sinceMs);
  const firstDay = Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth(), s0.getUTCDate());
  const countAt = (lists, eod) => lists.filter(stays => stays.some(s => s.stage === 'in-progress'
    && Date.parse(s.from) <= eod && (s.open || Date.parse(s.to) > eod))).length;
  for (let day = firstDay; day <= untilMs; day += DAY) {
    const eod = Math.min(day + DAY - 1, untilMs);
    wip.push({ date: isoDay(day), tickets: countAt(ticketStayLists, eod), epics: countAt(epicStayLists, eod) });
  }

  // Cycle time by week of the finish.
  const byWeek = new Map();
  for (let w = mondayMs(sinceMs); w <= untilMs; w += 7 * DAY) byWeek.set(w, []);
  for (const f of facts0) {
    if (f.started !== undefined && f.cycleEnd !== undefined && inWindow(f.cycleEnd)) {
      byWeek.get(mondayMs(f.cycleEnd))?.push(hours(f.cycleEnd - f.started));
    }
  }
  const cycleByWeek = [...byWeek].map(([w, vals]) => ({ week: isoDay(w), n: vals.length, median: vals.length ? r1(median(vals)) : null }));

  // Forgotten epics: in-progress, no event on the epic or any descendant for N days.
  const childrenOf = new Map();
  for (const t of byId.values()) {
    if (!t.parentId) continue;
    if (!childrenOf.has(t.parentId)) childrenOf.set(t.parentId, []);
    childrenOf.get(t.parentId).push(t.id);
  }
  const lastEvent = t => {
    const stamps = (t.history || []).map(e => toMs(e?.at)).filter(x => x !== null);
    return stamps.length ? Math.max(...stamps) : toMs(t.created);
  };
  const forgottenEpics = [];
  for (const e of epics) {
    if (sectionOf.get(e.id) !== 'in-progress') continue;
    let last = lastEvent(e);
    const seen = new Set([e.id]);
    const stack = [...(childrenOf.get(e.id) || [])];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const l = lastEvent(byId.get(id));
      if (l !== null && (last === null || l > last)) last = l;
      stack.push(...(childrenOf.get(id) || []));
    }
    if (last === null) continue;
    const idleDays = (nowMs - last) / DAY;
    if (idleDays >= forgottenEpicDays) {
      forgottenEpics.push({ id: e.id, title: e.title || '', lane: laneOf(e), project: projectOf(e), idleDays: r1(idleDays) });
    }
  }
  forgottenEpics.sort((a, b) => b.idleDays - a.idleDays);

  return {
    window: { since: iso(sinceMs), until: iso(untilMs) },
    counts: top.counts,
    cycle: top.cycle,
    lead: top.lead,
    stages: top.stages,
    bottleneck: top.bottleneck,
    groups: {
      project: groupBy(projectOf),
      lane: groupBy(laneOf),
      area: groupBy(t => areas[laneOf(t)] || 'other'),
    },
    wip,
    cycleByWeek,
    forgottenEpics,
  };
}
