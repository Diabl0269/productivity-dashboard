/**
 * cli/test/time-split.test.js: where in-progress time goes (shared/time-split.js), the session
 * intervals it reads, the insight, the payload field and `ch metrics flow` / `cost`. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarizeSession } from '../../shared/session-metrics.js';
import { splitInProgress, splitStay, ciTicket, ciIntervals } from '../../shared/time-split.js';
import { buildInsights } from '../../shared/insights.js';
import { summarizeHelperUsage, applyHelpers } from '../../shared/session-metrics.js';
import { buildMetricsPayload } from '../../shared/metrics-payload.js';

const H = 3600 * 1000;
const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const ms = (min) => T0 + min * 60000;
const base = (min, extra) => ({ sessionId: 's1', timestamp: at(min), gitBranch: 'main', ...extra });
const human = (min) => base(min, { type: 'user', origin: { kind: 'human' }, message: { content: 'x' } });
const asst = (min, blocks = [{ type: 'text', text: 'a' }]) => base(min, { type: 'assistant', message: { content: blocks } });
const tool = (min, id, name, input = {}) => asst(min, [{ type: 'tool_use', id, name, input }]);
const result = (min, id) => base(min, { type: 'user', message: { content: [{ type: 'tool_result', content: 'r', tool_use_id: id }] } });
const stop = (min) => base(min, { type: 'system', subtype: 'stop_hook_summary' });
const titled = (t) => ({ type: 'custom-title', customTitle: t, sessionId: 's1' });

// ---------- session intervals ----------

test('intervals: work is the open turn, waitUser the reply wait', () => {
  const r = summarizeSession([titled('PRO51 - x'), human(0), asst(5), stop(10), human(40), asst(42), stop(50)]);
  assert.deepEqual(r.intervals.work, [[ms(0), ms(10), 'PRO51'], [ms(40), ms(50), 'PRO51']]);
  assert.deepEqual(r.intervals.waitUser, [[ms(10), ms(40), 'PRO51']]);
});

test('intervals: a pending question moves its gap from work to waitUser (even under the stall threshold)', () => {
  const r = summarizeSession([titled('PRO51 - x'), human(0), tool(2, 'q1', 'AskUserQuestion'), result(8, 'q1'), asst(9), stop(12)]);
  assert.deepEqual(r.intervals.work, [[ms(0), ms(2), 'PRO51'], [ms(8), ms(12), 'PRO51']]);
  assert.deepEqual(r.intervals.waitUser, [[ms(2), ms(8), 'PRO51']]);
  assert.equal(r.activeMin, 12); // the existing active total is unchanged
});

test('intervals: a ch tasks move X in-progress switches the ticket and splits the stretch it falls in', () => {
  const mv = tool(5, 'b1', 'Bash', { command: 'CH_HOME=/x ./ch tasks move FRO7 in-progress' });
  const r = summarizeSession([titled('EPC1 - epic run'), human(0), asst(1), mv, result(6, 'b1'), asst(8), stop(10)]);
  assert.deepEqual(r.intervals.work, [[ms(0), ms(5), 'EPC1'], [ms(5), ms(10), 'FRO7']]);
});

test('intervals: close same-ticket neighbours merge, a long gap does not; no ticket, no intervals', () => {
  const r = summarizeSession([titled('PRO51 - x'), human(0), stop(2), human(2.5), stop(4), human(30), stop(31)]);
  assert.deepEqual(r.intervals.work, [[ms(0), ms(4), 'PRO51'], [ms(30), ms(31), 'PRO51']]);
  const none = summarizeSession([human(0), stop(2)]);
  assert.deepEqual(none.intervals, { work: [], waitUser: [] });
});

// ---------- the split ----------

test('splitStay: precedence working > CI > you > nothing, a moment counted once', () => {
  const a = 0;
  const b = 100 * 1000;
  const p = splitStay(a, b, {
    work: [[0, 30000]],
    ci: [[20000, 50000]], // 20-30 s overlaps working
    you: [[40000, 70000]], // 40-50 s overlaps CI
  });
  assert.deepEqual(p, { working: 30000, ci: 20000, you: 20000, idle: 30000 });
  assert.equal(p.working + p.ci + p.you + p.idle, b - a);
});

test('splitStay: intervals are clipped to the stay', () => {
  const p = splitStay(1000, 2000, { work: [[0, 1500], [1900, 5000]], ci: [[0, 10000]] });
  assert.deepEqual(p, { working: 600, ci: 400, you: 0, idle: 0 });
});

test('ciTicket maps the branch to a ticket; cancelled runs count; main and no-id branches do not', () => {
  assert.equal(ciTicket({ branch: 'fix/fro1610-mod-dot-menus' }), 'FRO1610');
  assert.equal(ciTicket({ branch: 'pro51-time-split' }), 'PRO51');
  assert.equal(ciTicket({ branch: 'main' }), null);
  const map = ciIntervals([
    { kind: 'ci', at: at(0), seconds: 60, branch: 'pro51-x', ok: null },
    { kind: 'ci', at: at(5), seconds: 60, branch: 'main' },
    { kind: 'gate', at: at(5), seconds: 60, branch: 'pro51-x' },
  ]);
  assert.deepEqual([...map], [['PRO51', [[ms(0), ms(1)]]]]);
});

const NOW = ms(600); // 10 h after T0
const doc = (tasks) => ({ sections: [{ id: 'in-progress', tasks }], meta: {} });
const tk = (id, over = {}) => ({
  id, title: `T ${id}`, type: 'task', project: 'p1', lane: 'l1', created: at(0),
  history: [{ at: at(0), event: 'created', to: 'todo' }, { at: at(60), event: 'moved', from: 'todo', to: 'in-progress' }], ...over,
});

test('splitInProgress: four categories from sessions and CI, idle is the remainder', () => {
  const sessions = [{
    intervals: {
      work: [[ms(60), ms(120), 'AB1']], // 1 h
      waitUser: [[ms(120), ms(240), 'AB1'], [ms(100), ms(130), 'AB1']], // 2 h, one overlaps the other and working
    },
  }];
  const timings = [{ kind: 'ci', at: at(130), seconds: 3600, branch: 'ab1-feature', ok: null }]; // 1 h, overlaps waitUser
  const r = splitInProgress({ doc: doc([tk('AB1')]), sessions, timings, now: NOW, since: at(0) });
  // stay = 60..600 min = 9 h. working 60-120 (1 h); CI 130-190; you = (100-240) minus working and CI.
  assert.equal(r.total.hours, 9);
  assert.equal(r.total.workingH, 1);
  assert.equal(r.total.ciH, 1);
  assert.equal(r.total.youH, 1); // 120-130 and 190-240 = 10 + 50 min
  assert.equal(r.total.idleH, 6);
  assert.equal(r.total.shares.idle, 0.667);
  assert.deepEqual(r.byTicket.map(x => x.ticket), ['AB1']);
  assert.equal(r.byTicket[0].open, true);
  assert.equal(r.sessionsWithIntervals, 1);
});

test('splitInProgress: only in-progress stays, clipped to the window; epics, other projects and other tickets excluded', () => {
  const closed = tk('B1', { history: [
    { at: at(0), event: 'created', to: 'todo' }, { at: at(60), event: 'moved', from: 'todo', to: 'in-progress' },
    { at: at(180), event: 'moved', from: 'in-progress', to: 'review' }] });
  const epic = tk('E1', { type: 'epic' });
  const other = tk('C1', { project: 'p2' });
  const sessions = [{ intervals: { work: [[ms(0), ms(600), 'B1'], [ms(0), ms(600), 'ZZ9']], waitUser: [] } }];
  const r = splitInProgress({ doc: doc([closed, epic, other]), sessions, timings: [], now: NOW, since: at(120), project: 'p1' });
  // window starts at minute 120; B1 was in progress 120..180 only: 1 h, all working. No E1, no C1.
  assert.deepEqual(r.byTicket.map(x => [x.ticket, x.hours, x.workingH]), [['B1', 1, 1]]);
  assert.equal(r.total.shares.working, 1);
});

test('splitInProgress: byTicket is sorted by idle hours; byProject and byArea sum the tickets', () => {
  const sessions = [{ intervals: { work: [[ms(60), ms(300), 'A1']], waitUser: [] } }];
  const r = splitInProgress({
    doc: doc([tk('A1'), tk('A2', { project: 'p2', lane: 'l2' })]), sessions, timings: [], now: NOW, since: at(0), areas: { l2: 'Web' },
  });
  assert.deepEqual(r.byTicket.map(x => x.ticket), ['A2', 'A1']);
  assert.equal(r.byProject.p1.workingH, 4);
  assert.equal(r.byArea.Web.idleH, 9);
  assert.equal(r.byArea.other.idleH, 5);
});

// ---------- helpers and the typical ticket ----------

const hl = (min) => ({ type: 'assistant', timestamp: at(min), message: { content: [{ type: 'text', text: 'h' }] } });

test('helper spans: cut at silences of stallMinutes, so a dead helper does not count', () => {
  const h = summarizeHelperUsage([hl(0), hl(5), hl(10), hl(60), hl(65)]);
  assert.deepEqual(h.spans, [[ms(0), ms(10)], [ms(60), ms(65)]]);
  assert.deepEqual(summarizeHelperUsage([hl(0), hl(30)], { stallMinutes: 40 }).spans, [[ms(0), ms(30)]]);
});

test('applyHelpers adds helper spans to work, tagged by the ticket current at the helper start', () => {
  const mv = tool(5, 'b1', 'Bash', { command: './ch tasks move FRO7 in-progress' });
  const rec = summarizeSession([titled('EPC1 - run'), human(0), mv, result(6, 'b1'), stop(8)]);
  const early = summarizeHelperUsage([hl(2), hl(4)]); // before the switch: EPC1
  const late = summarizeHelperUsage([hl(20), hl(35)]); // after: FRO7 (main session sat between turns)
  applyHelpers(rec, [early, late]);
  assert.deepEqual(rec.intervals.work, [[ms(0), ms(5), 'EPC1'], [ms(5), ms(8), 'FRO7'], [ms(20), ms(35), 'FRO7']]);
});

test('typical: average share over tickets whose stay closed; open stays (forgotten tickets) do not count', () => {
  const closedWith = (id, workMin) => ({ id, work: [[ms(60), ms(60 + workMin), id]] });
  const mk = (id) => tk(id, { history: [
    { at: at(0), event: 'created', to: 'todo' }, { at: at(60), event: 'moved', from: 'todo', to: 'in-progress' },
    { at: at(160), event: 'moved', from: 'in-progress', to: 'review' }] }); // 100 min stay
  const sessions = [{ intervals: { work: [...[closedWith('CA1', 50), closedWith('CB1', 60), closedWith('CC1', 100)].flatMap(x => x.work)], waitUser: [] } }];
  const r = splitInProgress({ doc: doc([mk('CA1'), mk('CB1'), mk('CC1'), tk('OLD1')]), sessions, timings: [], now: NOW, since: at(0) });
  assert.equal(r.typical.n, 3);
  assert.equal(r.typical.shares.working, 0.7); // mean of 0.5, 0.6, 1.0 (the median would be 0.6)
  assert.equal(r.typical.shares.idle, 0.3);
  const sh = r.typical.shares;
  assert.ok(Math.abs(sh.working + sh.ci + sh.you + sh.idle - 1) < 0.002); // the shares add up to 100%
  assert.equal(r.typical.medianHours, 1.67);
  assert.ok(r.total.shares.idle > 0.7); // the forgotten open ticket dominates the total
  const none = splitInProgress({ doc: doc([tk('OLD1')]), sessions: [], timings: [], now: NOW, since: at(0) });
  assert.equal(none.typical.n, 0);
  assert.equal(none.typical.shares.idle, null);
});

test('insight leads with the typical ticket and points at stale tickets for the total', () => {
  const total = { hours: 100, workingH: 5, ciH: 10, youH: 23, idleH: 62, shares: { working: 0.05, ci: 0.1, you: 0.23, idle: 0.62 } };
  const typical = { n: 12, medianHours: 4, shares: { working: 0.4, ci: 0.2, you: 0.1, idle: 0.3 } };
  const f = { stages: {}, groups: {}, backlog: {}, inProgressSplit: { total, typical, byTicket: [{ ticket: 'A1', idleH: 30 }] } };
  const [i] = buildInsights({ flow: f, sources: {} }).filter(x => x.title.startsWith('Average ticket'));
  assert.equal(i.title, 'Average ticket: nobody working on it 30% of its time in progress');
  assert.equal(i.kind, 'info');
  assert.match(i.detail, /working 40%, CI 20%, waiting on you 10%, nobody working on it 30%/);
  assert.match(i.detail, /forgotten stays/);
});

// ---------- insight and payload ----------

test('insight: names the idle share, the biggest other part and CI longer than working', () => {
  const total = { hours: 100, workingH: 5, ciH: 10, youH: 23, idleH: 62, shares: { working: 0.05, ci: 0.1, you: 0.23, idle: 0.62 } };
  const flow = { stages: {}, groups: {}, backlog: {}, inProgressSplit: { total, byTicket: [{ ticket: 'A1', idleH: 30 }] } };
  const [i] = buildInsights({ flow, sources: {} }).filter(x => x.title.startsWith('Nobody was working on it'));
  assert.equal(i.title, 'Nobody was working on it for 62% of in-progress time');
  assert.equal(i.kind, 'warn');
  assert.match(i.detail, /biggest part besides that is waiting on you: 23\.0 h \(23%\)/);
  assert.match(i.detail, /Waiting on CI is longer than the sessions spent working/);
  assert.match(i.detail, /Most idle: A1 \(30\.0 h\)/);
});

test('insight: silent without any session or CI time (all idle would mislead)', () => {
  const total = { hours: 100, workingH: 0, ciH: 0, youH: 0, idleH: 100, shares: { working: 0, ci: 0, you: 0, idle: 1 } };
  const list = buildInsights({ flow: { stages: {}, groups: {}, backlog: {}, inProgressSplit: { total, byTicket: [] } }, sources: {} });
  assert.equal(list.filter(x => x.title.startsWith('Nobody was working on it')).length, 0);
});

test('payload carries flow.inProgressSplit from sessions and CI records', () => {
  const sessions = [{ key: 's1', start: at(60), ticket: 'AB1', intervals: { work: [[ms(60), ms(180), 'AB1']], waitUser: [] } }];
  const timings = [{ kind: 'ci', at: at(200), seconds: 1800, branch: 'ab1-x', ok: true }];
  const p = buildMetricsPayload({ doc: doc([tk('AB1')]), sessions, timings, cfg: {}, now: NOW, since: at(0) });
  const t = p.flow.inProgressSplit.total;
  assert.equal(t.workingH, 2);
  assert.equal(t.ciH, 0.5);
  assert.ok(p.insights.some(i => i.title.startsWith('Nobody was working on it for')));
});

// ---------- CLI ----------

const CH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ch');

test('ch metrics flow prints and returns the split; ch metrics cost <id> prints one line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-split-'));
  const now = Date.now();
  const iso = (offH) => new Date(now + offH * H).toISOString();
  const task = {
    id: 'A1', title: 'Split me', checked: false, priority: 'medium', created: iso(-20), updated: null, subtasks: [],
    history: [{ at: iso(-20), event: 'created', to: 'todo' }, { at: iso(-10), event: 'moved', from: 'todo', to: 'in-progress' }],
  };
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ version: 1, sections: [{ id: 'in-progress', name: 'In progress', tasks: [task] }] }));
  fs.mkdirSync(path.join(dir, 'metrics'));
  const session = {
    key: 's1', sessionId: 's1', ticket: 'A1', start: iso(-10), end: iso(-5), wallMin: 300, activeMin: 120, costUSD: 3, mainCostUSD: 3,
    byTicket: { A1: { costUSD: 3, tokens: 10, toolCalls: 2 } },
    intervals: { work: [[now - 10 * H, now - 8 * H, 'A1']], waitUser: [[now - 8 * H, now - 7 * H, 'A1']] },
  };
  fs.writeFileSync(path.join(dir, 'metrics', 'sessions.jsonl'), JSON.stringify(session) + '\n');
  const run = (...args) => spawnSync('node', [CH, 'metrics', ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });

  const j = run('flow', '--json');
  assert.equal(j.status, 0, j.stderr);
  const sp = JSON.parse(j.stdout).inProgressSplit;
  assert.equal(sp.total.workingH, 2);
  assert.equal(sp.total.youH, 1);
  assert.equal(sp.byTicket[0].ticket, 'A1');

  const text = run('flow');
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /All in-progress hours 10\.0 h \(forgotten stays left out\): working 2\.0 h \(20%\), CI 0 min \(0%\), waiting on you 1\.0 h \(10%\), nobody working on it 7\.0 h \(70%\)/);
  assert.match(text.stdout, /A1\s+10\.0 h\s+2\.0 h/);

  const cost = run('cost', 'A1');
  assert.equal(cost.status, 0, cost.stderr);
  assert.match(cost.stdout, /In progress 10\.0 h: working 2\.0 h, CI 0 min, you 1\.0 h, nothing 7\.0 h/);
});

// ---------- PRO87: "nobody working on it" splits into waiting its turn and left in progress ----------

const iso = (min) => new Date(ms(min)).toISOString();
const todoToProg = (id, parentId, from, to) => ({
  id, parentId, type: parentId ? 'task' : 'epic', title: `T ${id}`, project: 'demo', created: iso(0),
  history: [{ at: iso(0), event: 'created', to: 'todo' }, { at: iso(from), event: 'moved', from: 'todo', to: 'in-progress' }, ...(to == null ? [] : [{ at: iso(to), event: 'moved', from: 'in-progress', to: 'review' }])],
});
const sessionOn = (id, a, b, extra = {}) => ({ start: iso(a), intervals: { work: [[ms(a), ms(b), id]], waitUser: [] }, ...extra });
const split = (tasks, sessions) => splitInProgress({ doc: { sections: [{ id: 's', tasks }] }, sessions, timings: [], now: ms(1000), since: ms(0) });

test('idle split: a session on a sibling ticket of the same epic makes the idle time "waiting its turn"; no session is "left"', () => {
  const tasks = [
    { id: 'EPC1', type: 'epic', title: 'epic', project: 'demo', created: iso(0), history: [{ at: iso(0), event: 'created', to: 'todo' }] },
    todoToProg('AAA1', 'EPC1', 0, 600),   // 10 h in progress; a sibling runs for the first 4 h
    { ...todoToProg('LONE1', null, 0, 600), type: 'task' },    // no epic, no session
  ];
  const tasks2 = [...tasks, todoToProg('AAA2', 'EPC1', 0, 600)];
  const r2 = split(tasks2, [sessionOn('AAA2', 0, 240)]);
  const a1 = r2.byTicket.find((x) => x.ticket === 'AAA1');
  assert.equal(a1.idleH, 10);
  assert.equal(a1.waitingH, 4);
  assert.equal(a1.leftH, 6);
  const lone = r2.byTicket.find((x) => x.ticket === 'LONE1');
  assert.equal(lone.waitingH, 0);
  assert.equal(lone.leftH, 10);
  // waiting + left is the old idle number, and the four-part sum still covers every hour
  assert.equal(r2.total.waitingH + r2.total.leftH, r2.total.idleH);
  assert.ok(Math.abs(r2.total.shares.working + r2.total.shares.ci + r2.total.shares.you + r2.total.shares.waiting + r2.total.shares.left - 1) < 0.003);
});

test('idle split: a session on the epic card itself credits its children like a dispatcher batch', () => {
  const tasks = [
    { id: 'EPC1', type: 'epic', title: 'epic', project: 'demo', created: iso(0), history: [{ at: iso(0), event: 'created', to: 'todo' }] },
    todoToProg('AAA1', 'EPC1', 0, 600),
  ];
  const r = split(tasks, [sessionOn('EPC1', 60, 180)]); // a coordinator session on the epic for 2 h
  const a1 = r.byTicket.find((x) => x.ticket === 'AAA1');
  assert.equal(a1.waitingH, 2);
  assert.equal(a1.leftH, 8);
});

test('idle split: time a ticket was worked, waited on CI or on you is never counted as waiting its turn', () => {
  const tasks = [
    { id: 'EPC1', type: 'epic', title: 'epic', project: 'demo', created: iso(0), history: [{ at: iso(0), event: 'created', to: 'todo' }] },
    todoToProg('AAA1', 'EPC1', 0, 600),
    todoToProg('AAA2', 'EPC1', 0, 600),
  ];
  // both tickets worked 0-3 h by their own sessions; the sibling's 0-3 h must not turn AAA1's own work into "waiting"
  const r = split(tasks, [sessionOn('AAA1', 0, 180), sessionOn('AAA2', 0, 180)]);
  const a1 = r.byTicket.find((x) => x.ticket === 'AAA1');
  assert.equal(a1.workingH, 3);
  assert.equal(a1.waitingH, 0);
  assert.equal(a1.leftH, 7);
});

test('idle split: the top tickets of each bucket are listed, biggest first', () => {
  const tasks = [
    { id: 'EPC1', type: 'epic', title: 'epic', project: 'demo', created: iso(0), history: [{ at: iso(0), event: 'created', to: 'todo' }] },
    todoToProg('AAA1', 'EPC1', 0, 600), todoToProg('AAA2', 'EPC1', 0, 600), { ...todoToProg('LONE1', null, 0, 300), type: 'task' },
  ];
  const r = split(tasks, [sessionOn('AAA2', 0, 480)]);
  assert.equal(r.idleTop.waiting[0].ticket, 'AAA1');
  assert.equal(r.idleTop.waiting[0].hours, 8);
  assert.deepEqual(r.idleTop.left.map((g) => g.ticket), ['LONE1', 'AAA1', 'AAA2']);
});
