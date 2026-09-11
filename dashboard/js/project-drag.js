// project-drag.js — Drag tickets between sub-projects and epics in Projects view.

import { showStatus } from './state.js';
import { applyMoveToEpic, applyMoveToProject } from './task-move.js';

const DRAG_MIME = 'application/x-pv-task-id';
let dragTaskId = null;

function findTaskById(state, taskId) {
  if (!taskId || !state?.tasks) return null;
  for (const list of Object.values(state.tasks)) {
    for (const t of list || []) {
      if (t.taskId === taskId) return t;
    }
  }
  return null;
}

function clearDropHighlights(root) {
  root?.querySelectorAll('.pv-drop-active').forEach(el => el.classList.remove('pv-drop-active'));
}

function bindDropTarget(el, { onDrop }) {
  el.addEventListener('dragover', (e) => {
    if (!dragTaskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('pv-drop-active');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('pv-drop-active');
  });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('pv-drop-active');
    const taskId = e.dataTransfer.getData(DRAG_MIME) || dragTaskId;
    if (!taskId) return;
    await onDrop(taskId);
    dragTaskId = null;
  });
}

export function attachTaskDragHandle(handle, task, rowWrap) {
  handle.addEventListener('mousedown', (e) => e.stopPropagation());
  handle.addEventListener('click', (e) => e.stopPropagation());

  handle.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    dragTaskId = task.taskId;
    rowWrap.classList.add('pv-dragging');
    e.dataTransfer.setData(DRAG_MIME, task.taskId);
    e.dataTransfer.effectAllowed = 'move';
  });
  handle.addEventListener('dragend', () => {
    dragTaskId = null;
    rowWrap.classList.remove('pv-dragging');
    document.querySelectorAll('.pv-drop-active').forEach(el => el.classList.remove('pv-drop-active'));
  });
}

export function bindProjectsDragDrop(container, state, onChanged) {
  if (!container) return;

  container.querySelectorAll('.pv-subproj[data-pv-project-id]').forEach(section => {
    const projectId = section.dataset.pvProjectId;
    bindDropTarget(section, {
      onDrop: async (taskId) => {
        const task = findTaskById(state, taskId);
        if (!task || task.project === projectId) return;
        await applyMoveToProject(state, task, projectId);
        onChanged?.();
      },
    });
  });

  container.querySelectorAll('[data-pv-epic-id]').forEach(epicEl => {
    const epicId = epicEl.dataset.pvEpicId;
    bindDropTarget(epicEl, {
      onDrop: async (taskId) => {
        const task = findTaskById(state, taskId);
        if (!task || task.taskId === epicId) return;
        applyMoveToEpic(state, task, epicId);
        onChanged?.();
        showStatus(`Moved ${taskId} under ${epicId}`);
      },
    });
  });

  container.querySelectorAll('[data-pv-unlink-epic]').forEach(zone => {
    bindDropTarget(zone, {
      onDrop: async (taskId) => {
        const task = findTaskById(state, taskId);
        if (!task || !task.parentId) return;
        applyMoveToEpic(state, task, null);
        onChanged?.();
        showStatus(`Removed ${taskId} from epic`);
      },
    });
  });

  container.addEventListener('dragover', (e) => {
    if (dragTaskId) e.preventDefault();
  });
  container.addEventListener('drop', () => clearDropHighlights(container));
}
