/**
 * shared/plan-share.js (pure): usage-limit hits across sessions and what a week's / 5-hour limit is worth
 * in API-price dollars. Spec: docs/metrics.md "Cost" > Limit hits and calibration.
 *
 * Calibration: each distinct limit hit is a point where the plan's allowance ran out, so the API-price
 * cost of everything started in the period before it estimates the allowance (7 days before a weekly hit,
 * 5 hours before a session hit; sessions are attributed by their start time). The median over hits is the
 * estimate. It is rough: the reset window starts at first use and is not known exactly, and the computed
 * cost is about 0.88 of what Claude Code counts.
 */
import { median } from './flow-metrics.js';
import { fmtHours } from './insights.js';

const HOUR = 3600 * 1000;
const WINDOW_MS = { weekly: 7 * 24 * HOUR, session: 5 * HOUR };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Distinct hits over all sessions, oldest first: [{kind, atMs, resetsAtMs|null, lostMin|null}].
 * The same hit seen by several sessions (parallel sessions share a limit) is deduped by `resetsAt`, or by
 * `at` within 1 hour when either side has no reset time; the longest `lostMin` is kept.
 */
export function distinctHits(sessions) {
  const all = [];
  for (const s of sessions || []) {
    for (const h of s.limitHits || []) {
      const atMs = Date.parse(h.at);
      if (!Number.isFinite(atMs) || (h.kind !== 'weekly' && h.kind !== 'session')) continue;
      const r = h.resetsAt ? Date.parse(h.resetsAt) : NaN;
      all.push({ kind: h.kind, atMs, resetsAtMs: Number.isFinite(r) ? r : null, lostMin: typeof h.lostMin === 'number' ? h.lostMin : null });
    }
  }
  all.sort((a, b) => a.atMs - b.atMs);
  const out = [];
  for (const h of all) {
    const dup = out.find((o) => o.kind === h.kind
      && (o.resetsAtMs !== null && h.resetsAtMs !== null ? o.resetsAtMs === h.resetsAtMs : Math.abs(o.atMs - h.atMs) < HOUR));
    if (!dup) { out.push({ ...h }); continue; }
    if (h.lostMin !== null && (dup.lostMin === null || h.lostMin > dup.lostMin)) dup.lostMin = h.lostMin;
    if (dup.resetsAtMs === null) dup.resetsAtMs = h.resetsAtMs;
  }
  return out;
}

/** Median over `hits` of the cost of sessions that started in the `kind` window before each hit; hits with no cost are skipped. */
function calibrate(hits, sessions, kind) {
  const priced = (sessions || []).map((s) => ({ ms: Date.parse(s.start), cost: num(s.costUSD) })).filter((s) => Number.isFinite(s.ms) && s.cost > 0);
  const sums = [];
  for (const h of hits) {
    if (h.kind !== kind) continue;
    const sum = priced.filter((s) => s.ms > h.atMs - WINDOW_MS[kind] && s.ms <= h.atMs).reduce((a, s) => a + s.cost, 0);
    if (sum > 0) sums.push(sum);
  }
  return sums.length ? { usd: r2(median(sums)), n: sums.length } : { usd: null, n: 0 };
}

/**
 * The payload's `costs.limits`. `sessions` must be every session in the data (not window- or
 * project-filtered); the counts are for hits inside [sinceMs, nowMs], the calibration uses every hit.
 * @returns {{sessionHits:number, weeklyHits:number, lostHours:number, weekUSD:number|null,
 *   sessionWindowUSD:number|null, nWeekly:number, nSession:number}}
 */
export function limitsBlock({ sessions, sinceMs, nowMs }) {
  const hits = distinctHits(sessions);
  const inWin = hits.filter((h) => h.atMs >= sinceMs && h.atMs <= nowMs);
  const week = calibrate(hits, sessions, 'weekly');
  const sess = calibrate(hits, sessions, 'session');
  return {
    sessionHits: inWin.filter((h) => h.kind === 'session').length,
    weeklyHits: inWin.filter((h) => h.kind === 'weekly').length,
    lostHours: Math.round((inWin.reduce((a, h) => a + (h.lostMin || 0), 0) / 60) * 10) / 10,
    weekUSD: week.usd,
    sessionWindowUSD: sess.usd,
    nWeekly: week.n,
    nSession: sess.n,
  };
}

/** One line for the CLI and the tab: hits, time lost, and the calibrated week or why there is none. */
export function limitsLine(l) {
  const head = `Limit hits: ${l.sessionHits} session, ${l.weeklyHits} weekly, ${fmtHours(l.lostHours || 0)} lost`;
  return l.weekUSD > 0
    ? `${head}; a week's limit ≈ $${l.weekUSD >= 100 ? Math.round(l.weekUSD) : l.weekUSD.toFixed(2)} at API prices (from ${l.nWeekly} ${l.nWeekly === 1 ? 'hit' : 'hits'})`
    : `${head}; not calibrated yet (no weekly-limit hit in the data)`;
}
