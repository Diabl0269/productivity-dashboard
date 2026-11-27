/**
 * cli/test/how-to-check-guard.test.js
 * `ch tasks add` / `update` refuse a non-epic ticket with no "How to check it" line
 * (autorun cannot start its epic), with --no-check-line as the escape hatch; `capture` is
 * exempt and `lint` warns about open tickets without one. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const FIXTURE = path.join(__dirname, 'fixtures/tasks.sample.json');
const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** open it\n';

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-howto-'));
  fs.copyFileSync(FIXTURE, path.join(dir, 'tasks.json'));
  return dir;
}
function ch(dir, ...args) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { status: r.status ?? 2, out: r.stdout || '', err: r.stderr || '' };
}
const read = dir => JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
const find = (doc, id) => doc.sections.flatMap(s => s.tasks).find(t => t.id === id);
function withDir(fn) { const d = tmp(); try { fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); } }
const REFUSED = /refused: .*has no 'How to check it' line/;

test('add refuses a task with no How to check it line', () => withDir(d => {
  const r = ch(d, 'tasks', 'add', '--no-project', 'Bare task');
  assert.notEqual(r.status, 0);
  assert.match(r.err, REFUSED);
  const r2 = ch(d, 'tasks', 'add', '--no-project', 'Plain but no check', '--description', '## In plain words\n**What you\'ll notice:** x');
  assert.notEqual(r2.status, 0);
  assert.equal(find(read(d), 'T7'), undefined);
}));

test('add succeeds with the line, and epics are exempt', () => withDir(d => {
  const r = ch(d, 'tasks', 'add', '--no-project', 'Good task', '--description', PLAIN, '--json');
  assert.equal(r.status, 0, r.err);
  const e = ch(d, 'tasks', 'add', '--no-project', 'An epic', '--type', 'epic', '--lane', 'a', '--label', 'model:sonnet', '--json');
  assert.equal(e.status, 0, e.err);
}));

test('--no-check-line records the reason as a decision', () => withDir(d => {
  const r = ch(d, 'tasks', 'add', '--no-project', 'Bookkeeping', '--no-check-line', 'only moves a label', '--json');
  assert.equal(r.status, 0, r.err);
  const t = find(read(d), JSON.parse(r.out).id);
  assert.match(t.decisions[0].text, /only moves a label/);
  assert.notEqual(ch(d, 'tasks', 'add', '--no-project', 'X', '--no-check-line', '  ').status, 0);
}));

test('update --description refuses text without the line; --add-description checks the result', () => withDir(d => {
  const bad = ch(d, 'tasks', 'update', 'T1', '--description', 'just words');
  assert.notEqual(bad.status, 0);
  assert.match(bad.err, REFUSED);
  assert.notEqual(ch(d, 'tasks', 'update', 'T1', '--add-description', 'more words').status, 0);
  assert.equal(ch(d, 'tasks', 'update', 'T1', '--description', PLAIN).status, 0);
  assert.equal(ch(d, 'tasks', 'update', 'T1', '--add-description', 'extra').status, 0);
  const hatch = ch(d, 'tasks', 'update', 'T2', '--description', 'bookkeeping', '--no-check-line', 'no behaviour');
  assert.equal(hatch.status, 0, hatch.err);
  assert.match(find(read(d), 'T2').decisions.at(-1).text, /no behaviour/);
}));

test('capture is unaffected', () => withDir(d => {
  const r = ch(d, 'tasks', 'capture', '--no-project', 'Quick thought', '--json');
  assert.equal(r.status, 0, r.err);
}));

test('lint warns about an open ticket under an open epic with no line', () => withDir(d => {
  const doc = read(d);
  const todo = doc.sections.find(s => s.id === 'todo');
  todo.tasks.push({ id: 'E9', title: 'Epic nine', checked: false, priority: 'medium', type: 'epic', lane: 'a', labels: ['model:sonnet'], subtasks: [] });
  todo.tasks.push({ id: 'C1', title: 'No line', checked: false, priority: 'medium', type: 'task', parentId: 'E9', subtasks: [] });
  todo.tasks.push({ id: 'C2', title: 'Has line', checked: false, priority: 'medium', type: 'task', parentId: 'E9', description: PLAIN, subtasks: [] });
  fs.writeFileSync(path.join(d, 'tasks.json'), JSON.stringify(doc));
  const r = ch(d, 'tasks', 'lint');
  assert.match(r.err, /lint: warning: C1 has no How to check it \(its epic E9 cannot auto-run\)/);
  assert.doesNotMatch(r.err, /C2 has no How/);
}));
