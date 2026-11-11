/**
 * cli/test/review-safety.test.js
 * Reviews are Tal's: `done` refuses to close a ticket in review, checks a session should own
 * are refused, answered design picks drop out of the epic. Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  checkOwnerProblem, isPickCheckText, removeStalePickChecks, rollUpIntoEpic, reviewClosedTooFast,
} from '../../shared/review.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

const sec = (id, tasks = []) => ({ id, name: id, tasks });
const tk = (id, extra = {}) => ({ id, title: `Ticket ${id}`, checked: false, priority: 'medium', subtasks: [], created: '2026-01-01', updated: '2026-01-01', ...extra });

function makeDir(sections) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-rsafe-test-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({
    version: 1,
    sections: ['todo', 'in-progress', 'review', 'done'].map(id => sec(id, sections[id] || [])),
  }));
  return dir;
}
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
function where(dir, id) {
  for (const s of read(dir).sections) { const t = s.tasks.find(x => x.id === id); if (t) return { task: t, section: s.id }; }
  return null;
}
function run(args, dir) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}

// ---- 3. done does not close a review ----------------------------------------------------

test('done refuses a review ticket with unticked checks, --force overrides', () => {
  const dir = makeDir({ review: [tk('T101', { checked: true, checks: [{ text: 'Look at it', checked: false }] })] });
  const r = run(['tasks', 'done', 'T101'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Tal reviews it/);
  assert.match(r.stderr, /ch tasks review/);
  assert.equal(where(dir, 'T101').section, 'review');
  assert.equal(run(['tasks', 'done', 'T101', '--force'], dir).status, 0);
  assert.equal(where(dir, 'T101').section, 'done');
});

test('done refuses a review ticket with unsent notes even when checks are ticked', () => {
  const dir = makeDir({ review: [tk('T102', { checked: true, checks: [{ text: 'a', checked: true }],
    reviewNotes: [{ n: 1, at: '2026-01-01T00:00:00.000Z', text: 'fix this', kind: 'fix', state: 'new' }] })] });
  assert.notEqual(run(['tasks', 'done', 'T102'], dir).status, 0);
});

test('done on a review ticket whose checks are all ticked still works', () => {
  const dir = makeDir({ review: [tk('T103', { checked: true, checks: [{ text: 'a', checked: true }] })] });
  assert.equal(run(['tasks', 'done', 'T103'], dir).status, 0);
});

test('done refuses an epic with unticked checks', () => {
  const dir = makeDir({ todo: [tk('T201', { type: 'epic', checks: [{ text: 'T201 check', checked: false }] })] });
  const r = run(['tasks', 'done', 'T201'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /epic/);
  assert.equal(where(dir, 'T201').section, 'todo');
});

test('lint warns about a ticket that went review -> done within 5 minutes', () => {
  assert.equal(reviewClosedTooFast({ history: [
    { at: '2026-01-01T10:00:00.000Z', event: 'moved', from: 'in-progress', to: 'review' },
    { at: '2026-01-01T10:03:00.000Z', event: 'moved', from: 'review', to: 'done' },
  ] }), true);
  assert.equal(reviewClosedTooFast({ history: [
    { at: '2026-01-01T10:00:00.000Z', event: 'moved', from: 'in-progress', to: 'review' },
    { at: '2026-01-01T12:00:00.000Z', event: 'moved', from: 'review', to: 'done' },
  ] }), false);
  const dir = makeDir({ done: [tk('T104', { checked: true, history: [
    { at: '2026-01-01T10:00:00.000Z', event: 'moved', from: 'in-progress', to: 'review' },
    { at: '2026-01-01T10:01:00.000Z', event: 'moved', from: 'review', to: 'done' },
  ] }), tk('T105', { checked: true })] });
  const r = run(['tasks', 'lint'], dir);
  assert.match(r.stderr, /T104 went review -> done within 5 minutes/);
  assert.doesNotMatch(r.stderr, /T105 went/);
});

// ---- 4. checks Claude owns ---------------------------------------------------------------

const REFUSED = [
  'WEB25: CI build passed',
  'FRO1360: PR 1014 CI green: 4 shards',
  'MAR32: In the suite checkout run git status: no analytics/data changes',
  'FRO1361: Open a project saved before this change: its unison sound is unchanged.',
  'FRO1291: Turn VoiceOver on, press Cmd+Up',
  'FRO1305: Run a scenario with Tools/ui-verify/run.py against an older build',
];
const ALLOWED = [
  'FRO1171: Add a Filter, hold a note and drag Cutoff slowly up from the bottom',
  'FRO734: Click + Track, type osc: only Oscillator rows remain',
  'Press Run and the arp starts',
];

test('checkOwnerProblem refuses real session-owned checks', () => {
  for (const t of REFUSED) assert.ok(checkOwnerProblem(t), t);
  assert.ok(checkOwnerProblem('Run: node --test'));
  assert.ok(checkOwnerProblem('Check for regression in the mixer'));
  assert.ok(checkOwnerProblem('Pick one option per question on the board'));
  assert.ok(checkOwnerProblem('FRO429: Open the Custom module board and answer Q1-Q9.'));
  assert.equal(checkOwnerProblem('The board looks right'), null);
  assert.equal(checkOwnerProblem('Pick the Sampler and hear it play'), null);
});

test('checkOwnerProblem lets product checks through', () => {
  for (const t of ALLOWED) assert.equal(checkOwnerProblem(t), null, t);
});

test('ch tasks review refuses owned checks (--check, --result-json, rollup) and --allow-check-owner overrides', () => {
  const dir = makeDir({ 'in-progress': [tk('T301'), tk('T302'), tk('T303')] });
  const base = ['tasks', 'review', 'T301', '--shipped', 'x'];
  let r = run([...base, '--check', 'WEB25: CI build passed'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--tests/);
  assert.equal(where(dir, 'T301').section, 'in-progress');
  r = run(['tasks', 'review', 'T301', '--result-json', JSON.stringify({ shipped: ['x'], checks: ['Turn VoiceOver on'] })], dir);
  assert.notEqual(r.status, 0);
  r = run([...base, '--check', 'Click + Track, type osc: only Oscillator rows remain'], dir);
  assert.equal(r.status, 0, r.stderr);
  r = run(['tasks', 'review', 'T302', '--shipped', 'x', '--check', 'CI build passed', '--allow-check-owner'], dir);
  assert.equal(r.status, 0, r.stderr);
});

test('review --rollup refuses owned checks on children', () => {
  const dir = makeDir({ review: [
    tk('T401', { type: 'epic' }),
    tk('T402', { parentId: 'T401', checks: [{ text: 'T402: CI green', checked: false }] }),
  ] });
  const r = run(['tasks', 'review', '--rollup'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /yours, not Tal's/);
});

// ---- 5. stale design-pick checks ---------------------------------------------------------

test('isPickCheckText matches pick prompts only', () => {
  for (const t of ['Pick the layout', 'Answer Pick 2 on the board', 'Open the design board and choose', 'Board shows three options']) assert.ok(isPickCheckText(t), t);
  for (const t of ['Click Pick tool', 'Drag the knob', 'The board looks right']) assert.equal(isPickCheckText(t), false, t);
});

test('rollUpIntoEpic drops unticked pick checks of the blockers the ticket was waiting on', () => {
  const pick = tk('T501');
  const child = tk('T502', { parentId: 'T209', blockedBy: ['T501'], result: { at: '2026-01-01T00:00:00.000Z', shipped: ['s'], ci: 'all passed' } });
  const epic = tk('T209', { type: 'epic', checks: [
    { text: 'T501: Pick the layout on the board', checked: false },
    { text: 'T501: Open the design board', checked: false },
    { text: 'T501: Pick done already', checked: true },
    { text: 'T501: Drag the knob', checked: false },
    { text: 'T503: Pick something else', checked: false },
  ] });
  const doc = { sections: [sec('in-progress', [child]), sec('todo', [epic]), sec('done', [pick])] };
  rollUpIntoEpic(doc, child, ['Turn the knob']);
  assert.deepEqual(epic.checks.map(c => c.text), [
    'T501: Pick done already', 'T501: Drag the knob', 'T503: Pick something else', 'T502: Turn the knob',
  ]);
  assert.equal(removeStalePickChecks({ checks: [] }, ['T501']), 0);
});

function epicDoc(epicSection, epicExtra = {}) {
  const child = tk('T702', { parentId: 'T701', result: { at: '2026-01-01T00:00:00.000Z', shipped: ['s'], ci: 'all passed' } });
  const epic = tk('T701', { type: 'epic', ...epicExtra });
  const doc = { sections: [sec('in-progress', [child]), sec(epicSection, [epic]), ...['review', 'done'].filter(x => x !== epicSection).map(x => sec(x))] };
  return { doc, child, epic };
}

test('rollUpIntoEpic: last child with no checks at all sends the epic to done, not review', () => {
  const { doc, child } = epicDoc('todo');
  const out = rollUpIntoEpic(doc, child, []);
  assert.equal(out.moveEpicToDone, true);
  assert.equal(out.moveEpicToReview, false);
  assert.equal(out.epic.result.shipped[0], 'T702: s');
});

test('rollUpIntoEpic: an epic with checks still goes to review', () => {
  const { doc, child } = epicDoc('todo');
  const out = rollUpIntoEpic(doc, child, ['Turn the knob']);
  assert.equal(out.moveEpicToReview, true);
  assert.equal(out.moveEpicToDone, false);
  const ticked = epicDoc('todo', { checks: [{ text: 'old', checked: true }] });
  assert.equal(rollUpIntoEpic(ticked.doc, ticked.child, []).moveEpicToReview, true);
});

test('rollUpIntoEpic: no checks but a left or unverified line still goes to review', () => {
  for (const key of ['left', 'unverified']) {
    const { doc, child } = epicDoc('todo');
    child.result[key] = ['run bash scripts/install.sh install'];
    const out = rollUpIntoEpic(doc, child, []);
    assert.deepEqual([out.moveEpicToReview, out.moveEpicToDone], [true, false], key);
  }
});

test('rollUpIntoEpic: an epic already in done returns to review only when checks are added', () => {
  const a = epicDoc('done');
  const noAdd = rollUpIntoEpic(a.doc, a.child, []);
  assert.deepEqual([noAdd.moveEpicToReview, noAdd.moveEpicToDone], [false, false]);
  const b = epicDoc('done');
  const add = rollUpIntoEpic(b.doc, b.child, ['Look']);
  assert.deepEqual([add.moveEpicToReview, add.moveEpicToDone], [true, false]);
});

test('ch tasks review --no-checks on the last child moves a check-less epic to done and unpins it', () => {
  const child = tk('T802', { parentId: 'T801', checked: false });
  const epic = tk('T801', { type: 'epic' });
  const dir = makeDir({ 'in-progress': [child, epic] });
  const r = run(['tasks', 'review', 'T802', '--shipped', 'did it', '--no-checks', 'internal only', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(where(dir, 'T802').section, 'done');
  assert.equal(where(dir, 'T801').section, 'done');
  assert.equal(JSON.parse(r.stdout).epicTo, 'done');
});
