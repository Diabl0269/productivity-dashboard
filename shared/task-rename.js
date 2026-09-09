/**
 * Task ID rename / project-prefix migration — shared by dashboard and CLI.
 */

import {
  collectKnownPrefixes,
  nextTaskId,
  parseTaskId,
  projectPrefix,
} from './task-ids.js';
import { getProjectById } from './projects.js';

/**
 * True when task id prefix does not match the target project's effective prefix.
 */
export function needsPrefixMigration(taskId, projectId, metaProjects = []) {
  if (!projectId || !taskId) return false;
  const proj = getProjectById(metaProjects, projectId) || { id: projectId };
  const targetPrefix = projectPrefix(proj, metaProjects);
  const known = collectKnownPrefixes(metaProjects);
  const parsed = parseTaskId(taskId, known);
  return !parsed || parsed.prefix !== targetPrefix;
}

/**
 * Rename a task id everywhere in a tasks.json document.
 * @returns {boolean} true if oldId was found and renamed
 */
export function renameTaskIdInDoc(doc, oldId, newId) {
  if (!oldId || !newId || oldId === newId) return false;
  let found = false;

  for (const section of doc.sections || []) {
    for (const task of section.tasks || []) {
      if (task.id === oldId) {
        task.id = newId;
        found = true;
      }
      if (task.parentId === oldId) task.parentId = newId;
      if (Array.isArray(task.blockedBy)) {
        task.blockedBy = task.blockedBy.map(id => (id === oldId ? newId : id));
      }
      if (Array.isArray(task.history)) {
        for (const h of task.history) {
          if (h.from === oldId) h.from = newId;
          if (h.to === oldId) h.to = newId;
        }
      }
    }
  }

  const meta = doc.meta || {};
  const dp = meta.dailyPlan || {};
  if (Array.isArray(dp.taskIds)) {
    dp.taskIds = dp.taskIds.map(id => (id === oldId ? newId : id));
  }
  if (Array.isArray(dp.carriedIds)) {
    dp.carriedIds = dp.carriedIds.map(id => (id === oldId ? newId : id));
  }

  return found;
}

/**
 * Flatten tasks.json doc to { id } rows.
 */
export function flattenDocTaskIds(doc) {
  const out = [];
  for (const section of doc.sections || []) {
    for (const task of section.tasks || []) {
      if (task.id) out.push({ id: task.id });
    }
  }
  return out;
}

/**
 * Assign next project-scoped id and rename task in doc. Sets task.project.
 * @returns {{ oldId: string, newId: string, migrated: boolean }}
 */
export function migrateTaskToProjectInDoc(doc, taskId, projectId) {
  const metaProjects = doc.meta?.projects || [];
  const { task } = findTaskInDoc(doc, taskId);
  if (!task) return { oldId: taskId, newId: taskId, migrated: false };

  task.project = projectId;

  if (!needsPrefixMigration(taskId, projectId, metaProjects)) {
    return { oldId: taskId, newId: taskId, migrated: false };
  }

  const flat = flattenDocTaskIds(doc);
  const newId = nextTaskId(flat, projectId, metaProjects);
  renameTaskIdInDoc(doc, taskId, newId);
  if (!Array.isArray(task.history)) task.history = [];
  task.history.push({
    at: new Date().toISOString(),
    event: 'id',
    from: taskId,
    to: newId,
    note: `migrated to project ${projectId}`,
  });
  return { oldId: taskId, newId, migrated: true };
}

function findTaskInDoc(doc, id) {
  for (const section of doc.sections || []) {
    for (const task of section.tasks || []) {
      if (task.id === id) return { task, section };
    }
  }
  return { task: null, section: null };
}

/**
 * Rename task id in dashboard in-memory state.
 */
export function renameTaskIdInState(state, oldId, newId) {
  if (!oldId || !newId || oldId === newId) return false;
  let found = false;

  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (t.taskId === oldId) {
        t.taskId = newId;
        found = true;
      }
      if (t.parentId === oldId) t.parentId = newId;
      if (Array.isArray(t.blockedBy)) {
        t.blockedBy = t.blockedBy.map(id => (id === oldId ? newId : id));
      }
      if (Array.isArray(t.history)) {
        for (const h of t.history) {
          if (h.from === oldId) h.from = newId;
          if (h.to === oldId) h.to = newId;
        }
      }
    }
  }

  const dp = state.meta?.dailyPlan;
  if (dp) {
    if (Array.isArray(dp.taskIds)) {
      dp.taskIds = dp.taskIds.map(id => (id === oldId ? newId : id));
    }
    if (Array.isArray(dp.carriedIds)) {
      dp.carriedIds = dp.carriedIds.map(id => (id === oldId ? newId : id));
    }
  }

  return found;
}

/**
 * Migrate task to project in dashboard state (rename id if prefix mismatch).
 */
export function migrateTaskToProjectInState(state, taskId, projectId) {
  const metaProjects = state.meta?.projects || [];
  let task = null;
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (t.taskId === taskId) { task = t; break; }
    }
    if (task) break;
  }
  if (!task) return { oldId: taskId, newId: taskId, migrated: false };

  task.project = projectId;

  if (!needsPrefixMigration(taskId, projectId, metaProjects)) {
    return { oldId: taskId, newId: taskId, migrated: false };
  }

  const flat = [];
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (t.taskId) flat.push({ id: t.taskId });
    }
  }
  const newId = nextTaskId(flat, projectId, metaProjects);
  renameTaskIdInState(state, taskId, newId);
  if (!Array.isArray(task.history)) task.history = [];
  task.history.push({
    at: new Date().toISOString(),
    event: 'id',
    from: taskId,
    to: newId,
    note: `migrated to project ${projectId}`,
  });
  return { oldId: taskId, newId, migrated: true };
}
