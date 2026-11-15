/**
 * cli/test/reopen-ask.test.js
 * PRO107: a dismissed or answered question can be reopened (shared/asks.js reopenAsk, `ch tasks answer <id> <key> --reopen`),
 * unless the follow-up filed from it has started; reopenHint says whether Claude already acted on it (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { addAsk, resolveAsk, reopenAsk, reopenHint, resolvedTaskAsks, openAsks, taskAsks } from '../../shared/asks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const AT = '2026-03-01T10:00:00.000Z';
const D = 'Open the Reverb panel on the master bus and compare the setting before and after; it decides the default.';

function ticket() {
  const t = { id: 'T1', title: 'Reverb', checked: false, priority: 'medium', subtasks: [] };
  addAsk(t, { text: 'Keep the tail?', options: ['A: yes', 'B: no'], details: D, now: AT });
  return t;
}
const docOf = (t, section = 'todo') => ({ sections: [{ id: section, tasks: [t] }] });

test('reopenAsk: a dismissed ask is open again, listed in taskAsks and openAsks, answer cleared', () => {
  const t = ticket();
  resolveAsk(t, '1', { action: 'dismiss', now: AT, section: 'todo' });
  assert.equal(taskAsks(t).length, 0);
  assert.equal(resolvedTaskAsks(t)[0].state, 'dismissed');
  const out = reopenAsk(t, '1');
  assert.equal(out.question, 'Keep the tail?');
  assert.equal(t.asks[0].state, 'open');
  assert.equal(t.waitingOn, 'Tal: Keep the tail?');
  assert.deepEqual(taskAsks(t).map(a => a.key), ['1']);
  assert.deepEqual(openAsks(docOf(t, 'in-progress')).map(r => [r.id, r.key]), [['T1', '1']]);
});

test('reopenAsk: an answered ask loses its answer and resolvedAt; the decision stays', () => {
  const t = ticket();
  resolveAsk(t, '1', { action: 'answer', reply: 'A', now: AT, section: 'in-progress' });
  assert.equal(t.asks[0].answer, 'A: yes');
  assert.ok(t.asks[0].resolvedAt);
  reopenAsk(t, '1');
  assert.equal('answer' in t.asks[0], false);
  assert.equal('resolvedAt' in t.asks[0], false);
  assert.equal(t.decisions.length, 1, 'reopening does not undo the decision');
});

test('reopenAsk: refuses an open ask, a missing key and a legacy resolvedAsks line', () => {
  const t = ticket();
  assert.throws(() => reopenAsk(t, '1'), /already open/);
  assert.throws(() => reopenAsk(t, '9'), /no own question "9"/);
  const old = { id: 'T2', title: 'Old', resolvedAsks: [{ kind: 'left', text: 'Is it right?', state: 'answered', at: AT }] };
  assert.throws(() => reopenAsk(old, 'L1'), /cannot be reopened/);
});

test('reopenAsk: refused once the follow-up filed from the ask has started; allowed while it is in todo', () => {
  const t = ticket();
  resolveAsk(t, '1', { action: 'answer', reply: 'make it longer', now: AT, section: 'done' });
  t.asks[0].filedAs = 'T7';
  const lookup = (section) => (id) => (id === 'T7' ? { task: { id: 'T7' }, section } : null);
  assert.throws(() => reopenAsk(t, '1', { lookup: lookup('in-progress') }), /T7.*has started \(in-progress\)/);
  assert.equal(t.asks[0].state, 'answered', 'a refused reopen changes nothing');
  assert.equal(t.asks[0].filedAs, 'T7');
  reopenAsk(t, '1', { lookup: lookup('todo') });
  assert.equal(t.asks[0].state, 'open');
  assert.equal('filedAs' in t.asks[0], false);
});

test('reopenHint: says whether Claude already acted on the answer', () => {
  const t = ticket();
  resolveAsk(t, '1', { action: 'dismiss', now: AT, section: 'todo' });
  assert.match(reopenHint(t, resolvedTaskAsks(t)[0]).line, /^Nothing acted on this yet: changing it still matters$/);
  const filed = { ...resolvedTaskAsks(t)[0], filedAs: 'FRO12' };
  const h = reopenHint(t, filed);
  assert.equal(h.acted, true);
  assert.equal(h.line, "Claude already filed FRO12 from this answer: changing it won't undo that");
  const u = ticket();
  resolveAsk(u, '1', { action: 'answer', reply: 'A', now: AT, section: 'in-progress' });
  assert.equal(reopenHint(u, resolvedTaskAsks(u)[0]).acted, true, 'a recorded decision counts');
});

function homeWith(t, section = 'todo') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-reopen-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ version: 1, sections: [{ id: section, name: section, tasks: [t] }] }));
  return dir;
}
const run = (args, dir) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
};
const readAsk = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).sections[0].tasks[0].asks[0];

test('CLI: answer --reopen puts a dismissed question back to open and prints the hint', () => {
  const t = ticket();
  resolveAsk(t, '1', { action: 'dismiss', now: AT, section: 'todo' });
  const dir = homeWith(t);
  const r = run(['tasks', 'answer', 'T1', '1', '--reopen'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /T1 question 1 reopened/);
  assert.match(r.stdout, /Nothing acted on this yet/);
  assert.equal(readAsk(dir).state, 'open');
  const j = run(['tasks', 'asks', '--json'], dir);
  assert.deepEqual(JSON.parse(j.stdout).asks.map(a => a.key), ['1']);
});

test('CLI: answer --reopen is refused when the follow-up has started, and with another action flag', () => {
  const t = ticket();
  resolveAsk(t, '1', { action: 'answer', reply: 'make it longer', now: AT, section: 'done' });
  t.asks[0].filedAs = 'T7';
  const dir = homeWith(t);
  const file = path.join(dir, 'tasks.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.sections.push({ id: 'in-progress', name: 'in-progress', tasks: [{ id: 'T7', title: 'Longer tail', checked: false, priority: 'medium', subtasks: [] }] });
  fs.writeFileSync(file, JSON.stringify(doc));
  let r = run(['tasks', 'answer', 'T1', '1', '--reopen'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /T7.*has started/);
  assert.equal(readAsk(dir).state, 'answered');
  r = run(['tasks', 'answer', 'T1', '1', '--reopen', '--dismiss'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not go with/);
});
