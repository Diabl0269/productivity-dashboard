/**
 * cli/test/answered-asks-notes.test.js
 * PRO104: answered asks on done / review / archive tickets are listed, routed and filed by the notes run
 * (`ch tasks notes`, `notes route`, `notes send`), once (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { pendingAnswers } from '../../shared/review-filing.js';
import { resolveAsk } from '../../shared/asks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const Q = 'Which focus ring should the strip use?';

const answered = (extra = {}) => ({
  n: 1, at: '2026-03-01T10:00:00.000Z', text: Q, state: 'answered', answer: 'A: Thin ring',
  options: [{ key: 'A', text: 'Thin ring' }, { key: 'B', text: 'Thick ring' }], ...extra,
});

/** A doc: epic T10 (lane "strip-ui", in todo) with a done child T11 holding an answered ask, an open child T12 likewise. */
function makeDoc() {
  const base = { checked: false, priority: 'medium', created: '2026-03-01', updated: null, subtasks: [], checks: [], links: [] };
  return {
    version: 1,
    sections: [
      { id: 'inbox', name: 'Inbox', tasks: [] },
      { id: 'backlog', name: 'Backlog', tasks: [] },
      { id: 'todo', name: 'To do', tasks: [{ ...base, id: 'T10', title: 'Strip polish', type: 'epic', lane: 'strip-ui' }] },
      { id: 'in-progress', name: 'In progress', tasks: [{ ...base, id: 'T12', title: 'Open child', parentId: 'T10', asks: [answered()] }] },
      { id: 'review', name: 'Review', tasks: [] },
      { id: 'done', name: 'Done', tasks: [{ ...base, id: 'T11', title: 'Done child', parentId: 'T10', checked: true, asks: [answered()] }] },
      { id: 'archive', name: 'Archive', tasks: [] },
    ],
  };
}

function setup(doc = makeDoc()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-answered-asks-test-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc));
  return dir;
}
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
const find = (doc, id) => doc.sections.flatMap(s => s.tasks).find(t => t.id === id);
function ch(args, dir) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}

test('listed: the answered ask on the done ticket shows in `notes` (text and json); the open ticket does not', () => {
  const dir = setup();
  const r = ch(['tasks', 'notes'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /T11#ask1 \[answer\]/);
  assert.match(r.stdout, /A: Thin ring/);
  assert.doesNotMatch(r.stdout, /T12/);
  const j = JSON.parse(ch(['tasks', 'notes', '--json'], dir).stdout);
  assert.equal(j.length, 1);
  assert.equal(j[0].id, 'T11');
  assert.equal(j[0].answers[0].answer, 'A: Thin ring');
});

test('routed: it lands in the epic of its ticket (new follow-ups epic for the lane)', () => {
  const dir = setup();
  const plan = JSON.parse(ch(['tasks', 'notes', 'route', '--json'], dir).stdout);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].area, 'strip-ui');
  assert.deepEqual(plan.groups[0].items.map(i => i.handle), ['T11#ask1']);
  assert.match(ch(['tasks', 'notes', 'route'], dir).stdout, /T11#ask1 \[answer\]/);
});

test('filed once: send makes one ticket quoting question, options and answer; a second run files nothing', () => {
  const dir = setup();
  const r = ch(['tasks', 'notes', 'send', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.filed.length, 1);
  const doc = read(dir);
  const id = out.filed[0].id;
  const ticket = find(doc, id);
  assert.match(ticket.description, /Which focus ring should the strip use\?/);
  assert.match(ticket.description, /A: Thin ring; B: Thick ring/);
  assert.match(ticket.description, /Answer: A: Thin ring/);
  assert.equal(ticket.reviewOf, 'T11');
  assert.equal(find(doc, 'T11').asks[0].filedAs, id);
  assert.equal(find(doc, 'T11').asks[0].state, 'answered');
  const again = JSON.parse(ch(['tasks', 'notes', 'send', '--json'], dir).stdout);
  assert.equal(again.filed.length, 0);
  assert.match(ch(['tasks', 'notes'], dir).stdout, /No new review notes/);
});

test('an answered ask on an open ticket is left alone', () => {
  const doc = makeDoc();
  assert.deepEqual(pendingAnswers(doc).map(a => a.handle), ['T11#ask1']);
  const dir = setup(doc);
  ch(['tasks', 'notes', 'send'], dir);
  assert.equal(find(read(dir), 'T12').asks[0].filedAs, undefined);
});

test('review and archive tickets count too', () => {
  const doc = makeDoc();
  const [t2] = doc.sections[3].tasks.splice(0, 1);
  doc.sections[4].tasks.push(t2);
  const t1 = doc.sections[5].tasks.splice(0, 1)[0];
  doc.sections[6].tasks.push(t1);
  assert.deepEqual(pendingAnswers(doc).map(a => a.handle).sort(), ['T11#ask1', 'T12#ask1']);
});

test('no double-file with the note path: an answer already turned into a note is not listed or filed', () => {
  // New path: resolveAsk on a done ticket adds the note and marks the ask filedAs.
  const doc = makeDoc();
  const t1 = find(doc, 'T11');
  t1.asks = [{ n: 1, at: '2026-03-01T10:00:00.000Z', text: Q, state: 'open' }];
  resolveAsk(t1, '1', { action: 'answer', reply: 'thin ring please', section: 'done' });
  assert.equal(t1.asks[0].state, 'answered');
  assert.deepEqual(pendingAnswers(doc).map(a => a.handle), []);
  // Old path: a note exists but the ask carries no marker.
  const old = makeDoc();
  const o = find(old, 'T11');
  o.reviewNotes = [{ n: 1, at: '2026-03-01T10:00:00.000Z', text: `Tal answered "${Q}": A: Thin ring`, kind: 'fix', state: 'filed', filed: 'T50' }];
  assert.deepEqual(pendingAnswers(old).map(a => a.handle), []);
  // And through the CLI: only the note is filed, the ask is not.
  const dir = setup(doc);
  const out = JSON.parse(ch(['tasks', 'notes', 'send', '--json'], dir).stdout);
  assert.equal(out.filed.length, 1);
  assert.equal(out.filed[0].handle, 'T11#1');
});

test('PRO109: `notes dismiss <id>#ask<n>` drops an answered ask: nothing is filed, reopen does not read it as a ticket', async () => {
  const dir = setup();
  const r = ch(['tasks', 'notes', 'dismiss', 'T11#ask1'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dismissed T11#ask1/);
  const doc = read(dir);
  assert.equal(find(doc, 'T11').asks[0].filedAs, 'dismissed');
  assert.deepEqual(pendingAnswers(doc), []);
  assert.match(ch(['tasks', 'notes'], dir).stdout, /No new review notes/);
  assert.equal(JSON.parse(ch(['tasks', 'notes', 'send', '--json'], dir).stdout).filed.length, 0);
  const { reopenHint } = await import('../../shared/asks.js');
  const hint = reopenHint(find(doc, 'T11'), find(doc, 'T11').asks[0]);
  assert.equal(hint.acted, false);
  assert.match(hint.line, /Dismissed/);
  // a second dismiss, or an unknown ask, is refused
  assert.notEqual(ch(['tasks', 'notes', 'dismiss', 'T11#ask1'], dir).status, 0);
  assert.notEqual(ch(['tasks', 'notes', 'dismiss', 'T11#ask9'], dir).status, 0);
});
