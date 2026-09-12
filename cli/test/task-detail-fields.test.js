import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taskIdDisplayState,
  buildParentPickerCandidates,
} from '../../shared/task-detail-fields.js';
import { parentCandidates } from '../../dashboard/js/ticket-types.js';

const TYPES = [
  { id: 'epic', name: 'Epic', color: '#8B5CF6', parentTypes: [] },
  { id: 'feature', name: 'Feature', color: '#F59E0B', parentTypes: ['epic'] },
  { id: 'task', name: 'Task', color: '#3B82F6', parentTypes: ['epic', 'feature'] },
  { id: 'bug', name: 'Bug', color: '#EF4444', parentTypes: ['epic', 'feature', 'task'] },
];

const TASKS = {
  backlog: [
    { taskId: 'T1', title: 'Epic one', type: 'epic', section: 'backlog' },
    { taskId: 'T9', title: 'Feature nine', type: 'feature', section: 'backlog' },
  ],
  todo: [
    { taskId: 'T2', title: 'Child task', type: 'task', parentId: 'T1', section: 'todo' },
    { taskId: 'T3', title: 'Under feature', type: 'bug', parentId: 'T9', section: 'todo' },
  ],
};

function findTaskByTaskId(tasksBySection, taskId) {
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.taskId === taskId) return t;
    }
  }
  return null;
}

test('taskIdDisplayState shows ticket id label and sizing', () => {
  const state = taskIdDisplayState({ taskId: 'APP-42' });
  assert.equal(state.label, 'APP-42');
  assert.equal(state.placeholder, '');
  assert.equal(state.size, 6);
  assert.match(state.title, /APP-42/);
});

test('taskIdDisplayState falls back when task id is missing', () => {
  const state = taskIdDisplayState({ taskId: null });
  assert.equal(state.label, '\u2014');
  assert.equal(state.placeholder, '\u2014');
  assert.equal(state.title, 'No ticket ID');
});

test('parentCandidates lists allowed parents for task type', () => {
  const candidates = parentCandidates(TYPES, TASKS, 'task', 'T2');
  assert.deepEqual(candidates.map(t => t.taskId).sort(), ['T1', 'T9']);
});

test('buildParentPickerCandidates keeps current parent when type rules change', () => {
  const task = { taskId: 'T3', type: 'feature', parentId: 'T2' };
  const base = parentCandidates(TYPES, TASKS, task.type, task.taskId);
  assert.equal(base.some(t => t.taskId === 'T2'), false);
  const withOrphan = buildParentPickerCandidates(base, task, id => findTaskByTaskId(TASKS, id));
  assert.equal(withOrphan[0].taskId, 'T2');
  assert.ok(withOrphan.some(t => t.taskId === 'T1'));
});

test('buildParentPickerCandidates leaves list unchanged when parent already allowed', () => {
  const task = { taskId: 'T2', type: 'task', parentId: 'T1' };
  const base = parentCandidates(TYPES, TASKS, task.type, task.taskId);
  const merged = buildParentPickerCandidates(base, task, id => findTaskByTaskId(TASKS, id));
  assert.deepEqual(merged.map(t => t.taskId), base.map(t => t.taskId));
});
