/**
 * shared/cost-metrics.js (pure): the `costs` block of the metrics payload.
 * Spec: docs/metrics.md "Cost". Cost is API list-price US dollars computed from token usage
 * (shared/model-prices.js), main session plus helpers. Records written before the cost fields
 * existed only have `costUSD`; they are attributed whole to the session's ticket.
 */
import { median, percentile } from './flow-metrics.js';
import { priceParts } from './model-prices.js';
import { CTX_BUCKET } from './session-metrics.js';

const DAY = 24 * 3600 * 1000;
const r2 = n => Math.round(n * 100) / 100;
const r3 = n => Math.round(n * 1000) / 1000;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const tokensTotal = t => (t ? num(t.input) + num(t.output) + num(t.cacheRead) + num(t.cacheWrite) : 0);
const MODEL_LABEL_RE = /^model:\s*\S/i;

const PART_KEYS = ['cacheRead', 'cacheWrite', 'output', 'input'];

/**
 * Dollars by part of one side of a session (`parts` = main, `helperParts` = helpers). Records from
 * before the split are priced from their per-model totals (`byModel` / `helperByModel`): exact
 * except for the long-prompt multiplier and the 1-hour cache write rate, which those totals lost.
 */
function partsOf(s, partsKey, modelKey) {
  if (s[partsKey] && typeof s[partsKey] === 'object') return s[partsKey];
  const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const [m, v] of Object.entries(s[modelKey] || {})) {
    const p = priceParts(m, { input: num(v.input), output: num(v.output), cacheRead: num(v.cacheRead), cacheWrite5m: num(v.cacheWrite) });
    if (p) for (const k of PART_KEYS) out[k] += p[k];
  }
  return out;
}

/** Window median / p90 from merged bucket histograms ({bucket index: calls}); linear inside a bucket. */
function histQuantile(hist, n, q) {
  const target = q * n;
  let seen = 0;
  for (const i of Object.keys(hist).map(Number).sort((a, b) => a - b)) {
    const c = hist[i];
    if (seen + c >= target) return Math.round((i + (c > 0 ? (target - seen) / c : 0)) * CTX_BUCKET);
    seen += c;
  }
  return null;
}

/** Per-ticket attribution of one session: {ticket: {costUSD, tokens, toolCalls}}. */
function attribution(s) {
  if (s.byTicket && typeof s.byTicket === 'object' && Object.keys(s.byTicket).length) return s.byTicket;
  if (!s.ticket) return {};
  return { [s.ticket]: { costUSD: num(s.costUSD), tokens: tokensTotal(s.tokens) + tokensTotal(s.helperTokens), toolCalls: num(s.toolCallsTotal) + num(s.helperToolCalls) } };
}

/**
 * @param {{sessions:object[], byId:Map<string,object>, sectionOf:Map<string,string>, cfg?:object,
 *   sinceMs:number, nowMs:number, limit?:number}} args  `sessions` are already filtered to the window and project;
 *   `limit` caps byTicket (default 30) and byEpic (half of it); Infinity keeps every row.
 */
export function costsBlock({ sessions, byId, sectionOf, cfg = {}, sinceMs, nowMs, limit = 30, weekUSD = null }) {
  // `weekShare`: cost as a share of a week's plan limit (shared/plan-share.js); only when calibrated.
  const wk = weekUSD > 0 ? raw => ({ weekShare: r3(raw / weekUSD) }) : () => ({});
  let totalUSD = 0;
  let helperUSD = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const models = new Map();
  const tickets = new Map();
  const activeBy = new Map();
  const byPart = { main: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, helpers: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const hist = {};
  let ctxCalls = 0;
  let ctxSessions = 0;
  for (const s of sessions) {
    const mp = partsOf(s, 'parts', 'byModel');
    const hp = partsOf(s, 'helperParts', 'helperByModel');
    for (const k of PART_KEYS) { byPart.main[k] += num(mp[k]); byPart.helpers[k] += num(hp[k]); }
    if (num(s.ctxCalls) > 0 && s.ctxHist && typeof s.ctxHist === 'object') {
      ctxCalls += s.ctxCalls;
      ctxSessions += 1;
      for (const [b, c] of Object.entries(s.ctxHist)) hist[b] = (hist[b] || 0) + num(c);
    }
    totalUSD += num(s.costUSD);
    helperUSD += num(s.helperCostUSD);
    for (const k of Object.keys(tokens)) tokens[k] += num(s.tokens?.[k]) + num(s.helperTokens?.[k]);
    for (const src of [s.byModel, s.helperByModel]) {
      for (const [m, v] of Object.entries(src || {})) models.set(m, (models.get(m) || 0) + num(v.costUSD));
    }
    if (s.ticket) activeBy.set(s.ticket, (activeBy.get(s.ticket) || 0) + num(s.activeMin));
    for (const [id, a] of Object.entries(attribution(s))) {
      const e = tickets.get(id) || { ticket: id, costUSD: 0, tokens: 0, toolCalls: 0, sessions: 0 };
      e.costUSD += num(a.costUSD);
      e.tokens += num(a.tokens);
      e.toolCalls += num(a.toolCalls);
      e.sessions += 1;
      tickets.set(id, e);
    }
  }
  // Cost by part: dollars of cache reads / cache writes / output / input, main thread and helpers.
  const partSum = PART_KEYS.reduce((a, k) => a + byPart.main[k] + byPart.helpers[k], 0);
  const parts = PART_KEYS.map(part => {
    const main = byPart.main[part];
    const helpers = byPart.helpers[part];
    return { part, costUSD: r2(main + helpers), mainUSD: r2(main), helpersUSD: r2(helpers), share: partSum > 0 ? r3((main + helpers) / partSum) : 0 };
  });
  const context = {
    calls: ctxCalls, sessions: ctxSessions, sessionsWithout: sessions.length - ctxSessions,
    median: ctxCalls ? histQuantile(hist, ctxCalls, 0.5) : null,
    p90: ctxCalls ? histQuantile(hist, ctxCalls, 0.9) : null,
  };
  const total = {
    byPart: parts,
    context,
    costUSD: r2(totalUSD),
    tokens,
    sessions: sessions.length,
    helperCostUSD: r2(helperUSD),
    byModel: [...models].map(([model, c]) => ({ model, costUSD: r2(c), share: totalUSD > 0 ? r3(c / totalUSD) : 0 }))
      .sort((a, b) => b.costUSD - a.costUSD || (a.model < b.model ? -1 : 1)),
  };

  const rows = [...tickets.values()].map(e => {
    const t = byId.get(e.ticket);
    return {
      ticket: e.ticket, title: t?.title ?? null, type: t?.type ?? null,
      labels: (t?.labels || []).filter(l => MODEL_LABEL_RE.test(String(l))),
      state: sectionOf.get(e.ticket) ?? null,
      costUSD: r2(e.costUSD), tokens: e.tokens, toolCalls: e.toolCalls, sessions: e.sessions,
      activeMin: Math.round((activeBy.get(e.ticket) || 0) * 10) / 10,
      share: totalUSD > 0 ? r3(e.costUSD / totalUSD) : 0,
      ...wk(e.costUSD),
      _raw: e.costUSD,
    };
  }).sort((a, b) => b._raw - a._raw || (a.ticket < b.ticket ? -1 : 1));
  const byTicket = rows.slice(0, limit).map(({ _raw, ...r }) => r);

  // Roll every ticket's cost up its parent chain into each epic above it (its own cost included).
  const epics = new Map();
  for (const e of tickets.values()) {
    let prev = null;
    let cur = byId.get(e.ticket);
    for (let i = 0; cur && i < 10; prev = cur, cur = byId.get(cur.parentId), i++) {
      if (cur.type !== 'epic') continue;
      const ep = epics.get(cur.id) || { epic: cur.id, title: cur.title ?? null, _raw: 0, kids: new Map() };
      ep._raw += e.costUSD;
      const kid = prev || cur;
      ep.kids.set(kid.id, (ep.kids.get(kid.id) || 0) + e.costUSD);
      epics.set(cur.id, ep);
    }
  }
  const byEpic = [...epics.values()].sort((a, b) => b._raw - a._raw || (a.epic < b.epic ? -1 : 1))
    .slice(0, limit === Infinity ? Infinity : Math.ceil(limit / 2)).map(ep => ({
    epic: ep.epic, title: ep.title, costUSD: r2(ep._raw),
    share: totalUSD > 0 ? r3(ep._raw / totalUSD) : 0,
    ...wk(ep._raw),
    children: [...ep.kids].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id, c]) => ({
      ticket: id, title: byId.get(id)?.title ?? null, costUSD: r2(c), own: id === ep.epic,
    })),
  }));

  // Cost of tickets (not epics: an epic run's cost is its children's) now in review or done, by model label.
  const groups = new Map();
  for (const e of tickets.values()) {
    if (byId.get(e.ticket)?.type === 'epic') continue;
    const state = sectionOf.get(e.ticket);
    if (state !== 'review' && state !== 'done') continue;
    if (!(e.costUSD > 0)) continue;
    const label = (byId.get(e.ticket)?.labels || []).find(l => MODEL_LABEL_RE.test(String(l))) || 'none';
    const key = label === 'none' ? label : String(label).trim().toLowerCase().replace(/^model:\s*/, 'model:');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.costUSD);
  }
  const perShipped = [...groups].map(([label, v]) => ({
    label, n: v.length, medianUSD: r2(median(v)), p75USD: r2(percentile(v, 75)), totalUSD: r2(v.reduce((a, b) => a + b, 0)),
  })).sort((a, b) => b.totalUSD - a.totalUSD || (a.label < b.label ? -1 : 1));

  const block = { total, byTicket, byEpic, perShipped };
  const plan = Number(cfg.planUSDPerMonth);
  if (Number.isFinite(plan) && plan > 0) {
    const days = Math.max((nowMs - sinceMs) / DAY, 1 / 24);
    const per30 = (totalUSD * 30) / days;
    block.plan = { usdPerMonth: plan, apiEquivalentPer30d: r2(per30), multiple: Math.round((per30 / plan) * 10) / 10 };
  }
  return block;
}
