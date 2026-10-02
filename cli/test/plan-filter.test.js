/**
 * cli/test/plan-filter.test.js
 * Tests for shared/plan-filter.js (Overview "Today plan" filter). Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPlanRows, normalizePlanFilter, epicProgress } from '../../shared/plan-filter.js';

const tasks = {
  'in-progress': [
    { taskId: 'E1', type: 'epic', title: 'Epic one', section: 'in-progress' },
    { taskId: 'T3', type: 'task', title: 'Plain', section: 'in-progress' },
  ],
  todo: [
    { taskId: 'E2', type: 'epic', title: 'Epic todo', section: 'todo' },
    { taskId: 'T1', type: 'task', title: 'Child a', parentId: 'E1', section: 'todo' },
    { taskId: 'T2', type: 'task', title: 'Pinned', section: 'todo' },
  ],
  done: [{ taskId: 'T4', type: 'task', title: 'Child b', parentId: 'E1', checked: true, section: 'done' }],
};

test('normalizePlanFilter falls back to both', () => {
  assert.equal(normalizePlanFilter('pinned'), 'pinned');
  assert.equal(normalizePlanFilter('epics'), 'epics');
  assert.equal(normalizePlanFilter('nope'), 'both');
  assert.equal(normalizePlanFilter(null), 'both');
});

test('epicProgress counts done children', () => {
  const all = Object.values(tasks).flat();
  assert.deepEqual(epicProgress('E1', all), { done: 1, total: 2 });
  assert.deepEqual(epicProgress('E2', all), { done: 0, total: 0 });
});

test('both: in-progress epics first, then pinned; epic pinned once', () => {
  const rows = selectPlanRows(tasks, { taskIds: ['T2', 'E1'] }, 'both');
  assert.deepEqual(rows.map(r => r.id), ['E1', 'T2']);
  assert.equal(rows[0].kind, 'epic');
  assert.equal(rows[0].pinned, true);
  assert.deepEqual(rows[0].progress, { done: 1, total: 2 });
  assert.equal(rows[1].progress, null);
});

test('pinned: only pinned ids; epics: only in-progress epics', () => {
  const plan = { taskIds: ['T2'] };
  assert.deepEqual(selectPlanRows(tasks, plan, 'pinned').map(r => r.id), ['T2']);
  const epics = selectPlanRows(tasks, plan, 'epics');
  assert.deepEqual(epics.map(r => r.id), ['E1']);
  assert.equal(epics[0].pinned, false);
});

test('unknown mode behaves as both; missing plan is fine', () => {
  assert.deepEqual(selectPlanRows(tasks, undefined, 'x').map(r => r.id), ['E1']);
});
