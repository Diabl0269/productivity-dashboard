/**
 * PRO124: shared/weekly-reset.js (the one weekly anchor, config metrics.weeklyReset) and shared/usage-meter.js
 * (week boundaries, DST, override precedence and expiry, no calibration, pace). Fixtures are synthetic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeeklyReset, lastWeeklyReset, nextWeeklyReset, DEFAULT_WEEKLY_RESET, WEEK_MS } from '../../shared/weekly-reset.js';
import { nextWeeklyReset as fromNextStart, computeNextStart } from '../../shared/next-start.js';
import { computeUsageMeter, chipText, chipLevel, paceSentence, NO_PERCENT_REASON, TOO_LOW_REASON, localDayKey } from '../../shared/usage-meter.js';

const HOUR = 3600e3;
const T = iso => Date.parse(iso);
const HIT = { kind: 'weekly', atMs: T('2026-11-13T10:00:00Z'), resetsAtMs: T('2026-11-17T11:00:00Z') };
const hourOf = iso => Math.floor(T(iso) / HOUR);

// ---- the one weekly anchor ----

test('default reset is Tuesday 11:00 UTC and next-start reads the same definition', () => {
  assert.deepEqual(DEFAULT_WEEKLY_RESET, { weekday: 2, utcHour: 11, utcMinute: 0 });
  assert.equal(fromNextStart, nextWeeklyReset);
  // The value the old hardcoded anchor (2026-11-03T11:00Z + k weeks) gave, before and after the moment.
  for (const [now, want] of [
    ['2026-11-12T10:00:00Z', '2026-11-17T11:00:00.000Z'],
    ['2026-11-17T10:59:59Z', '2026-11-17T11:00:00.000Z'],
    ['2026-11-17T11:00:00Z', '2026-11-24T11:00:00.000Z'],
    ['2026-10-27T11:00:01Z', '2026-11-03T11:00:00.000Z'],
    ['2025-03-02T00:00:00Z', '2025-03-04T11:00:00.000Z'],
  ]) {
    assert.equal(new Date(nextWeeklyReset(T(now))).toISOString(), want, now);
    assert.equal(new Date(nextWeeklyReset(T(now), undefined)).toISOString(), want);
  }
});

test('next-start behaves the same at the default and moves with a configured reset', () => {
  const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look\n\n## Technical detail (for Claude)\nz';
  const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
  const doc = { version: 1, meta: {}, sections: [{ id: 'todo', name: 'todo', tasks: [
    task('E1', { type: 'epic', lane: 'a', description: '', labels: ['auto'] }), task('T1', { parentId: 'E1' })] }] };
  const base = { doc, now: T('2026-11-12T10:00:00Z'), weekCostUSD: 900, weekUSD: 1000, lastTickMs: T('2026-11-12T09:50:00Z'), tickMin: 30 };
  const a = computeNextStart(base);
  assert.equal(a.next.atKind, 'reset');
  assert.deepEqual(computeNextStart({ ...base, weeklyReset: { ...DEFAULT_WEEKLY_RESET } }), a);
  assert.ok(a.next.atMs >= T('2026-11-17T11:00:00Z') && a.next.atMs < T('2026-11-17T12:00:00Z'));
  // A Friday 06:00 UTC reset: the same pace stop now lifts the next morning.
  const c = computeNextStart({ ...base, weeklyReset: { weekday: 5, utcHour: 6 } });
  assert.ok(c.next.atMs >= T('2026-11-13T06:00:00Z') && c.next.atMs < T('2026-11-13T07:00:00Z'), new Date(c.next.atMs).toISOString());
});

test('normalizeWeeklyReset: valid values kept, anything else is the default', () => {
  assert.deepEqual(normalizeWeeklyReset({ weekday: 0, utcHour: 23, utcMinute: 30 }), { weekday: 0, utcHour: 23, utcMinute: 30 });
  assert.deepEqual(normalizeWeeklyReset({ weekday: 6, utcHour: 0 }), { weekday: 6, utcHour: 0, utcMinute: 0 });
  for (const bad of [null, 'tue', {}, { weekday: 7, utcHour: 1 }, { weekday: 1, utcHour: 24 }, { weekday: 1.5, utcHour: 1 }, { weekday: 1, utcHour: 1, utcMinute: 60 }]) {
    assert.deepEqual(normalizeWeeklyReset(bad), DEFAULT_WEEKLY_RESET, JSON.stringify(bad));
  }
});

test('lastWeeklyReset / nextWeeklyReset for another weekday and minute', () => {
  const r = { weekday: 0, utcHour: 9, utcMinute: 30 }; // Sunday 09:30 UTC
  assert.equal(new Date(lastWeeklyReset(T('2026-11-17T12:00:00Z'), r)).toISOString(), '2026-11-15T09:30:00.000Z');
  assert.equal(new Date(nextWeeklyReset(T('2026-11-17T12:00:00Z'), r)).toISOString(), '2026-11-22T09:30:00.000Z');
  assert.equal(lastWeeklyReset(T('2026-11-15T09:30:00Z'), r), T('2026-11-15T09:30:00Z'));
});

// ---- the meter ----

const NOW = T('2026-11-13T11:00:00Z'); // Friday: three days into a week that began Tue 2026-11-10 11:00Z
const rec = (id, startIso, hours, extra = {}) => ({
  sessionId: id, start: startIso, end: new Date(Math.max(...Object.keys(hours).map(Number)) * HOUR + HOUR).toISOString(),
  costUSD: Object.values(hours).reduce((a, b) => a + b, 0), costByHour: hours, ...extra,
});

test('the week starts at the reset moment: spend an hour before it is last week', () => {
  const s = [
    rec('old', '2026-11-10T09:00:00Z', { [hourOf('2026-11-10T09:00:00Z')]: 50, [hourOf('2026-11-10T10:00:00Z')]: 40 }), // 09:00-11:00Z: before the reset
    rec('new', '2026-11-10T11:00:00Z', { [hourOf('2026-11-10T11:00:00Z')]: 30 }),
  ];
  const m = computeUsageMeter({ sessions: s, nowMs: NOW });
  assert.equal(m.weekStart, '2026-11-10T11:00:00.000Z');
  assert.equal(m.resetsAt, '2026-11-17T11:00:00.000Z');
  assert.equal(m.costThisWeekUSD, 30);
});

test('a session straddling the reset counts only the hours after it; a half hour counts half', () => {
  const s = [rec('x', '2026-11-10T10:00:00Z', { [hourOf('2026-11-10T10:00:00Z')]: 10, [hourOf('2026-11-10T11:00:00Z')]: 10 })];
  assert.equal(computeUsageMeter({ sessions: s, nowMs: NOW }).costThisWeekUSD, 10);
  // A reset at 11:30: the hour that holds it counts half; the hour holding "now" counts whole (spend there is already made).
  const mid = computeUsageMeter({ sessions: s, nowMs: NOW, reset: { weekday: 2, utcHour: 11, utcMinute: 30 } });
  assert.equal(mid.costThisWeekUSD, 5);
  assert.equal(computeUsageMeter({ sessions: s, nowMs: T('2026-11-10T11:10:00Z') }).costThisWeekUSD, 10);
});

test('the exact reset moment starts a new week', () => {
  const s = [rec('x', '2026-11-17T10:00:00Z', { [hourOf('2026-11-17T10:00:00Z')]: 99 })];
  const m = computeUsageMeter({ sessions: s, nowMs: T('2026-11-17T11:00:00Z') });
  assert.equal(m.weekStart, '2026-11-17T11:00:00.000Z');
  assert.equal(m.costThisWeekUSD, 0);
});

test('a record from before hourly costs counts whole when it started this week', () => {
  const s = [{ sessionId: 'a', start: '2026-11-11T08:00:00Z', end: '2026-11-11T09:00:00Z', costUSD: 12 },
    { sessionId: 'b', start: '2026-11-09T08:00:00Z', end: '2026-11-09T09:00:00Z', costUSD: 77 }];
  assert.equal(computeUsageMeter({ sessions: s, nowMs: NOW }).costThisWeekUSD, 12);
});

test('the week is 168 hours across a daylight-saving change; days are local calendar days', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'Europe/Berlin'; // clocks go back on 2026-10-25
  try {
    const now = T('2026-10-27T15:00:00Z');
    const s = [rec('x', '2026-10-25T00:00:00Z', {
      [hourOf('2026-10-24T22:30:00Z')]: 1, // 00:30 CEST on the 25th
      [hourOf('2026-10-25T23:30:00Z')]: 2, // 00:30 CET on the 26th (the 25th had 25 hours)
    })];
    const m = computeUsageMeter({ sessions: s, nowMs: now });
    assert.equal(T(m.resetsAt) - T(m.weekStart), WEEK_MS);
    assert.equal(m.weekStart, '2026-10-27T11:00:00.000Z');
    // Spend before the reset belongs to last week; this week has none.
    assert.equal(m.costThisWeekUSD, 0);
    const wk = computeUsageMeter({ sessions: [rec('y', '2026-10-27T11:00:00Z', { [hourOf('2026-10-27T11:00:00Z')]: 4, [hourOf('2026-10-28T20:00:00Z')]: 6 })], nowMs: T('2026-10-29T10:00:00Z') });
    assert.deepEqual(wk.perDay.map(d => d.date), ['2026-10-27', '2026-10-28', '2026-10-29']);
    assert.deepEqual(wk.perDay.map(d => d.usd), [4, 6, 0]);
    assert.equal(localDayKey(T('2026-10-25T23:30:00Z')), '2026-10-26');
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
});

test('no calibration: dollars only, no percent, a plain-words reason', () => {
  const s = [rec('x', '2026-11-11T08:00:00Z', { [hourOf('2026-11-11T08:00:00Z')]: 412 })];
  const m = computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: null });
  assert.equal(m.pctUsed, null);
  assert.equal(m.source, 'none');
  assert.equal(m.weekUSD, null);
  assert.equal(m.reason, NO_PERCENT_REASON);
  assert.match(m.reason, /not enough limit hits/i);
  assert.equal(m.pace.projectedPctAtReset, null);
  assert.match(chipText(m), /^\$412\.?\d* this week · resets \w{3} \d\d:\d\d$/);
  assert.equal(chipLevel(m), 'none');
});

test('calibrated: estimated percent, chip text, colour levels', () => {
  const s = [rec('x', '2026-11-11T08:00:00Z', { [hourOf('2026-11-11T08:00:00Z')]: 620 })];
  const m = computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: 1000 });
  assert.equal(m.source, 'estimated');
  assert.equal(m.pctUsed, 62);
  assert.match(chipText(m), /^about 62% of the week used · resets \w{3} \d\d:\d\d$/);
  assert.equal(chipLevel(m), 'none');
  const set = pctUsed => ({ pctUsed, source: 'set by you' });
  assert.equal(chipLevel(set(75)), 'none');
  assert.equal(chipLevel(set(76)), 'amber');
  assert.equal(chipLevel(set(90)), 'amber');
  assert.equal(chipLevel(set(91)), 'red');
  // An estimate is never coloured, unless a weekly limit hit is active.
  assert.equal(chipLevel({ pctUsed: 95, source: 'estimated' }), 'none');
  assert.equal(chipLevel({ pctUsed: 95, source: 'estimated', limitHit: { kind: 'weekly', resetsAt: '2026-11-17T11:00:00Z' } }), 'red');
});

test('override: preferred for the week it was set in, extrapolated by cost since, expires at the reset', () => {
  const s = [rec('a', '2026-11-11T08:00:00Z', { [hourOf('2026-11-11T08:00:00Z')]: 300 }),
    rec('b', '2026-11-13T09:00:00Z', { [hourOf('2026-11-13T09:00:00Z')]: 100 })]; // 100 after the set time
  const ov = { pct: 40, setAt: '2026-11-13T09:00:00Z' };
  const known = computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: 1000, override: ov });
  assert.equal(known.source, 'set by you');
  assert.equal(known.setAt, '2026-11-13T09:00:00.000Z');
  assert.equal(known.pctUsed, 50); // 40 + 100 / 1000
  // Without a calibrated limit the set percent is shown as it is.
  const unknown = computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: null, override: ov });
  assert.equal(unknown.pctUsed, 40);
  assert.equal(unknown.source, 'set by you');
  assert.equal(unknown.reason, null);
  // Set in an earlier week: ignored.
  const old = computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: 1000, override: { pct: 99, setAt: '2026-11-09T12:00:00Z' } });
  assert.equal(old.source, 'estimated');
  // Over once the reset passes: a week later the same override no longer applies.
  const later = computeUsageMeter({ sessions: s, nowMs: T('2026-11-17T11:00:00Z'), weekUSD: 1000, override: ov });
  assert.equal(later.source, 'estimated');
  // Set in the future (clock skew) is ignored.
  assert.equal(computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: 1000, override: { pct: 5, setAt: '2026-11-14T00:00:00Z' } }).source, 'estimated');
});

test('override with its own reset time fixes the week and expires at it', () => {
  const ov = { pct: 30, setAt: '2026-11-14T08:00:00Z', resetsAt: '2026-11-18T10:00:00Z' };
  const m = computeUsageMeter({ sessions: [], nowMs: T('2026-11-15T08:00:00Z'), weekUSD: null, override: ov });
  assert.equal(m.resetsAt, '2026-11-18T10:00:00.000Z');
  assert.equal(m.weekStart, '2026-11-11T10:00:00.000Z');
  assert.equal(m.source, 'set by you');
  const after = computeUsageMeter({ sessions: [], nowMs: T('2026-11-18T10:00:00Z'), weekUSD: null, override: ov });
  assert.equal(after.source, 'none');
});

test('pace: projected percent at the reset and when the limit is reached', () => {
  // 3 days (72 h) in, 40% used -> 40 * 168 / 72 = 93.3% at the reset.
  const s = [rec('a', '2026-11-11T08:00:00Z', { [hourOf('2026-11-11T08:00:00Z')]: 400 })];
  const m = computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: 1000 });
  assert.equal(m.pace.projectedPctAtReset, 93.3);
  assert.equal(m.pace.reachesLimitAt, null);
  assert.equal(paceSentence(m), 'You will end the week at about 93%.');
  // 60% at 72 h: 100% after 120 h, which is Sunday 11:00 UTC + ... (before the reset): reachesLimitAt = start + 120 h.
  const fast = computeUsageMeter({ sessions: [rec('a', '2026-11-11T08:00:00Z', { [hourOf('2026-11-11T08:00:00Z')]: 600 })], nowMs: NOW, weekUSD: 1000 });
  assert.equal(fast.pace.projectedPctAtReset, 140);
  assert.equal(fast.pace.reachesLimitAt, '2026-11-15T11:00:00.000Z');
  assert.match(paceSentence(fast), /^At this pace you reach the limit \w+day (morning|afternoon|evening|night)\.$/);
  const over = computeUsageMeter({ sessions: [rec('a', '2026-11-11T08:00:00Z', { [hourOf('2026-11-11T08:00:00Z')]: 1200 })], nowMs: NOW, weekUSD: 1000, limitHit: HIT });
  assert.equal(over.pace.reachesLimitAt, null);
  assert.match(paceSentence(over), /weekly limit was hit; it frees up \w{3} \d\d:\d\d/);
  assert.match(paceSentence({ pctUsed: null, costThisWeekUSD: 12, reason: NO_PERCENT_REASON }), /\$12\.00 spent so far/);
});

test('per epic and per running session, with the project filter', () => {
  const doc = { sections: [{ id: 'in-progress', tasks: [
    { id: 'E1', type: 'epic', title: 'Epic one', project: 'p1' },
    { id: 'T1', parentId: 'E1', title: 't1', project: 'p1' },
    { id: 'T2', parentId: 'E1', title: 't2', project: 'p1' },
    { id: 'E2', type: 'epic', title: 'Epic two', project: 'p2' },
    { id: 'T3', parentId: 'E2', title: 't3', project: 'p2' },
  ] }] };
  const h = hourOf('2026-11-12T10:00:00Z');
  const s = [
    rec('s1', '2026-11-12T10:00:00Z', { [h]: 10 }, { ticket: 'T1' }),
    rec('s2', '2026-11-12T10:00:00Z', { [h]: 20, [h + 1]: 20 }, { ticket: 'T2', byTicket: { T2: { costUSD: 30 }, T3: { costUSD: 10 } } }),
    rec('live', '2026-11-13T10:30:00Z', { [hourOf('2026-11-13T10:00:00Z')]: 5 }, { ticket: 'T3' }),
  ];
  const all = computeUsageMeter({ sessions: s, doc, nowMs: NOW, liveIds: ['live'] });
  assert.equal(all.costThisWeekUSD, 55);
  assert.deepEqual(all.perEpic.map(e => [e.id, e.usd]), [['E1', 40], ['E2', 15]]);
  assert.deepEqual(all.perRunning, [{ ticketId: 'T3', sessionId: 'live', usd: 5, since: '2026-11-13T10:30:00Z' }]);
  const p1 = computeUsageMeter({ sessions: s, doc, nowMs: NOW, project: 'p1', liveIds: ['live'] });
  assert.deepEqual(p1.perEpic.map(e => e.id), ['E1']);
  assert.deepEqual(p1.perRunning, []);
  assert.equal(p1.costThisWeekUSD, 55); // the limit is the account's: the total ignores the project filter
});

test('asOf and capped pass through', () => {
  const m = computeUsageMeter({ sessions: [], nowMs: NOW, asOfMs: T('2026-11-13T10:00:00Z'), capped: true });
  assert.equal(m.asOf, '2026-11-13T10:00:00.000Z');
  assert.equal(m.capped, true);
});

test('an estimate over 100% with no active limit hit is treated as uncalibrated; an active hit keeps it', () => {
  const s = [rec('x', '2026-11-11T08:00:00Z', { [hourOf('2026-11-11T08:00:00Z')]: 1670 })];
  const m = computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: 1000 });
  assert.equal(m.pctUsed, null);
  assert.equal(m.source, 'none');
  assert.equal(m.reason, TOO_LOW_REASON);
  assert.match(m.reason, /looks too low.*ch metrics usage --set <pct>/);
  assert.equal(m.costThisWeekUSD, 1670);
  assert.match(chipText(m), /^\$1,?670 this week · resets/);
  assert.equal(chipLevel(m), 'none');
  const hit = computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: 1000, limitHit: HIT });
  // Under an active hit: words from the hit record, never a percent above 100; dollars stay in the numbers.
  assert.equal(hit.pctUsed, null);
  assert.deepEqual(hit.limitHit, { kind: 'weekly', resetsAt: '2026-11-17T11:00:00.000Z' });
  assert.match(chipText(hit), /^weekly limit hit · resets \w{3} \d\d:\d\d$/);
  assert.doesNotMatch(chipText(hit), /\d%/);
  assert.equal(hit.costThisWeekUSD, 1670);
  assert.equal(chipLevel(hit), 'red');
  // A number you set is capped at 100 even after counting the cost since.
  const over100 = computeUsageMeter({ sessions: [rec('b', '2026-11-13T10:00:00Z', { [hourOf('2026-11-13T10:00:00Z')]: 900 })], nowMs: NOW, weekUSD: 1000, override: { pct: 95, setAt: '2026-11-13T09:00:00Z' } });
  assert.equal(over100.pctUsed, 100);
  const set = computeUsageMeter({ sessions: s, nowMs: NOW, weekUSD: 1000, override: { pct: 60, setAt: '2026-11-13T10:00:00Z' } });
  assert.equal(set.source, 'set by you');
});

test('a limit hit that work continued past (spend over 30 minutes after it) is not active; it gets a note', () => {
  const day = hourOf('2026-11-11T08:00:00Z');
  const before = [rec('x', '2026-11-11T08:00:00Z', { [day]: 1670 })]; // all spend before the hit
  assert.equal(computeUsageMeter({ sessions: before, nowMs: NOW, weekUSD: 1000, limitHit: HIT }).limitHit.kind, 'weekly');
  const after = [...before, rec('y', '2026-11-13T10:30:00Z', { [hourOf('2026-11-13T11:00:00Z')]: 5 })]; // 11:00 is more than 30 min after 10:00
  const m = computeUsageMeter({ sessions: after, nowMs: NOW + HOUR, weekUSD: 1000, limitHit: HIT });
  assert.equal(m.limitHit, null);
  assert.equal(m.pctUsed, null); // over 100% and not blocking: the dollars-only rule
  assert.equal(m.reason, TOO_LOW_REASON);
  assert.equal(chipLevel(m), 'none');
  assert.match(m.limitHitNote, /^A weekly limit was hit on Friday, work continued after it\.$/);
  // Spend within 30 minutes of the hit does not clear it.
  const near = [...before, rec('z', '2026-11-13T10:00:00Z', { [hourOf('2026-11-13T10:00:00Z')]: 5 })];
  assert.ok(computeUsageMeter({ sessions: near, nowMs: NOW, weekUSD: 1000, limitHit: HIT }).limitHit);
});
