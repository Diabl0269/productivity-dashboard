// task-move.js — Move tasks between projects/epics; rename IDs with confirmation.

import { escapeHtml } from './ticket-types.js';
import { appendHistory } from './task-fields.js';
import { todayStr } from './tasks-parser.js';
import { markChanged } from './tasks-io.js';
import { showStatus } from './state.js';
import { mountTicketPicker } from './ticket-picker.js';
import { mergedProjectList } from '../../shared/projects.js';
import {
  needsPrefixMigration,
  migrateTaskToProjectInState,
  moveTaskToEpicInState,
  renameTaskIdWithHistoryInState,
  countIdReferencesInState,
} from '../../shared/task-rename.js';
import { projectPrefix } from './task-fields.js';
import { createTasksBackup } from './tasks-backup.js';

function buildRenameMessage(task, newId, refs) {
  const original = task.originalId || task.taskId;
  const lines = [
    `Rename ${task.taskId} → ${newId}?`,
    '',
    `• Original ID "${original}" will be kept on the ticket`,
  ];
  if (refs.childCount) lines.push(`• ${refs.childCount} child ticket(s) will update their parent reference`);
  if (refs.blockedRefs) lines.push(`• ${refs.blockedRefs} blocked-by reference(s) will update`);
  if (refs.dailyPlanRefs) lines.push(`• Daily plan reference(s) will update`);
  lines.push('', 'OK to continue · Cancel to abort');
  return lines.join('\n');
}

export function confirmAndRenameTaskId(state, task, newId, onDone) {
  const trimmed = String(newId || '').trim().toUpperCase();
  if (!trimmed || trimmed === task.taskId) return false;

  const refs = countIdReferencesInState(state, task.taskId);
  if (!confirm(buildRenameMessage(task, trimmed, refs))) return false;

  const result = renameTaskIdWithHistoryInState(state, task.taskId, trimmed, {
    note: 'ID renamed manually',
    updated: todayStr(),
  });

  if (!result.ok) {
    const msg = result.reason === 'duplicate' ? 'That ID is already in use'
      : result.reason === 'invalid' ? 'Invalid ID format'
        : 'Could not rename';
    showStatus(msg);
    return false;
  }

  markChanged(result.task);
  onDone?.(result);
  showStatus(`Renamed ${result.oldId} → ${result.newId}`);
  return true;
}

export function showTaskMovePopover(anchor, task, state, onDone) {
  document.querySelectorAll('.pv-move-popover').forEach(el => el.remove());

  const pop = document.createElement('div');
  pop.className = 'pv-move-popover';
  pop.innerHTML = `
    <div class="pv-move-popover-head">${escapeHtml(task.taskId)} · ${escapeHtml(task.title || '')}</div>
    <button type="button" class="pv-move-action" data-action="open">Open ticket</button>
    <button type="button" class="pv-move-action" data-action="rename">Rename ID…</button>
    <div class="pv-move-section-label">Move to project</div>
    <div class="pv-move-project-list"></div>
    <div class="pv-move-section-label">Move under epic</div>
    <div class="pv-move-epic-picker"></div>
    <button type="button" class="pv-move-action" data-action="clear-epic">Remove from epic</button>
  `;

  const projects = mergedProjectList(state.tasks, state.meta?.projects || []);
  const projectList = pop.querySelector('.pv-move-project-list');
  for (const p of projects) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pv-move-project-opt';
    btn.innerHTML = `<span class="pv-swatch" style="background:${escapeHtml(p.color || '#3B82F6')}"></span>${escapeHtml(p.name)}`;
    btn.addEventListener('click', async () => {
      await moveTaskToProject(state, task, p.id, onDone);
      pop.remove();
    });
    projectList.appendChild(btn);
  }

  const epics = [];
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if ((t.type || '') === 'epic' && t.taskId !== task.taskId) epics.push(t);
    }
  }
  epics.sort((a, b) => (a.taskId || '').localeCompare(b.taskId || '', undefined, { numeric: true }));

  mountTicketPicker(pop.querySelector('.pv-move-epic-picker'), {
    tasks: epics,
    value: task.parentId,
    allowNone: false,
    placeholder: 'Search epic…',
    ariaLabel: 'Move under epic',
    onChange: (epicId) => {
      if (!epicId) return;
      moveTaskToEpic(state, task, epicId, onDone);
      pop.remove();
    },
  });

  pop.querySelector('[data-action="open"]').addEventListener('click', () => {
    pop.remove();
    onDone?.({ action: 'open', task });
  });

  pop.querySelector('[data-action="rename"]').addEventListener('click', () => {
    const next = prompt('New ticket ID:', task.taskId);
    if (next) confirmAndRenameTaskId(state, task, next, onDone);
    pop.remove();
  });

  pop.querySelector('[data-action="clear-epic"]').addEventListener('click', () => {
    moveTaskToEpic(state, task, null, onDone);
    pop.remove();
  });

  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 4}px`;
  pop.style.left = `${Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)}px`;

  const close = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function moveTaskToProject(state, task, projectId, onDone) {
  const metaProjects = state.meta?.projects || [];
  const project = mergedProjectList(state.tasks, metaProjects).find(p => p.id === projectId);
  const willMigrate = needsPrefixMigration(task.taskId, projectId, metaProjects);
  if (willMigrate) {
    const targetPrefix = projectPrefix(project || { id: projectId }, metaProjects);
    const msg = `${task.taskId} will be renamed to prefix ${targetPrefix}.\n\nCreate a backup first?`;
    if (!confirm(msg + '\n\nOK = backup & move · Cancel = abort')) return;
    try {
      await createTasksBackup();
      showStatus('Backup created');
    } catch (e) {
      if (!confirm(`Backup failed (${e.message}). Move anyway?`)) return;
    }
  }
  const result = migrateTaskToProjectInState(state, task.taskId, projectId);
  const finalTask = findUpdatedTask(state, result.newId);
  if (finalTask) {
    finalTask.updated = todayStr();
    appendHistory(finalTask, { event: 'project', to: projectId });
    markChanged(finalTask);
  }
  onDone?.({ action: 'project', result });
  showStatus(result.migrated
    ? `Moved ${result.oldId} → ${result.newId} (${project?.name || projectId})`
    : `Moved to ${project?.name || projectId}`);
}

function findUpdatedTask(state, taskId) {
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (t.taskId === taskId) return t;
    }
  }
  return null;
}

function moveTaskToEpic(state, task, epicId, onDone) {
  const result = moveTaskToEpicInState(state, task.taskId, epicId);
  if (!result) return;
  result.task.updated = todayStr();
  appendHistory(result.task, {
    event: 'parent',
    from: result.oldParent || '',
    to: epicId || '',
  });
  markChanged(result.task);
  onDone?.({ action: 'epic', result });
  showStatus(epicId ? `Moved under ${epicId}` : 'Removed from epic');
}
