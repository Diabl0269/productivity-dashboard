import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTasksJson, serializeTasksJson } from '../../dashboard/js/tasks-json.js';
import { computeRunPlan } from '../../shared/run-plan.js';

const result = { at: '2026-10-01T10:00:00.000Z', shipped: ['Added the thing'], tests: ['t1'], ci: 'all passed' };

function docText() {
  return JSON.stringify({
    version: 1,
    sections: [
      { id: 'todo', name: 'To do', tasks: [
        { id: 'T3', title: 'Follow-up', reviewOf: 'T2', checked: false },
      ] },
      { id: 'review', name: 'Ready for review', tasks: [
        { id: 'T2', title: 'Newer', checked: true, result: { ...result, at: '2026-10-03T10:00:00.000Z' },
          checks: [{ text: 'looks right', checked: true }, { text: 'works', checked: false }] },
        { id: 'T1', title: 'Older', checked: true, result,
          history: [{ at: '2026-10-01T10:00:00.000Z', event: 'moved', from: 'in-progress', to: 'review' }] },
      ] },
      { id: 'done', name: 'Done', tasks: [] },
    ],
  });
}

test('tasks-json round-trips reviewOf, result and the review section', () => {
  const loaded = loadTasksJson(docText());
  assert.ok(loaded.sections.some(s => s.id === 'review'));
  assert.equal(loaded.tasks.todo[0].reviewOf, 'T2');
  assert.deepEqual(loaded.tasks.review[1].result, result);
  const out = JSON.parse(serializeTasksJson(loaded.sections, loaded.tasks, loaded.ticketTypes, loaded.meta));
  const review = out.sections.find(s => s.id === 'review');
  assert.equal(review.tasks.find(t => t.id === 'T1').result.shipped[0], 'Added the thing');
  assert.equal(out.sections.find(s => s.id === 'todo').tasks[0].reviewOf, 'T2');
});

test('tasks-json drops a malformed result and empty reviewOf', () => {
  const doc = JSON.parse(docText());
  doc.sections[0].tasks[0].reviewOf = '  ';
  doc.sections[1].tasks[0].result = ['nope'];
  const loaded = loadTasksJson(JSON.stringify(doc));
  const out = JSON.parse(serializeTasksJson(loaded.sections, loaded.tasks, loaded.ticketTypes, loaded.meta));
  assert.equal('reviewOf' in out.sections[0].tasks[0], false);
  assert.equal('result' in out.sections[1].tasks[0], false);
});

test('tasks-json round-trips reviewNotes and drops malformed ones', () => {
  const doc = JSON.parse(docText());
  const good = { n: 1, at: '2026-10-02T10:00:00.000Z', text: 'fix it', kind: 'fix', check: 'works', state: 'new' };
  doc.sections[1].tasks[0].reviewNotes = [good, { n: 0, text: 'bad' }, { n: 2, at: 'x', text: 'y', kind: 'nope', state: 'new' }];
  const loaded = loadTasksJson(JSON.stringify(doc));
  assert.deepEqual(loaded.tasks.review[0].reviewNotes, [good]);
  const out = JSON.parse(serializeTasksJson(loaded.sections, loaded.tasks, loaded.ticketTypes, loaded.meta));
  const review = out.sections.find(s => s.id === 'review');
  assert.deepEqual(review.tasks.find(t => t.id === 'T2').reviewNotes, [good]);
  assert.equal('reviewNotes' in review.tasks.find(t => t.id === 'T1'), false);
});

test('computeRunPlan counts unsent review notes', () => {
  const doc = JSON.parse(docText());
  doc.sections[1].tasks[0].reviewNotes = [{ n: 1, at: '2026-10-02T10:00:00.000Z', text: 'a', kind: 'idea', state: 'new' }];
  const plan = computeRunPlan(doc);
  assert.equal(plan.review.find(r => r.id === 'T2').notes, 1);
  assert.equal(plan.review.find(r => r.id === 'T1').notes, 0);
});

test('computeRunPlan review queue is oldest first with follow-ups', () => {
  const plan = computeRunPlan(JSON.parse(docText()));
  assert.deepEqual(plan.review.map(r => r.id), ['T1', 'T2']);
  assert.deepEqual(plan.review[1].checks, { done: 1, total: 2 });
  assert.deepEqual(plan.review[1].followUps, [{ id: 'T3', title: 'Follow-up', section: 'todo' }]);
  assert.deepEqual(plan.review[0].followUps, []);
});

import { noteArea, areaOptions } from '../../shared/review-filing.js';

function areaDoc() {
  return {
    sections: [
      { id: 'todo', tasks: [
        { id: 'E1', title: 'Canvas epic', type: 'epic', lane: 'canvas' },
        { id: 'E2', title: 'Account epic', type: 'epic', lane: 'account' },
      ] },
      { id: 'done', tasks: [{ id: 'E3', title: 'Old epic', type: 'epic', lane: 'old' }] },
      { id: 'review', tasks: [{ id: 'T1', title: 'Shipped', parentId: 'E1' }, { id: 'T2', title: 'Loose' }] },
    ],
  };
}

test('noteArea: note area wins, else the ticket epic lane, else null', () => {
  const doc = areaDoc();
  const t1 = doc.sections[2].tasks[0];
  assert.equal(noteArea(doc, t1, { n: 1 }), 'canvas');
  assert.equal(noteArea(doc, t1, { n: 1, area: 'account' }), 'account');
  assert.equal(noteArea(doc, doc.sections[2].tasks[1], { n: 1 }), null);
  assert.equal(noteArea(doc, doc.sections[0].tasks[1], { n: 1 }), 'account');
});

test('areaOptions: lanes of open epics plus the current one, sorted', () => {
  const doc = areaDoc();
  assert.deepEqual(areaOptions(doc, null), ['account', 'canvas']);
  assert.deepEqual(areaOptions(doc, 'old'), ['account', 'canvas', 'old']);
});
