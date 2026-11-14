/**
 * cli/test/interpretations.test.js
 * PRO96: "Interpretation:" lines become Plan page cards (OK / Not this); never a gate (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  parseInterpretationLine, interpretationsIn, taskInterpretations, openInterpretations, resolveInterpretation, addInterpretation,
} from '../../shared/interpretations.js';
import { openAsks } from '../../shared/asks.js';
import { openEpicReadiness } from '../../shared/epic-ready.js';
import { validateTasksDoc } from '../lib/schema.js';
import { loadTasksJson, serializeTasksJson } from '../../dashboard/js/tasks-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const READING = 'a dark theme toggle in the header, not a new settings page';

const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** open the panel and look at the title\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
const mk = (bySection) => ({
  version: 1,
  meta: { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } },
  sections: Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks })),
});
const withReading = (extra = {}) => task('T12', { parentId: 'T11', description: `${PLAIN}\nInterpretation: ${READING}`, ...extra });
const docWith = (child = withReading()) => mk({ todo: [task('T11', { type: 'epic', lane: 'a', description: '' }), child] });

function runCli(args, dir) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}

function tmpHome(doc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-interp-test-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc));
  return dir;
}

test('parsing: description lines, bullets, bold, case, left lines, repeats', () => {
  assert.equal(parseInterpretationLine('Interpretation: read it as X'), 'read it as X');
  assert.equal(parseInterpretationLine('  - interpretation:   read it as X  '), 'read it as X');
  assert.equal(parseInterpretationLine('**Interpretation:** read it as X'), 'read it as X');
  assert.equal(parseInterpretationLine('Interpretation:'), '');
  assert.equal(parseInterpretationLine('My interpretation: X'), '');
  assert.equal(parseInterpretationLine('Interpretations differ'), '');
  assert.deepEqual(interpretationsIn('a\nInterpretation: one\nb\nInterpretation: two\nInterpretation: one'), ['one', 'two']);
  const t = task('T19', { description: 'Interpretation: from description', result: { at: '2026-03-01T10:00:00.000Z', left: ['Interpretation: from left', 'plain'] } });
  assert.deepEqual(taskInterpretations(t), ['from description', 'from left']);
});

test('cards show on open tickets only, oldest first, with ticket, reading and key', () => {
  const doc = mk({
    todo: [withReading({ id: 'T13', updated: '2026-02-02' }), withReading({ id: 'T12', updated: '2026-02-01' })],
    done: [withReading({ id: 'T14', checked: true })],
    archive: [withReading({ id: 'T15' })],
  });
  const cards = openInterpretations(doc);
  assert.deepEqual(cards.map(c => [c.id, c.key, c.text, c.section]), [['T12', 'I1', READING, 'todo'], ['T13', 'I1', READING, 'todo']]);
  assert.equal(cards[0].title, 'Task T12');
});

test('an unanswered card leaves the ticket Ready and runnable: no ask, no waitingOn', () => {
  const plain = openEpicReadiness(docWith(task('T12', { parentId: 'T11' })))[0];
  const doc = docWith();
  const r = openEpicReadiness(doc)[0];
  assert.equal(openInterpretations(doc).length, 1);
  assert.equal(r.ready, true);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.children, plain.children);
  assert.equal(r.children[0].runnable, true);
  assert.deepEqual(openAsks(doc), []);
  const t = doc.sections[0].tasks[1];
  assert.equal(t.waitingOn, undefined);
  assert.equal(t.asks, undefined);
  assert.equal(validateTasksDoc(doc).errors.length, 0);
});

test('OK resolves silently: the card goes, nothing else changes, the ticket stays Ready', () => {
  const doc = docWith();
  const t = doc.sections[0].tasks[1];
  const before = { ...t, resolvedAsks: undefined };
  const out = resolveInterpretation(t, READING, { action: 'ok', now: '2026-03-02T00:00:00.000Z' });
  assert.equal(out.note, null);
  assert.deepEqual(openInterpretations(doc), []);
  assert.deepEqual(t.resolvedAsks, [{ kind: 'interpretation', text: READING, state: 'done', at: '2026-03-02T00:00:00.000Z' }]);
  assert.equal(t.reviewNotes, undefined);
  assert.deepEqual({ ...t, resolvedAsks: undefined }, before);
  assert.equal(openEpicReadiness(doc)[0].ready, true);
  assert.equal(validateTasksDoc(doc).errors.length, 0);
});

test('Not this needs text, adds the NEWEST review note, resolves the card, ticket stays Ready', () => {
  const doc = docWith(withReading({ reviewNotes: [{ n: 4, at: '2026-02-01T00:00:00.000Z', text: 'older note', kind: 'idea', state: 'filed' }] }));
  const t = doc.sections[0].tasks[1];
  assert.throws(() => resolveInterpretation(t, READING, { action: 'not-this', reply: '  ' }), /needs the correction/);
  assert.throws(() => resolveInterpretation(t, 'something else', { action: 'ok' }), /no interpretation/);
  const out = resolveInterpretation(t, READING, { action: 'not-this', reply: 'a new settings page, please', now: '2026-03-02T00:00:00.000Z' });
  assert.equal(out.note.n, 5);
  assert.equal(t.reviewNotes.at(-1).text.includes('a new settings page, please'), true);
  assert.deepEqual(openInterpretations(doc), []);
  assert.equal(t.resolvedAsks[0].state, 'answered');
  assert.equal(openEpicReadiness(doc)[0].ready, true);
  assert.equal(validateTasksDoc(doc).errors.length, 0);
});

test('state survives the dashboard load / save round trip', () => {
  const doc = docWith();
  const t = doc.sections[0].tasks[1];
  resolveInterpretation(t, READING, { action: 'not-this', reply: 'fix it' });
  const loaded = loadTasksJson(JSON.stringify(doc));
  const text = serializeTasksJson(loaded.sections, loaded.tasks, loaded.ticketTypes, loaded.meta);
  const back = JSON.parse(text).sections[0].tasks.find(x => x.id === 'T12');
  assert.deepEqual(back.resolvedAsks.map(x => [x.kind, x.text, x.state]), [['interpretation', READING, 'answered']]);
  assert.equal(back.reviewNotes.length, 1);
});

test('CLI: interpret records the line; Not this note is the newest note in `ch tasks get`', () => {
  const dir = tmpHome(docWith(task('T12', { parentId: 'T11' })));
  let r = runCli(['tasks', 'interpret', 'T12', READING], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(runCli(['tasks', 'interpret', 'T12', READING], dir).stdout, /already recorded/);
  assert.equal(runCli(['tasks', 'interpret', 'T12'], dir).status, 1);
  const file = path.join(dir, 'tasks.json');
  let doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  let t = doc.sections[0].tasks.find(x => x.id === 'T12');
  assert.equal(t.description.split('Interpretation:').length, 2);
  assert.equal(t.waitingOn, undefined);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
  assert.match(runCli(['tasks', 'ready'], dir).stdout, /\[ready\]\s+T11/);
  // what the dashboard's Not this does to the stored ticket, then what a session sees
  resolveInterpretation(t, READING, { action: 'not-this', reply: 'make it a settings page' });
  fs.writeFileSync(file, JSON.stringify(doc));
  r = runCli(['tasks', 'get', 'T12'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /review notes: 1 new/);
  assert.match(r.stdout, /T12#1 \[fix\]: Interpretation correction: .*make it a settings page/);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
  assert.match(runCli(['tasks', 'ready'], dir).stdout, /\[ready\]\s+T11/);
});

test('addInterpretation: empty refused, repeat is a no-op', () => {
  const t = task('T12', { description: '' });
  assert.throws(() => addInterpretation(t, '  '), /empty/);
  assert.equal(addInterpretation(t, 'X'), true);
  assert.equal(addInterpretation(t, 'X'), false);
  assert.equal(t.description, 'Interpretation: X');
});
