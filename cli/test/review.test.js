/**
 * cli/test/review.test.js
 * "Ready for review": shared/review.js unit tests plus CLI flows (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  normalizeResult, addChecks, reviewQueue, reviewComplete, followUpsOf, resultLines,
} from '../../shared/review.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

function makeTmpDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-review-test-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(tmpDir, 'tasks.json'));
  return tmpDir;
}

function readTasks(tmpDir) {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, 'tasks.json'), 'utf8'));
}

function runCli(args, tmpDir) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], {
    env: { ...process.env, CH_HOME: tmpDir },
    encoding: 'utf8',
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? (r.error ? 2 : 0) };
}

/** { task, section } for an id in the saved doc. */
function find(tmpDir, id) {
  for (const s of readTasks(tmpDir).sections) {
    const task = s.tasks.find(t => t.id === id);
    if (task) return { task, section: s.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// shared/review.js
// ---------------------------------------------------------------------------

test('normalizeResult: defaults ci, omits empty left/tests, trims', () => {
  const r = normalizeResult({ shipped: ['  one  ', ''] }, { now: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(r, { at: '2026-01-01T00:00:00.000Z', shipped: ['one'], ci: 'all passed' });
});

test('normalizeResult: keeps left, tests, ci and a valid at', () => {
  const r = normalizeResult({
    at: '2026-02-02T10:00:00.000Z', shipped: 'a', left: ['b'], tests: ['c'], ci: 'red then green',
  });
  assert.deepEqual(r, {
    at: '2026-02-02T10:00:00.000Z', shipped: ['a'], left: ['b'], tests: ['c'], ci: 'red then green',
  });
});

test('normalizeResult: errors on bad input', () => {
  assert.throws(() => normalizeResult(null), /object/);
  assert.throws(() => normalizeResult({}), /shipped/);
  assert.throws(() => normalizeResult({ shipped: [] }), /shipped/);
  assert.throws(() => normalizeResult({ shipped: [1] }), /list of strings/);
});

test('addChecks dedupes by text and reports how many were added', () => {
  const task = { checks: [{ text: 'a', checked: true, addedAt: 'x' }] };
  assert.equal(addChecks(task, ['a', ' b ', 'b', '']), 1);
  assert.deepEqual(task.checks.map(c => c.text), ['a', 'b']);
  assert.equal(task.checks[1].checked, false);
});

function reviewDoc() {
  return {
    sections: [
      { id: 'todo', tasks: [{ id: 'X3', title: 'follow-up', reviewOf: 'X1' }] },
      {
        id: 'review',
        tasks: [
          { id: 'X2', title: 'later', checks: [{ text: 'a', checked: true }, { text: 'b', checked: false }],
            history: [{ event: 'moved', to: 'review', at: '2026-03-02T00:00:00.000Z' }] },
          { id: 'X1', title: 'earlier', checks: [],
            history: [{ event: 'moved', to: 'review', at: '2026-03-01T00:00:00.000Z' }] },
        ],
      },
      { id: 'done', tasks: [{ id: 'X4', title: 'nope' }] },
    ],
  };
}

test('reviewQueue: oldest first, with progress and follow-ups', () => {
  const q = reviewQueue(reviewDoc());
  assert.deepEqual(q.map(r => r.id), ['X1', 'X2']);
  assert.deepEqual(q[1].checks, { done: 1, total: 2 });
  assert.deepEqual(q[0].followUps, [{ id: 'X3', title: 'follow-up', section: 'todo' }]);
  assert.deepEqual(followUpsOf(reviewDoc(), 'X2'), []);
});

test('reviewComplete: only in review, only after a tick, only when all ticked', () => {
  const all = { checks: [{ checked: true }] };
  const some = { checks: [{ checked: true }, { checked: false }] };
  assert.equal(reviewComplete(all, 'review', { ticked: true }), true);
  assert.equal(reviewComplete(all, 'review', { ticked: false }), false);
  assert.equal(reviewComplete(all, 'todo', { ticked: true }), false);
  assert.equal(reviewComplete(some, 'review', { ticked: true }), false);
});

test('resultLines lists shipped, left, tests and ci', () => {
  assert.deepEqual(resultLines({ shipped: ['a'], left: ['b'], tests: ['c'], ci: 'ok' }),
    ['Shipped: a', 'Left: b', 'Tests: c', 'CI: ok']);
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('review: moves to review, checks it, stores result and checks', () => {
  const dir = makeTmpDir();
  const r = runCli(['tasks', 'review', 'T3', '--shipped', 'added A', '--shipped', 'added B',
    '--left', 'nothing', '--tests', 'two new', '--ci', 'green', '--check', 'look at A', '--check', 'look at B'], dir);
  assert.equal(r.status, 0, r.stderr);
  const { task, section } = find(dir, 'T3');
  assert.equal(section, 'review');
  assert.equal(task.checked, true);
  assert.deepEqual(task.result.shipped, ['added A', 'added B']);
  assert.deepEqual(task.result.left, ['nothing']);
  assert.deepEqual(task.result.tests, ['two new']);
  assert.equal(task.result.ci, 'green');
  assert.deepEqual(task.checks.map(c => c.text), ['look at A', 'look at B']);
  const last = task.history[task.history.length - 1];
  assert.equal(last.event, 'moved');
  assert.equal(last.from, 'in-progress');
  assert.equal(last.to, 'review');
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
});

test('review: --result-json merges with flags and carries checks', () => {
  const dir = makeTmpDir();
  const json = JSON.stringify({ shipped: ['from json'], tests: ['t1'], checks: ['json check'] });
  const r = runCli(['tasks', 'review', 'T3', '--result-json', json, '--shipped', 'from flag', '--check', 'flag check'], dir);
  assert.equal(r.status, 0, r.stderr);
  const { task } = find(dir, 'T3');
  assert.deepEqual(task.result.shipped, ['from json', 'from flag']);
  assert.deepEqual(task.result.tests, ['t1']);
  assert.equal(task.result.ci, 'all passed');
  assert.deepEqual(task.checks.map(c => c.text), ['json check', 'flag check']);
  assert.equal(task.result.checks, undefined);
});

test('review: second run dedupes checks and does not log another move', () => {
  const dir = makeTmpDir();
  runCli(['tasks', 'review', 'T3', '--shipped', 'x', '--check', 'one'], dir);
  const before = find(dir, 'T3').task.history.length;
  const r = runCli(['tasks', 'review', 'T3', '--check', 'one', '--check', 'two'], dir);
  assert.equal(r.status, 0, r.stderr);
  const { task, section } = find(dir, 'T3');
  assert.equal(section, 'review');
  assert.deepEqual(task.checks.map(c => c.text), ['one', 'two']);
  assert.equal(task.history.length, before);
  assert.deepEqual(task.result.shipped, ['x']);
});

test('review: invalid result errors and leaves the ticket alone', () => {
  const dir = makeTmpDir();
  assert.notEqual(runCli(['tasks', 'review', 'T3', '--result-json', '{nope'], dir).status, 0);
  assert.notEqual(runCli(['tasks', 'review', 'T3', '--result-json', '{"tests":["t"]}'], dir).status, 0);
  assert.notEqual(runCli(['tasks', 'review', 'T3', '--ci', 'green'], dir).status, 0);
  assert.notEqual(runCli(['tasks', 'review', 'T3', '--result-json', '[1]'], dir).status, 0);
  assert.equal(find(dir, 'T3').section, 'in-progress');
});

test('ticking checks one by one moves to done only after the last', () => {
  const dir = makeTmpDir();
  runCli(['tasks', 'review', 'T3', '--shipped', 'x', '--check', 'a', '--check', 'b'], dir);

  const first = runCli(['tasks', 'update', 'T3', '--check-check', '1'], dir);
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stdout, /moved to done/);
  assert.equal(find(dir, 'T3').section, 'review');

  const last = runCli(['tasks', 'update', 'T3', '--check-check', '2', '--json'], dir);
  assert.equal(last.status, 0, last.stderr);
  assert.equal(JSON.parse(last.stdout).movedToDone, true);
  const { task, section } = find(dir, 'T3');
  assert.equal(section, 'done');
  assert.equal(task.checked, true);
  assert.deepEqual(task.history.slice(-1)[0], { ...task.history.slice(-1)[0], event: 'moved', from: 'review', to: 'done' });
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
});

test('--check-all-checks ticks everything and moves to done', () => {
  const dir = makeTmpDir();
  runCli(['tasks', 'review', 'T3', '--shipped', 'x', '--check', 'a', '--check', 'b'], dir);
  const r = runCli(['tasks', 'update', 'T3', '--check-all-checks'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /all checks ticked: moved to done/);
  const { task, section } = find(dir, 'T3');
  assert.equal(section, 'done');
  assert.ok(task.checks.every(c => c.checked));
});

test('an unrelated edit on a review ticket does not move it to done', () => {
  const dir = makeTmpDir();
  runCli(['tasks', 'review', 'T3', '--shipped', 'x'], dir);
  runCli(['tasks', 'update', 'T3', '--priority', 'high'], dir);
  assert.equal(find(dir, 'T3').section, 'review');
});

test('move into review checks the ticket; move out unchecks it', () => {
  const dir = makeTmpDir();
  assert.equal(runCli(['tasks', 'move', 'T1', 'review'], dir).status, 0);
  assert.equal(find(dir, 'T1').task.checked, true);
  assert.equal(find(dir, 'T1').section, 'review');
  assert.equal(runCli(['tasks', 'move', 'T1', 'todo'], dir).status, 0);
  assert.equal(find(dir, 'T1').task.checked, false);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
});

test('add --review-of records the link; get shows both directions', () => {
  const dir = makeTmpDir();
  runCli(['tasks', 'review', 'T3', '--shipped', 'did a thing', '--left', 'a leftover', '--check', 'c'], dir);
  const add = runCli(['tasks', 'add', 'Follow-up', '--review-of', 'T3', '--json'], dir);
  assert.equal(add.status, 0, add.stderr);
  const newId = JSON.parse(add.stdout).id;
  assert.equal(find(dir, newId).task.reviewOf, 'T3');

  const parent = runCli(['tasks', 'get', 'T3'], dir).stdout;
  assert.match(parent, /Follow-ups from review: .*\(todo\)/);
  assert.match(parent, /Result:\n\s+Shipped: did a thing/);
  assert.match(parent, /Left: a leftover/);
  const child = runCli(['tasks', 'get', newId], dir).stdout;
  assert.match(child, /From review of: T3 /);
  const json = JSON.parse(runCli(['tasks', 'get', 'T3', '--json'], dir).stdout);
  assert.deepEqual(json.followUps.map(f => f.id), [newId]);

  assert.notEqual(runCli(['tasks', 'add', 'Bad', '--review-of', 'T999'], dir).status, 0);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
});

test('update --review-of / --clear-review-of / --clear-result', () => {
  const dir = makeTmpDir();
  runCli(['tasks', 'review', 'T3', '--shipped', 'x'], dir);
  assert.equal(runCli(['tasks', 'update', 'T1', '--review-of', 'T3'], dir).status, 0);
  assert.equal(find(dir, 'T1').task.reviewOf, 'T3');
  assert.notEqual(runCli(['tasks', 'update', 'T1', '--review-of', 'T999'], dir).status, 0);
  assert.equal(runCli(['tasks', 'update', 'T1', '--clear-review-of'], dir).status, 0);
  assert.equal(find(dir, 'T1').task.reviewOf, undefined);
  assert.equal(runCli(['tasks', 'update', 'T3', '--clear-result'], dir).status, 0);
  assert.equal(find(dir, 'T3').task.result, undefined);
});

test('runplan lists the review queue; --active hides review tickets', () => {
  const dir = makeTmpDir();
  runCli(['tasks', 'review', 'T3', '--shipped', 'x', '--check', 'a'], dir);
  const plan = runCli(['tasks', 'runplan'], dir).stdout;
  assert.match(plan, /Ready for review \(1\), oldest first:/);
  assert.match(plan, /T3 .* · checks 0\/1 · since \d{4}-\d{2}-\d{2}/);
  assert.equal(JSON.parse(runCli(['tasks', 'runplan', '--json'], dir).stdout).review.length, 1);
  const active = JSON.parse(runCli(['tasks', 'dump', '--active', '--json'], dir).stdout);
  assert.ok(!JSON.stringify(active).includes('"T3"'));
  const listed = runCli(['tasks', 'list', '--section', 'review'], dir).stdout;
  assert.match(listed, /T3/);
});

test('normalizeResult: keeps unverified, risks, fixed and opened only when given', () => {
  const r = normalizeResult({ shipped: ['x'], unverified: ['not seen in the app'], risks: [' flaky '], fixed: [], opened: ['T9 follow-up'] });
  assert.deepEqual(r.unverified, ['not seen in the app']);
  assert.deepEqual(r.risks, ['flaky']);
  assert.equal('fixed' in r, false);
  assert.deepEqual(r.opened, ['T9 follow-up']);
  assert.deepEqual(resultLines(r).slice(-3), ['Unverified: not seen in the app', 'Risk: flaky', 'Opened: T9 follow-up']);
});

test('ch tasks review: --risk, --unverified, --fixed and --opened land on the result', () => {
  const dir = makeTmpDir();
  const r = runCli(['tasks', 'review', 'T1', '--shipped', 'a', '--risk', 'r1', '--unverified', 'u1', '--fixed', 'f1', '--opened', 'o1', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout).result;
  assert.deepEqual([res.risks, res.unverified, res.fixed, res.opened], [['r1'], ['u1'], ['f1'], ['o1']]);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
});

// ---------------------------------------------------------------------------
// Children of an epic roll up into the epic
// ---------------------------------------------------------------------------

function addEpicWithChildren(tmpDir) {
  const epic = runCli(['tasks', 'add', 'Epic E', '--type', 'epic', '--json'], tmpDir);
  const epicId = JSON.parse(epic.stdout).id;
  const ids = [];
  for (const title of ['Child A', 'Child B']) {
    const r = runCli(['tasks', 'add', title, '--parent', epicId, '--json'], tmpDir);
    ids.push(JSON.parse(r.stdout).id);
  }
  return { epicId, ids };
}

test('review on an epic child: result and checks go to the epic, child goes to Done', () => {
  const tmpDir = makeTmpDir();
  const { epicId, ids } = addEpicWithChildren(tmpDir);
  const [a, b] = ids;

  let r = runCli(['tasks', 'review', a, '--shipped', 'did A', '--check', 'look at A'], tmpDir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(find(tmpDir, a).section, 'done');
  assert.deepEqual(find(tmpDir, a).task.result.shipped, ['did A']);
  // B still open: the epic collects but stays out of review
  assert.notEqual(find(tmpDir, epicId).section, 'review');
  assert.deepEqual(find(tmpDir, epicId).task.checks.map(c => c.text), [`${a}: look at A`]);

  r = runCli(['tasks', 'review', b, '--shipped', 'did B', '--check', 'look at B'], tmpDir);
  assert.equal(r.status, 0, r.stderr);
  const epic = find(tmpDir, epicId);
  assert.equal(epic.section, 'review');
  assert.deepEqual(epic.task.result.shipped, [`${a}: did A`, `${b}: did B`]);
  assert.equal(epic.task.checks.length, 2);

  const doc = readTasks(tmpDir);
  assert.deepEqual(reviewQueue(doc).map(q => q.id), [epicId]);
});

test('review rollup: tidies children already sitting in review', () => {
  const tmpDir = makeTmpDir();
  const { epicId, ids } = addEpicWithChildren(tmpDir);
  for (const id of ids) {
    runCli(['tasks', 'move', id, 'review'], tmpDir);
    runCli(['tasks', 'update', id, '--add-check', `check ${id}`], tmpDir);
  }
  const data = readTasks(tmpDir);
  const t = data.sections.flatMap(s => s.tasks).find(x => x.id === ids[0]);
  t.result = { at: '2026-01-01T00:00:00.000Z', shipped: ['old A'], ci: 'all passed' };
  fs.writeFileSync(path.join(tmpDir, 'tasks.json'), JSON.stringify(data));

  const r = runCli(['tasks', 'review', '--rollup'], tmpDir);
  assert.equal(r.status, 0, r.stderr);
  for (const id of ids) assert.equal(find(tmpDir, id).section, 'done');
  const epic = find(tmpDir, epicId);
  assert.equal(epic.section, 'review');
  assert.equal(epic.task.checks.length, 2);
  assert.deepEqual(epic.task.result.shipped, [`${ids[0]}: old A`]);
});

test('review on a standalone ticket still gets its own review card', () => {
  const tmpDir = makeTmpDir();
  const id = JSON.parse(runCli(['tasks', 'add', 'Solo', '--parent', JSON.parse(runCli(['tasks', 'add', 'Ep', '--type', 'epic', '--json'], tmpDir).stdout).id, '--json'], tmpDir).stdout).id;
  runCli(['tasks', 'update', id, '--clear-parent'], tmpDir);
  const r = runCli(['tasks', 'review', id, '--shipped', 'x'], tmpDir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(find(tmpDir, id).section, 'review');
});

// ---------------------------------------------------------------------------
// Auto pin/unpin (PRO15)
// ---------------------------------------------------------------------------

const pins = (tmpDir) => {
  const plan = readTasks(tmpDir).meta?.dailyPlan || {};
  return [...(plan.taskIds || []), ...(plan.carriedIds || [])];
};

test('closing the last child of a pinned epic unpins the epic', () => {
  const tmpDir = makeTmpDir();
  const { epicId, ids: [a, b] } = addEpicWithChildren(tmpDir);
  assert.equal(runCli(['tasks', 'plan', '--pin', epicId], tmpDir).status, 0);

  runCli(['tasks', 'review', a, '--shipped', 'did A'], tmpDir);
  assert.ok(pins(tmpDir).includes(epicId), 'still pinned while B is open');

  const r = runCli(['tasks', 'done', b], tmpDir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`unpinned ${epicId}`));
  assert.ok(!pins(tmpDir).includes(epicId));
});

test('moving a pinned epic to done unpins it; moving a child to review counts as closed', () => {
  const tmpDir = makeTmpDir();
  const { epicId, ids: [a, b] } = addEpicWithChildren(tmpDir);
  runCli(['tasks', 'plan', '--pin', epicId], tmpDir);
  runCli(['tasks', 'move', a, 'review'], tmpDir);
  assert.ok(pins(tmpDir).includes(epicId));
  runCli(['tasks', 'move', b, 'review'], tmpDir);
  assert.ok(!pins(tmpDir).includes(epicId));

  const other = addEpicWithChildren(tmpDir).epicId;
  runCli(['tasks', 'plan', '--pin', other], tmpDir);
  runCli(['tasks', 'done', other], tmpDir);
  assert.ok(!pins(tmpDir).includes(other));
});

test('an epic added or updated with a lane is pinned; one without a lane is not', () => {
  const tmpDir = makeTmpDir();
  const add = (...extra) => JSON.parse(runCli(['tasks', 'add', 'E', '--type', 'epic', '--json', ...extra], tmpDir).stdout).id;
  const laned = add('--lane', 'canvas');
  const bare = add();
  assert.ok(pins(tmpDir).includes(laned));
  assert.ok(!pins(tmpDir).includes(bare));

  const r = runCli(['tasks', 'update', bare, '--lane', 'website'], tmpDir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(pins(tmpDir).includes(bare));
});
