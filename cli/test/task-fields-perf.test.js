/**
 * cli/test/task-fields-perf.test.js
 * countTasksUnderEpics / taskUnderEpic index reuse (dashboard/js/task-fields.js). Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countTasksUnderEpics, taskUnderEpic, indexTasksById, isEffectivelyBlocked,
} from '../../dashboard/js/task-fields.js';

/** 200 epics, nested 3 levels deep, 2000 tasks over three sections, plus one parent cycle. */
function buildTasks() {
  const sections = { todo: [], 'in-progress': [], done: [] };
  const names = Object.keys(sections);
  const all = [];
  for (let i = 0; i < 2000; i++) {
    const t = { taskId: `T${i}`, title: `Task ${i}`, type: i < 200 ? 'epic' : 'task', blockedBy: [] };
    if (i >= 200) t.parentId = `T${i % 200}`;            // child of an epic
    if (i >= 1000) t.parentId = `T${200 + (i % 800)}`;   // grandchild
    if (i >= 1600) t.parentId = `T${1000 + (i % 600)}`;  // great-grandchild
    if (i % 7 === 0) t.blockedBy = [`T${(i * 13) % 2000}`];
    all.push(t);
  }
  all[5].parentId = 'T6';   // cycle T5 <-> T6
  all[6].parentId = 'T5';
  all[9].parentId = 'MISSING'; // dangling parent
  all.push({ taskId: 'T-orphan' }, { title: 'no id', parentId: 'T0' });
  all.forEach((t, i) => sections[names[i % 3]].push(t));
  return sections;
}

const naive = (tasks, epicId) => {
  const byId = indexTasksById(tasks);
  let n = 0;
  for (const list of Object.values(tasks)) for (const t of list) if (taskUnderEpic(t, epicId, tasks, byId)) n++;
  return n;
};

test('countTasksUnderEpics equals the naive per-epic count for every epic', () => {
  const tasks = buildTasks();
  const t0 = performance.now();
  const counts = countTasksUnderEpics(tasks);
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `took ${ms.toFixed(1)} ms`);
  for (let i = 0; i < 200; i++) {
    assert.equal(counts.get(`T${i}`) || 0, naive(tasks, `T${i}`), `epic T${i}`);
  }
  assert.equal(counts.get('MISSING'), naive(tasks, 'MISSING'));
  assert.equal(counts.get('T5'), naive(tasks, 'T5')); // cycle members count each other
});

test('taskUnderEpic and isEffectivelyBlocked agree with and without a prebuilt index', () => {
  const tasks = buildTasks();
  const byId = indexTasksById(tasks);
  for (const list of Object.values(tasks)) {
    for (const t of list.slice(0, 300)) {
      for (const epic of ['T0', 'T5', 'T6', 'T199', 'MISSING']) {
        assert.equal(taskUnderEpic(t, epic, tasks, byId), taskUnderEpic(t, epic, tasks));
      }
      assert.equal(isEffectivelyBlocked(t, tasks, byId), isEffectivelyBlocked(t, tasks));
    }
  }
});
