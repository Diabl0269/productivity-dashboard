/**
 * cli/test/answer-closes-review-card.test.js
 * An answered last ask closes its review card (done, with a decision, answer still filed by the notes run);
 * AGE98: a ticket with an open ask never moves to done (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { answerAsk, closesAfterAnswer, ANSWER_CLOSE_LINE, openAskBlock } from '../../shared/asks.js';
import { pendingAnswers } from '../../shared/review-filing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const ask = (n, extra = {}) => ({ n, at: '2026-03-01T10:00:00.000Z', text: `Question ${n}?`, state: 'open', options: [{ key: 'A', text: 'Yes' }, { key: 'B', text: 'No' }], ...extra });

function makeDoc({ asks, checks = [], section = 'review' } = {}) {
  const base = { checked: false, priority: 'medium', created: '2026-03-01', updated: null, subtasks: [], checks: [], links: [] };
  const t = { ...base, id: 'T1', title: 'Design ticket', checked: section !== 'todo', asks: asks || [ask(1)], checks };
  const secs = ['inbox', 'backlog', 'todo', 'in-progress', 'review', 'done', 'archive'].map(id => ({ id, name: id, tasks: id === section ? [t] : [] }));
  return { version: 1, sections: secs };
}
const find = (doc, id) => doc.sections.flatMap(s => s.tasks).find(t => t.id === id);
const sectionOf = (doc, id) => doc.sections.find(s => s.tasks.some(t => t.id === id)).id;
const AT = '2026-11-16T10:00:00.000Z';

function setup(doc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-answer-close-test-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc));
  return dir;
}
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
function ch(args, dir) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}

test('answering the last ask of a review ticket with no unticked checks moves it to done with the closing decision', () => {
  const doc = makeDoc();
  const out = answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'A', now: AT });
  assert.deepEqual(out.closed, ['T1']);
  assert.equal(sectionOf(doc, 'T1'), 'done');
  const t = find(doc, 'T1');
  assert.equal(t.checked, true);
  assert.ok(t.decisions.some(d => d.text === ANSWER_CLOSE_LINE));
  const moved = t.history.find(h => h.event === 'moved' && h.to === 'done');
  assert.equal(moved.from, 'review');
  assert.equal(moved.note, ANSWER_CLOSE_LINE);
});

test('the answer is still listed for the notes run after the close (PRO104)', () => {
  const doc = makeDoc();
  answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'A', now: AT });
  const pending = pendingAnswers(doc);
  assert.deepEqual(pending.map(p => p.handle), ['T1#ask1']);
  assert.equal(pending[0].section, 'done');
});

test('through the CLI: ch tasks answer closes it and ch tasks notes still lists the answer', () => {
  const dir = setup(makeDoc());
  const r = ch(['tasks', 'answer', 'T1', '1', 'A'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /closed T1/);
  assert.equal(sectionOf(read(dir), 'T1'), 'done');
  assert.match(ch(['tasks', 'notes'], dir).stdout, /T1#ask1 \[answer\]/);
});

test('stays in review while a check is unticked or another ask is open; --dismiss and park never close it', () => {
  const unticked = makeDoc({ checks: [{ text: 'Looks right', checked: false }] });
  assert.deepEqual(answerAsk(unticked, 'T1', '1', { action: 'answer', reply: 'A', now: AT }).closed, []);
  assert.equal(sectionOf(unticked, 'T1'), 'review');
  const two = makeDoc({ asks: [ask(1), ask(2)] });
  assert.deepEqual(answerAsk(two, 'T1', '1', { action: 'answer', reply: 'A', now: AT }).closed, []);
  assert.equal(sectionOf(two, 'T1'), 'review');
  assert.deepEqual(answerAsk(two, 'T1', '2', { action: 'answer', reply: 'B', now: AT }).closed, ['T1']);
  const dismissed = makeDoc();
  assert.deepEqual(answerAsk(dismissed, 'T1', '1', { action: 'dismiss', now: AT }).closed, []);
  assert.equal(sectionOf(dismissed, 'T1'), 'review');
  assert.equal(closesAfterAnswer(find(makeDoc({ section: 'todo' }), 'T1'), 'todo'), false);
});

test('a linked check ticked by the answer lets the ticket close', () => {
  const doc = makeDoc({ asks: [ask(1, { checkRefs: [{ id: 'T1', text: 'Looks right' }] })], checks: [{ text: 'Looks right', checked: false }] });
  const out = answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'A', now: AT });
  assert.deepEqual(out.closed, ['T1']);
});

test('AGE98: done and move-to-done refuse while an ask is open, naming --dismiss; they work after it', () => {
  const dir = setup(makeDoc());
  for (const args of [['tasks', 'done', 'T1'], ['tasks', 'move', 'T1', 'done']]) {
    const r = ch(args, dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /open ask/);
    assert.match(r.stderr, /ch tasks answer T1 1 --dismiss/);
    assert.equal(sectionOf(read(dir), 'T1'), 'review');
  }
  assert.equal(ch(['tasks', 'answer', 'T1', '1', '--dismiss'], dir).status, 0);
  assert.equal(ch(['tasks', 'done', 'T1'], dir).status, 0);
  assert.equal(sectionOf(read(dir), 'T1'), 'done');
});

test('openAskBlock: empty without an open ask', () => {
  assert.equal(openAskBlock({ id: 'T1', asks: [{ n: 1, text: 'q', state: 'answered', answer: 'A' }] }), '');
  assert.match(openAskBlock({ id: 'T1', asks: [ask(1)] }), /T1 still has an open ask \(1\)/);
});

test('an epic closed by its last answer leaves the day plan (CLI and shared path)', () => {
  const doc = makeDoc({ asks: [ask(1)] });
  find(doc, 'T1').type = 'epic';
  doc.meta = { dailyPlan: { date: '2026-11-16', taskIds: ['T1', 'T9'], carriedIds: ['T1'] } };
  const out = answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'A', now: AT });
  assert.deepEqual(out.closed, ['T1']);
  assert.deepEqual(out.unpinned, ['T1']);
  assert.deepEqual(doc.meta.dailyPlan.taskIds, ['T9']);
  assert.deepEqual(doc.meta.dailyPlan.carriedIds, []);

  const doc2 = makeDoc();
  find(doc2, 'T1').type = 'epic';
  doc2.meta = { dailyPlan: { date: '2026-11-16', taskIds: ['T1'], carriedIds: [] } };
  const dir = setup(doc2);
  const r = ch(['tasks', 'answer', 'T1', '1', 'A'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /unpinned T1/);
  assert.deepEqual(read(dir).meta.dailyPlan.taskIds, []);
});
