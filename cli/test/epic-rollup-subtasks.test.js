/**
 * cli/test/epic-rollup-subtasks.test.js
 * PRO32 (epic closes whichever way its last child closes), PRO34 (reviews need checks,
 * Unverified lines can be resolved), T191 (done refuses open subtasks), T192 (make a task
 * from a subtask). Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { rollUpAfterClose, resolveUnverified, clearUnverified } from '../../shared/review.js';
import {
  openSubtasks, openSubtasksMessage, splitSubtask, promoteSubtask, promoteSubtaskInState,
} from '../../shared/subtasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-pro31-test-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(dir, 'tasks.json'));
  return dir;
}

const readTasks = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));

function runCli(args, dir) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], {
    env: { ...process.env, CH_HOME: dir },
    encoding: 'utf8',
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? (r.error ? 2 : 0) };
}

function find(dir, id) {
  for (const s of readTasks(dir).sections) {
    const task = s.tasks.find(t => t.id === id);
    if (task) return { task, section: s.id };
  }
  return null;
}

/** Adds an epic (no project) and returns its id. */
function addEpic(dir, title = 'Epic E') {
  const r = runCli(['tasks', 'add', '--no-project', title, '--type', 'epic', '--lane', 'canvas', '--label', 'model:opus', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).id;
}

function addChild(dir, title, parent, extra = []) {
  const r = runCli(['tasks', 'add', '--no-project', title, '--parent', parent, ...extra, '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).id;
}

/** Epic with A (shipped through `review`, so the epic holds a result and a check) and an open B. */
function epicWithReviewedAndOpen(dir) {
  const epic = addEpic(dir);
  const a = addChild(dir, 'Child A', epic);
  const b = addChild(dir, 'Child B', epic);
  const r = runCli(['tasks', 'review', a, '--shipped', 'did A', '--check', 'look at A'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(find(dir, epic).section, 'review', 'B still open');
  return { epic, a, b };
}

// ---------------------------------------------------------------------------
// PRO32
// ---------------------------------------------------------------------------

test('PRO32: done on the last open child moves the epic to review', () => {
  const dir = makeTmpDir();
  const { epic, b } = epicWithReviewedAndOpen(dir);
  const r = runCli(['tasks', 'done', b], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`\\(epic ${epic} now in review\\)`));
  const e = find(dir, epic);
  assert.equal(e.section, 'review');
  assert.equal(e.task.checked, true);
  const last = e.task.history.at(-1);
  assert.deepEqual([last.event, last.to], ['moved', 'review']);
});

test('PRO32: move <id> done does the same, and --json carries epicMoved', () => {
  const dir = makeTmpDir();
  const { epic, b } = epicWithReviewedAndOpen(dir);
  const r = runCli(['tasks', 'move', b, 'done', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).epicMoved, [{ id: epic, from: 'todo', to: 'review' }]);
  assert.equal(find(dir, epic).section, 'review');
});

test('PRO32: moving the only open child to another epic closes the old epic', () => {
  const dir = makeTmpDir();
  const { epic, b } = epicWithReviewedAndOpen(dir);
  const other = addEpic(dir, 'Other epic');
  const r = runCli(['tasks', 'update', b, '--parent', other], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`\\(epic ${epic} now in review\\)`));
  assert.equal(find(dir, epic).section, 'review');
  assert.equal(find(dir, other).section, 'todo', 'the epic that gained an open child stays open');
  assert.equal(find(dir, b).task.parentId, other);
});

test('PRO32: --clear-parent on the last open child closes the epic too', () => {
  const dir = makeTmpDir();
  const { epic, b } = epicWithReviewedAndOpen(dir);
  assert.equal(runCli(['tasks', 'update', b, '--clear-parent'], dir).status, 0);
  assert.equal(find(dir, epic).section, 'review');
});

test('PRO32: an epic with nothing to review goes to done', () => {
  const dir = makeTmpDir();
  const epic = addEpic(dir);
  const a = addChild(dir, 'A', epic);
  const b = addChild(dir, 'B', epic);
  assert.equal(runCli(['tasks', 'done', a], dir).status, 0);
  assert.equal(find(dir, epic).section, 'todo', 'B is still open');
  const r = runCli(['tasks', 'done', b], dir);
  assert.match(r.stdout, new RegExp(`\\(epic ${epic} now done\\)`));
  assert.equal(find(dir, epic).section, 'done');
  assert.equal(find(dir, epic).task.checked, true);
});

test('PRO32: an epic with an open child left stays put', () => {
  const dir = makeTmpDir();
  const epic = addEpic(dir);
  const a = addChild(dir, 'A', epic);
  addChild(dir, 'B', epic);
  const r = runCli(['tasks', 'done', a], dir);
  assert.doesNotMatch(r.stdout, /epic/);
  assert.equal(find(dir, epic).section, 'todo');
});

test('PRO32: ticking the last check of the last child in review closes the epic', () => {
  const dir = makeTmpDir();
  const epic = addEpic(dir);
  const a = addChild(dir, 'A', epic);
  assert.equal(runCli(['tasks', 'move', a, 'review'], dir).status, 0);
  assert.equal(runCli(['tasks', 'update', a, '--add-check', 'look'], dir).status, 0);
  const r = runCli(['tasks', 'update', a, '--check-check', '1'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(find(dir, a).section, 'done');
  assert.equal(find(dir, epic).section, 'done');
  assert.match(r.stdout, new RegExp(`epic ${epic} now done`));
});

test('PRO32: rollUpAfterClose recurses to the enclosing epic and skips closed or childless epics', () => {
  const task = (id, extra = {}) => ({ id, title: id, checked: false, priority: 'medium', type: 'task', subtasks: [], checks: [], ...extra });
  const doc = {
    sections: [
      { id: 'todo', tasks: [task('T1', { type: 'epic' }), task('T2', { type: 'epic', parentId: 'T1' }), task('T9', { type: 'epic' })] },
      { id: 'done', tasks: [task('T3', { parentId: 'T2', checked: true })] },
      { id: 'review', tasks: [] },
    ],
  };
  const moved = rollUpAfterClose(doc, 'T2', { now: '2026-01-02T00:00:00.000Z' });
  assert.deepEqual(moved, [{ id: 'T2', from: 'todo', to: 'done' }, { id: 'T1', from: 'todo', to: 'done' }]);
  assert.deepEqual(doc.sections.find(s => s.id === 'done').tasks.map(t => t.id), ['T3', 'T2', 'T1']);
  assert.deepEqual(rollUpAfterClose(doc, 'T2'), [], 'already closed');
  assert.deepEqual(rollUpAfterClose(doc, 'T9'), [], 'a childless epic with nothing to review stays');
});

// ---------------------------------------------------------------------------
// PRO34
// ---------------------------------------------------------------------------

test('PRO34: review without any check dies and leaves the ticket alone', () => {
  const dir = makeTmpDir();
  const r = runCli(['tasks', 'review', 'T2', '--shipped', 'x'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--no-checks/);
  assert.equal(find(dir, 'T2').section, 'todo');
});

test('PRO34: --no-checks "<reason>" is accepted and stored', () => {
  const dir = makeTmpDir();
  const r = runCli(['tasks', 'review', 'T2', '--shipped', 'x', '--no-checks', 'pure refactor, tests cover it'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no checks: pure refactor/);
  const { task, section } = find(dir, 'T2');
  assert.equal(section, 'review');
  assert.equal(task.noChecksReason, 'pure refactor, tests cover it');
  assert.match(task.history.at(-1).note, /no checks: pure refactor/);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
});

test('PRO34: an empty --no-checks reason is refused', () => {
  const dir = makeTmpDir();
  const r = runCli(['tasks', 'review', 'T2', '--shipped', 'x', '--no-checks', '  '], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /needs a reason/);
});

test('PRO34: checks from --result-json, or already on the ticket, satisfy it', () => {
  const dir = makeTmpDir();
  const viaJson = runCli(['tasks', 'review', 'T2', '--result-json', '{"shipped":["x"],"checks":["look"]}'], dir);
  assert.equal(viaJson.status, 0, viaJson.stderr);
  assert.equal(runCli(['tasks', 'update', 'T4', '--add-check', 'already here'], dir).status, 0);
  const existing = runCli(['tasks', 'review', 'T4', '--shipped', 'y'], dir);
  assert.equal(existing.status, 0, existing.stderr);
});

test('PRO34: a child of an epic needs checks too', () => {
  const dir = makeTmpDir();
  const epic = addEpic(dir);
  const a = addChild(dir, 'A', epic);
  const no = runCli(['tasks', 'review', a, '--shipped', 'x'], dir);
  assert.notEqual(no.status, 0);
  assert.notEqual(find(dir, a).section, 'done');
  const yes = runCli(['tasks', 'review', a, '--shipped', 'x', '--no-checks', 'nothing to look at'], dir);
  assert.equal(yes.status, 0, yes.stderr);
  assert.equal(find(dir, a).section, 'done');
  assert.equal(find(dir, a).task.noChecksReason, 'nothing to look at');
});

test('PRO34: --rollup is unaffected', () => {
  const dir = makeTmpDir();
  assert.equal(runCli(['tasks', 'review', '--rollup'], dir).status, 0);
});

test('PRO34: resolve and clear Unverified lines (review and update, also on an epic)', () => {
  const dir = makeTmpDir();
  const shipArgs = ['tasks', 'review', 'T2', '--shipped', 'x', '--check', 'c', '--unverified', 'u1', '--unverified', 'u2', '--unverified', 'u3'];
  assert.equal(runCli(shipArgs, dir).status, 0);
  assert.deepEqual(find(dir, 'T2').task.result.unverified, ['u1', 'u2', 'u3']);

  assert.equal(runCli(['tasks', 'update', 'T2', '--resolve-unverified', '2'], dir).status, 0);
  assert.deepEqual(find(dir, 'T2').task.result.unverified, ['u1', 'u3']);
  const bad = runCli(['tasks', 'update', 'T2', '--resolve-unverified', '5'], dir);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /between 1 and 2/);

  // a later review can resolve one while adding a check
  assert.equal(runCli(['tasks', 'review', 'T2', '--check', 'again', '--resolve-unverified', '1'], dir).status, 0);
  assert.deepEqual(find(dir, 'T2').task.result.unverified, ['u3']);

  assert.equal(runCli(['tasks', 'update', 'T2', '--clear-unverified'], dir).status, 0);
  assert.equal(find(dir, 'T2').task.result.unverified, undefined);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);

  // an epic's lines are prefixed with the child id; the epic's own numbering applies
  const epic = addEpic(dir);
  const a = addChild(dir, 'A', epic);
  addChild(dir, 'B', epic);
  assert.equal(runCli(['tasks', 'review', a, '--shipped', 'x', '--check', 'c', '--unverified', 'one', '--unverified', 'two'], dir).status, 0);
  assert.deepEqual(find(dir, epic).task.result.unverified, [`${a}: one`, `${a}: two`]);
  assert.equal(runCli(['tasks', 'update', epic, '--resolve-unverified', '1'], dir).status, 0);
  assert.deepEqual(find(dir, epic).task.result.unverified, [`${a}: two`]);
});

test('PRO34: resolveUnverified / clearUnverified helpers', () => {
  const task = { result: { unverified: ['a', 'b'] } };
  assert.equal(resolveUnverified(task, 1), 'a');
  assert.throws(() => resolveUnverified(task, 0), /between 1 and 1/);
  assert.equal(resolveUnverified(task, 1), 'b');
  assert.equal(task.result.unverified, undefined);
  assert.equal(clearUnverified(task), 0);
  assert.throws(() => resolveUnverified({}, 1), /between 1 and 0/);
});

// ---------------------------------------------------------------------------
// T191
// ---------------------------------------------------------------------------

test('T191: openSubtasks numbers the unchecked ones; the message lists them', () => {
  const task = { subtasks: [{ text: 'a', checked: true }, { text: 'b', checked: false }, { text: ' c ', checked: false }] };
  assert.deepEqual(openSubtasks(task), [{ n: 2, text: 'b' }, { n: 3, text: 'c' }]);
  assert.deepEqual(openSubtasks({}), []);
  const cli = openSubtasksMessage('T1', task, { cli: true });
  assert.match(cli, /T1 has 2 open subtasks/);
  assert.match(cli, /2\. b/);
  assert.match(cli, /--promote-subtask N/);
  assert.match(openSubtasksMessage('T1', task), /2 subtasks are still open/);
});

test('T191: done, move done and review refuse open subtasks; --force overrides', () => {
  const dir = makeTmpDir(); // T1 has an open subtask (#2), T3 too (#3)
  for (const args of [['done', 'T1'], ['move', 'T1', 'done'], ['review', 'T1', '--shipped', 'x', '--check', 'c']]) {
    const r = runCli(['tasks', ...args], dir);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, /2\. Add package\.json/);
    assert.match(r.stderr, /--promote-subtask/);
    assert.equal(find(dir, 'T1').section, 'todo');
  }
  assert.equal(runCli(['tasks', 'done', 'T1', '--force'], dir).status, 0);
  assert.equal(find(dir, 'T1').section, 'done');
  assert.equal(runCli(['tasks', 'move', 'T3', 'done', '--force'], dir).status, 0);
  assert.equal(runCli(['tasks', 'review', 'T4', '--shipped', 'x', '--check', 'c'], dir).status, 0, 'no subtasks, no refusal');
  const forced = makeTmpDir();
  assert.equal(runCli(['tasks', 'review', 'T1', '--shipped', 'x', '--check', 'c', '--force'], forced).status, 0);
});

test('T191: ticking the last check refuses to finish a ticket with open subtasks', () => {
  const dir = makeTmpDir();
  assert.equal(runCli(['tasks', 'move', 'T1', 'review', '--force'], dir).status, 0);
  assert.equal(runCli(['tasks', 'update', 'T1', '--add-check', 'look'], dir).status, 0);
  const r = runCli(['tasks', 'update', 'T1', '--check-check', '1'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /open subtask/);
  assert.equal(find(dir, 'T1').section, 'review');
  assert.equal(find(dir, 'T1').task.checks[0].checked, false, 'nothing saved');
  assert.equal(runCli(['tasks', 'update', 'T1', '--check-check', '1', '--force'], dir).status, 0);
  assert.equal(find(dir, 'T1').section, 'done');
});

test('T191: an epic with open subtasks still rolls up', () => {
  const dir = makeTmpDir();
  const epic = addEpic(dir);
  const a = addChild(dir, 'A', epic);
  assert.equal(runCli(['tasks', 'update', epic, '--add-subtask', 'epic note to self'], dir).status, 0);
  assert.equal(runCli(['tasks', 'done', a], dir).status, 0);
  assert.equal(find(dir, epic).section, 'done');
});

// ---------------------------------------------------------------------------
// T192
// ---------------------------------------------------------------------------

function promoteDoc() {
  const task = (id, extra = {}) => ({ id, title: id, checked: false, priority: 'medium', type: 'task', subtasks: [], checks: [], ...extra });
  return {
    meta: { projects: [{ id: 'demo', name: 'Demo', prefix: 'DM' }] },
    sections: [
      { id: 'todo', tasks: [
        task('DM1', { type: 'epic', project: 'demo' }),
        task('DM2', { parentId: 'DM1', project: 'demo', priority: 'high', labels: ['ui', 'model:sonnet'], subtasks: [{ text: 'wire it', checked: false }, { text: 'done bit', checked: true }, { text: '  ', checked: false }] }),
        task('DM3', { project: 'demo', subtasks: [{ text: 'solo', checked: false }] }),
      ] },
      { id: 'done', tasks: [] },
    ],
  };
}

test('T192: promoteSubtask copies project/labels/priority, links back, removes the subtask', () => {
  const doc = promoteDoc();
  const ticket = doc.sections[0].tasks[1];
  const made = promoteSubtask(doc, ticket, 1, { now: new Date('2026-05-05T10:00:00Z') });
  assert.equal(made.id, 'DM4');
  assert.equal(made.title, 'wire it');
  assert.equal(made.project, 'demo');
  assert.deepEqual(made.labels, ['ui', 'model:sonnet']);
  assert.equal(made.priority, 'high');
  assert.equal(made.parentId, 'DM1', 'the ticket\'s own epic');
  assert.equal(made.description, 'Split from DM2.');
  assert.equal(made.created, '2026-05-05');
  assert.ok(doc.sections[0].tasks.includes(made), 'filed in todo');
  assert.deepEqual(ticket.subtasks.map(s => s.text), ['done bit', '  ']);
  assert.notStrictEqual(made.labels, ticket.labels);
});

test('T192: parent option wins; a standalone ticket gets no parent; an epic parents its own split', () => {
  const doc = promoteDoc();
  const [epic, child, solo] = doc.sections[0].tasks;
  assert.equal(promoteSubtask(doc, child, 1, { parent: 'DM3' }).parentId, 'DM3');
  assert.equal(promoteSubtask(doc, solo, 1).parentId, undefined);
  epic.subtasks = [{ text: 'epic step', checked: false }];
  assert.equal(promoteSubtask(doc, epic, 1).parentId, 'DM1');
});

test('T192: bad N, empty text or unknown parent throw and change nothing', () => {
  const doc = promoteDoc();
  const child = doc.sections[0].tasks[1];
  const before = JSON.stringify(doc);
  assert.throws(() => promoteSubtask(doc, child, 0), /between 1 and 3/);
  assert.throws(() => promoteSubtask(doc, child, 4), /between 1 and 3/);
  assert.throws(() => promoteSubtask(doc, child, 3), /no text/);
  assert.throws(() => promoteSubtask(doc, child, 1, { parent: 'DM99' }), /not found/);
  assert.equal(JSON.stringify(doc), before);
  assert.throws(() => splitSubtask({ subtasks: [] }, 1, { ticketId: 'X' }), /between 1 and 0/);
});

test('T192: promoteSubtaskInState works on the dashboard shape', () => {
  const state = {
    meta: { projects: [] },
    tasks: {
      todo: [
        { id: 1, taskId: 'T1', type: 'epic', title: 'E', subtasks: [] },
        { id: 2, taskId: 'T2', type: 'task', parentId: 'T1', priority: 'low', project: null, labels: ['x'], subtasks: [{ text: 'hello', checked: false }] },
      ],
      done: [],
    },
  };
  const made = promoteSubtaskInState(state, state.tasks.todo[1], 1, { now: new Date('2026-05-05T10:00:00Z') });
  assert.equal(made.taskId, 'T3');
  assert.equal(made.parentId, 'T1');
  assert.equal(made.section, 'todo');
  assert.equal(made.priority, 'low');
  assert.deepEqual(made.labels, ['x']);
  assert.equal(made.description, 'Split from T2.');
  assert.deepEqual(state.tasks.todo[1].subtasks, []);
  assert.ok(state.tasks.todo.includes(made));
  assert.throws(() => promoteSubtaskInState(state, state.tasks.todo[1], 1), /between 1 and 0/);
});

test('T192: CLI --promote-subtask prints the new id, keeps the ticket\'s parent, --parent names the new task\'s parent', () => {
  const dir = makeTmpDir();
  const epic = addEpic(dir);
  const other = addEpic(dir, 'Other');
  const t = addChild(dir, 'Parent ticket', epic, ['--priority', 'high', '--label', 'ui']);
  assert.equal(runCli(['tasks', 'update', t, '--add-subtask', 'first', '--add-subtask', 'second', '--add-subtask', 'third'], dir).status, 0);

  let r = runCli(['tasks', 'update', t, '--promote-subtask', '2', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const firstId = JSON.parse(r.stdout).promoted;
  let made = find(dir, firstId);
  assert.equal(made.section, 'todo');
  assert.equal(made.task.title, 'second');
  assert.equal(made.task.parentId, epic);
  assert.equal(made.task.priority, 'high');
  assert.deepEqual(made.task.labels, ['ui']);
  assert.match(made.task.description, new RegExp(`Split from ${t}`));
  assert.deepEqual(find(dir, t).task.subtasks.map(s => s.text), ['first', 'third']);

  r = runCli(['tasks', 'update', t, '--promote-subtask', '1', '--parent', other], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /created \S+ from subtask 1/);
  const secondId = r.stdout.match(/created (\S+) from subtask/)[1];
  assert.equal(find(dir, secondId).task.parentId, other);
  assert.equal(find(dir, t).task.parentId, epic, '--parent did not re-parent the ticket');

  r = runCli(['tasks', 'update', t, '--promote-subtask', '1', '--promote-parent', epic], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(find(dir, t).task.subtasks, []);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
});

test('T192: CLI errors: N out of range, --promote-parent alone, clash with --clear-parent', () => {
  const dir = makeTmpDir();
  let r = runCli(['tasks', 'update', 'T1', '--promote-subtask', '9'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /between 1 and 2/);
  r = runCli(['tasks', 'update', 'T1', '--promote-parent', 'T2'], dir);
  assert.notEqual(r.status, 0);
  r = runCli(['tasks', 'update', 'T1', '--promote-subtask', '2', '--clear-parent'], dir);
  assert.notEqual(r.status, 0);
  r = runCli(['tasks', 'update', 'T1', '--promote-subtask', '2', '--parent', 'T99'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not found/);
  assert.equal(readTasks(dir).sections.flatMap(s => s.tasks).length, 6, 'nothing was created');
});
