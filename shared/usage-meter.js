/**
 * shared/usage-meter.js (pure, PRO124): this week's usage against the plan's weekly limit, for the Home chip.
 *
 *   computeUsageMeter({ sessions, doc, nowMs, reset, weekUSD, override, project, liveIds, asOfMs, capped })
 *   paceSentence(meter, nowMs)   the pace line in plain words
 *   chipText(meter, nowMs)       the chip's text, e.g. "62% of the week used · resets Tue 13:00"
 *
 * Cost is API list-price dollars from the session records (docs/metrics.md "Cost"), counted by the hour it
 * was spent exactly as `ch metrics cost` does (shared/cost-metrics.js windowedSessions), over every project:
 * the weekly limit belongs to the account. `weekUSD` is the calibrated weekly limit in API dollars
 * (shared/plan-share.js, null until a weekly limit hit has been recorded). The percent is therefore an
 * estimate (cost this week / weekUSD) unless the owner set it by hand (`override`, from `ch metrics usage --set`).
 */
import { lastWeeklyReset, WEEK_MS } from './weekly-reset.js';

const HOUR = 3600e3;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r2 = n => Math.round(n * 100) / 100;
const r1 = n => Math.round(n * 10) / 10;
const two = n => String(n).padStart(2, '0');
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const TOO_LOW_REASON = 'The limit estimate looks too low (it puts you over 100% with no limit hit), so no percent is shown. Set your real number with `ch metrics usage --set <pct>`.';
export const NO_PERCENT_REASON = 'Not enough limit hits to show a percent: no weekly limit hit is in the data yet, so only dollars are shown.';

/** Local calendar day of `ms` as YYYY-MM-DD. */
export function localDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** The session's cost by hour index: main thread (or the older total) plus helpers, as `windowedSessions` reads it. */
function hourly(s) {
  if (!s.costByHour || typeof s.costByHour !== 'object') return null;
  const out = new Map();
  for (const src of [s.mainCostByHour || s.costByHour, s.helperCostByHour]) {
    for (const [h, v] of Object.entries(src || {})) out.set(Number(h), (out.get(Number(h)) || 0) + num(v));
  }
  return out;
}

/** Every [from, to] overlap of the session's hours as [hourStartMs, usd] pieces; records without hours are one piece at their start. */
function pieces(s, from, to, hourEdge = to) {
  const hrs = hourly(s);
  const out = [];
  if (!hrs) {
    const t = Date.parse(s.start);
    if (Number.isFinite(t) && t >= from && t <= to && num(s.costUSD) > 0) out.push([t, num(s.costUSD)]);
    return { out, total: num(s.costUSD) };
  }
  let total = 0;
  for (const [h, v] of hrs) {
    total += v;
    const a = h * HOUR;
    // The hour holding `to` is whole: spend in it happened at or before `to`, so it is not scaled down to the elapsed part.
    const o = Math.min(hourEdge, a + HOUR) - Math.max(from, a);
    if (o > 0 && v > 0) out.push([Math.max(from, a), v * (o / HOUR)]);
  }
  return { out, total };
}

function ticketsOf(s) {
  if (s.byTicket && typeof s.byTicket === 'object' && Object.keys(s.byTicket).length) {
    return Object.entries(s.byTicket).map(([id, v]) => [id, num(v.costUSD)]);
  }
  return s.ticket ? [[s.ticket, num(s.costUSD)]] : [];
}

/** The override that applies at `nowMs`, with the week it fixes; null when none is set or it has expired. */
function activeOverride(override, nowMs, weekStart) {
  if (!override || !Number.isFinite(override.pct)) return null;
  const setAt = Date.parse(override.setAt);
  if (!Number.isFinite(setAt) || setAt > nowMs) return null;
  const resetsAt = override.resetsAt ? Date.parse(override.resetsAt) : NaN;
  if (Number.isFinite(resetsAt)) return nowMs < resetsAt && setAt >= resetsAt - WEEK_MS ? { ...override, setAtMs: setAt, resetsAtMs: resetsAt } : null;
  return setAt >= weekStart ? { ...override, setAtMs: setAt, resetsAtMs: null } : null;
}

/**
 * @returns {{weekStart:string, resetsAt:string, costThisWeekUSD:number, weekUSD:number|null, pctUsed:number|null,
 *   source:'estimated'|'set by you'|'none', setAt:string|null, reason:string|null,
 *   perDay:{date:string, usd:number}[], perEpic:{id:string, title:string|null, usd:number}[],
 *   perRunning:{ticketId:string|null, sessionId:string, usd:number, since:string|null}[],
 *   pace:{projectedPctAtReset:number|null, reachesLimitAt:string|null}, asOf:string, capped:boolean}}
 */
export function computeUsageMeter({
  sessions = [], doc = null, nowMs = Date.now(), reset, weekUSD = null, override = null,
  project = null, liveIds = [], asOfMs = null, capped = false, limitHit = null,
} = {}) {
  const lastReset = lastWeeklyReset(nowMs, reset);
  const ov = activeOverride(override, nowMs, lastReset);
  const resetsMs = ov?.resetsAtMs ?? lastReset + WEEK_MS;
  const startMs = resetsMs - WEEK_MS;
  const limit = weekUSD > 0 ? weekUSD : null;

  const byId = new Map();
  for (const sec of doc?.sections || []) for (const t of sec.tasks || []) if (t?.id && !byId.has(t.id)) byId.set(t.id, t);

  const toEdge = (Math.floor(nowMs / HOUR) + 1) * HOUR;
  const perDayMap = new Map();
  const perTicket = new Map();
  const live = new Set(liveIds);
  const running = [];
  let cost = 0;
  let lastSpendMs = 0;
  let costSinceSet = 0;
  for (const s of sessions) {
    const endMs = Date.parse(s.end);
    if (Number.isFinite(endMs) && endMs + HOUR < startMs && !live.has(s.sessionId)) continue;
    const { out, total } = pieces(s, startMs, nowMs, toEdge);
    let win = 0;
    for (const [at, usd] of out) {
      win += usd;
      if (usd > 0 && at > lastSpendMs) lastSpendMs = at;
      const k = localDayKey(at);
      perDayMap.set(k, (perDayMap.get(k) || 0) + usd);
      if (ov && at + HOUR > ov.setAtMs) costSinceSet += at >= ov.setAtMs ? usd : usd * Math.max(0, (at + HOUR - ov.setAtMs) / HOUR);
    }
    cost += win;
    if (win > 0 && total > 0) {
      for (const [id, usd] of ticketsOf(s)) perTicket.set(id, (perTicket.get(id) || 0) + usd * (win / total));
    }
    if (live.has(s.sessionId)) {
      const t = s.ticket ? byId.get(s.ticket) : null;
      if (!project || (t && t.project === project)) {
        running.push({ ticketId: s.ticket || null, sessionId: s.sessionId, usd: r2(num(s.costUSD)), since: s.start || null });
      }
    }
  }

  // A hit that work carried on past (spend recorded over 30 minutes after it) is not blocking: it only gets a note.
  let hitNote = null;
  if (limitHit && lastSpendMs > limitHit.atMs + 30 * 60e3) {
    hitNote = `A ${limitHit.kind} limit was hit on ${DAY_NAMES[new Date(limitHit.atMs).getDay()]}, work continued after it.`;
    limitHit = null;
  }

  // Cost per epic: every ticket's cost goes to each epic above it (or to itself when it has none).
  const perEpicMap = new Map();
  for (const [id, usd] of perTicket) {
    const t = byId.get(id);
    if (!t || (project && t.project !== project)) continue;
    const chain = [];
    for (let cur = t, i = 0; cur && i < 10; cur = byId.get(cur.parentId), i++) if (cur.type === 'epic') chain.push(cur.id);
    for (const e of chain.length ? chain : [id]) perEpicMap.set(e, (perEpicMap.get(e) || 0) + usd);
  }
  const perEpic = [...perEpicMap].filter(([, u]) => u >= 0.005)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5)
    .map(([id, usd]) => ({ id, title: byId.get(id)?.title ?? null, usd: r2(usd) }));

  // One row per local day from the week's first day to today (a day with no spend is 0).
  const perDay = [];
  const d = new Date(startMs);
  d.setHours(12, 0, 0, 0);
  for (let i = 0; i < 9 && localDayKey(d.getTime()) <= localDayKey(nowMs); i++) {
    const k = localDayKey(d.getTime());
    perDay.push({ date: k, usd: r2(perDayMap.get(k) || 0) });
    d.setDate(d.getDate() + 1);
  }

  let pctUsed = null;
  let source = 'none';
  let reason = limit ? null : NO_PERCENT_REASON;
  if (ov) {
    source = 'set by you';
    reason = null;
    pctUsed = ov.pct + (limit ? (100 * costSinceSet) / limit : 0);
  } else if (limit) {
    source = 'estimated';
    pctUsed = (100 * cost) / limit;
    if (pctUsed > 100) { // never a percent above 100: in words under an active hit, else the calibration is evidently too low
      pctUsed = null;
      if (!limitHit) { source = 'none'; reason = TOO_LOW_REASON; }
    }
  }
  if (pctUsed !== null) pctUsed = r1(Math.min(100, Math.max(0, pctUsed)));

  // Pace: the week so far, straight on to the reset.
  const elapsed = Math.max(nowMs - startMs, HOUR);
  const pace = { projectedPctAtReset: null, reachesLimitAt: null };
  if (pctUsed !== null && pctUsed > 0) {
    pace.projectedPctAtReset = r1(pctUsed * (WEEK_MS / elapsed));
    if (pctUsed < 100 && pace.projectedPctAtReset > 100) {
      const at = nowMs + (elapsed * (100 - pctUsed)) / pctUsed;
      if (at < resetsMs) pace.reachesLimitAt = new Date(at).toISOString();
    }
  } else if (pctUsed === 0) pace.projectedPctAtReset = 0;

  return {
    weekStart: new Date(startMs).toISOString(),
    resetsAt: new Date(resetsMs).toISOString(),
    costThisWeekUSD: r2(cost),
    weekUSD: limit,
    pctUsed,
    source,
    limitHitNote: hitNote,
    limitHit: limitHit ? { kind: limitHit.kind, resetsAt: new Date(limitHit.resetsAtMs).toISOString() } : null,
    setAt: ov ? new Date(ov.setAtMs).toISOString() : null,
    reason,
    perDay,
    perEpic,
    perRunning: running.sort((a, b) => Date.parse(b.since || 0) - Date.parse(a.since || 0)),
    pace,
    asOf: new Date(asOfMs ?? nowMs).toISOString(),
    capped: !!capped,
  };
}

/** "Tue 13:00" in the viewer's local time. */
export function resetLabel(ms) {
  const d = new Date(ms);
  return `${SHORT_DAYS[d.getDay()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "Monday evening": the local weekday and part of the day. */
export function dayPart(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
  return `${DAY_NAMES[d.getDay()]} ${part}`;
}

const money = n => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`;
export const fmtMoney = money;

/** The chip: percent and reset, or words under an active limit hit, or dollars and reset when there is no percent. Never above 100%. */
export function chipText(m) {
  const reset = resetLabel(Date.parse(m.resetsAt));
  if (m.pctUsed === null && m.limitHit) return `${m.limitHit.kind} limit hit · resets ${resetLabel(Date.parse(m.limitHit.resetsAt))}`;
  return m.pctUsed === null
    ? `${money(m.costThisWeekUSD)} this week · resets ${reset}`
    : `${m.source === 'estimated' ? 'about ' : ''}${Math.round(m.pctUsed)}% of the week used · resets ${reset}`;
}

/** Chip colour: amber over 75%, red over 90% or under an active hit; an estimate with no hit stays neutral. */
export function chipLevel(m) {
  if (m.limitHit) return 'red';
  if (m.pctUsed === null || m.source !== 'set by you') return 'none';
  return m.pctUsed > 90 ? 'red' : m.pctUsed > 75 ? 'amber' : 'none';
}

/** The pace line in plain words. */
export function paceSentence(m) {
  if (m.pctUsed === null && m.limitHit) return `The ${m.limitHit.kind} limit was hit; it frees up ${resetLabel(Date.parse(m.limitHit.resetsAt))}.`;
  if (m.pctUsed === null) return `${money(m.costThisWeekUSD)} spent so far this week. ${m.reason || ''}`.trim();
  if (m.pctUsed >= 100) return 'You have used the whole week. It frees up at the reset.';
  if (m.pace.reachesLimitAt) return `At this pace you reach the limit ${dayPart(Date.parse(m.pace.reachesLimitAt))}.`;
  if (m.pace.projectedPctAtReset === null) return 'Nothing used yet this week.';
  return `You will end the week at about ${Math.round(m.pace.projectedPctAtReset)}%.`;
}
