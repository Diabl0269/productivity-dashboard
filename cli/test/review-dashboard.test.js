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

test('computeRunPlan review queue is oldest first with follow-ups', () => {
  const plan = computeRunPlan(JSON.parse(docText()));
  assert.deepEqual(plan.review.map(r => r.id), ['T1', 'T2']);
  assert.deepEqual(plan.review[1].checks, { done: 1, total: 2 });
  assert.deepEqual(plan.review[1].followUps, [{ id: 'T3', title: 'Follow-up', section: 'todo' }]);
  assert.deepEqual(plan.review[0].followUps, []);
});
