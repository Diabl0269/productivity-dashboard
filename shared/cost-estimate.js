/**
 * shared/cost-estimate.js (pure): what a ticket will probably cost, from tickets that shipped.
 * Spec: docs/metrics.md "Cost estimate". No model calls: median and p75 of the API-list-price cost
 * (shared/cost-metrics.js) of similar tickets now in review or done.
 *
 * Similar = same model label, type, project and lane; when fewer than MIN_SAMPLES tickets match, the
 * group is widened step by step: [label,type,project,lane] -> [label,type,project] -> [label,type]
 * -> [label] -> all shipped tickets. With fewer than MIN_SAMPLES samples overall there is no estimate.
 * An epic is the sum of the estimates of its open (not review/done/archive) tickets.
 */
import { median, percentile } from './flow-metrics.js';
import { costsBlock } from './cost-metrics.js';

export const MIN_SAMPLES = 5;
export const ESTIMATE_WINDOW_DAYS = 90;
const DAY = 24 * 3600 * 1000;
const MODEL_LABEL_RE = /^model:\s*\S/i;
const SHIPPED = new Set(['review', 'done']);
const CLOSED = new Set(['review', 'done', 'archive']);
const r2 = n => Math.round(n * 100) / 100;

/** $0.40, $4.3, $4, $12 (cents under $1, a decimal under $10, whole dollars above). */
export function usd(v) {
  const n = Number(v) || 0;
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 10) return `$${(Math.round(n * 10) / 10).toString()}`;
  return `$${Math.round(n)}`;
}

/** "~$4 (up to $9)" from {typicalUSD, highUSD}; '' for no estimate. */
export function formatRange(est) {
  if (!est) return '';
  const hi = usd(est.highUSD);
  const lo = usd(est.typicalUSD);
  return hi === lo ? `~${lo}` : `~${lo} (up to ${hi})`;
}

/** model:sonnet from a ticket's labels (first `model:` label, lowercased), else 'none'. */
export function modelLabelOf(t) {
  const l = (t?.labels || []).find(x => MODEL_LABEL_RE.test(String(x)));
  return l ? String(l).trim().toLowerCase().replace(/^model:\s*/, 'model:') : 'none';
}

const LEVELS = [
  { keys: ['label', 'type', 'project', 'lane'] },
  { keys: ['label', 'type', 'project'] },
  { keys: ['label', 'type'] },
  { keys: ['label'] },
  { keys: [] },
];

function basisText(keys, f) {
  if (!keys.length) return 'all shipped tickets';
  const words = keys.map(k => {
    if (k === 'label') return f.label === 'none' ? 'no model label' : f.label;
    if (k === 'lane') return `lane ${f.lane}`;
    return f[k];
  });
  return words.join(' · ');
}

/**
 * @param {{costs:object, byId:Map<string,object>, sectionOf?:Map<string,string>, minSamples?:number}} args
 *   `costs` is costsBlock output computed with limit Infinity over the sample window.
 * @returns {{estimate:(id:string)=>object|null, samples:number, summary:()=>object[]}}
 */
export function buildEstimator({ costs, byId, sectionOf = new Map(), minSamples = MIN_SAMPLES }) {
  const laneOf = t => {
    for (let cur = t, i = 0; cur && i < 10; cur = byId.get(cur.parentId), i++) if (cur.lane) return cur.lane;
    return 'unassigned';
  };
  const features = t => ({ label: modelLabelOf(t), type: t.type || 'task', project: t.project || 'none', lane: laneOf(t) });

  const spent = new Map((costs?.byTicket || []).map(r => [r.ticket, r.costUSD]));
  const samples = [];
  for (const r of costs?.byTicket || []) {
    const t = byId.get(r.ticket);
    if (!t || t.type === 'epic' || !SHIPPED.has(sectionOf.get(r.ticket)) || !(r.costUSD > 0)) continue;
    samples.push({ id: r.ticket, usd: r.costUSD, f: features(t) });
  }

  const ticketEstimate = id => {
    const t = byId.get(id);
    if (!t || t.type === 'epic' || samples.length < minSamples) return null;
    const f = features(t);
    const pool = samples.filter(s => s.id !== id);
    for (const { keys } of LEVELS) {
      const g = pool.filter(s => keys.every(k => s.f[k] === f[k]));
      if (g.length >= minSamples) {
        const v = g.map(s => s.usd);
        return { typicalUSD: r2(median(v)), highUSD: r2(percentile(v, 75)), n: g.length, basis: basisText(keys, f) };
      }
    }
    return null; // the pool without the ticket itself fell under the minimum
  };

  const epicEstimate = id => {
    if (samples.length < minSamples) return null;
    const kids = [];
    for (const [cid, t] of byId) {
      if (t.type === 'epic' || CLOSED.has(sectionOf.get(cid))) continue;
      const seen = new Set();
      for (let cur = byId.get(t.parentId); cur && !seen.has(cur.id); cur = byId.get(cur.parentId)) {
        if (cur.id === id) { kids.push(cid); break; }
        seen.add(cur.id);
      }
    }
    let typical = 0;
    let high = 0;
    const perChild = [];
    for (const cid of kids) {
      const e = ticketEstimate(cid);
      if (!e) continue;
      typical += e.typicalUSD;
      high += e.highUSD;
      perChild.push({ ticket: cid, title: byId.get(cid)?.title ?? null, typicalUSD: e.typicalUSD, highUSD: e.highUSD, basis: e.basis });
    }
    const epicRow = (costs?.byEpic || []).find(e => e.epic === id);
    return {
      typicalUSD: r2(typical), highUSD: r2(high), n: perChild.length,
      basis: `sum of ${perChild.length} open ticket${perChild.length === 1 ? '' : 's'}`,
      spentUSD: epicRow ? epicRow.costUSD : 0, perChild,
    };
  };

  return {
    samples: samples.length,
    spentUSD: id => spent.get(id) ?? 0,
    stateOf: id => sectionOf.get(id) ?? null,
    estimate: id => (byId.get(id)?.type === 'epic' ? epicEstimate(id) : ticketEstimate(id)),
    /** Leave-one-out backtest: each shipped sample's estimate (without itself) next to what it really cost. */
    backtest() {
      const rows = [];
      for (const s of samples) {
        const e = ticketEstimate(s.id);
        if (!e) continue;
        rows.push({ ticket: s.id, label: s.f.label, actualUSD: r2(s.usd), typicalUSD: e.typicalUSD, highUSD: e.highUSD, n: e.n, basis: e.basis });
      }
      return rows;
    },
    /** Shipped samples by model label: n, median and p75 dollars. */
    summary() {
      const g = new Map();
      for (const s of samples) {
        if (!g.has(s.f.label)) g.set(s.f.label, []);
        g.get(s.f.label).push(s.usd);
      }
      return [...g].map(([label, v]) => ({ label, n: v.length, medianUSD: r2(median(v)), p75USD: r2(percentile(v, 75)) }))
        .sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : 1));
    },
  };
}

/**
 * Estimator from the tracker document and the sessions store: costs over the last `windowDays`
 * (default 90) of sessions, optionally limited to one project.
 */
export function estimatorFor({ doc, sessions = [], cfg = {}, nowMs = Date.now(), project, windowDays = ESTIMATE_WINDOW_DAYS }) {
  const byId = new Map();
  const sectionOf = new Map();
  for (const sec of doc?.sections || []) {
    for (const t of sec.tasks || []) {
      if (t?.id && !byId.has(t.id)) { byId.set(t.id, t); sectionOf.set(t.id, sec.id); }
    }
  }
  const sinceMs = nowMs - windowDays * DAY;
  const win = (sessions || []).filter(s => {
    const ms = typeof s.start === 'number' ? s.start : Date.parse(s.start);
    if (!Number.isFinite(ms) || ms < sinceMs || ms > nowMs) return false;
    if (!project) return true;
    const t = s.ticket ? byId.get(s.ticket) : null;
    return !!t && t.project === project;
  });
  const costs = costsBlock({ sessions: win, byId, sectionOf, cfg, sinceMs, nowMs, limit: Infinity });
  return { ...buildEstimator({ costs, byId, sectionOf }), costs, windowDays };
}

/** The `estimates` summary block of the metrics payload. */
export function estimatesSummary(estimator) {
  return { sampleWindowDays: estimator.windowDays ?? ESTIMATE_WINDOW_DAYS, samples: estimator.samples, byLabel: estimator.summary() };
}

/** What a ticket gets recorded in its history when it starts: {median, p75, n, group}; null without an estimate. */
export function estimateAtStartOf(estimator, id) {
  const e = estimator ? estimator.estimate(id) : null;
  if (!e || e.perChild) return null;
  return { median: e.typicalUSD, p75: e.highUSD, n: e.n, group: e.basis };
}

export const JUDGE_MIN = 8;
export const CLOSE_UNDER_HIGH = 0.7;
export const CLOSE_RATIO = [0.7, 1.4];

/**
 * How close the estimates were: of backtest rows, the share at or under the high end (p75) and the median
 * actual/typical, overall and per model label. A label is judged only with at least JUDGE_MIN tickets.
 * "Close" = at least 70% at or under the high end and median actual/typical between 0.7 and 1.4;
 * above 1.4 estimates run low, below 0.7 they run high.
 */
export function accuracyReport(rows) {
  const stats = list => {
    const ratios = list.filter(r => r.typicalUSD > 0).map(r => r.actualUSD / r.typicalUSD);
    const under = list.filter(r => r.actualUSD <= r.highUSD).length;
    const underShare = list.length ? under / list.length : null;
    const medianRatio = ratios.length ? r2(median(ratios)) : null;
    const missUSD = list.length ? r2(median(list.map(r => Math.abs(r.actualUSD - r.typicalUSD)))) : null;
    let verdict;
    if (list.length < JUDGE_MIN) verdict = `too few to judge (${list.length} of ${JUDGE_MIN} needed)`;
    else if (medianRatio > CLOSE_RATIO[1]) verdict = 'estimates run low';
    else if (medianRatio < CLOSE_RATIO[0]) verdict = 'estimates run high';
    else if (underShare < CLOSE_UNDER_HIGH) verdict = 'typical is close, but the high end is too tight';
    else verdict = 'close';
    return { n: list.length, underHighShare: underShare === null ? null : r2(underShare), medianRatio, medianMissUSD: missUSD, verdict };
  };
  const labels = [...new Set(rows.map(r => r.label))].sort();
  return {
    overall: stats(rows),
    byLabel: labels.map(label => ({ label, ...stats(rows.filter(r => r.label === label)) }))
      .sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : 1)),
  };
}
