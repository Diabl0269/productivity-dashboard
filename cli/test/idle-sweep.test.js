/**
 * cli/test/idle-sweep.test.js: PRO74. Forgotten stays set apart, batch runs credited, the two labels,
 * and `ch tasks sweep-idle` (shared/idle-sweep.js). Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitInProgress, sessionIntervals } from '../../shared/time-split.js';
import { batchFrom, summarizeSession } from '../../shared/session-metrics.js';
import { idleInProgress } from '../../shared/idle-sweep.js';
import { buildInsights } from '../../shared/insights.js';
import { flowMetrics } from '../../shared/flow-metrics.js';

const H = 3600 * 1000;
const NOW = Date.parse('2026-02-01T00:00:00.000Z');
const iso = (offH) => new Date(NOW + offH * H).toISOString();
const CH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ch');

const tk = (id, enteredH, over = {}) => ({
  id, title: `T ${id}`, type: 'task', project: 'p1', lane: 'l1', created: iso(enteredH - 1),
  history: [{ at: iso(enteredH - 1), event: 'created', to: 'todo' }, { at: iso(enteredH), event: 'moved', from: 'todo', to: 'in-progress' }], ...over,
});
const doc = (tasks) => ({ sections: [{ id: 'in-progress', tasks }], meta: {} });
const sess = (over) => ({ ticket: 'A1', end: iso(-1), intervals: { work: [], waitUser: [] }, ...over });

// ---------- batch attribution ----------

test('batchFrom: title and prompt forms; a single id is no batch', () => {
  assert.deepEqual(batchFrom({ title: 'autorun PRO71 FRO1745 PRO72' }), ['PRO71', 'FRO1745', 'PRO72']);
  assert.deepEqual(batchFrom({ firstPrompt: '/ship-task PRO71 auto FRO1745 PRO72' }), ['PRO71', 'FRO1745', 'PRO72']);
  assert.deepEqual(batchFrom({ title: 'autorun FRO1485' }), []);
  assert.deepEqual(batchFrom({ title: 'FRO830 - Macros and canvas drag' }), []);
});

test('summarizeSession stores the batch list from the title', () => {
  const line = (type, extra) => ({ sessionId: 's1', timestamp: iso(0), gitBranch: 'main', type, ...extra });
  const r = summarizeSession([
    { type: 'custom-title', customTitle: 'autorun EP1 BA1 BA2', sessionId: 's1' },
    line('user', { origin: { kind: 'human' }, message: { content: '/ship-task EP1 auto BA1 BA2' } }),
    line('assistant', { message: { content: [{ type: 'text', text: 'a' }] } }),
  ]);
  assert.deepEqual(r.batch, ['EP1', 'BA1', 'BA2']);
});

test('sessionIntervals: a batch session credits every id in its batch, a plain session only its own', () => {
  const w = [[NOW - 5 * H, NOW - 4 * H, 'EP1']];
  const m = sessionIntervals([{ title: 'autorun EP1 BA1 BA2', intervals: { work: w } }], 'work');
  assert.deepEqual([...m.keys()].sort(), ['BA1', 'BA2', 'EP1']);
  const plain = sessionIntervals([{ title: 'EP1 - x', intervals: { work: w } }], 'work');
  assert.deepEqual([...plain.keys()], ['EP1']);
  const stored = sessionIntervals([{ batch: ['EP1', 'BA9'], intervals: { work: w } }], 'work');
  assert.deepEqual([...stored.keys()].sort(), ['BA9', 'EP1']);
});

test('splitInProgress: a batch ticket with no session of its own is credited the batch run', () => {
  const sessions = [{ title: 'autorun EP1 BA1', intervals: { work: [[NOW - 6 * H, NOW - 2 * H, 'EP1']], waitUser: [] } }];
  const r = splitInProgress({ doc: doc([tk('BA1', -8)]), sessions, now: NOW, since: iso(-30) });
  assert.equal(r.total.workingH, 4);
  assert.equal(r.total.idleH, 4);
});

// ---------- forgotten stays ----------

test('splitInProgress: a stay over 72 h with no session work is forgotten and left out of every total', () => {
  const sessions = [{ intervals: { work: [[NOW - 5 * H, NOW - 3 * H, 'W1']], waitUser: [] } }];
  const r = splitInProgress({ doc: doc([tk('F1', -100), tk('W1', -10), tk('S1', -50)]), sessions, now: NOW, since: iso(-200) });
  assert.deepEqual(r.forgotten.tickets.map(g => g.ticket), ['F1']); // S1 is 50 h: under 72 h, stays in the totals
  assert.equal(r.forgotten.hours, 100);
  assert.deepEqual(r.byTicket.map(x => x.ticket).sort(), ['S1', 'W1']);
  assert.equal(r.total.hours, 60);
  assert.deepEqual(r.forgottenStays, [`F1|${iso(-100)}`]);
});

test('splitInProgress: a long stay with session work is not forgotten', () => {
  const sessions = [{ intervals: { work: [[NOW - 90 * H, NOW - 85 * H, 'L1']], waitUser: [] } }];
  const r = splitInProgress({ doc: doc([tk('L1', -100)]), sessions, now: NOW, since: iso(-200) });
  assert.equal(r.forgotten.n, 0);
  assert.equal(r.total.hours, 100);
  // under 2% of the stay worked (1 h of 100) still counts as forgotten
  const few = [{ intervals: { work: [[NOW - 90 * H, NOW - 89 * H, 'L1']], waitUser: [] } }];
  assert.equal(splitInProgress({ doc: doc([tk('L1', -100)]), sessions: few, now: NOW, since: iso(-200) }).forgotten.n, 1);
});

test('flowMetrics skipStays leaves a forgotten in-progress stay out of the in-progress total and bottleneck share', () => {
  const d = { sections: [{ id: 'in-progress', tasks: [tk('F1', -100)] }], meta: {} };
  const all = flowMetrics(d, { now: NOW, since: iso(-200) });
  const fixed = flowMetrics(d, { now: NOW, since: iso(-200), skipStays: new Set([`F1|${iso(-100)}`]) });
  assert.equal(all.stages['in-progress'].totalHours, 100);
  assert.equal(fixed.stages['in-progress'].totalHours, 0);
  assert.equal(fixed.bottleneck, null);
});

// ---------- labels ----------

test('labels: average ticket and all in-progress hours in the insight and the CLI', () => {
  const total = { hours: 100, workingH: 5, ciH: 10, youH: 23, idleH: 62, shares: { working: 0.05, ci: 0.1, you: 0.23, idle: 0.62 } };
  const typical = { n: 3, medianHours: 4, shares: { working: 0.4, ci: 0.2, you: 0.1, idle: 0.3 } };
  const f = { stages: {}, groups: {}, backlog: {}, inProgressSplit: { total, typical, byTicket: [] } };
  const i = buildInsights({ flow: f, sources: {} }).find(x => /^Average ticket/.test(x.title));
  assert.ok(i);
  assert.match(i.detail, /All in-progress hours:/);
  assert.doesNotMatch(i.detail, /typical ticket/i);
  const src = fs.readFileSync(path.join(path.dirname(CH), 'dashboard/js/metrics-time-view.js'), 'utf8');
  assert.match(src, /Average ticket/);
  assert.match(src, /All in-progress hours/);
});

// ---------- idle sweep ----------

test('idleInProgress: idle 24 h swept; recent entry, recent session work, batch session and epics kept', () => {
  const d = doc([
    tk('OLD', -48), tk('NEW', -2), tk('WRK', -48), tk('BAT1', -48), tk('EP', -48, { type: 'epic' }), tk('RUN', -48),
  ]);
  const sessions = [
    sess({ ticket: 'WRK', end: iso(-30), intervals: { work: [[NOW - 3 * H, NOW - 2 * H, 'WRK']], waitUser: [] } }),
    sess({ ticket: 'EP9', title: 'autorun EP9 BAT1', end: iso(-40), intervals: { work: [[NOW - 4 * H, NOW - 3 * H, 'EP9']], waitUser: [] } }),
    sess({ ticket: 'RUN', end: iso(-1), intervals: { work: [], waitUser: [] } }), // old record shape: only `end`
  ];
  const rows = idleInProgress({ doc: d, sessions, now: NOW, hours: 24 });
  assert.deepEqual(rows.map(r => r.id), ['OLD']);
  assert.equal(rows[0].idleHours, 48);
});

test('idleInProgress: a ticket nobody ever worked is swept once it has sat past the limit', () => {
  const rows = idleInProgress({ doc: doc([tk('Z1', -100)]), sessions: [sess({ ticket: 'Q1' })], now: NOW, hours: 24 });
  assert.deepEqual(rows.map(r => r.id), ['Z1']);
});

function ch(home, ...args) {
  return spawnSync(process.execPath, [CH, 'tasks', ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
}
function sweepHome(sessions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-sweep-'));
  const now = Date.now();
  const at = (h) => new Date(now + h * H).toISOString();
  const t = (id, h) => ({ id, title: `T ${id}`, checked: false, priority: 'medium', created: at(h - 1).slice(0, 10), updated: null, subtasks: [],
    history: [{ at: at(h - 1), event: 'created', to: 'todo' }, { at: at(h), event: 'moved', from: 'todo', to: 'in-progress' }] });
  const epic = { ...t('T9', -72), type: 'epic' };
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ version: 1, sections: [
    { id: 'todo', name: 'To do', tasks: [] }, { id: 'in-progress', name: 'In progress', tasks: [t('T1', -72), t('T2', -72), epic] }] }));
  fs.mkdirSync(path.join(dir, 'metrics'));
  if (sessions) {
    const live = { key: 's1', sessionId: 's1', ticket: 'T2', start: at(-3), end: at(-1), intervals: { work: [[now - 3 * H, now - 1 * H, 'T2']], waitUser: [] } };
    fs.writeFileSync(path.join(dir, 'metrics', 'sessions.jsonl'), JSON.stringify(live) + '\n');
  }
  return dir;
}

test('ch tasks sweep-idle --dry-run lists and changes nothing; a real run moves back to todo with a decision', () => {
  const dir = sweepHome(true);
  const before = fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8');
  const dry = ch(dir, 'sweep-idle', '--dry-run', '--json');
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout).idle.map(r => r.id), ['T1']);
  assert.equal(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'), before);

  const run = ch(dir, 'sweep-idle', '--no-collect', '--json');
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).moved, ['T1']);
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
  const sec = (id) => doc.sections.find(s => s.id === id).tasks.map(t => t.id).sort();
  assert.deepEqual(sec('todo'), ['T1']);
  assert.deepEqual(sec('in-progress'), ['T2', 'T9']); // epic and the live ticket stay
  const moved = doc.sections.find(s => s.id === 'todo').tasks[0];
  assert.match(moved.decisions[0].text, /Idle sweep: moved back to todo, no session work for 24\+ hours/);
  assert.equal(moved.history.at(-1).to, 'todo');
  // second run: nothing left
  assert.match(ch(dir, 'sweep-idle', '--no-collect').stdout, /No in-progress ticket idle/);
});

test('ch tasks sweep-idle refuses without session data and rejects a bad --hours', () => {
  const dir = sweepHome(false);
  const r = ch(dir, 'sweep-idle', '--no-collect');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no session data/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).sections[1].tasks.length, 3);
  assert.notEqual(ch(sweepHome(true), 'sweep-idle', '--hours', '0').status, 0);
});
