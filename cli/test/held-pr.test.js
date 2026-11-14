/**
 * cli/test/held-pr.test.js
 * PRO92: a check on an unmerged PR says so. `review --held-pr` puts heldPr { pr, branch } on every
 * check of the call (own, taste, the generic "try on branch"), the epic's copy keeps it, the schema
 * accepts / rejects it, and `asks --refresh` clears it once the PR merges (fake gh, synthetic data).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { addChecks, rollUpIntoEpic } from '../../shared/review.js';
import { clearMergedHeldPrs, heldPrError, cleanHeldPr, prNumber } from '../../shared/held-pr.js';
import { validateTasksDoc } from '../lib/schema.js';
import { normalizeChecks } from '../../dashboard/js/tasks-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const PR = 'https://github.com/example/demo/pull/42';
const HELD = { pr: PR, branch: 'feat/demo-branch' };

function makeHome(mutate) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-held-test-'));
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  const t1 = doc.sections.flatMap(s => s.tasks).find(t => t.id === 'T1');
  t1.labels = [];
  t1.links = [{ url: PR, label: 'PR #42' }];
  mutate?.(doc, t1);
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc));
  return home;
}
function fakeGh(state) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-fake-gh-'));
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho '{"state":"${state}","headRefName":"feat/demo-branch"}'\n`, { mode: 0o755 });
  return bin;
}
const run = (args, home, bin) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
};
const taskOf = (home, id) => JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8')).sections.flatMap(s => s.tasks).find(t => t.id === id);

test('review --held-pr: every check of the call carries heldPr, the generic one too', () => {
  const home = makeHome();
  const r = run(['tasks', 'review', 'T1', '--shipped', 'a', '--check', 'Open the panel: the label reads Gain', '--check', 'Second look', '--held-pr', 'real-Mac check'], home, fakeGh('OPEN'));
  assert.equal(r.status, 0, r.stderr);
  const t = taskOf(home, 'T1');
  assert.equal(t.checks.length, 3);
  for (const c of t.checks) assert.deepEqual(c.heldPr, HELD, c.text);
  assert.deepEqual(validateTasksDoc(JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'))).errors ?? [], []);
});

test('review --held-pr on a child: the epic copy keeps the label', () => {
  const home = makeHome((doc, t1) => {
    const epic = { id: 'T9', title: 'Epic', type: 'epic', checked: false, priority: 'medium', subtasks: [] };
    doc.sections.find(s => s.id === 'todo').tasks.push(epic);
    t1.parentId = 'T9';
  });
  const r = run(['tasks', 'review', 'T1', '--shipped', 'a', '--check', 'Look at the knob', '--held-pr', 'why'], home, fakeGh('OPEN'));
  assert.equal(r.status, 0, r.stderr);
  const epic = taskOf(home, 'T9');
  assert.ok(epic.checks.length >= 2);
  for (const c of epic.checks) assert.deepEqual(c.heldPr, HELD, c.text);
  assert.ok(epic.checks.every(c => c.text.startsWith('T1: ')));
});

test('addChecks copies heldPr onto new checks and onto an existing same-text check', () => {
  const task = { checks: [{ text: 'same', checked: false }] };
  addChecks(task, [{ text: 'same', heldPr: HELD }, { text: 'new', heldPr: HELD }]);
  assert.deepEqual(task.checks.map(c => c.heldPr), [HELD, HELD]);
  assert.notEqual(task.checks[0].heldPr, HELD, 'copied, not shared');
});

test('rollUpIntoEpic carries heldPr to the prefixed copy', () => {
  const doc = { sections: [{ id: 'todo', tasks: [{ id: 'E1', type: 'epic' }, { id: 'C1', parentId: 'E1' }] }] };
  rollUpIntoEpic(doc, doc.sections[0].tasks[1], [{ text: 'look', heldPr: HELD }]);
  assert.deepEqual(doc.sections[0].tasks[0].checks[0].heldPr, HELD);
  assert.equal(doc.sections[0].tasks[0].checks[0].text, 'C1: look');
});

test('schema accepts a heldPr with a PR url and a branch (even empty) and rejects the rest', () => {
  const ok = (h) => heldPrError(h, 'x') === '';
  assert.ok(ok(HELD));
  assert.ok(ok({ pr: PR, branch: '' }));
  assert.ok(!ok({ pr: 'https://example.com', branch: 'b' }));
  assert.ok(!ok({ pr: PR }));
  assert.ok(!ok('nope'));
  const doc = { sections: [{ id: 'todo', name: 'To do', tasks: [{ id: 'T1', title: 't', checked: false, checks: [{ text: 'a', checked: false, heldPr: { pr: 'bad', branch: 1 } }] }] }] };
  const res = validateTasksDoc(doc);
  assert.ok((res.errors || []).some(e => /heldPr/.test(e)), JSON.stringify(res));
});

test('dashboard loader keeps a well-formed heldPr and drops a malformed one', () => {
  const [a, b] = normalizeChecks([{ text: 'a', checked: false, heldPr: HELD }, { text: 'b', checked: false, heldPr: { pr: 'x' } }]);
  assert.deepEqual(a.heldPr, HELD);
  assert.equal(b.heldPr, undefined);
  assert.equal(cleanHeldPr(null), null);
  assert.equal(prNumber(PR), '#42');
});

test('clearMergedHeldPrs drops merged labels only, and the task heldPr', () => {
  const other = 'https://github.com/example/demo/pull/7';
  const task = { heldPr: { ...HELD, reason: 'r' }, checks: [{ text: 'a', heldPr: { ...HELD } }, { text: 'b', heldPr: { pr: other, branch: 'x' } }, { text: 'c' }] };
  const state = (u) => (u === PR ? { state: 'MERGED' } : { error: 'offline' });
  const cleared = clearMergedHeldPrs(task, state);
  assert.deepEqual(cleared, [HELD]);
  assert.equal(task.checks[0].heldPr, undefined);
  assert.ok(task.checks[1].heldPr, 'unknown state keeps the label');
  assert.equal(task.heldPr, undefined);
});

test('asks --refresh clears the label on a merged PR and says so', () => {
  const home = makeHome();
  run(['tasks', 'review', 'T1', '--shipped', 'a', '--check', 'Look', '--held-pr', 'why'], home, fakeGh('OPEN'));
  let r = run(['tasks', 'asks', '--refresh'], home, fakeGh('OPEN'));
  assert.doesNotMatch(r.stdout, /cleared branch label/);
  assert.ok(taskOf(home, 'T1').checks.every(c => c.heldPr));
  r = run(['tasks', 'asks', '--refresh'], home, fakeGh('MERGED'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`cleared branch label on T1 \\(${PR.replace(/[/.]/g, '\\$&')} merged\\)`));
  assert.ok(taskOf(home, 'T1').checks.every(c => !c.heldPr));
});
