/**
 * cli/test/plan-share.test.js: usage-limit hits per session, stop causes of missed wakes, the week
 * calibration, "% of a week", the limits insight and `ch metrics cost`. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarizeSession } from '../../shared/session-metrics.js';
import { parseLimitText, parseResetsAt } from '../../shared/limit-hits.js';
import { distinctHits, limitsBlock } from '../../shared/plan-share.js';
import { buildMetricsPayload } from '../../shared/metrics-payload.js';
import { buildInsights } from '../../shared/insights.js';

const CH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ch');
const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();

const human = (min, text = 'go') => ({ type: 'user', sessionId: 's1', timestamp: at(min), origin: { kind: 'human' }, message: { content: text } });
const work = (min, blocks = [{ type: 'text', text: 'ok' }]) => ({ type: 'assistant', sessionId: 's1', timestamp: at(min), message: { id: `m${min}`, model: 'claude-opus-5', content: blocks } });
const errLine = (min, text) => ({ type: 'assistant', sessionId: 's1', timestamp: at(min), isApiErrorMessage: true, message: { model: '<synthetic>', content: [{ type: 'text', text }] } });
const SESSION_HIT = "You've hit your session limit · resets 12:40pm (UTC)";
const WEEKLY_HIT = "You've hit your weekly limit · resets Jan 5 at 2pm (UTC)";

test('parse limit text: session and weekly, credit balance and API errors are not limits', () => {
  assert.deepEqual(parseLimitText(SESSION_HIT).kind, 'session');
  assert.deepEqual(parseLimitText(WEEKLY_HIT).kind, 'weekly');
  assert.equal(parseLimitText('Credit balance is too low'), null);
  assert.equal(parseLimitText("API Error: Can't reach the API server"), null);
});

test('parse resets: no date = next occurrence, with a date, zone offsets, year roll, bad zone', () => {
  const t = Date.parse('2026-01-01T10:00:00Z');
  assert.equal(parseResetsAt(SESSION_HIT, t), '2026-01-01T12:40:00.000Z');
  assert.equal(parseResetsAt('resets 9am (UTC)', t), '2026-01-02T09:00:00.000Z'); // already past today
  assert.equal(parseResetsAt('resets 12am (UTC)', t), '2026-01-02T00:00:00.000Z');
  assert.equal(parseResetsAt(WEEKLY_HIT, t), '2026-01-05T14:00:00.000Z');
  assert.equal(parseResetsAt('resets 12:40pm (America/New_York)', t), '2026-01-01T17:40:00.000Z'); // winter, UTC-5
  assert.equal(parseResetsAt('resets 1pm (America/New_York)', Date.parse('2026-07-01T10:00:00Z')), '2026-07-01T17:00:00.000Z'); // summer, UTC-4
  assert.equal(parseResetsAt('resets Jan 2 at 1pm (UTC)', Date.parse('2026-12-31T10:00:00Z')), '2027-01-02T13:00:00.000Z');
  assert.equal(parseResetsAt('resets 1pm (Not/AZone)', t), null);
  assert.equal(parseResetsAt('no reset here', t), null);
});

test('session: limit hit kind, resetsAt and lostMin (to the next real assistant line, cut at the reset)', () => {
  const r = summarizeSession([human(0), work(1), errLine(2, SESSION_HIT), human(30), work(31)]);
  assert.equal(r.limitHits.length, 1);
  assert.deepEqual(r.limitHits[0], { kind: 'session', at: at(2), resetsAt: '2026-01-01T12:40:00.000Z', lostMin: 29 });
  // next work only after the reset: lost time stops at the reset (10:02 -> 12:40 = 158 min)
  const late = summarizeSession([human(0), errLine(2, SESSION_HIT), work(240)]);
  assert.equal(late.limitHits[0].lostMin, 158);
  // no later line: to the reset; no reset and no later line: unknown
  assert.equal(summarizeSession([human(0), errLine(2, SESSION_HIT)]).limitHits[0].lostMin, 158);
  assert.equal(summarizeSession([human(0), errLine(2, "You've hit your session limit")]).limitHits[0].lostMin, null);
  const w = summarizeSession([human(0), errLine(2, WEEKLY_HIT)]);
  assert.equal(w.limitHits[0].kind, 'weekly');
  assert.equal(w.limitHits[0].resetsAt, '2026-01-05T14:00:00.000Z');
});

test('session: retries with no real work between are one hit; work in between makes a new one', () => {
  const r = summarizeSession([human(0), errLine(1, SESSION_HIT), human(2, 'again'), errLine(3, SESSION_HIT), human(4, 'again'), errLine(5, SESSION_HIT)]);
  assert.equal(r.limitHits.length, 1);
  assert.equal(r.limitHits[0].at, at(1));
  const two = summarizeSession([human(0), errLine(1, SESSION_HIT), work(20), errLine(25, SESSION_HIT)]);
  assert.equal(two.limitHits.length, 2);
  // a different kind right after is its own hit
  assert.equal(summarizeSession([human(0), errLine(1, SESSION_HIT), errLine(2, WEEKLY_HIT)]).limitHits.length, 2);
});

test('session: credit balance and API errors are not limit hits', () => {
  const r = summarizeSession([human(0), errLine(1, 'Credit balance is too low'), errLine(2, "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)")]);
  assert.deepEqual(r.limitHits, []);
  assert.deepEqual(summarizeSession([human(0), work(1)]).limitHits, []);
});

// A turn that stopped right after a tool finished and sat 40 minutes: tool_use, tool_result, silence, your prompt.
const toolStop = (extraAfterResult = [], extraAfterGap = []) => summarizeSession([
  human(0), work(1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
  { type: 'user', sessionId: 's1', timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } },
  ...extraAfterResult,
  human(45, 'hello?'),
  ...extraAfterGap,
]);

test('stop causes: usage-limit, api-error, interrupt and unknown for a tool-result missed wake', () => {
  const base = toolStop();
  assert.equal(base.missedWakeOrigins['tool-result'], 1);
  assert.deepEqual(base.missedWakeCauses, { unknown: 1 });
  // the limit line is written when you retry, just after the gap
  assert.deepEqual(toolStop([], [errLine(46, SESSION_HIT)]).missedWakeCauses, { 'usage-limit': 1 });
  // a system api_error line just after the tool result
  const sys = { type: 'system', subtype: 'api_error', sessionId: 's1', timestamp: at(2.5), error: { formatted: 'Connection dropped (ECONNRESET)' } };
  assert.deepEqual(toolStop([sys]).missedWakeCauses, { 'api-error': 1 });
  assert.deepEqual(toolStop([], [errLine(46, 'Credit balance is too low')]).missedWakeCauses, { 'api-error': 1 });
  // your Escape press
  assert.deepEqual(toolStop([human(2.2, '[Request interrupted by user for tool use]')]).missedWakeCauses, { interrupt: 1 });
  // the limit wins over an API error and an interrupt near the same stop
  assert.deepEqual(toolStop([sys], [errLine(46, WEEKLY_HIT)]).missedWakeCauses, { 'usage-limit': 1 });
});

const result = (min, id) => ({ type: 'user', sessionId: 's1', timestamp: at(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] } });

test('stop causes: "No response requested." after the silence is app-closed (a missed wake, not a stall)', () => {
  const noResp = (min) => ({ type: 'assistant', sessionId: 's1', timestamp: at(min), message: { id: `n${min}`, model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] } });
  const r = summarizeSession([human(0), work(1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]), result(2, 't1'), noResp(60)]);
  assert.equal(r.missedWakes, 1);
  assert.equal(r.stalls, 0);
  assert.deepEqual(r.missedWakeCauses, { 'app-closed': 1 });
  // the same text after your resume prompt
  assert.deepEqual(toolStop([], [noResp(46)]).missedWakeCauses, { 'app-closed': 1 });
  // any other answer after the gap is still a stall
  const stall = summarizeSession([human(0), work(1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]), result(2, 't1'), work(60)]);
  assert.deepEqual([stall.missedWakes, stall.stalls], [0, 1]);
});

test('a silence ended by another tool result (a slow parallel tool) is a tool wait, not a missed wake', () => {
  // t2's call was never seen pending, so only the line itself shows the tool was still running
  const r = summarizeSession([human(0), work(1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]), result(2, 't1'), result(50, 'orphan')]);
  assert.equal(r.missedWakes, 0);
  assert.deepEqual([r.toolWaits, r.toolWaitMin], [1, 48]);
  assert.deepEqual(r.missedWakeCauses, {});
  // with the second call pending it is a tool wait named by the tool (unchanged), still no missed wake
  const par = summarizeSession([human(0), work(1, [{ type: 'tool_use', id: 'a', name: 'Bash', input: {} }, { type: 'tool_use', id: 'b', name: 'Read', input: {} }]), result(2, 'a'), result(50, 'b')]);
  assert.deepEqual([par.missedWakes, par.toolWaits, par.toolWaitTools], [0, 1, { Read: 1 }]);
  // your prompt after the silence is still a missed wake
  assert.equal(toolStop().missedWakes, 1);
});

const sess = (id, startIso, cost, hits = [], over = {}) => ({
  key: id, sessionId: id, ticket: null, start: startIso, end: startIso, wallMin: 10, activeMin: 5, costUSD: cost, limitHits: hits, byTicket: {}, ...over,
});
const hit = (kind, atIso, resetsAt = null, lostMin = 60) => ({ kind, at: atIso, resetsAt, lostMin });

test('distinct hits: same reset deduped across sessions, null reset by 1 hour, longest lostMin kept', () => {
  const a = sess('a', '2026-11-01T00:00:00Z', 1, [hit('weekly', '2026-11-03T10:00:00Z', '2026-11-05T14:00:00Z', 30)]);
  const b = sess('b', '2026-11-01T00:00:00Z', 1, [hit('weekly', '2026-11-03T10:20:00Z', '2026-11-05T14:00:00Z', 90), hit('session', '2026-11-03T08:00:00Z'), hit('session', '2026-11-03T08:40:00Z')]);
  const d = distinctHits([a, b, sess('c', '2026-11-01T00:00:00Z', 1, [hit('session', '2026-11-03T12:00:00Z')])]);
  assert.deepEqual(d.map((h) => [h.kind, h.lostMin]), [['session', 60], ['weekly', 90], ['session', 60]]);
});

const NOW = '2026-11-11T12:00:00.000Z';
const calSessions = () => [
  sess('a', '2026-10-30T10:00:00Z', 10, [hit('weekly', '2026-11-03T10:00:00Z', '2026-11-05T14:00:00Z', 60)]),
  sess('b', '2026-11-01T10:00:00Z', 5, [hit('weekly', '2026-11-03T10:30:00Z', '2026-11-05T14:00:00Z', 30)]), // the same hit seen by a parallel session
  sess('c', '2026-11-06T10:00:00Z', 20, [hit('weekly', '2026-11-10T10:00:00Z', '2026-11-12T14:00:00Z', 120), hit('session', '2026-11-06T12:00:00Z', '2026-11-06T15:00:00Z', 60)]),
];

test('calibration: median over distinct weekly hits (shared reset deduped), 5-hour window, counts', () => {
  const l = limitsBlock({ sessions: calSessions(), sinceMs: Date.parse('2026-10-12T12:00:00Z'), nowMs: Date.parse(NOW) });
  // hit 1: sessions a + b started in the 7 days before it = 15; hit 2: only c = 20; median 17.5
  assert.deepEqual(l, { sessionHits: 1, weeklyHits: 2, lostHours: 4, weekUSD: 17.5, sessionWindowUSD: 20, nWeekly: 2, nSession: 1 });
  // counts are for the window, calibration still uses every hit
  const narrow = limitsBlock({ sessions: calSessions(), sinceMs: Date.parse('2026-11-08T00:00:00Z'), nowMs: Date.parse(NOW) });
  assert.deepEqual([narrow.weeklyHits, narrow.sessionHits, narrow.nWeekly, narrow.weekUSD], [1, 0, 2, 17.5]);
  const none = limitsBlock({ sessions: [sess('x', '2026-11-06T10:00:00Z', 4)], sinceMs: 0, nowMs: Date.parse(NOW) });
  assert.deepEqual(none, { sessionHits: 0, weeklyHits: 0, lostHours: 0, weekUSD: null, sessionWindowUSD: null, nWeekly: 0, nSession: 0 });
});

const tk = (id, over = {}) => ({ id, title: `${id} title`, type: 'task', project: 'pa', lane: 'l', created: '2026-11-01T00:00:00.000Z', history: [], ...over });
const doc = () => ({ sections: [{ id: 'in-progress', tasks: [tk('K1')] }, { id: 'done', tasks: [tk('K2', { project: 'pb' })] }], meta: {} });

test('payload: costs.limits from all sessions (also with a project filter); weekShare only when calibrated', () => {
  const sessions = calSessions().map((s, i) => ({ ...s, ticket: i === 2 ? 'K2' : 'K1', byTicket: { [i === 2 ? 'K2' : 'K1']: { costUSD: s.costUSD, tokens: 1, toolCalls: 0 } } }));
  const p = buildMetricsPayload({ doc: doc(), sessions, cfg: {}, now: NOW });
  assert.equal(p.costs.limits.weekUSD, 17.5);
  const k2 = p.costs.byTicket.find((t) => t.ticket === 'K2');
  assert.equal(k2.weekShare, 1.143); // 20 / 17.5
  assert.equal(p.costs.byTicket.find((t) => t.ticket === 'K1').weekShare, 0.857);
  // filtered to project pa: c (ticket K2, project pb) leaves the rows, but the calibration still counts it
  const pa = buildMetricsPayload({ doc: doc(), sessions, cfg: {}, now: NOW, project: 'pa' });
  assert.equal(pa.costs.limits.weekUSD, 17.5);
  assert.ok(!pa.costs.byTicket.some((t) => t.ticket === 'K2'));
  // not calibrated: no weekShare anywhere
  const plain = sessions.map((s) => ({ ...s, limitHits: [] }));
  const q = buildMetricsPayload({ doc: doc(), sessions: plain, cfg: {}, now: NOW });
  assert.equal(q.costs.limits.weekUSD, null);
  assert.ok(q.costs.byTicket.length > 0 && q.costs.byTicket.every((t) => !('weekShare' in t)));
  assert.ok(q.costs.byEpic.every((e) => !('weekShare' in e)));
});

test('payload: missedWakeCauses summed over sessions', () => {
  const s = (id, c) => sess(id, '2026-11-05T10:00:00Z', 1, [], { missedWakeCauses: c });
  const p = buildMetricsPayload({ doc: doc(), sessions: [s('a', { 'usage-limit': 2 }), s('b', { 'usage-limit': 1, unknown: 1 }), s('c', undefined)], cfg: {}, now: NOW });
  assert.deepEqual(p.sessions.summary.missedWakeCauses, { 'usage-limit': 3, unknown: 1 });
});

const trends = (n) => Array.from({ length: n }, (_, i) => ({ repo: `r${i}`, name: 'build', changePct: 40, recentCount: 5, priorCount: 5, priorMedian: 100, recentMedian: 140 }));

test('insights: cost and limits insights survive a dozen other findings', () => {
  const costs = { total: { costUSD: 50, helperCostUSD: 5, sessions: 3, byModel: [] }, byEpic: [], byTicket: [{ ticket: 'K1', costUSD: 50, share: 1 }], limits: { sessionHits: 2, weeklyHits: 1, lostHours: 3.5, weekUSD: 120, nWeekly: 1 } };
  const out = buildInsights({ costs, timings: { trends: trends(12) } });
  assert.equal(out.length, 10);
  const titles = out.map((i) => i.title);
  assert.ok(titles.some((t) => t.includes('cost the most')), titles.join('\n'));
  const lim = out.find((i) => i.title.startsWith('Hit a usage limit'));
  assert.ok(lim, titles.join('\n'));
  assert.match(lim.title, /3 times, losing 3\.5 h/);
  assert.match(lim.detail, /A week's limit is about \$120 at API prices \(from 1 weekly-limit hit\)/);
  const none = buildInsights({ costs: { ...costs, limits: { sessionHits: 0, weeklyHits: 0 } } });
  assert.ok(!none.some((i) => i.title.startsWith('Hit a usage limit')));
  const uncal = buildInsights({ costs: { ...costs, limits: { sessionHits: 1, weeklyHits: 0, lostHours: 0.5, weekUSD: null } } });
  assert.match(uncal.find((i) => i.title.startsWith('Hit a usage limit')).detail, /Not calibrated yet/);
});

test('insights: the stuck-session insight names the stop causes', () => {
  const sessions = { summary: { n: 3, missedWakeSessions: 2, missedWakes: 3, missedWakeOrigins: { 'tool-result': 3 }, missedWakeCauses: { 'usage-limit': 2, unknown: 1 } }, byWeek: [] };
  const i = buildInsights({ sessions }).find((x) => x.title.includes('got stuck'));
  assert.match(i.detail, /3 mid-turn stops: 2 usage limit, 1 no cause found/);
});

test('ch metrics cost: limits line, calibrated "% wk" column and not-calibrated text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-plan-cli-'));
  try {
    fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc()));
    fs.mkdirSync(path.join(dir, 'metrics'));
    const h = (n) => new Date(Date.now() - n * 3600000).toISOString();
    const run = (...a) => spawnSync('node', [CH, 'metrics', ...a], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
    const write = (hits) => {
      const s = sess('s1', h(30), 10, hits, { ticket: 'K1', byTicket: { K1: { costUSD: 6, tokens: 500, toolCalls: 9 } } });
      fs.writeFileSync(path.join(dir, 'metrics', 'sessions.jsonl'), JSON.stringify(s) + '\n');
    };
    write([hit('session', h(20), h(18), 60), hit('weekly', h(10), h(1), 120)]);
    const cal = run('cost', '--since', '30d');
    assert.equal(cal.status, 0, cal.stderr);
    assert.match(cal.stdout, /Limit hits: 1 session, 1 weekly, 3\.0 h lost; a week's limit ≈ \$10\.00 at API prices \(from 1 hit\)/);
    assert.match(cal.stdout, /Share\s+% wk\s+Tokens/);
    assert.match(cal.stdout, /K1\s+\$6\.00\s+60%\s+60\.0%\s+500/);
    assert.match(run('cost', 'K1').stdout, /K1\s+\$6\.00 \(60\.0% of a week\)/);
    assert.equal(JSON.parse(run('cost', '--json').stdout).limits.weekUSD, 10);
    write([hit('session', h(20), h(18), 60)]);
    const un = run('cost', '--since', '30d');
    assert.match(un.stdout, /Limit hits: 1 session, 0 weekly, 1\.0 h lost; not calibrated yet \(no weekly-limit hit in the data\)/);
    assert.ok(!un.stdout.includes('% wk'));
    assert.match(un.stdout, /K1\s+\$6\.00\s+60%\s+500/);
    assert.ok(!run('cost', 'K1').stdout.includes('of a week'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
