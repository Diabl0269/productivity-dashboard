/**
 * shared/next-start.js (pure): which Ready Auto epic the autorun dispatcher starts next, and when.
 * Used by `ch tasks next-start` and the Plan page's "Next start" line (GET /api/next-start). No fs, no clock:
 * the caller passes `now` and everything the dispatcher knows (live runs, spend, limit hits, last tick).
 *
 * It mirrors the dispatcher's gate order (suite scripts/autorun/gates.mjs decideTick) so the line says what
 * the next tick will do: paused, no Ready Auto epic, usage limit, weekly pace stop, review cap, no free
 * run slot, then per epic (lane busy, build cap, nothing an automatic run can take). Only epics Ready by
 * epic-ready.js may start. The start time is the next dispatcher tick after the gate opens.
 */
import { openEpicReadiness, autoQueueOrder } from './epic-ready.js';
import { DEFAULT_MACHINE_CAP } from './run-plan.js';
import { normalizeSettings } from './autorun-settings.js';

export const DEFAULT_TICK_MIN = 30;
const BATCH_MAX = 4;
const MIN = 60e3;
/** Weekly plan limits reset every Tuesday 11:00 UTC (same anchor as the dispatcher's gates.mjs lastWeeklyReset). */
const WEEK_RESET_ANCHOR_MS = Date.parse('2026-11-03T11:00:00Z');
const WEEK_MS = 7 * 86400e3;

/** First weekly reset strictly after `nowMs`. */
export function nextWeeklyReset(nowMs) {
  return WEEK_RESET_ANCHOR_MS + (Math.floor((nowMs - WEEK_RESET_ANCHOR_MS) / WEEK_MS) + 1) * WEEK_MS;
}

/**
 * First tick at or after `afterMs`. With a known last tick: lastTick + k * interval. Without one the time
 * is unknown and null comes back (the line then says "within N minutes").
 */
export function tickAtOrAfter(afterMs, nowMs, lastTickMs, tickMin = DEFAULT_TICK_MIN) {
  if (!Number.isFinite(lastTickMs)) return null;
  const step = tickMin * MIN;
  const from = Math.max(afterMs, nowMs);
  const k = Math.max(1, Math.ceil((from - lastTickMs) / step));
  return lastTickMs + k * step;
}

const two = n => String(n).padStart(2, '0');
/** "today 14:30", "tomorrow 02:00" or "Tue 11:00" in the viewer's local time. */
export function formatWhen(ms, nowMs) {
  const d = new Date(ms);
  const day0 = t => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const diff = Math.round((day0(ms) - day0(nowMs)) / 86400e3);
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (diff === 0) return `today ${hm}`;
  if (diff === 1) return `tomorrow ${hm}`;
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${hm}`;
}

/**
 * @param {object} input
 * @param {object} input.doc            tasks.json document shape
 * @param {number} input.now            ms
 * @param {string[]} [input.liveEpics]  epics with a live automatic run
 * @param {number} [input.manualBusy]   sessions run by hand that are busy now
 * @param {object} [input.settings]     autorun.json (maxRuns, maxTotal, paceStop, reviewCap)
 * @param {boolean} [input.off]         autorun.off present
 * @param {number} [input.weekCostUSD]  API-price spend since the last weekly reset
 * @param {number} [input.weekUSD]      the plan's weekly limit in API-price dollars (null = unknown, no pace stop)
 * @param {number} [input.reviewCount]  cards waiting in Ready for review
 * @param {{kind: string, resetsAtMs: number|null}[]} [input.limitHits]  plan-share distinctHits()
 * @param {number|null} [input.lastTickMs]  when the dispatcher last ran
 * @param {number} [input.tickMin]      minutes between ticks
 * @param {number} [input.machineCap]   app builds at once
 * @returns {{next: null|{epic: string, title: string, lane: string|null, children: string[], model: string, atMs: number|null, atKind: 'tick'|'reset'|'slot', waitsFor: string|null},
 *   reason: string|null, line: string}}
 */
export function computeNextStart(input) {
  const {
    doc, now, liveEpics = [], manualBusy = 0, off = false, weekCostUSD = 0, weekUSD = null,
    reviewCount = 0, limitHits = [], lastTickMs = null, tickMin = DEFAULT_TICK_MIN, machineCap = DEFAULT_MACHINE_CAP,
  } = input;
  const s = normalizeSettings(input.settings);
  const none = reason => ({ next: null, reason, line: `Next start: none, ${reason}` });
  if (off) return none('autorun is paused');

  const all = openEpicReadiness(doc);
  const queue = autoQueueOrder(all.filter(r => r.auto));
  const candidates = queue.filter(r => r.ready);
  if (!candidates.length) {
    const waiting = queue.filter(r => !r.ready)[0];
    return none(waiting
      ? `no epic is Ready with Auto on (${waiting.id} waits: ${waiting.reasons.join('; ')})`
      : 'no epic is Ready with Auto on');
  }

  // When does the gate open? (null = only when something you or a run does changes)
  let gateOpensMs = null;
  let gate = null;
  const activeHit = (limitHits || []).filter(h => h.resetsAtMs && h.resetsAtMs > now).sort((a, b) => b.resetsAtMs - a.resetsAtMs)[0];
  if (activeHit) {
    gateOpensMs = activeHit.resetsAtMs;
    gate = `the ${activeHit.kind} usage limit resets`;
  } else if (weekUSD > 0 && weekCostUSD / weekUSD >= s.paceStop) {
    gateOpensMs = nextWeeklyReset(now);
    gate = `the weekly pace stop (${Math.round(s.paceStop * 100)}% of the limit) lifts at the weekly reset`;
  }

  const first = candidates[0];
  const pickChildren = r => r.children.filter(c => c.runnable && !c.needsComputerUse).slice(0, BATCH_MAX);

  // Per-epic walk in lane order: which epic would the dispatcher take?
  const live = new Set(liveEpics);
  const cap = Math.min(s.maxRuns, s.maxTotal == null ? Infinity : s.maxTotal - manualBusy);
  const notes = [];
  let pick = null;
  const laneOf = r => r.lane || r.id;
  const liveBuilds = liveEpics.filter(id => /^FRO\d/.test(id)).length;
  for (const r of candidates) {
    if (live.has(r.id)) { notes.push(`${r.id} already has a run`); continue; }
    const other = all.find(e => e.id !== r.id && laneOf(e) === laneOf(r)
      && (live.has(e.id) || (e.section === 'in-progress' && !(e.auto && !e.ready))));
    if (other) { notes.push(`${r.id} waits for lane ${laneOf(r)} (${other.id} is running)`); continue; }
    if (/^FRO\d/.test(r.id) && liveBuilds >= machineCap) { notes.push(`${r.id} waits for an app-build slot (${machineCap} at once)`); continue; }
    if (!pickChildren(r).length) { notes.push(`${r.id} has no ticket an automatic run can take`); continue; }
    pick = r;
    break;
  }
  const model = r => (r.children.some(c => c.runnable && c.model === 'opus') ? 'opus' : 'sonnet');
  const head = r => ({ epic: r.id, title: r.title, lane: r.lane, children: pickChildren(r).map(c => c.id), model: model(r) });

  if (gateOpensMs !== null) {
    const r = pick || first;
    const atMs = tickAtOrAfter(gateOpensMs, now, lastTickMs, tickMin) ?? gateOpensMs;
    return {
      next: { ...head(r), atMs, atKind: 'reset', waitsFor: gate },
      reason: gate,
      line: `Next start: ${r.id} ${r.title ? `(${r.title}) ` : ''}waits until ${gate}, then starts at the next check, about ${formatWhen(atMs, now)}`,
    };
  }
  if (reviewCount > s.reviewCap) return none(`${reviewCount} cards wait for your review (autorun adds nothing above ${s.reviewCap})`);
  if (liveEpics.length >= cap) {
    const r = pick || first;
    const why = `all ${cap} run slots are busy (${liveEpics.length} runs${manualBusy ? `, ${manualBusy} sessions by hand` : ''})`;
    return {
      next: { ...head(r), atMs: null, atKind: 'slot', waitsFor: why },
      reason: why,
      line: `Next start: ${r.id} ${r.title ? `(${r.title}) ` : ''}starts when a run slot frees (${why}), at the next check`,
    };
  }
  if (!pick) return none(notes.join('; '));
  const atMs = tickAtOrAfter(now, now, lastTickMs, tickMin);
  const when = atMs === null ? `at the next check, within ${tickMin} minutes` : `at ${formatWhen(atMs, now)}`;
  return {
    next: { ...head(pick), atMs, atKind: 'tick', waitsFor: null },
    reason: null,
    line: `Next start: ${pick.id} ${pick.title ? `(${pick.title}) ` : ''}${when}`,
  };
}
