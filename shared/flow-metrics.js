/**
 * Flow metrics — cycle/lead time, stage dwell, bottleneck, WIP and forgotten epics, from the
 * `moved` events in ticket history (docs/metrics.md, "Ticket flow"). Pure module: no I/O.
 * The bottleneck is the stage with the largest MEDIAN closed stay (a typical ticket), totalHours is secondary.
 *
 * Input is the tasks.json document shape: { sections: [{ id, tasks: [...] }], meta }.
 * History may be missing on old tickets; those tickets simply have no stays and are skipped
 * (except for the forgotten-epic check, which falls back to `created`).
 */

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const STAGES = ['todo', 'in-progress', 'review'];
const MIN_REVIEW_MS = 60 * 1000; // shorter review stays are automatic roll-through
const BOTTLENECK_STAGES = ['in-progress', 'review'];
const CLOSE = new Set(['review', 'done', 'archive']);
const FINISH = new Set(['review', 'done']);
const REOPEN_FROM = new Set(['review', 'done']);
const REOPEN_TO = new Set(['in-progress', 'todo']);

const toMs = v => {
  if (v === undefined || v === null || v === '') return null;
  const ms = typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(v);
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

const FIX_DAYS = 14;
const MODEL_LABEL_RE = /^model:\s*\S/i;
const modelLabelOf = t => {
  const l = (t?.labels || []).find(x => MODEL_LABEL_RE.test(String(x)));
  return l ? String(l).trim().toLowerCase().replace(/^model:\s*/, 'model:') : 'none';
};
const REVIEW_BUCKETS = [['under 1 h', 1], ['1-4 h', 4], ['4-12 h', 12], ['12-24 h', 24], ['1-3 days', 72], ['over 3 days', Infinity]];

/** Counts of hour values per REVIEW_BUCKETS bucket: [{ label, n }]. */
function bucketHours(values) {
  const out = REVIEW_BUCKETS.map(([label]) => ({ label, n: 0 }));
  for (const v of values) out[REVIEW_BUCKETS.findIndex(([, max]) => v < max)].n++;
  return out;
}

/**
 * Ready-to-reviewed: for each move INTO review, hours until the card's next move out of review or its first
 * review note written after the move, whichever is first. Cards still waiting with neither are `waiting`.
 * Roll-through moves (under MIN_REVIEW_MS) are skipped.
 */
function readyToReviewed(tasks, inWindow) {
  const hrsList = [];
  let waiting = 0;
  for (const t of tasks) {
    const mv = moves(t);
    const notes = (t.reviewNotes || []).map(n => toMs(n?.at)).filter(x => x !== null);
    for (let i = 0; i < mv.length; i++) {
      if (mv[i].to !== 'review' || !inWindow(mv[i].at)) continue;
      const a = mv[i].at;
      const next = mv.slice(i + 1).find(m => m.from === 'review');
      const note = notes.filter(n => n >= a).sort((x, y) => x - y)[0];
      const ends = [next?.at, note].filter(x => x !== undefined);
      if (!ends.length) { waiting++; continue; }
      const end = Math.min(...ends);
      if (end - a < MIN_REVIEW_MS) continue;
      hrsList.push(hours(end - a));
    }
  }
  return { ...summary(hrsList), waiting, buckets: bucketHours(hrsList) };
}

/**
 * Shipped tickets that got a fix ticket within FIX_DAYS of shipping (the fix names it by reviewOf, by parent
 * when the parent is a non-epic ticket, or by a link/links entry) and was created in the window: one entry per fix.
 */
function fixesOfShipped(all, byId, inWindow) {
  const out = [];
  for (const fix of all) {
    const created = toMs(fix.created) ?? toMs((fix.history || []).find(e => e && e.event === 'created')?.at);
    if (created === null || !inWindow(created)) continue;
    const refs = [fix.reviewOf, fix.parentId, ...[].concat(fix.link || [], fix.links || []).map(l => (l && l.id) || l)];
    for (const id of new Set(refs.filter(x => typeof x === 'string' && x && x !== fix.id))) {
      const src = byId.get(id);
      if (!src || src.type === 'epic') continue;
      const done = moves(src).find(m => FINISH.has(m.to));
      if (done && created >= done.at && created - done.at <= FIX_DAYS * DAY) { out.push(src); break; }
    }
  }
  return out;
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
  now = new Date(), since, project, lane, areas = {}, forgottenEpicDays = 3, skipStays,
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
    const firstClose = mv.find(m => CLOSE.has(m.to));
    const finishAfterStart = firstStart ? mv.find(m => FINISH.has(m.to) && m.at >= firstStart.at) : null;
    return {
      t,
      started: firstStart?.at,
      finish: firstFinish?.at,
      closedAt: firstClose?.at,
      noWork,
      cycleEnd: finishAfterStart?.at,
      created: toMs(t.created) ?? toMs((t.history || []).find(e => e && e.event === 'created')?.at),
      reopened: mv.filter(m => REOPEN_FROM.has(m.from) && REOPEN_TO.has(m.to)).map(m => m.at),
      stays: ticketStays(t, { now: nowMs }),
    };
  }
  const facts0 = work.map(facts);
  // Epics only contribute review stays: an epic's card is where its children's checks wait.
  const epicFacts = epics.map(t => ({ t, epic: true, stays: ticketStays(t, { now: nowMs }) }));
  const factsAll = [...facts0, ...epicFacts];

  /** counts, cycle, lead, stages and bottleneck for a set of ticket facts. */
  function compute(list) {
    const counts = { started: 0, shipped: 0, reopened: 0, reopenedFixes: 0, closedWithoutWork: 0 };
    const cycle = [];
    const lead = [];
    const stageVals = Object.fromEntries(STAGES.map(s => [s, { closed: [], total: 0, openN: 0, oldest: 0 }]));
    const revKind = { epics: { closed: [], openN: 0, oldest: 0 }, tickets: { closed: [], openN: 0, oldest: 0 } };
    for (const f of list) {
      if (!f.epic) {
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
      }
      for (const s of f.stays) {
        const v = stageVals[s.stage];
        if (!v) continue;
        if (f.epic && s.stage !== 'review') continue;
        // Forgotten in-progress stays (see time-split.js) are left out of the in-progress numbers.
        if (skipStays && s.stage === 'in-progress' && skipStays.has(`${f.t.id}|${s.from}`)) continue;
        const a = Date.parse(s.from);
        const b = Date.parse(s.to);
        if (s.stage === 'review' && !s.open && b - a < MIN_REVIEW_MS) continue;
        if (!(a < untilMs && b > sinceMs)) continue;
        const dwell = hours(Math.min(b, untilMs) - Math.max(a, sinceMs));
        v.total += dwell;
        if (s.open) { v.openN++; v.oldest = Math.max(v.oldest, hours(nowMs - a)); } else v.closed.push(dwell);
        if (s.stage === 'review') {
          const k = revKind[f.epic ? 'epics' : 'tickets'];
          if (s.open) { k.openN++; k.oldest = Math.max(k.oldest, hours(nowMs - a)); } else k.closed.push(dwell);
        }
      }
    }
    const stages = {};
    let grand = 0;
    for (const s of BOTTLENECK_STAGES) grand += stageVals[s].total;
    let best = null; // slowest by median closed stay
    let bestTotal = null; // fallback when no stage has a closed stay yet: largest total
    for (const s of STAGES) {
      const v = stageVals[s];
      const sum = summary(v.closed);
      stages[s] = {
        n: sum.n, median: sum.median, p75: sum.p75, totalHours: r1(v.total),
        open: { n: v.openN, oldestHours: r1(v.oldest) },
      };
      if (BOTTLENECK_STAGES.includes(s) && v.total > 0) {
        if (sum.median !== null && (!best || sum.median > best.med)) best = { stage: s, med: sum.median, raw: v.total };
        if (!bestTotal || v.total > bestTotal.raw) bestTotal = { stage: s, med: sum.median, raw: v.total };
      }
    }
    best = best || bestTotal;
    const kindOut = k => ({ ...summary(k.closed), open: { n: k.openN, oldestHours: r1(k.oldest) } });
    const reviewWait = {
      epics: kindOut(revKind.epics), tickets: kindOut(revKind.tickets),
      readyToReviewed: readyToReviewed(list.map(f => f.t), inWindow),
    };
    // Reopened = moved back from review/done, plus a fix ticket opened from a shipped ticket within 14 days; by model label.
    const byLabel = new Map();
    const bump = (t, key) => {
      const l = modelLabelOf(t);
      if (!byLabel.has(l)) byLabel.set(l, { label: l, moves: 0, fixes: 0 });
      byLabel.get(l)[key]++;
    };
    for (const f of list) if (!f.epic) for (const at of f.reopened) if (inWindow(at)) bump(f.t, 'moves');
    const listIds = new Set(list.map(f => f.t.id));
    for (const src of fixesOfShipped(all, byId, inWindow)) if (listIds.has(src.id)) { counts.reopenedFixes++; bump(src, 'fixes'); }
    counts.reopenedMoves = counts.reopened;
    counts.reopened += counts.reopenedFixes;
    return {
      reviewWait,
      reopenedByLabel: [...byLabel.values()].sort((a, b) => (b.moves + b.fixes) - (a.moves + a.fixes) || (a.label < b.label ? -1 : 1)),
      counts, cycle: summary(cycle), lead: summary(lead), stages,
      bottleneck: best ? { stage: best.stage, medianHours: best.med, totalHours: r1(best.raw), share: Math.round((best.raw / grand) * 1000) / 1000 } : null,
    };
  }

  const top = compute(factsAll);

  const groupBy = keyOf => {
    const buckets = new Map();
    for (const f of factsAll) {
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

  // Stale tickets: non-epic tickets in progress with no history event on the ticket itself for N days.
  const staleTickets = [];
  for (const t of work) {
    if (sectionOf.get(t.id) !== 'in-progress') continue;
    const last = lastEvent(t);
    if (last === null) continue;
    const idleDays = (nowMs - last) / DAY;
    if (idleDays >= forgottenEpicDays) {
      staleTickets.push({ id: t.id, title: t.title || '', lane: laneOf(t), project: projectOf(t), idleDays: r1(idleDays) });
    }
  }
  staleTickets.sort((a, b) => b.idleDays - a.idleDays);

  // Throughput per week (tickets only): created, first start, first finish (not bookkeeping).
  const tp = new Map();
  for (let w = mondayMs(sinceMs); w <= untilMs; w += 7 * DAY) tp.set(w, { created: 0, started: 0, shipped: 0, closed: 0 });
  const bump = (ms, k) => { if (inWindow(ms)) tp.get(mondayMs(ms))[k]++; };
  for (const f of facts0) {
    bump(f.created ?? undefined, 'created');
    bump(f.started, 'started');
    if (!f.noWork) bump(f.finish, 'shipped');
    bump(f.closedAt, 'closed');
  }
  const throughputByWeek = [...tp].map(([w, v]) => ({ week: isoDay(w), ...v }));
  const openTodo = work.filter(t => sectionOf.get(t.id) === 'todo').length;
  const growth = throughputByWeek.length
    ? throughputByWeek.reduce((a, w) => a + w.created - w.closed, 0) / throughputByWeek.length : 0;

  return {
    window: { since: iso(sinceMs), until: iso(untilMs) },
    counts: top.counts,
    cycle: top.cycle,
    lead: top.lead,
    stages: top.stages,
    reviewWait: top.reviewWait,
    reopenedByLabel: top.reopenedByLabel,
    bottleneck: top.bottleneck,
    groups: {
      project: groupBy(projectOf),
      lane: groupBy(laneOf),
      area: groupBy(t => areas[laneOf(t)] || 'other'),
    },
    wip,
    cycleByWeek,
    throughputByWeek,
    backlog: { openTodo, growthPerWeek: r1(growth) },
    forgottenEpics,
    staleTickets,
    staleDays: forgottenEpicDays,
  };
}
