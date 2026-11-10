/**
 * shared/metrics-payload.js (pure): the one JSON object the dashboard Metrics tab and
 * `ch metrics report --json` read. Spec: docs/metrics.md.
 */
import { flowMetrics, median, percentile } from './flow-metrics.js';
import { rankReadyTickets } from './next-ticket.js';
import { redTime, trend, isUncounted, isFlakyRerun } from './ci-metrics.js';
import { buildInsights } from './insights.js';
import { costsBlock, windowedSessions } from './cost-metrics.js';
import { limitsBlock } from './plan-share.js';
import { estimatorFor, estimatesSummary } from './cost-estimate.js';
import { splitInProgress } from './time-split.js';

const DAY = 24 * 3600 * 1000;
const toMs = v => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return v;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};
const iso = ms => new Date(ms).toISOString();
const r1 = n => (n === null || n === undefined ? null : Math.round(n * 10) / 10);
const sum = (list, f) => list.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const mondayMs = ms => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY;
};
const autonomous = s => !(s.questionsMidRun > 0) && !(s.stalls > 0) && !(s.toolWaits > 0) && !(s.missedWakes > 0);
const silent = s => (s.stalls > 0) || (s.toolWaits > 0);
const share = list => (list.length ? Math.round((list.filter(autonomous).length / list.length) * 1000) / 1000 : null);
const newest = (list, f) => {
  let best = null;
  for (const x of list) { const ms = toMs(f(x)); if (ms !== null && (best === null || ms > best)) best = ms; }
  return best === null ? null : iso(best);
};

function sessionsBlock(list, sinceMs, untilMs) {
  const withTicket = list.filter(s => s.ticket);
  const perTicket = new Map();
  for (const s of withTicket) {
    const e = perTicket.get(s.ticket) || { ticket: s.ticket, sessions: 0, wall: 0, active: 0 };
    e.sessions++; e.wall += s.wallMin || 0; e.active += s.activeMin || 0;
    perTicket.set(s.ticket, e);
  }
  const counts = [...perTicket.values()].map(e => e.sessions);
  const toolWaitTools = {};
  for (const s of list) for (const [k, v] of Object.entries(s.toolWaitTools || {})) toolWaitTools[k] = (toolWaitTools[k] || 0) + v;
  const missedWakeOrigins = {};
  for (const s of list) for (const [k, v] of Object.entries(s.missedWakeOrigins || {})) missedWakeOrigins[k] = (missedWakeOrigins[k] || 0) + v;
  const missedWakeCauses = {};
  for (const s of list) for (const [k, v] of Object.entries(s.missedWakeCauses || {})) missedWakeCauses[k] = (missedWakeCauses[k] || 0) + v;
  const replies = list.flatMap(s => s.replyWaits || []);
  const summary = {
    n: list.length,
    withTicket: withTicket.length,
    medianWallMin: r1(median(list.map(s => s.wallMin))),
    medianActiveMin: r1(median(list.map(s => s.activeMin))),
    waitUserHours: r1(sum(list, s => s.waitUserMin) / 60) ?? 0,
    questions: sum(list, s => s.questions),
    questionsMidRun: sum(list, s => s.questionsMidRun),
    stalls: sum(list, s => s.stalls),
    toolWaits: sum(list, s => s.toolWaits),
    questionWaits: sum(list, s => s.questionWaits),
    missedWakes: sum(list, s => s.missedWakes),
    missedWakeOrigins,
    missedWakeCauses,
    helperWaits: sum(list, s => s.helperWaits),
    missedWakeSessions: list.filter(s => s.missedWakes > 0).length,
    toolWaitTools,
    silentSessions: list.filter(silent).length,
    medianReplyMin: r1(median(replies)),
    sessionsWaitedOver1h: list.filter(s => (s.waitUserMin || 0) > 60).length,
    autonomousShare: share(list),
    sessionsPerTicket: { median: r1(median(counts)), max: counts.length ? Math.max(...counts) : null },
    costUSD: Math.round(sum(list, s => s.costUSD) * 100) / 100,
  };
  const weeks = new Map();
  for (let w = mondayMs(sinceMs); w <= untilMs; w += 7 * DAY) weeks.set(w, []);
  for (const s of list) weeks.get(mondayMs(Date.parse(s.start)))?.push(s);
  const byWeek = [...weeks].map(([w, l]) => ({
    week: iso(w).slice(0, 10),
    n: l.length,
    medianWallMin: r1(median(l.map(s => s.wallMin))),
    medianActiveMin: r1(median(l.map(s => s.activeMin))),
    questionsMidRun: sum(l, s => s.questionsMidRun),
    stalls: sum(l, s => s.stalls),
    toolWaits: sum(l, s => s.toolWaits),
    questionWaits: sum(l, s => s.questionWaits),
    missedWakes: sum(l, s => s.missedWakes),
    autonomousShare: share(l),
    waitUserHours: r1(sum(l, s => s.waitUserMin) / 60),
  }));
  const recent = [...list].sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, 30).map(s => ({
    sessionId: s.sessionId ?? s.key ?? null, title: s.title ?? null, ticket: s.ticket ?? null, start: s.start,
    wallMin: s.wallMin ?? null, activeMin: s.activeMin ?? null, waitUserMin: s.waitUserMin ?? null,
    questions: s.questions ?? 0, questionsMidRun: s.questionsMidRun ?? 0, stalls: s.stalls ?? 0,
    helpers: s.helpers ?? 0, costUSD: s.costUSD ?? null,
  }));
  const topTickets = [...perTicket.values()]
    .map(e => ({ ticket: e.ticket, sessions: e.sessions, wallHours: r1(e.wall / 60), activeHours: r1(e.active / 60) }))
    .sort((a, b) => b.activeHours - a.activeHours || (a.ticket < b.ticket ? -1 : 1)).slice(0, 10);
  return { summary, byWeek, recent, topTickets };
}

function timingsBlock(all, inWindow, now) {
  const groups = new Map();
  for (const r of inWindow) {
    if (!Number.isFinite(r.seconds) || isUncounted(r)) continue;
    const k = JSON.stringify([r.repo ?? null, r.kind ?? null, r.host ?? null, r.name ?? null]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ at: r.at, seconds: r.seconds, ok: r.ok !== false });
  }
  const series = [...groups].map(([k, points]) => {
    const [repo, kind, host, name] = JSON.parse(k);
    points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { repo, kind, host, name, points };
  }).sort((a, b) => JSON.stringify([a.repo, a.kind, a.name]) < JSON.stringify([b.repo, b.kind, b.name]) ? -1 : 1);

  const ciRuns = inWindow.filter(r => r.kind === 'ci');
  const spans = redTime(ciRuns, all.filter(r => r.kind === 'pr')).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const mins = spans.map(s => s.redMinutes);
  const red = {
    summary: { branches: spans.length, medianMinutes: r1(median(mins)), p90Minutes: r1(percentile(mins, 90)), openNow: spans.filter(s => s.open).length },
    items: spans.slice(0, 20),
  };
  const byRepoMap = new Map();
  for (const r of ciRuns) {
    const k = JSON.stringify([r.repo ?? null, r.workflow ?? r.name ?? null]);
    if (!byRepoMap.has(k)) byRepoMap.set(k, []);
    byRepoMap.get(k).push(r);
  }
  const byRepo = [...byRepoMap].map(([k, all]) => {
    const [repo, workflow] = JSON.parse(k);
    const runs = all.filter(r => !isUncounted(r)); // cancelled/skipped are neither pass nor failure
    const secs = runs.map(r => r.seconds);
    const failedRuns = runs.filter(r => r.ok === false);
    const jobCounts = new Map();
    for (const r of failedRuns) for (const n of r.failedJobs || []) jobCounts.set(n, (jobCounts.get(n) || 0) + 1);
    const topFailedJobs = [...jobCounts].map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)).slice(0, 5);
    return {
      repo, workflow, runs: runs.length, failed: failedRuns.length,
      cancelled: all.length - runs.length, flakyReruns: runs.filter(isFlakyRerun).length,
      medianSeconds: r1(median(secs)), p90Seconds: r1(percentile(secs, 90)),
      failRate: runs.length ? Math.round((failedRuns.length / runs.length) * 1000) / 1000 : 0,
      medianQueueSeconds: r1(median(runs.map(r => r.queuedSeconds))),
      topFailedJobs,
    };
  }).sort((a, b) => (JSON.stringify([a.repo, a.workflow]) < JSON.stringify([b.repo, b.workflow]) ? -1 : 1));
  return { series, trends: trend(all, { now }), redTime: red, ci: { byRepo } };
}

/**
 * @param {{doc:object, sessions?:object[], timings?:object[], cfg?:object, now?:Date|string|number,
 *   since?:Date|string|number, project?:string}} args
 */
export function buildMetricsPayload({ doc, sessions = [], timings = [], cfg = {}, now = new Date(), since, project, costLimit } = {}) {
  const nowMs = toMs(now) ?? Date.now();
  const sinceMs = toMs(since) ?? nowMs - 30 * DAY;
  const inRange = ms => ms !== null && ms >= sinceMs && ms <= nowMs;

  const byId = new Map();
  for (const sec of doc?.sections || []) for (const t of sec.tasks || []) if (t?.id && !byId.has(t.id)) byId.set(t.id, t);
  const laneOf = t => {
    for (let cur = t, i = 0; cur && i < 10; cur = byId.get(cur.parentId), i++) if (cur.lane) return cur.lane;
    return 'unassigned';
  };
  const sectionOf = new Map();
  for (const sec of doc?.sections || []) for (const t of sec.tasks || []) if (t?.id && !sectionOf.has(t.id)) sectionOf.set(t.id, sec.id);
  const projects = [...new Set([...byId.values()].map(t => t.project).filter(Boolean))].sort();
  const lanes = [...new Set([...byId.values()].map(laneOf))].sort();

  const flow = flowMetrics(doc, { now: nowMs, since: sinceMs, project, areas: cfg.areas, forgottenEpicDays: cfg.forgottenEpicDays });
  // Where in-progress time goes (sessions are not window-filtered: a session that began earlier still counts inside a stay).
  flow.inProgressSplit = splitInProgress({ doc, sessions, timings, now: nowMs, since: sinceMs, project, areas: cfg.areas });

  const sess = (sessions || []).filter(s => {
    if (!inRange(toMs(s.start))) return false;
    if (!project) return true;
    const t = s.ticket ? byId.get(s.ticket) : null;
    return !!t && t.project === project;
  });
  // Cost is counted by the hour it was spent: records with costByHour count their in-window part.
  const inProject = s => {
    if (!project) return true;
    const t = s.ticket ? byId.get(s.ticket) : null;
    return !!t && t.project === project;
  };
  const costWindow = windowedSessions((sessions || []).filter(inProject), sess, sinceMs, nowMs);
  // Calibrate on every session in the data, not only this window and project.
  const limits = limitsBlock({ sessions: sessions || [], sinceMs, nowMs });
  const estimator = estimatorFor({ doc, sessions, cfg, nowMs, project });
  const next = rankReadyTickets(doc, { n: 8, project, now: nowMs }).map(t => ({ ...t, estimate: estimator.estimate(t.id) }));
  const timingsAll = timings || [];
  const timingsWin = timingsAll.filter(r => inRange(toMs(r.at)));

  const payload = {
    generatedAt: iso(nowMs),
    window: { since: iso(sinceMs), until: iso(nowMs) },
    filters: { project: project || null, projects, lanes },
    flow,
    sessions: sessionsBlock(sess, sinceMs, nowMs),
    costs: { ...costsBlock({ sessions: sess, byId, sectionOf, cfg, sinceMs, nowMs, limit: costLimit, windowed: costWindow, weekUSD: limits.weekUSD }), limits },
    estimates: estimatesSummary(estimator),
    timings: timingsBlock(timingsAll, timingsWin, nowMs),
    next,
    sources: {
      sessions: { records: (sessions || []).length, newest: newest(sessions || [], s => s.start) },
      ci: { records: timingsAll.filter(r => r.kind === 'ci').length, newest: newest(timingsAll.filter(r => r.kind === 'ci'), r => r.at) },
      gates: { records: timingsAll.filter(r => r.kind === 'gate').length, newest: newest(timingsAll.filter(r => r.kind === 'gate'), r => r.at) },
      builds: { records: timingsAll.filter(r => r.kind === 'build').length, newest: newest(timingsAll.filter(r => r.kind === 'build'), r => r.at) },
    },
  };
  const { sources, ...head } = payload;
  const insights = buildInsights(payload);
  return { ...head, insights, sources };
}
