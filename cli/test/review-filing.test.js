/**
 * cli/test/review-filing.test.js
 * File review: shared/review-filing.js unit tests plus `ch tasks notes route|send` (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { planFiling, applyFiling } from '../../shared/review-filing.js';
import { nextTaskId } from '../../shared/task-ids.js';
import { validateTasksDoc } from '../lib/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const AT = '2026-10-01T10:00:00.000Z';

const task = (id, over = {}) => ({
  id, title: `Ticket ${id}`, checked: false, priority: 'medium', type: 'task',
  created: '2026-10-01', updated: null, subtasks: [], checks: [], ...over,
});
const note = (n, kind, text, over = {}) => ({ n, at: AT, text, kind, state: 'new', ...over });

/** Two lanes: canvas has a todo epic, account has only a done epic. */
function makeDoc() {
  const ids = ['inbox', 'backlog', 'todo', 'in-progress', 'review', 'done', 'archive'];
  const doc = { version: 1, sections: ids.map(id => ({ id, name: id, tasks: [] })) };
  const put = (section, t) => doc.sections.find(s => s.id === section).tasks.push(t);
  put('todo', task('T1', { title: 'Edit Layout 4', type: 'epic', lane: 'canvas' }));
  put('done', task('T2', { title: 'Account basics', type: 'epic', lane: 'account' }));
  put('review', task('T3', {
    parentId: 'T1', labels: ['ui'],
    checks: [{ text: 'Drag works', checked: false }, { text: 'Colours match', checked: false }],
    reviewNotes: [
      note(1, 'fix', 'handle jumps on drag', { check: 'Drag works' }),
      note(2, 'idea', 'snap to grid'),
      note(3, 'design', 'colour palette for tabs', { check: 'Colours match' }),
    ],
  }));
  put('review', task('T4', { parentId: 'T2', reviewNotes: [note(1, 'fix', 'avatar is cropped')] }));
  put('review', task('T5', { reviewNotes: [note(1, 'fix', 'no home for this')] }));
  put('review', task('T6', { reviewNotes: [note(1, 'fix', 'explicit area note', { area: 'canvas' })] }));
  return doc;
}

const newId = (doc) => (project) => nextTaskId(doc.sections.flatMap(s => s.tasks), project || null, []);
const find = (doc, id) => doc.sections.flatMap(s => s.tasks.map(t => ({ t, s: s.id }))).find(r => r.t.id === id);

test('plan routes to the existing todo epic, a new epic when none is open, and flags missing areas', () => {
  const plan = planFiling(makeDoc());
  const canvasNext = plan.groups.find(g => g.epic.id === 'T1');
  assert.deepEqual(canvasNext.items.map(i => i.handle), ['T3#1', 'T3#3', 'T6#1']);
  const acct = plan.groups.find(g => g.area === 'account');
  assert.equal(acct.epic.isNew, true);
  assert.equal(acct.epic.title, 'Account follow-ups');
  assert.equal(acct.epic.section, 'todo');
  assert.ok(plan.groups.every(g => g.epic.id !== 'T2'), 'never under a done epic');
  assert.deepEqual(plan.unrouted, [{ handle: 'T5#1', reason: 'needs an area' }]);
});

test('idea notes go to the lane\'s later epic, or a new one in backlog', () => {
  const doc = makeDoc();
  const later = planFiling(doc).groups.find(g => g.items.some(i => i.handle === 'T3#2'));
  assert.deepEqual([later.epic.isNew, later.epic.title, later.epic.section], [true, 'Canvas: later', 'backlog']);
  // A backlog feature epic in the lane is not a later epic: ideas skip it.
  doc.sections.find(s => s.id === 'backlog').tasks.push(task('T9', { type: 'epic', lane: 'canvas', title: 'Canvas ideas' }));
  assert.equal(planFiling(doc).groups.find(g => g.items.some(i => i.handle === 'T3#2')).epic.isNew, true);
  doc.sections.find(s => s.id === 'backlog').tasks.push(task('T10', { type: 'epic', lane: 'canvas', title: 'Canvas 5: bigger ideas (later)' }));
  const again = planFiling(doc).groups.find(g => g.items.some(i => i.handle === 'T3#2'));
  assert.equal(again.epic.id, 'T10');
});

test('plan is limited by ticket and does not mutate', () => {
  const doc = makeDoc();
  const before = JSON.stringify(doc);
  const plan = planFiling(doc, { ticket: 'T4' });
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.unrouted.length, 0);
  assert.equal(JSON.stringify(doc), before);
});

test('apply files tickets, the design pair, hands checks over and finishes the review', () => {
  const doc = makeDoc();
  doc.sections.find(s => s.id === 'in-progress').tasks.push(task('T8', { type: 'epic', lane: 'account', title: 'Account work (later)' }));
  const res = applyFiling(doc, planFiling(doc), { newId: newId(doc), now: AT });
  const t3 = find(doc, 'T3');
  // fix -> T1; design -> pick + build under T1; idea -> new later epic in backlog
  const fix = find(doc, t3.t.reviewNotes[0].filed);
  assert.equal(fix.s, 'todo');
  assert.equal(fix.t.parentId, 'T1');
  assert.equal(fix.t.title, 'Handle jumps on drag');
  assert.deepEqual(fix.t.labels, ['model:sonnet', 'ui']);
  assert.equal(fix.t.reviewOf, 'T3');
  assert.match(fix.t.description, /noted while reviewing T3 on the check "Drag works"/);
  assert.match(fix.t.description, /Filed by File review from note T3#1\./);
  const build = find(doc, t3.t.reviewNotes[2].filed);
  assert.equal(build.t.title, 'Colour palette for tabs, per the pick');
  const pick = find(doc, build.t.blockedBy[0]);
  assert.equal(pick.t.title, 'Co-task: pick colour palette for tabs');
  assert.deepEqual(pick.t.labels, ['design', 'model:opus', 'ui']);
  const idea = find(doc, t3.t.reviewNotes[1].filed);
  assert.equal(idea.s, 'backlog');
  const laterEpic = find(doc, idea.t.parentId);
  assert.deepEqual([laterEpic.s, laterEpic.t.title, laterEpic.t.lane], ['backlog', 'Canvas: later', 'canvas']);
  assert.ok(!res.pin.includes(laterEpic.t.id), 'later epic is not pinned');
  // no usable account epic (the in-progress one is a "(later)" epic): new one, blocked by it, pinned
  const acct = find(doc, find(doc, doc.sections.flatMap(s => s.tasks).find(x => x.reviewOf === 'T4').id).t.parentId);
  assert.deepEqual([acct.s, acct.t.title, acct.t.blockedBy], ['todo', 'Account follow-ups', ['T8']]);
  assert.ok(res.pin.includes(acct.t.id));
  // checks handed over, notes filed, review finished
  assert.deepEqual(t3.t.checks.map(c => [c.checked, c.handedTo]), [[true, fix.t.id], [true, build.t.id]]);
  assert.ok(t3.t.reviewNotes.every(n => n.state === 'filed'));
  assert.deepEqual(res.movedToDone.sort(), ['T3', 'T4', 'T6']);
  assert.equal(find(doc, 'T3').s, 'done');
  assert.equal(find(doc, 'T5').s, 'review', 'unrouted note stays unsent');
  assert.equal(find(doc, 'T5').t.reviewNotes[0].state, 'new');
  assert.equal(validateTasksDoc(doc).errors.filter(e => /handedTo|reviewNotes/.test(e)).length, 0);
});

test('a ticket with checks still open stays in review after filing', () => {
  const doc = makeDoc();
  find(doc, 'T3').t.reviewNotes = [note(1, 'idea', 'only an idea')];
  applyFiling(doc, planFiling(doc, { ticket: 'T3' }), { newId: newId(doc), now: AT });
  assert.equal(find(doc, 'T3').s, 'review');
});

function runCli(args, home) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  return { out: r.stdout || '', err: r.stderr || '', status: r.status ?? 2 };
}

test('CLI: notes route prints the plan; notes send files and moves the review to done', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-review-filing-'));
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(makeDoc()));
  const route = runCli(['tasks', 'notes', 'route'], home);
  assert.equal(route.status, 0, route.err);
  assert.match(route.out, /Canvas -> T1 Edit Layout 4 \(todo\)\n  T3#1 \[fix\] Handle jumps on drag/);
  assert.match(route.out, /Account -> new epic "Account follow-ups" \(todo, pinned\)\n  T4#1 \[fix\] Avatar is cropped/);
  assert.match(route.out, /Needs an area:\n  T5#1/);

  const send = runCli(['tasks', 'notes', 'send', '--ticket', 'T3'], home);
  assert.equal(send.status, 0, send.err);
  assert.match(send.out, /filed T3#1 -> T\d+ \(in T1\)/);
  assert.match(send.out, /moved T3 to done/);
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
  assert.equal(find(doc, 'T3').s, 'done');
  assert.equal(find(doc, 'T4').t.reviewNotes[0].state, 'new', '--ticket leaves other notes alone');

  const rest = runCli(['tasks', 'notes', 'send'], home);
  assert.equal(rest.status, 0, rest.err);
  const after = JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
  const epic = after.sections.flatMap(s => s.tasks).find(t => t.title === 'Account follow-ups');
  assert.ok(epic);
  assert.ok(after.meta.dailyPlan.taskIds.includes(epic.id), 'new follow-ups epic is pinned');
  assert.equal(runCli(['tasks', 'lint'], home).status, 0);
});

test('CLI: notes add --area stores the area', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-review-filing-'));
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(makeDoc()));
  assert.equal(runCli(['tasks', 'notes', 'add', 'T5', 'routed by flag', '--area', 'account'], home).status, 0);
  assert.equal(runCli(['tasks', 'notes', 'add', 'T5', 'bad', '--area', 'Bad Lane'], home).status, 1);
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
  assert.equal(find(doc, 'T5').t.reviewNotes[1].area, 'account');
});
