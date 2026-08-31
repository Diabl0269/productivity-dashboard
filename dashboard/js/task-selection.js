// task-selection.js — Multi-select + bulk actions toolbar

import { markChanged } from './tasks-io.js';
import { moveTask } from './tasks-board.js';
import { softDeleteTasks } from './task-undo.js';
import { appendHistory, ensureTaskFieldDefaults } from './task-fields.js';
import { showStatus } from './state.js';
import { clearFacets, renderFilterBar } from './task-filters.js';

let getState = null;
let getRenderTasks = null;

/** Selected tasks by ephemeral numeric id. */
export const selectedIds = new Set();

export function setSelectionCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

export function isSelected(task) {
  return task && selectedIds.has(task.id);
}

export function clearSelection() {
  selectedIds.clear();
  renderBulkBar();
}

export function toggleSelect(task, { additive = false } = {}) {
  if (!task) return;
  if (!additive) {
    const was = selectedIds.has(task.id);
    selectedIds.clear();
    if (!was) selectedIds.add(task.id);
  } else if (selectedIds.has(task.id)) {
    selectedIds.delete(task.id);
  } else {
    selectedIds.add(task.id);
  }
  renderBulkBar();
  getRenderTasks && getRenderTasks()();
}

export function selectOnly(task) {
  selectedIds.clear();
  if (task) selectedIds.add(task.id);
  renderBulkBar();
}

function selectedTasks() {
  const state = getState() || {};
  const out = [];
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (selectedIds.has(t.id)) out.push(t);
    }
  }
  return out;
}

function renderBulkBar() {
  let bar = document.getElementById('bulkActionsBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bulkActionsBar';
    bar.className = 'bulk-actions-bar';
    bar.hidden = true;
    const panel = document.getElementById('tasksPanel');
    if (panel) panel.insertBefore(bar, panel.firstChild);
  }

  const n = selectedIds.size;
  if (n === 0) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  bar.hidden = false;
  const state = getState() || {};
  const sections = state.sections || [];

  bar.innerHTML = `
    <span class="bulk-count">${n} selected</span>
    <select class="bulk-select" data-bulk="move" aria-label="Move to section">
      <option value="">Move to…</option>
      ${sections.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
    </select>
    <select class="bulk-select" data-bulk="priority" aria-label="Set priority">
      <option value="">Priority…</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
    </select>
    <button type="button" data-bulk="archive">Archive</button>
    <button type="button" data-bulk="block">Block</button>
    <button type="button" data-bulk="unblock">Unblock</button>
    <button type="button" data-bulk="add-label">+ Label</button>
    <button type="button" data-bulk="delete" class="bulk-danger">Delete</button>
    <button type="button" data-bulk="clear">Clear</button>
  `;

  bar.querySelector('[data-bulk="move"]').addEventListener('change', (e) => {
    const sec = e.target.value;
    if (!sec) return;
    bulkMove(sec);
    e.target.value = '';
  });
  bar.querySelector('[data-bulk="priority"]').addEventListener('change', (e) => {
    const p = e.target.value;
    if (!p) return;
    bulkPriority(p);
    e.target.value = '';
  });
  bar.querySelector('[data-bulk="archive"]').addEventListener('click', () => bulkMove('archive'));
  bar.querySelector('[data-bulk="block"]').addEventListener('click', () => bulkBlocked(true));
  bar.querySelector('[data-bulk="unblock"]').addEventListener('click', () => bulkBlocked(false));
  bar.querySelector('[data-bulk="add-label"]').addEventListener('click', () => {
    const label = prompt('Label to add:');
    if (label && label.trim()) bulkAddLabel(label.trim());
  });
  bar.querySelector('[data-bulk="delete"]').addEventListener('click', () => bulkDelete());
  bar.querySelector('[data-bulk="clear"]').addEventListener('click', () => {
    clearSelection();
    getRenderTasks && getRenderTasks()();
  });
}

function bulkMove(sectionId) {
  const tasks = selectedTasks();
  for (const t of tasks) {
    const from = t.section;
    if (from === sectionId) continue;
    moveTask(t.id, sectionId, -1, { skipRender: true, history: true });
  }
  clearSelection();
  markChanged();
  getRenderTasks && getRenderTasks()();
  showStatus(`Moved ${tasks.length} task(s)`);
}

function bulkPriority(priority) {
  const tasks = selectedTasks();
  for (const t of tasks) {
    const prev = t.priority || 'medium';
    if (prev === priority) continue;
    t.priority = priority;
    appendHistory(t, { event: 'priority', from: prev, to: priority });
  }
  clearSelection();
  markChanged();
  getRenderTasks && getRenderTasks()();
  showStatus(`Priority set on ${tasks.length} task(s)`);
}

function bulkBlocked(blocked) {
  const tasks = selectedTasks();
  for (const t of tasks) {
    ensureTaskFieldDefaults(t);
    if (!!t.blocked === blocked) continue;
    t.blocked = blocked;
    appendHistory(t, { event: blocked ? 'blocked' : 'unblocked' });
    if (!blocked) { /* keep waitingOn */ }
  }
  clearSelection();
  markChanged();
  getRenderTasks && getRenderTasks()();
  showStatus(blocked ? `Blocked ${tasks.length}` : `Unblocked ${tasks.length}`);
}

function bulkAddLabel(label) {
  const tasks = selectedTasks();
  for (const t of tasks) {
    ensureTaskFieldDefaults(t);
    if (!t.labels.includes(label)) t.labels.push(label);
  }
  clearSelection();
  markChanged();
  getRenderTasks && getRenderTasks()();
  showStatus(`Labeled ${tasks.length} task(s)`);
}

function bulkDelete() {
  const tasks = selectedTasks();
  if (tasks.length === 0) return;
  if (!confirm(`Delete ${tasks.length} task(s)? You can undo briefly.`)) return;
  softDeleteTasks(tasks);
  clearSelection();
}

export function escapeClearsSelectionOrFilters() {
  if (selectedIds.size > 0) {
    clearSelection();
    getRenderTasks && getRenderTasks()();
    return true;
  }
  // Clear facets if any
  clearFacets();
  renderFilterBar();
  getRenderTasks && getRenderTasks()();
  return true;
}

export function initBulkSelection() {
  renderBulkBar();
}
