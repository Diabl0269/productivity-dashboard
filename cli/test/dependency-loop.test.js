/**
 * cli/test/dependency-loop.test.js
 * PRO133: loops between epics (a ticket waits on a follow-up whose epic waits on the ticket's epic) are flagged
 * by readiness, `ch tasks lint` and `ch tasks add --review-of`; the review filer keeps a follow-up for a
 * still-open ticket under that ticket's own epic. Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dependencyLoops, openEpicReadiness, reviewFollowUpLoop, plainReasonLine } from '../../shared/epic-ready.js';
import { planFiling } from '../../shared/review-filing.js';

const CH_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ch');
const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], checks: [], created: '2026-11-18', updated: null, description: PLAIN, ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane: 'a', description: '', labels: ['model:sonnet'], ...extra });
const mk = bySection => ({
  version: 1,
  meta: { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } },
  sections: ['inbox', 'backlog', 'todo', 'in-progress', 'review', 'done', 'archive'].map(id => ({ id, name: id, tasks: bySection[id] || [] })),
});
const ch = (h, ...args) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: h }, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const home = doc => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-loop-'));
  fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc));
  return h;
};

/** T10 (build epic) holds T11; T11 is blocked by the follow-up T21, which sits in T20, and T20 is blocked by T10. */
const loopDoc = () => mk({
  'in-progress': [epic('T10')],
  todo: [task('T11', { parentId: 'T10', blockedBy: ['T21'] }), epic('T20', { blockedBy: ['T10'] }), task('T21', { parentId: 'T20' })],
});
/** Same shape without the loop: the follow-up sits under the build epic. */
const fixedDoc = () => mk({
  'in-progress': [epic('T10')],
  todo: [task('T11', { parentId: 'T10', blockedBy: ['T21'] }), task('T21', { parentId: 'T10' }), epic('T20', { blockedBy: ['T10'] }), task('T22', { parentId: 'T20' })],
});

test('loop: the FRO1750 shape is found, written from each ticket in it', () => {
  const loops = dependencyLoops(loopDoc());
  assert.deepEqual(loops.map(l => l.id).sort(), ['T10', 'T11', 'T21']);
  assert.deepEqual(loops.find(l => l.id === 'T11').path, ['T11', 'T21', 'T10', 'T11']);
});

test('loop: no loop once the follow-up sits under the build epic; ordinary epic waits are not loops', () => {
  assert.deepEqual(dependencyLoops(fixedDoc()), []);
  const doc = mk({ todo: [epic('T10'), task('T11', { parentId: 'T10' }), epic('T20', { blockedBy: ['T10'] }), task('T21', { parentId: 'T20', blockedBy: ['T11'] })] });
  assert.deepEqual(dependencyLoops(doc), []);
});

test('loop: a finished blocker breaks the loop', () => {
  const doc = loopDoc();
  const todo = doc.sections.find(s => s.id === 'todo');
  const tb = todo.tasks.find(t => t.id === 'T21');
  doc.sections.find(s => s.id === 'done').tasks.push(tb);
  todo.tasks = todo.tasks.filter(t => t !== tb);
  assert.deepEqual(dependencyLoops(doc), []);
});

test('readiness: a child in a loop is not runnable, and the epic says Not ready: loop', () => {
  const r = openEpicReadiness(loopDoc()).find(e => e.id === 'T10');
  assert.equal(r.ready, false);
  assert.equal(r.children.find(c => c.id === 'T11').runnable, false);
  assert.match(r.children.find(c => c.id === 'T11').why, /^loop T11 -> T21 -> T10 -> T11$/);
  assert.equal(r.reasons[0], 'loop T11 -> T21 -> T10 -> T11');
  assert.match(plainReasonLine(r), /wait on each other in a loop/);
  assert.equal(openEpicReadiness(fixedDoc()).find(e => e.id === 'T10').ready, true);
});

test('reviewFollowUpLoop: only while the source is open and the target epic waits on the source epic', () => {
  const doc = mk({ 'in-progress': [epic('T10')], todo: [task('T11', { parentId: 'T10' }), epic('T20', { blockedBy: ['T10'] })] });
  assert.deepEqual(reviewFollowUpLoop(doc, 'T11', 'T20'), { sourceEpic: 'T10' });
  assert.equal(reviewFollowUpLoop(doc, 'T11', 'T10'), null);
  const done = mk({ 'in-progress': [epic('T10')], done: [task('T11', { parentId: 'T10' })], todo: [epic('T20', { blockedBy: ['T10'] })] });
  assert.equal(reviewFollowUpLoop(done, 'T11', 'T20'), null);
});

test('ch tasks add --review-of warns when the parent epic waits on the source epic; no warning under the source epic', () => {
  const doc = mk({ 'in-progress': [epic('T10')], todo: [task('T11', { parentId: 'T10' }), epic('T20', { blockedBy: ['T10'] })] });
  const bad = ch(home(doc), 'tasks', 'add', 'Redraw first', '--no-project', '--parent', 'T20', '--review-of', 'T11');
  assert.equal(bad.status, 0, bad.err);
  assert.match(bad.err, /could never start.*--parent T10/);
  const good = ch(home(doc), 'tasks', 'add', 'Redraw first', '--no-project', '--parent', 'T10', '--review-of', 'T11');
  assert.equal(good.status, 0, good.err);
  assert.doesNotMatch(good.err, /could never start/);
});

test('ch tasks lint lists the loop; ch tasks ready shows it as the reason', () => {
  const h = home(loopDoc());
  const lint = ch(h, 'tasks', 'lint');
  assert.match(lint.err, /Not ready: loop T11 -> T21 -> T10 -> T11/);
  assert.equal(JSON.parse(ch(h, 'tasks', 'lint', '--json').out).dependencyLoops.length, 3);
  assert.match(ch(h, 'tasks', 'ready').out, /Not ready: loop T11 -> T21 -> T10 -> T11/);
  assert.doesNotMatch(ch(home(fixedDoc()), 'tasks', 'lint').err, /loop/);
});

test('review filer: a follow-up for a still-open ticket goes to its own epic, not the next epic of the area', () => {
  const note = { n: 1, at: '2026-11-18T10:00:00.000Z', text: 'redraw the board first', kind: 'fix', state: 'new' };
  const doc = mk({
    'in-progress': [epic('T10', { lane: 'canvas' })],
    todo: [task('T11', { parentId: 'T10', reviewNotes: [note] }), epic('T20', { lane: 'canvas', blockedBy: ['T10'] })],
  });
  const plan = planFiling(doc);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].epic.id, 'T10');
  // a source already in review keeps the old routing (next todo epic of the area)
  const rv = mk({
    'in-progress': [epic('T10', { lane: 'canvas' })],
    review: [task('T11', { parentId: 'T10', reviewNotes: [note] })],
    todo: [epic('T20', { lane: 'canvas' })],
  });
  assert.equal(planFiling(rv).groups[0].epic.id, 'T20');
});
