/**
 * Task ID rename / project-prefix migration — shared by dashboard and CLI.
 */

import {
  collectKnownPrefixes,
  collectKnownPrefixesWithTasks,
  isValidTaskId,
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

function findTaskInDoc(doc, id) {
  for (const section of doc.sections || []) {
    for (const task of section.tasks || []) {
      if (task.id === id) return { task, section };
    }
  }
  return { task: null, section: null };
}

/** Find task row in dashboard state by taskId. */
export function findTaskInState(state, taskId) {
  if (!taskId || !state?.tasks) return null;
  for (const list of Object.values(state.tasks)) {
    for (const t of list || []) {
      if (t.taskId === taskId) return t;
    }
  }
  return null;
}

/** Preserve the first id a task ever had (never overwritten). */
export function ensureOriginalId(task, id) {
  if (!task || task.originalId) return;
  const v = String(id || task.taskId || '').trim();
  if (v) task.originalId = v;
}

/** Count inbound references to a task id across the doc/state. */
export function countIdReferencesInState(state, taskId) {
  let childCount = 0;
  let blockedRefs = 0;
  let dailyPlanRefs = 0;
  for (const list of Object.values(state?.tasks || {})) {
    for (const t of list || []) {
      if (t.parentId === taskId) childCount += 1;
      if (Array.isArray(t.blockedBy) && t.blockedBy.includes(taskId)) blockedRefs += 1;
    }
  }
  const dp = state?.meta?.dailyPlan;
  if (Array.isArray(dp?.taskIds) && dp.taskIds.includes(taskId)) dailyPlanRefs += 1;
  if (Array.isArray(dp?.carriedIds) && dp.carriedIds.includes(taskId)) dailyPlanRefs += 1;
  return { childCount, blockedRefs, dailyPlanRefs, total: childCount + blockedRefs + dailyPlanRefs };
}

export function countIdReferencesInDoc(doc, taskId) {
  let childCount = 0;
  let blockedRefs = 0;
  let dailyPlanRefs = 0;
  for (const section of doc.sections || []) {
    for (const t of section.tasks || []) {
      if (t.parentId === taskId) childCount += 1;
      if (Array.isArray(t.blockedBy) && t.blockedBy.includes(taskId)) blockedRefs += 1;
    }
  }
  const dp = doc.meta?.dailyPlan;
  if (Array.isArray(dp?.taskIds) && dp.taskIds.includes(taskId)) dailyPlanRefs += 1;
  if (Array.isArray(dp?.carriedIds) && dp.carriedIds.includes(taskId)) dailyPlanRefs += 1;
  return { childCount, blockedRefs, dailyPlanRefs, total: childCount + blockedRefs + dailyPlanRefs };
}

function taskIdExistsInState(state, taskId, exceptId = null) {
  for (const list of Object.values(state?.tasks || {})) {
    for (const t of list || []) {
      if (t.taskId === taskId && t.taskId !== exceptId) return true;
    }
  }
  return false;
}

function taskIdExistsInDoc(doc, taskId, exceptId = null) {
  for (const section of doc.sections || []) {
    for (const t of section.tasks || []) {
      if (t.id === taskId && t.id !== exceptId) return true;
    }
  }
  return false;
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
  ensureOriginalId(task, taskId);
  task.history.push({
    at: new Date().toISOString(),
    event: 'id',
    from: taskId,
    to: newId,
    note: `migrated to project ${projectId}`,
  });
  return { oldId: taskId, newId, migrated: true };
}

/**
 * Rename a task id with originalId preservation and history on the renamed task.
 */
export function renameTaskIdWithHistoryInState(state, oldId, newId, opts = {}) {
  if (!oldId || !newId || oldId === newId) return { ok: false, reason: 'unchanged' };
  const trimmed = String(newId).trim().toUpperCase();
  const metaProjects = state.meta?.projects || [];
  const flat = [];
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) flat.push(t);
  }
  const known = collectKnownPrefixesWithTasks(metaProjects, flat);
  if (!isValidTaskId(trimmed, known)) return { ok: false, reason: 'invalid' };
  if (taskIdExistsInState(state, trimmed, oldId)) return { ok: false, reason: 'duplicate' };

  const task = findTaskInState(state, oldId);
  if (!task) return { ok: false, reason: 'not_found' };

  const refs = countIdReferencesInState(state, oldId);
  ensureOriginalId(task, oldId);
  renameTaskIdInState(state, oldId, trimmed);

  if (!Array.isArray(task.history)) task.history = [];
  task.history.push({
    at: new Date().toISOString(),
    event: 'id',
    from: oldId,
    to: trimmed,
    note: opts.note || 'ID renamed',
  });
  if (typeof opts.updated === 'string') task.updated = opts.updated;

  return { ok: true, oldId, newId: trimmed, refs, task };
}

/** Rename in tasks.json doc with originalId + history. */
export function renameTaskIdWithHistoryInDoc(doc, oldId, newId, opts = {}) {
  if (!oldId || !newId || oldId === newId) return { ok: false, reason: 'unchanged' };
  const trimmed = String(newId).trim().toUpperCase();
  const metaProjects = doc.meta?.projects || [];
  const known = collectKnownPrefixes(metaProjects);
  if (!isValidTaskId(trimmed, known)) return { ok: false, reason: 'invalid' };
  if (taskIdExistsInDoc(doc, trimmed, oldId)) return { ok: false, reason: 'duplicate' };

  const { task } = findTaskInDoc(doc, oldId);
  if (!task) return { ok: false, reason: 'not_found' };

  const refs = countIdReferencesInDoc(doc, oldId);
  ensureOriginalId(task, oldId);
  renameTaskIdInDoc(doc, oldId, trimmed);

  if (!Array.isArray(task.history)) task.history = [];
  task.history.push({
    at: new Date().toISOString(),
    event: 'id',
    from: oldId,
    to: trimmed,
    note: opts.note || 'ID renamed',
  });

  return { ok: true, oldId, newId: trimmed, refs, task };
}

/** Move a task under an epic (or clear parent). Syncs project to epic's project. */
export function moveTaskToEpicInState(state, taskId, epicId) {
  const task = findTaskInState(state, taskId);
  if (!task) return null;
  const epic = epicId ? findTaskInState(state, epicId) : null;
  if (epicId && !epic) return null;
  const oldParent = task.parentId || null;
  task.parentId = epicId || null;
  if (epic?.project) task.project = epic.project;
  return { task, oldParent, epicId: epicId || null };
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
  ensureOriginalId(task, taskId);
  task.history.push({
    at: new Date().toISOString(),
    event: 'id',
    from: taskId,
    to: newId,
    note: `migrated to project ${projectId}`,
  });
  return { oldId: taskId, newId, migrated: true };
}
