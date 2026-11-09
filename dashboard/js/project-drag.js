// project-drag.js — Drag tickets between sub-projects and epics in Projects view, and reorder rows in a list
// (bindReorderDrag: the Plan page's Auto queue). Same MIME type and drag-state as the ticket drag.

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

/**
 * FLIP: run `mutate` (which moves/redraws rows), then slide each row from where it was to where it
 * is now, so neighbours make room instead of jumping. Rows are matched by `data-epic`.
 * @param {Element[]} rows  rows before the change
 * @param {() => Element[]} mutate  applies the change, returns the rows after it
 */
export function flipRows(rows, mutate, { ms = 160 } = {}) {
  const before = new Map(rows.map(r => [r.dataset.epic, r.getBoundingClientRect()]));
  const after = mutate() || [];
  playFlip(after, before, ms);
}

/** Slide `rows` from the rects in `before` (Map id -> DOMRect) to where they are now. */
export function playFlip(rows, before, ms = 160) {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  for (const row of rows) {
    const was = before.get(row.dataset.epic);
    if (!was || !row.animate) continue;
    const now = row.getBoundingClientRect();
    const dy = was.top - now.top;
    if (Math.abs(dy) < 1) continue;
    row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: ms, easing: 'ease-out' });
  }
}

/**
 * Drag rows (`[data-epic]` inside each list) within and between `lists` (elements with a
 * `data-priority`). While dragging, the row moves live and neighbours slide aside; on drop,
 * `onDrop(id, listEl, index)` gets the final place. A drag that ends elsewhere calls `onCancel`.
 */
export function bindReorderDrag(lists, { onDrop, onCancel }) {
  let dragRow = null;
  let dropped = false;
  const rowsIn = (list) => [...list.querySelectorAll(':scope > [data-epic]')];
  const allRows = () => lists.flatMap(rowsIn);

  for (const list of lists) {
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest?.('[data-epic]');
      if (!row || !list.contains(row)) return;
      dragRow = row;
      dropped = false;
      dragTaskId = row.dataset.epic;
      row.classList.add('rp-aq-dragging');
      e.dataTransfer.setData(DRAG_MIME, row.dataset.epic);
      e.dataTransfer.effectAllowed = 'move';
    });
    list.addEventListener('dragover', (e) => {
      if (!dragRow) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const others = rowsIn(list).filter(r => r !== dragRow);
      const next = others.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; }) || null;
      const inPlace = dragRow.parentElement === list && dragRow.nextElementSibling === next
        && (next || list.lastElementChild === dragRow);
      if (inPlace) return;
      flipRows(allRows(), () => { list.insertBefore(dragRow, next); return allRows(); });
    });
    list.addEventListener('drop', (e) => {
      if (!dragRow) return;
      e.preventDefault();
      dropped = true;
      onDrop(dragRow.dataset.epic, list, rowsIn(list).indexOf(dragRow));
    });
  }
  const end = () => {
    if (!dragRow) return;
    const row = dragRow;
    dragRow = null;
    dragTaskId = null;
    row.classList.remove('rp-aq-dragging');
    if (!dropped) onCancel?.();
  };
  for (const list of lists) list.addEventListener('dragend', end);
}
