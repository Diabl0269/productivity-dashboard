/**
 * cli/test/run-plan.test.js
 * Tests for shared/run-plan.js (computeRunPlan) and `ch tasks runplan`.
 * Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { computeRunPlan, isPickGate } from '../../shared/run-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

function task(id, extra = {}) {
  return { id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], ...extra };
}
function epic(id, extra = {}) { return task(id, { type: 'epic', title: `Epic ${id}`, ...extra }); }
function mkDoc(tasks, pinned) {
  return {
    version: 1,
    meta: { dailyPlan: { date: '2026-01-01', taskIds: pinned, carriedIds: [] } },
    sections: [{ id: 'todo', name: 'Todo', tasks }],
  };
}
const find = (plan, id) => plan.lanes.flatMap(l => l.epics).find(e => e.id === id);

test('ready epic lists open children in dependency order', () => {
  const doc = mkDoc([
    epic('E1'),
    task('T3', { parentId: 'E1', blockedBy: ['T2'] }),
    task('T2', { parentId: 'E1' }),
    task('T4', { parentId: 'E1', checked: true }),
  ], ['E1']);
  const e = find(computeRunPlan(doc), 'E1');
  assert.equal(e.state, 'ready');
  assert.deepEqual(e.tickets.map(t => t.id), ['T2', 'T3']);
  assert.deepEqual(e.tickets[1].blockedBy, ['T2']);
  assert.equal(e.command, '/ship-task E1');
});

test('partial: child blocked only by a Co-task pick gate', () => {
  const doc = mkDoc([
    epic('E1'),
    task('T2', { parentId: 'E1', title: 'Co-task: pick a vendor' }),
    task('T3', { parentId: 'E1', blockedBy: ['T2'] }),
    task('T4', { parentId: 'E1' }),
  ], ['E1']);
  const plan = computeRunPlan(doc);
  const e = find(plan, 'E1');
  assert.equal(e.state, 'partial');
  assert.deepEqual(e.picks, ['T2']);
  assert.equal(e.tickets.find(t => t.id === 'T2').isPick, true);
  assert.equal(plan.readyCount, 1);
});

test('design label counts as a pick gate; plain blocker does not make partial', () => {
  assert.equal(isPickGate({ title: 'x', labels: ['Design'] }), true);
  assert.equal(isPickGate({ title: 'Design: colours' }), true);
  assert.equal(isPickGate({ title: 'Plain' }), false);
  const doc = mkDoc([
    epic('E1'),
    task('T2', { parentId: 'E1' }),
    task('T3', { parentId: 'E1', blockedBy: ['T2'] }),
  ], ['E1']);
  assert.equal(find(computeRunPlan(doc), 'E1').state, 'ready');
});

test('waiting: epic-level blockedBy an open epic, and flips when it closes', () => {
  const tasks = [
    epic('E1'), task('T2', { parentId: 'E1' }),
    epic('E5', { blockedBy: ['E1'] }), task('T6', { parentId: 'E5' }),
  ];
  const plan = computeRunPlan(mkDoc(tasks, ['E1', 'E5']));
  assert.equal(find(plan, 'E5').state, 'waiting');
  assert.deepEqual(find(plan, 'E5').waitingOn, ['E1']);
  assert.equal(plan.readyCount, 1);
  tasks[1].checked = true; // E1's only child done -> E1 done
  const after = computeRunPlan(mkDoc(tasks, ['E1', 'E5']));
  assert.equal(find(after, 'E5').state, 'ready');
  assert.deepEqual(after.doneEpics, ['E1']);
});

test('done: all children done, or epic itself checked', () => {
  const doc = mkDoc([
    epic('E1'), task('T2', { parentId: 'E1', checked: true }),
    epic('E3', { checked: true }),
    epic('E4'), task('T5', { parentId: 'E4' }),
  ], ['E1', 'E3', 'E4']);
  const plan = computeRunPlan(doc);
  assert.deepEqual(plan.doneEpics, ['E1', 'E3']);
  assert.deepEqual(plan.lanes.flatMap(l => l.epics.map(e => e.id)), ['E4']);
});

test('cross-epic child blocker makes the epic wait on the owning epic', () => {
  const doc = mkDoc([
    epic('E1'), task('T2', { parentId: 'E1' }),
    epic('E3'), task('T4', { parentId: 'E3', blockedBy: ['T2'] }),
  ], ['E1', 'E3']);
  const e = find(computeRunPlan(doc), 'E3');
  assert.equal(e.state, 'waiting');
  assert.deepEqual(e.waitingOn, ['E1']);
});

test('subtasks of children belong to the epic', () => {
  const doc = mkDoc([
    epic('E1'), task('T2', { parentId: 'E1', checked: true }),
    task('T3', { parentId: 'T2' }),
  ], ['E1']);
  const e = find(computeRunPlan(doc), 'E1');
  assert.deepEqual(e.tickets.map(t => t.id), ['T3']);
});

test('lanes: grouped by epic lane, ordered by after, first appearance, tie by id', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'alpha', blockedBy: ['E4'] }), task('T11', { parentId: 'E1' }),
    epic('E2', { lane: 'alpha' }), task('T12', { parentId: 'E2' }),
    epic('E3', { lane: 'beta' }), task('T13', { parentId: 'E3' }),
    epic('E4', { lane: 'alpha' }), task('T14', { parentId: 'E4' }),
  ], ['E1', 'E3', 'E2', 'E4']);
  const plan = computeRunPlan(doc);
  assert.deepEqual(plan.lanes.map(l => l.lane), ['alpha', 'beta']);
  assert.deepEqual(plan.lanes[0].epics.map(e => e.id), ['E2', 'E4', 'E1']);
});

test('epics without a lane go to "unassigned"', () => {
  const doc = mkDoc([epic('E1'), task('T2', { parentId: 'E1' })], ['E1']);
  assert.deepEqual(computeRunPlan(doc).lanes.map(l => l.lane), ['unassigned']);
});

test('cycles do not crash and keep every ticket and epic', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a', blockedBy: ['E2'] }), task('T3', { parentId: 'E1', blockedBy: ['T4'] }),
    task('T4', { parentId: 'E1', blockedBy: ['T3'] }),
    epic('E2', { lane: 'a', blockedBy: ['E1'] }), task('T5', { parentId: 'E2' }),
  ], ['E1', 'E2']);
  const plan = computeRunPlan(doc);
  assert.equal(plan.lanes[0].epics.length, 2);
  assert.deepEqual(find(plan, 'E1').tickets.map(t => t.id), ['T3', 'T4']);
});

test('unpinned epics are ignored; machineCap is configurable', () => {
  const doc = mkDoc([epic('E1'), task('T2', { parentId: 'E1' }), epic('E3')], ['E1']);
  assert.equal(computeRunPlan(doc).machineCap, 3);
  const plan = computeRunPlan(doc, { machineCap: 5 });
  assert.equal(plan.machineCap, 5);
  assert.equal(plan.lanes.length, 1);
});

test('CLI: ch tasks runplan --json and text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-runplan-'));
  const doc = mkDoc([
    epic('T1', { lane: 'alpha' }), task('T2', { parentId: 'T1' }),
  ], ['T1']);
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc));
  const run = args => spawnSync(process.execPath, [CH_SCRIPT, 'tasks', ...args], {
    env: { ...process.env, CH_HOME: dir }, encoding: 'utf8',
  });
  const j = run(['runplan', '--json']);
  assert.equal(j.status, 0, j.stderr);
  assert.equal(JSON.parse(j.stdout).lanes[0].epics[0].command, '/ship-task T1');
  const t = run(['runplan']);
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /Lane: alpha/);
  assert.match(t.stdout, /\/ship-task T1/);
});

test('dashboard tasks.json round-trip preserves lane', async () => {
  const { loadTasksJson, serializeTasksJson } = await import('../../dashboard/js/tasks-json.js');
  const doc = mkDoc([epic('T1', { lane: 'alpha' })], ['T1']);
  const mem = loadTasksJson(JSON.stringify(doc));
  assert.equal(mem.tasks.todo[0].lane, 'alpha');
  const out = JSON.parse(serializeTasksJson(mem.sections, mem.tasks, mem.ticketTypes, mem.meta));
  assert.equal(out.sections[0].tasks[0].lane, 'alpha');
});

test('dashboard routing knows the runplan tab', async () => {
  global.window = { location: { pathname: '/dashboard/runplan' }, history: { replaceState() {}, pushState() {} }, addEventListener() {} };
  const { parseRoute, buildPath } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.tab, 'runplan');
  assert.equal(buildPath(route), '/dashboard/runplan');
});
