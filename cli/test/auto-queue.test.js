/**
 * cli/test/auto-queue.test.js
 * PRO63: Auto priority (High/Normal/Low) and autoRank on epics: start order, `ch tasks update
 * --auto-priority/--auto-rank`, `ch tasks ready`, the split store, and the queue's move logic.
 * Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { autoQueueOrder, openEpicReadiness, autoPriorityOf, autoRankOf } from '../../shared/epic-ready.js';
import { autoQueue, groupQueue, moveInQueue, stepTarget } from '../../shared/auto-queue.js';
import { migrateToSplit } from '../../shared/tasks-files.js';
import { loadTasksJson, serializeTasksJson } from '../../dashboard/js/tasks-json.js';

const CH_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ch');
const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane: 'a', description: '', labels: ['auto', 'model:sonnet'], ...extra });
const mk = (todo) => ({ version: 1, meta: { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } }, sections: [{ id: 'todo', name: 'todo', tasks: todo }] });
const withKids = (...epics) => mk(epics.flatMap(e => [e, task(`${e.id}0`, { parentId: e.id })]));
const row = (id, priority, autoRank = null, extra = {}) => ({ id, priority, autoRank, auto: true, ...extra });

// --- ordering ----------------------------------------------------------------------------

test('autoQueueOrder: priority, then autoRank, then the order given; unranked after ranked', () => {
  const input = [row('A', 'low', 1), row('B', 'normal'), row('C', 'high', 2), row('D', 'high', 1), row('E', 'normal', 5), row('F', 'normal')];
  assert.deepEqual(autoQueueOrder(input).map(r => r.id), ['D', 'C', 'E', 'B', 'F', 'A']);
  assert.deepEqual(input.map(r => r.id), ['A', 'B', 'C', 'D', 'E', 'F'], 'input is not mutated');
  assert.deepEqual(autoQueueOrder([{ id: 'X', priority: 'weird' }, row('Y', 'high')]).map(r => r.id), ['Y', 'X'], 'unknown = normal');
  assert.deepEqual(autoQueueOrder([]), []);
});

test('readiness carries priority (missing = normal) and autoRank (missing = null)', () => {
  const doc = withKids(epic('E1'), epic('E2', { autoPriority: 'high', autoRank: 3 }), epic('E3', { autoPriority: 'bogus', autoRank: 'x' }));
  const r = openEpicReadiness(doc);
  assert.deepEqual(r.map(e => [e.id, e.priority, e.autoRank]), [['E1', 'normal', null], ['E2', 'high', 3], ['E3', 'normal', null]]);
  assert.equal(r[0].auto && r[0].ready, true);
  assert.equal(autoPriorityOf({ autoPriority: 'LOW' }), 'low');
  assert.equal(autoRankOf({ autoRank: NaN }), null);
});

// --- move logic --------------------------------------------------------------------------

const Q = () => [row('H1', 'high', 1), row('H2', 'high', 2), row('N1', 'normal', 1), row('N2', 'normal', 2), row('N3', 'normal'), row('L1', 'low', 1)];

test('moveInQueue: within a group renumbers that group only', () => {
  const { order, changes } = moveInQueue(Q(), 'N3', { priority: 'normal', index: 0 });
  assert.deepEqual(order, ['H1', 'H2', 'N3', 'N1', 'N2', 'L1']);
  assert.deepEqual(changes, [{ id: 'N3', priority: 'normal', autoRank: 1 }, { id: 'N1', priority: 'normal', autoRank: 2 }, { id: 'N2', priority: 'normal', autoRank: 3 }]);
});

test('moveInQueue: into another group changes priority and renumbers both groups', () => {
  const { order, changes } = moveInQueue(Q(), 'N1', { priority: 'high', index: 1 });
  assert.deepEqual(order, ['H1', 'N1', 'H2', 'N2', 'N3', 'L1']);
  const by = Object.fromEntries(changes.map(c => [c.id, [c.priority, c.autoRank]]));
  assert.deepEqual(by, { N1: ['high', 2], H2: ['high', 3], N2: ['normal', 1], N3: ['normal', 2] });
});

test('moveInQueue: into an empty group, clamps the index, ignores no-ops and unknown ids', () => {
  const q = [row('A', 'high', 1), row('B', 'high', 2)];
  assert.deepEqual(moveInQueue(q, 'A', { priority: 'low', index: 99 }).changes, [{ id: 'B', priority: 'high', autoRank: 1 }, { id: 'A', priority: 'low', autoRank: 1 }]);
  assert.deepEqual(moveInQueue(q, 'A', { priority: 'high', index: 0 }).changes, [], 'already there');
  assert.deepEqual(moveInQueue(q, 'ZZ', { priority: 'high', index: 0 }).changes, []);
  assert.deepEqual(moveInQueue(q, 'B', { priority: 'high', index: -4 }).order, ['B', 'A']);
});

test('moveInQueue: the result sorts back into the same order through autoQueueOrder', () => {
  const q = Q();
  const { order, changes } = moveInQueue(q, 'L1', { priority: 'normal', index: 1 });
  const after = q.map(r => ({ ...r, ...(changes.find(c => c.id === r.id) || {}) }));
  assert.deepEqual(autoQueueOrder(after).map(r => r.id), order);
});

test('stepTarget: one place, then across the group edge, null at the very ends', () => {
  const q = Q();
  assert.deepEqual(stepTarget(q, 'N2', -1), { priority: 'normal', index: 0 });
  assert.deepEqual(stepTarget(q, 'N1', -1), { priority: 'high', index: 2 });
  assert.deepEqual(stepTarget(q, 'N3', 1), { priority: 'low', index: 0 });
  assert.equal(stepTarget(q, 'H1', -1), null);
  assert.equal(stepTarget(q, 'L1', 1), null);
  assert.equal(stepTarget(q, 'nope', 1), null);
  // an empty group in the way is still a stop (it is shown, so the row can land in it)
  const r = [row('A', 'high', 1), row('B', 'low', 1)];
  assert.deepEqual(stepTarget(r, 'A', 1), { priority: 'normal', index: 0 });
});

test('autoQueue / groupQueue: only Auto epics, grouped in start order', () => {
  const doc = withKids(epic('E1', { autoPriority: 'low' }), epic('E2', { labels: ['model:sonnet'] }), epic('E3', { autoPriority: 'high' }), epic('E4'));
  const q = autoQueue(openEpicReadiness(doc));
  assert.deepEqual(q.map(r => r.id), ['E3', 'E4', 'E1']);
  const g = groupQueue(q);
  assert.deepEqual([g.high.length, g.normal.length, g.low.length], [1, 1, 1]);
});

// --- CLI ---------------------------------------------------------------------------------

const home = (doc, split = false) => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-aq-'));
  fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc));
  if (split) migrateToSplit(h, { moveSingleTo: path.join(h, 'tasks.json.bak') });
  return h;
};
const ch = (h, ...args) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: h }, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const cliDoc = () => withKids(epic('T1', { lane: 'a' }), epic('T3', { lane: 'b' }), epic('T5', { lane: 'c' }), epic('T7', { lane: 'd', labels: ['model:sonnet'] }));

for (const split of [false, true]) {
  test(`CLI (${split ? 'split store' : 'tasks.json'}): --auto-priority and --auto-rank save, order ch tasks ready, and lint stays valid`, () => {
    const h = home(cliDoc(), split);
    assert.equal(ch(h, 'tasks', 'update', 'T5', '--auto-priority', 'high').status, 0);
    assert.equal(ch(h, 'tasks', 'update', 'T3', '--auto-priority', 'low', '--auto-rank', '2').status, 0);
    assert.equal(ch(h, 'tasks', 'update', 'T1', '--auto-rank', '1.5').status, 0);
    const json = JSON.parse(ch(h, 'tasks', 'ready', '--json').out);
    assert.deepEqual(json.epics.map(e => [e.id, e.priority, e.autoRank]), [['T5', 'high', null], ['T1', 'normal', 1.5], ['T3', 'low', 2], ['T7', 'normal', null]]);
    assert.deepEqual(JSON.parse(ch(h, 'tasks', 'ready', '--json', '--auto').out).epics.map(e => e.id), ['T5', 'T1', 'T3']);
    assert.match(ch(h, 'tasks', 'ready').out, /T5 .*\[auto high\]/);
    assert.equal(ch(h, 'tasks', 'lint').status, 0, ch(h, 'tasks', 'lint').err);
    if (split) assert.match(fs.readFileSync(path.join(h, 'tasks.d', 'tickets', 'T3.json'), 'utf8'), /"autoPriority": "low"/);

    assert.equal(ch(h, 'tasks', 'update', 'T3', '--clear-auto-rank').status, 0);
    assert.equal(JSON.parse(ch(h, 'tasks', 'ready', '--json').out).epics.find(e => e.id === 'T3').autoRank, null);
  });
}

test('CLI: bad values are refused (priority, rank, non-epic) and the ticket --priority is unchanged', () => {
  const h = home(mk([epic('T1'), task('T10', { parentId: 'T1' }), task('T9')]));
  assert.notEqual(ch(h, 'tasks', 'update', 'T1', '--auto-priority', 'urgent').status, 0);
  assert.match(ch(h, 'tasks', 'update', 'T1', '--auto-priority', 'medium').err, /high, normal, low/);
  assert.notEqual(ch(h, 'tasks', 'update', 'T1', '--auto-rank', 'abc').status, 0);
  assert.notEqual(ch(h, 'tasks', 'update', 'T1', '--auto-rank', '').status, 0);
  assert.match(ch(h, 'tasks', 'update', 'T9', '--auto-priority', 'high').err, /not an epic/);
  assert.equal(ch(h, 'tasks', 'update', 'T1', '--priority', 'high').status, 0, 'ticket priority still low/medium/high');
  assert.notEqual(ch(h, 'tasks', 'update', 'T1', '--priority', 'normal').status, 0);
  assert.equal(ch(h, 'tasks', 'lint').status, 0);
});

test('lint rejects a hand-edited bad autoPriority / autoRank', () => {
  const h = home(mk([epic('T1', { autoPriority: 'urgent', autoRank: 'first' })]));
  const r = ch(h, 'tasks', 'lint');
  assert.notEqual(r.status, 0);
  assert.match(r.err + r.out, /autoPriority/);
  assert.match(r.err + r.out, /autoRank/);
});

// --- dashboard round trip ----------------------------------------------------------------

test('dashboard load/save keeps autoPriority and autoRank, and drops empty ones', () => {
  const doc = mk([epic('T1', { autoPriority: 'high', autoRank: 2 }), epic('T2')]);
  const loaded = loadTasksJson(JSON.stringify(doc));
  const t = id => loaded.tasks.todo.find(x => x.taskId === id);
  assert.deepEqual([t('T1').autoPriority, t('T1').autoRank, t('T2').autoPriority, t('T2').autoRank], ['high', 2, null, null]);
  const out = JSON.parse(serializeTasksJson(loaded.sections, loaded.tasks, loaded.ticketTypes, loaded.meta));
  const o = id => out.sections.find(s => s.id === 'todo').tasks.find(x => x.id === id);
  assert.deepEqual([o('T1').autoPriority, o('T1').autoRank], ['high', 2]);
  assert.equal('autoPriority' in o('T2') || 'autoRank' in o('T2'), false);
  t('T1').autoPriority = null; t('T1').autoRank = null;
  const cleared = JSON.parse(serializeTasksJson(loaded.sections, loaded.tasks, loaded.ticketTypes, loaded.meta));
  assert.equal('autoPriority' in cleared.sections[0].tasks.find(x => x.id === 'T1'), false);
});
