import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  needsPrefixMigration,
  renameTaskIdInDoc,
  migrateTaskToProjectInDoc,
  renameTaskIdWithHistoryInState,
} from '../../shared/task-rename.js';

function sampleDoc() {
  return {
    version: 1,
    meta: {
      projects: [{ id: 'my-app', name: 'My App', prefix: 'APP' }],
      dailyPlan: { date: null, taskIds: ['T1'], carriedIds: [] },
    },
    sections: [
      {
        id: 'todo',
        name: 'Todo',
        tasks: [
          { id: 'T1', title: 'One', priority: 'medium', type: 'task', parentId: null },
          { id: 'T2', title: 'Two', priority: 'medium', type: 'task', parentId: 'T1', blockedBy: ['T1'] },
        ],
      },
    ],
  };
}

test('needsPrefixMigration when prefix differs', () => {
  const meta = [{ id: 'my-app', prefix: 'APP' }];
  assert.equal(needsPrefixMigration('T5', 'my-app', meta), true);
  assert.equal(needsPrefixMigration('APP1', 'my-app', meta), false);
});

test('renameTaskIdInDoc updates references', () => {
  const doc = sampleDoc();
  assert.equal(renameTaskIdInDoc(doc, 'T1', 'APP1'), true);
  assert.equal(doc.sections[0].tasks[0].id, 'APP1');
  assert.equal(doc.sections[0].tasks[1].parentId, 'APP1');
  assert.equal(doc.sections[0].tasks[1].blockedBy[0], 'APP1');
  assert.deepEqual(doc.meta.dailyPlan.taskIds, ['APP1']);
});

test('migrateTaskToProjectInDoc renames and sets project', () => {
  const doc = sampleDoc();
  const result = migrateTaskToProjectInDoc(doc, 'T1', 'my-app');
  assert.equal(result.migrated, true);
  assert.equal(result.oldId, 'T1');
  assert.equal(result.newId, 'APP1');
  assert.equal(doc.sections[0].tasks[0].project, 'my-app');
  assert.equal(doc.sections[0].tasks[0].id, 'APP1');
});

test('renameTaskIdWithHistoryInState preserves originalId and updates refs', () => {
  const state = {
    meta: {
      projects: [{ id: 'my-app', prefix: 'APP' }],
      dailyPlan: { taskIds: ['T1'], carriedIds: [] },
    },
    tasks: {
      todo: [
        { taskId: 'T1', title: 'Epic', type: 'epic', parentId: null },
        { taskId: 'T2', title: 'Child', type: 'task', parentId: 'T1' },
      ],
    },
  };
  const result = renameTaskIdWithHistoryInState(state, 'T1', 'APP1');
  assert.equal(result.ok, true);
  assert.equal(state.tasks.todo[0].taskId, 'APP1');
  assert.equal(state.tasks.todo[0].originalId, 'T1');
  assert.equal(state.tasks.todo[1].parentId, 'APP1');
  assert.deepEqual(state.meta.dailyPlan.taskIds, ['APP1']);
});
