/**
 * cli/test/quality-health.test.js (PRO77, PRO78): the Quality section (review notes by principle, rework and red CI
 * by model label), the one Session health view (stuck/silent/asked/clean, unknown stop causes by origin and week) and
 * the backlog trend. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { principleOf, qualityBlock } from '../../shared/quality-metrics.js';
import { healthBlock, backlogBlock, statusOf, STUCK_DOCS } from '../../shared/health-metrics.js';
import { flowMetrics } from '../../shared/flow-metrics.js';
import { buildMetricsPayload } from '../../shared/metrics-payload.js';
import { buildInsights } from '../../shared/insights.js';
import { summarizeSession } from '../../shared/session-metrics.js';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const SINCE = Date.parse('2026-10-13T00:00:00.000Z');
const at = (day, hh = 0) => `2026-11-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:00:00.000Z`;
const mv = (when, from, to) => ({ at: when, event: 'moved', from, to });
const task = (id, over = {}) => ({ id, title: `T ${id}`, type: 'task', project: 'p1', created: at(1), labels: [], history: [], ...over });
const docOf = map => ({ sections: Object.entries(map).map(([id, tasks]) => ({ id, tasks })), meta: {} });
const note = (n, kind, state, over = {}) => ({ n, at: at(5), text: 'x', kind, state, ...over });

// ---------- PRO77: review notes by principle ----------

test('principleOf: the filed ticket Taste line first, then the check text, else other', () => {
  const filed = { description: '## x\n**Taste:** motion (gentle entrance)\n' };
  assert.equal(principleOf({ check: 'Tab order works with the keyboard' }, filed), 'motion');
  assert.equal(principleOf({ check: 'Tab order works with the keyboard' }, null), 'keyboard');
  assert.equal(principleOf({ check: 'Every knob takes a mod dot like its siblings' }, { description: 'no taste line' }), 'consistency');
  assert.equal(principleOf({ check: 'Open the board and wait' }, null), 'other');
  assert.equal(principleOf({}, null), 'other');
});

test('quality notes: kinds, states, per shipped ticket and by principle with the most fix notes first', () => {
  const f1 = task('F1', { description: '**Taste:** motion.' });
  const a = task('A1', { history: [mv(at(2), 'todo', 'in-progress'), mv(at(4), 'in-progress', 'done')], reviewNotes: [
    note(1, 'fix', 'filed', { filed: 'F1' }), note(2, 'fix', 'filed', { filed: 'F1' }), note(3, 'fix', 'dismissed', { check: 'Keyboard reaches the field' }),
    note(4, 'idea', 'filed'), note(5, 'design', 'new'), note(6, 'fix', 'filed', { filed: 'F1', at: '2026-06-01T00:00:00.000Z' }), // before the window
  ] });
  const doc = docOf({ done: [a], todo: [f1] });
  const flow = flowMetrics(doc, { now: NOW, since: SINCE });
  const q = qualityBlock({ tasks: [a, f1], flow, sinceMs: SINCE, untilMs: NOW });
  assert.equal(q.notes.total, 5);
  assert.deepEqual(q.notes.kinds, { fix: 3, idea: 1, design: 1 });
  assert.deepEqual(q.notes.states, { filed: 3, dismissed: 1, new: 1 });
  assert.equal(q.notes.perShipped, 5); // 5 notes, 1 shipped ticket
  assert.deepEqual(q.notes.byPrinciple.map(r => [r.principle, r.fix]), [['motion', 2], ['keyboard', 1], ['other', 0]]);
  assert.equal(q.notes.byPrinciple[0].high, false); // 2 fix notes is under the threshold of 3
  assert.match(q.notes.hint, /pre-ship check|taste doc/);
});

test('quality notes: a principle with 3+ fix notes is flagged high', () => {
  const f1 = task('F1', { description: '**Taste:** keyboard' });
  const a = task('A1', { reviewNotes: [1, 2, 3].map(n => note(n, 'fix', 'filed', { filed: 'F1' })) });
  const q = qualityBlock({ tasks: [a, f1], flow: { counts: { shipped: 0 } }, sinceMs: SINCE, untilMs: NOW });
  assert.equal(q.notes.byPrinciple[0].high, true);
  assert.equal(q.notes.high, true);
  assert.equal(q.notes.perShipped, null);
});

// ---------- PRO77: rework and red CI by model label ----------

test('flow.reopenedByLabel carries shipped per label; quality turns it into a rework share and flags over 20%', () => {
  const shipped = (id, label, extra = []) => task(id, { labels: [label], history: [mv(at(2), 'todo', 'in-progress'), mv(at(4), 'in-progress', 'done'), ...extra] });
  const back = shipped('H1', 'model:haiku', [mv(at(6), 'done', 'in-progress')]);
  const tasks = [back, shipped('H2', 'model:haiku'), shipped('H3', 'model:haiku'), shipped('O1', 'model:opus'), shipped('O2', 'model:opus')];
  const flow = flowMetrics(docOf({ done: tasks }), { now: NOW, since: SINCE });
  assert.deepEqual(flow.reopenedByLabel.map(r => [r.label, r.shipped]).sort(), [['model:haiku', 3], ['model:opus', 2]]);
  const q = qualityBlock({ tasks, flow, sinceMs: SINCE, untilMs: NOW });
  assert.deepEqual(q.byLabel.map(r => [r.label, r.shipped, r.reopened, r.reworkShare, r.reworkHigh]),
    [['model:opus', 2, 0, 0, false], ['model:haiku', 3, 1, 0.333, true]]); // opus first, then sonnet, haiku
  assert.equal(q.rework.high, true);
  assert.equal(q.rework.share, 0.2); // 1 of 5
  assert.match(q.rework.hint, /raise the tier/);
});

test('red CI per PR: branches join tickets through sessions, failed runs per PR, rerun cost, top failing job, by label', () => {
  const tOpus = task('O1', { labels: ['model:opus'] });
  const tHaiku = task('H1', { labels: ['model:haiku'] });
  const sessions = [{ ticket: 'O1', branch: 'o1-work' }, { ticket: 'H1', branch: 'weird-branch' }];
  const run = (branch, ok, over = {}) => ({ kind: 'ci', repo: 'r', branch, at: at(5), seconds: 600, ok, conclusion: ok ? 'success' : 'failure', ...over });
  const timings = [
    run('o1-work', false, { failedJobs: ['Windows'] }), run('o1-work', true, { attempt: 2 }),
    run('weird-branch', false, { failedJobs: ['Windows', 'Lint'] }), run('weird-branch', false, { failedJobs: ['Windows'] }), run('weird-branch', false, { failedJobs: ['Windows'] }), run('weird-branch', true),
    run('weird-branch', null, { conclusion: 'cancelled' }), // not counted
    run('main', false, { failedJobs: ['Windows'] }), // not a PR
    { kind: 'gate', repo: 'r', branch: 'o1-work', at: at(5), seconds: 5, ok: false }, // not CI
  ];
  const q = qualityBlock({ tasks: [tOpus, tHaiku], flow: { counts: { shipped: 0 } }, timings, sessions, sinceMs: SINCE, untilMs: NOW });
  assert.deepEqual([q.ci.prs, q.ci.runs, q.ci.failedRuns, q.ci.failedPerPr], [2, 6, 4, 2]);
  assert.deepEqual(q.ci.topFailedJob, { name: 'Windows', count: 4 });
  assert.equal(q.ci.rerunHours, 0.17); // one rerun of 600 s
  assert.equal(q.ci.failedHours, 0.67); // four failed runs of 600 s
  assert.equal(q.ci.high, true); // 2 failed per PR > 1.5
  const by = Object.fromEntries(q.byLabel.map(r => [r.label, r]));
  assert.deepEqual([by['model:opus'].prs, by['model:opus'].failedPerPr, by['model:opus'].redHigh], [1, 1, false]);
  assert.deepEqual([by['model:haiku'].prs, by['model:haiku'].failedPerPr, by['model:haiku'].redHigh], [1, 3, true]);
  assert.match(q.ci.hint, /repeat failing job/);
});

test('red CI: a branch named after a known ticket joins without a session, and the project filter applies', () => {
  const t = task('PRO7', { project: 'pa', labels: ['model:sonnet'] });
  const other = task('FRO9', { project: 'pb', labels: ['model:sonnet'] });
  const run = (branch) => ({ kind: 'ci', repo: 'r', branch, at: at(5), seconds: 60, ok: false });
  const q = qualityBlock({ tasks: [t, other], flow: { counts: {} }, timings: [run('feat/pro7-fix'), run('fix/fro9-fix'), run('chore/review-checks-1107')], sessions: [], sinceMs: SINCE, untilMs: NOW, project: 'pa' });
  assert.equal(q.ci.prs, 2); // the PRO7 branch and the branch with no ticket (FRO9 is another project)
  assert.equal(q.byLabel.find(r => r.prs).label, 'model:sonnet');
});

test('payload carries quality, health and the backlog block', () => {
  const doc = docOf({ done: [task('A1', { history: [mv(at(2), 'todo', 'in-progress'), mv(at(4), 'in-progress', 'done')] })] });
  const p = buildMetricsPayload({ doc, sessions: [], timings: [], cfg: {}, now: NOW, since: SINCE });
  assert.ok(p.quality.notes && p.quality.ci && p.quality.rework);
  assert.equal(p.health.n, 0);
  assert.ok(Array.isArray(p.flow.backlog.byWeek));
  assert.equal(p.flow.backlog.shipped, 1);
});

// ---------- PRO78: session health ----------

const week1 = '2026-11-03T10:00:00Z';
const week2 = '2026-11-10T10:00:00Z';
const H = (list) => healthBlock(list, Date.parse('2026-11-02'), Date.parse('2026-11-12'));

test('every session is exactly one of stuck, silent, asked, clean', () => {
  assert.equal(statusOf({ missedWakes: 1, stalls: 2, questionsMidRun: 1 }), 'stuck');
  assert.equal(statusOf({ stalls: 1, questionsMidRun: 1 }), 'silent');
  assert.equal(statusOf({ toolWaits: 1 }), 'silent');
  assert.equal(statusOf({ questionsMidRun: 2 }), 'asked');
  assert.equal(statusOf({}), 'clean');
  const h = H([{ start: week1, missedWakes: 1, stalls: 1 }, { start: week1, stalls: 1 }, { start: week1 }, { start: week2, questionsMidRun: 1 }]);
  assert.deepEqual(h.status, { stuck: 1, silent: 1, asked: 1, clean: 1 });
  assert.equal(h.status.stuck + h.status.silent + h.status.asked + h.status.clean, h.n);
  assert.equal(h.cleanShare, 0.25);
});

test('the payload sessions summary uses the same definitions as health', () => {
  const ses = (id, over) => ({ key: id, sessionId: id, start: week1, wallMin: 1, activeMin: 1, ...over });
  const p = buildMetricsPayload({ doc: docOf({ todo: [] }), sessions: [ses('a', { missedWakes: 1, stalls: 1 }), ses('b', { stalls: 1 }), ses('c', {})], timings: [], cfg: {}, now: NOW, since: SINCE });
  assert.equal(p.sessions.summary.autonomousShare, p.health.cleanShare);
  assert.equal(p.sessions.summary.silentSessions, p.health.status.silent); // a stuck session is not also counted silent
  assert.equal(p.health.status.stuck, 1);
});

test('mid-turn stops vs unanswered by origin, causes, and unknown stops by what ended the silence and by week', () => {
  const h = H([
    { start: week1, missedWakes: 3, missedWakeOrigins: { 'tool-result': 2, 'task-notification': 1 }, missedWakeCauses: { unknown: 2 }, missedWakeUnknownBy: { human: 1, 'task-notification': 1 } },
    { start: week2, missedWakes: 2, missedWakeOrigins: { 'tool-result': 2 }, missedWakeCauses: { 'usage-limit': 1, unknown: 1 }, missedWakeUnknownBy: { human: 1 } },
    { start: week2, missedWakes: 1, missedWakeOrigins: { 'tool-result': 1 }, missedWakeCauses: { unknown: 1 } }, // an older record: no per-origin detail
  ]);
  assert.equal(h.events.midTurnStops, 5);
  assert.deepEqual(h.events.unanswered, { 'task-notification': 1 });
  assert.equal(h.events.unansweredTotal, 1);
  assert.deepEqual(h.causes, { unknown: 4, 'usage-limit': 1 });
  assert.deepEqual(h.unknown.byWake, { human: 2, 'task-notification': 1, 'not recorded': 1 });
  assert.deepEqual(h.unknown.byWeek.filter(w => w.n).map(w => [w.week, w.n]), [['2026-11-02', 2], ['2026-11-09', 2]]);
  assert.equal(h.unknown.total, 4);
  assert.equal(h.unknown.share, 0.8);
  assert.match(h.actions.unknown, /Most mid-turn stops have no cause \(4 of 5\)/);
  assert.match(h.actions.stuck, /usage limit \(1\)/);
  assert.match(h.actions.stuck, new RegExp(STUCK_DOCS.replace(/\./g, '\\.')));
});

test('every health card has an action line, also with nothing to fix', () => {
  const h = H([{ start: week1 }]);
  for (const k of ['stuck', 'unknown', 'silent', 'clean']) assert.ok(h.actions[k] && h.actions[k].length > 10, k);
  assert.equal(H([]).actions.clean, 'No sessions in this range.');
});

test('summarizeSession records what ended the silence for stops with no cause found', () => {
  const T0 = Date.parse('2026-01-01T10:00:00.000Z');
  const ts = (min) => new Date(T0 + min * 60000).toISOString();
  const lines = (wake) => [
    { type: 'user', sessionId: 's1', timestamp: ts(0), origin: { kind: 'human' }, message: { content: 'go' } },
    { type: 'assistant', sessionId: 's1', timestamp: ts(1), message: { id: 'm1', model: 'claude-opus-5', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
    { type: 'user', sessionId: 's1', timestamp: ts(2), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } },
    wake,
  ];
  const human = { type: 'user', sessionId: 's1', timestamp: ts(45), origin: { kind: 'human' }, message: { content: 'hello?' } };
  const notif = { type: 'user', sessionId: 's1', timestamp: ts(45), origin: { kind: 'task-notification' }, message: { content: '<task-notification>done</task-notification>' } };
  assert.deepEqual(summarizeSession(lines(human)).missedWakeUnknownBy, { human: 1 });
  assert.deepEqual(summarizeSession(lines(notif)).missedWakeUnknownBy, { 'task-notification': 1 });
  const known = summarizeSession(lines(human), { stopCauses: [{ sessionId: 's1', at: ts(20), cause: 'idle-sweep', evidence: 'x', recordedAt: ts(21) }] });
  assert.deepEqual(known.missedWakeUnknownBy, {}); // a stop with a cause is not listed
});

// ---------- PRO78: backlog ----------

const wk = (week, created, shipped) => ({ week, created, shipped });

test('backlog: created vs shipped per week, closed without work, hint after 3 weeks of created > shipped', () => {
  const weeks = [wk('2026-10-12', 1, 5), wk('2026-10-19', 6, 2), wk('2026-10-26', 7, 3), wk('2026-11-02', 9, 4), wk('2026-11-09', 0, 0)];
  const b = backlogBlock(weeks, { openTodo: 40, growthPerWeek: 4 }, { closedWithoutWork: 245, untilMs: Date.parse('2026-11-11T12:00:00Z') });
  assert.deepEqual([b.created, b.shipped, b.closedWithoutWork, b.openTodo], [23, 14, 245, 40]);
  assert.equal(b.weeksOver, 3); // the running week (11-09) is left out of the streak
  assert.equal(b.over, true);
  assert.match(b.action, /stop opening small tickets/);
  const calm = backlogBlock([wk('2026-10-19', 6, 2), wk('2026-10-26', 3, 3), wk('2026-11-02', 9, 4)], { openTodo: 1, growthPerWeek: 0 }, { untilMs: Date.parse('2026-11-11T12:00:00Z') });
  assert.equal(calm.weeksOver, 1);
  assert.equal(calm.over, false);
  assert.match(calm.action, /in step/);
});

test('backlog insight appears only when created > shipped for 3 weeks', () => {
  const full = { sources: { sessions: { records: 1 }, ci: { records: 1 }, gates: { records: 1 }, builds: { records: 1 } } };
  const flowOf = (backlog) => ({ bottleneck: null, stages: {}, groups: { project: {} }, forgottenEpics: [], backlog });
  const over = { openTodo: 40, growthPerWeek: 4, created: 22, shipped: 9, weeksOver: 3, over: true, action: 'stop opening small tickets' };
  assert.ok(buildInsights({ ...full, flow: flowOf(over) }).some(i => i.title === 'More tickets opened than shipped for 3 weeks'));
  assert.ok(!buildInsights({ ...full, flow: flowOf({ ...over, over: false, weeksOver: 1 }) }).some(i => /opened than shipped/.test(i.title)));
});
