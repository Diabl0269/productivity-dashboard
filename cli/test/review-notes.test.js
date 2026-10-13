/**
 * cli/test/review-notes.test.js
 * Review notes: shared/review-notes.js unit tests plus CLI flows (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  addReviewNote, unsentNotes, setNoteState, parseNoteHandle, noteLine, reviewNoteErrors,
  pendingReviewNotes, countUnsentNotes,
} from '../../shared/review-notes.js';
import { reviewComplete } from '../../shared/review.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

function makeTmpDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-review-notes-test-'));
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

function find(tmpDir, id) {
  for (const s of readTasks(tmpDir).sections) {
    const task = s.tasks.find(t => t.id === id);
    if (task) return { task, section: s.id };
  }
  return null;
}

/** Ship T3 into review with two checks. */
function shipT3(dir) {
  const r = runCli(['tasks', 'review', 'T3', '--shipped', 'added A', '--check', 'look at A', '--check', 'look at B'], dir);
  assert.equal(r.status, 0, r.stderr);
}

test('addReviewNote: numbers per ticket, never reuses, validates', () => {
  const task = { id: 'T1' };
  const a = addReviewNote(task, { text: '  first ', now: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(a, { n: 1, at: '2026-01-01T00:00:00.000Z', text: 'first', kind: 'fix', state: 'new' });
  const b = addReviewNote(task, { text: 'second', kind: 'idea', check: 'works' });
  assert.equal(b.n, 2);
  assert.equal(b.check, 'works');
  setNoteState(task, 2, 'dismissed');
  assert.equal(addReviewNote(task, { text: 'third' }).n, 3);
  assert.throws(() => addReviewNote(task, { text: '   ' }));
  assert.throws(() => addReviewNote(task, { text: 'x', kind: 'bogus' }));
  assert.throws(() => setNoteState(task, 99, 'filed'));
  assert.throws(() => setNoteState(task, 1, 'weird'));
  setNoteState(task, 1, 'filed', { filed: 'T9' });
  assert.equal(task.reviewNotes[0].filed, 'T9');
  assert.deepEqual(unsentNotes(task).map(n => n.n), [3]);
});

test('parseNoteHandle', () => {
  assert.deepEqual(parseNoteHandle('PRO19#3'), { id: 'PRO19', n: 3 });
  assert.equal(parseNoteHandle('PRO19'), null);
  assert.equal(parseNoteHandle('PRO19#x'), null);
  assert.equal(parseNoteHandle(''), null);
});

test('noteLine: with and without a check, long checks truncated', () => {
  assert.equal(noteLine('T1', { n: 2, kind: 'fix', text: 'broken', check: 'works' }), 'T1#2 [fix] on "works": broken');
  assert.equal(noteLine('T1', { n: 3, kind: 'idea', text: 'maybe' }), 'T1#3 [idea]: maybe');
  const long = 'x'.repeat(60);
  assert.equal(noteLine('T1', { n: 1, kind: 'fix', text: 't', check: long }), `T1#1 [fix] on "${'x'.repeat(50)}…": t`);
});

test('reviewNoteErrors flags bad notes', () => {
  assert.deepEqual(reviewNoteErrors([{ n: 1, at: '2026-01-01T00:00:00Z', text: 'a', kind: 'fix', state: 'new' }], 'r'), []);
  assert.ok(reviewNoteErrors('nope', 'r').length);
  const errs = reviewNoteErrors([
    { n: 1, at: 'yesterday', text: ' ', kind: 'zzz', state: 'old', check: 3 },
    { n: 1, at: '2026-01-01T00:00:00Z', text: 'a', kind: 'fix', state: 'new' },
  ], 'r');
  assert.ok(errs.length >= 6, errs.join('\n'));
});

test('reviewComplete is false with unsent notes, true after dismiss', () => {
  const task = { id: 'T1', checks: [{ text: 'a', checked: true }] };
  addReviewNote(task, { text: 'todo' });
  assert.equal(reviewComplete(task, 'review', { ticked: true }), false);
  setNoteState(task, 1, 'dismissed');
  assert.equal(reviewComplete(task, 'review', { ticked: true }), true);
});

test('pendingReviewNotes and countUnsentNotes walk the doc', () => {
  const t = { id: 'T1', title: 'One', type: 'task' };
  addReviewNote(t, { text: 'a' });
  addReviewNote(t, { text: 'b' });
  const doc = { sections: [{ id: 'review', tasks: [t, { id: 'T2', title: 'Two' }] }] };
  const p = pendingReviewNotes(doc);
  assert.equal(p.length, 1);
  assert.equal(p[0].section, 'review');
  assert.equal(countUnsentNotes(doc), 2);
});

test('CLI: notes add -> list -> json -> dismiss', () => {
  const dir = makeTmpDir();
  shipT3(dir);
  assert.equal(runCli(['tasks', 'notes'], dir).stdout.trim(), 'No new review notes.');
  const add = runCli(['tasks', 'notes', 'add', 'T3', 'A is off', '--kind', 'idea', '--check', '1'], dir);
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /added T3#1/);
  assert.equal(find(dir, 'T3').task.reviewNotes[0].check, 'look at A');
  const list = runCli(['tasks', 'notes'], dir);
  assert.match(list.stdout, /^T3 /m);
  assert.match(list.stdout, /^  T3#1 \[idea\] on "look at A": A is off$/m);
  const json = JSON.parse(runCli(['tasks', 'notes', '--json'], dir).stdout);
  assert.equal(json[0].id, 'T3');
  assert.equal(json[0].notes[0].n, 1);
  assert.deepEqual(JSON.parse(runCli(['tasks', 'notes', '--ticket', 'T1', '--json'], dir).stdout), []);
  assert.match(runCli(['tasks', 'get', 'T3'], dir).stdout, /review notes: 1 new, 0 filed, 0 dismissed/);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
  const dis = runCli(['tasks', 'notes', 'dismiss', 'T3#1'], dir);
  assert.match(dis.stdout, /dismissed T3#1/);
  assert.equal(runCli(['tasks', 'notes'], dir).stdout.trim(), 'No new review notes.');
  assert.notEqual(runCli(['tasks', 'notes', 'add', 'T3', 'x', '--check', '9'], dir).status, 0);
  assert.notEqual(runCli(['tasks', 'notes', 'add', 'T3', 'x', '--kind', 'zzz'], dir).status, 0);
});

test('CLI: ch context first line only with unsent notes', () => {
  const dir = makeTmpDir();
  shipT3(dir);
  const before = runCli(['context'], dir);
  assert.doesNotMatch(before.stdout, /new review note/);
  assert.equal(JSON.parse(runCli(['context', '--json'], dir).stdout).new_review_notes, 0);
  runCli(['tasks', 'notes', 'add', 'T3', 'one'], dir);
  const after = runCli(['context'], dir);
  assert.equal(after.stdout.split('\n')[0], '1 new review note(s): ch tasks notes');
  assert.equal(JSON.parse(runCli(['context', '--json'], dir).stdout).new_review_notes, 1);
});

test('CLI: lint flags a malformed reviewNotes entry', () => {
  const dir = makeTmpDir();
  shipT3(dir);
  const doc = readTasks(dir);
  const t = doc.sections.flatMap(s => s.tasks).find(x => x.id === 'T3');
  t.reviewNotes = [{ n: 'one', text: '' }];
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc));
  const r = runCli(['tasks', 'lint'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /reviewNotes/);
});

test('CLI: ticking all checks with an unsent note keeps the ticket in review', () => {
  const dir = makeTmpDir();
  shipT3(dir);
  runCli(['tasks', 'notes', 'add', 'T3', 'still to send'], dir);
  const r = runCli(['tasks', 'update', 'T3', '--check-all-checks'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /1 review note\(s\) unsent: ch tasks notes --ticket T3/);
  assert.equal(find(dir, 'T3').section, 'review');
  runCli(['tasks', 'notes', 'dismiss', 'T3#1'], dir);
  runCli(['tasks', 'update', 'T3', '--check-all-checks'], dir);
  assert.equal(find(dir, 'T3').section, 'done');
});
