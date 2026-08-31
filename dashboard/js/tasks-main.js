// tasks-main.js - Main orchestrator for tasks functionality

import { taskSectionId, autoArchive, todayStr } from './tasks-parser.js';
import { loadTasksJson, serializeTasksJson, defaultTasksMeta, normalizeTasksMeta } from './tasks-json.js';
import { markChanged, startWatching, setIOCallbacks, setLastModified, autoSave } from './tasks-io.js';
import { renderBoard, setBoardCallbacks } from './tasks-board.js';
import { renderList, setListCallbacks } from './tasks-list.js';
import { setTaskDetailCallbacks } from './task-detail.js';
import { setTaskCreateCallbacks } from './task-create.js';
import { showStatus, filePathEl, setTaskInfoGetter, activeMainTab } from './state.js';
import { saveHandle } from './persistence.js';
import { httpSave, startHttpTaskWatching } from './http-loader.js';
import { isSaving } from './tasks-io.js';
import { reapplySearch } from './search.js';
import { normalizeTicketTypes, DEFAULT_TICKET_TYPE_ID } from './ticket-types.js';
import { setSettingsCallbacks, renderSettingsTicketTypes } from './settings.js';
import { setFilterCallbacks, renderFilterBar, initTaskFilters } from './task-filters.js';
import { refreshOverviewTaskWidgets } from './overview.js';
import { initSavedViews } from './saved-views.js';
import { initTaskTemplates } from './task-templates.js';
import { setSelectionCallbacks, initBulkSelection } from './task-selection.js';
import { setUndoCallbacks } from './task-undo.js';
import { setKeyboardCallbacks, initTaskKeyboard } from './task-keyboard.js';
import { initTaskTimer, setTimerCallbacks } from './task-timer.js';
import { setProjectsViewCallbacks, refreshProjectsView } from './projects-view.js';
import { computeNextTaskId, appendHistory } from './task-fields.js';

// ===== Shared mutable state =====
export const taskState = {
  taskFileHandle: null,
  taskFileName: '',
  sections: [],
  tasks: {},
  ticketTypes: normalizeTicketTypes(null),
  meta: defaultTasksMeta(),
  hasChanges: false,
  currentView: 'board',
  quickAddSection: null,
  sortByPriority: true,
  swimlanesByEpic: false,
};

export function renderTasks() {
  if (taskState.currentView === 'board') renderBoard();
  else renderList();
  renderFilterBar();
  reapplySearch();
  refreshOverviewTaskWidgets({ tasks: taskState.tasks, meta: taskState.meta });
  refreshProjectsView();
}

// Register callbacks for other modules
setIOCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks,
  parseFn: () => loadTasksJson
});

setBoardCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setListCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setTaskDetailCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setTaskCreateCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setFilterCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setSelectionCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setUndoCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setKeyboardCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setSettingsCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setTimerCallbacks({
  stateFn: () => taskState,
  renderFn: () => renderTasks
});

setTaskInfoGetter(() => ({
  handle: taskState.taskFileHandle,
  name: taskState.taskFileName
}));

function captureToInbox(title) {
  const text = String(title || '').trim();
  if (!text) return;
  if (!taskState.sections.find(s => s.id === 'inbox')) {
    taskState.sections.unshift({ id: 'inbox', name: 'Inbox' });
  }
  if (!taskState.tasks.inbox) taskState.tasks.inbox = [];
  const taskId = computeNextTaskId(taskState);
  const task = {
    id: Date.now() + Math.random(),
    taskId,
    title: text,
    description: '',
    checked: false,
    priority: 'medium',
    type: DEFAULT_TICKET_TYPE_ID,
    created: todayStr(),
    updated: null,
    subtasks: [],
    section: 'inbox',
    labels: [],
    links: [],
    blockedBy: [],
    notes: [],
    history: [],
    timeEntries: [],
    decisions: [],
  };
  appendHistory(task, { event: 'created', to: 'inbox' });
  taskState.tasks.inbox.unshift(task);
  markChanged();
  renderTasks();
  showStatus(`Captured ${taskId}`);
}

function initCaptureBar() {
  const input = document.getElementById('captureInput');
  const btn = document.getElementById('captureBtn');
  if (!input || !btn) return;
  const go = () => {
    captureToInbox(input.value);
    input.value = '';
    input.focus();
  };
  btn.addEventListener('click', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go(); }
  });
}

export function switchTaskView(view) {
  const listView = document.getElementById('listView');
  const board = document.getElementById('board');
  const listViewBtn = document.getElementById('listViewBtn');
  const boardViewBtn = document.getElementById('boardViewBtn');

  taskState.currentView = view;
  if (view === 'list') {
    listView.style.display = 'block';
    board.style.display = 'none';
    listViewBtn.classList.add('active');
    boardViewBtn.classList.remove('active');
  } else {
    listView.style.display = 'none';
    board.style.display = 'flex';
    listViewBtn.classList.remove('active');
    boardViewBtn.classList.add('active');
  }

  // Show legend only in board view
  const legend = board && board.previousElementSibling &&
    board.previousElementSibling.classList.contains('priority-legend')
    ? board.previousElementSibling : null;
  if (legend) legend.classList.toggle('hidden', view !== 'board');

  renderTasks();
}

export async function loadTaskFromHandle(handle) {
  taskState.taskFileHandle = handle;
  const file = await taskState.taskFileHandle.getFile();
  const content = await file.text();
  setLastModified(file.lastModified);
  const result = loadTasksJson(content);
  applyLoadedTasks(result);
  if (autoArchive(taskState.sections, taskState.tasks)) {
    taskState.hasChanges = true;
  }
  switchTaskView('board');
  startWatching();
  taskState.taskFileName = file.name;
  if (activeMainTab === 'tasks') filePathEl.textContent = file.name;
  showStatus('Loaded ' + file.name);
}

export function loadTaskFromHttp(parsed) {
  taskState.taskFileHandle = null;
  applyLoadedTasks(parsed);
  autoArchive(taskState.sections, taskState.tasks);
  switchTaskView('board');
  taskState.taskFileName = 'tasks.json';
  if (activeMainTab === 'tasks') filePathEl.textContent = 'tasks.json';
  showStatus('Loaded tasks.json via HTTP');
}

export function startTasksHttpWatching() {
  startHttpTaskWatching((parsed) => {
    loadTaskFromHttp(parsed);
    refreshOverviewTaskWidgets(parsed);
  }, {
    shouldSkip: () => taskState.hasChanges || isSaving
  });
}

function applyLoadedTasks(result) {
  taskState.sections.length = 0;
  // Ensure canonical section order (inbox first)
  const canonical = ['inbox', 'backlog', 'todo', 'in-progress', 'done', 'archive'];
  const byId = new Map(result.sections.map(s => [s.id, s]));
  const ordered = [];
  for (const id of canonical) {
    if (byId.has(id)) ordered.push(byId.get(id));
    else ordered.push({ id, name: id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') });
  }
  for (const s of result.sections) {
    if (!canonical.includes(s.id)) ordered.push(s);
  }
  taskState.sections.push(...ordered);
  for (const key of Object.keys(taskState.tasks)) delete taskState.tasks[key];
  Object.assign(taskState.tasks, result.tasks);
  for (const id of canonical) {
    if (!taskState.tasks[id]) taskState.tasks[id] = [];
  }
  taskState.ticketTypes = normalizeTicketTypes(result.ticketTypes);
  taskState.meta = normalizeTasksMeta(result.meta);
  renderSettingsTicketTypes();
}

export async function openTaskFile() {
  try {
    [taskState.taskFileHandle] = await window.showOpenFilePicker({
      types: [{ description: 'Tasks JSON', accept: { 'application/json': ['.json'] } }]
    });
    await loadTaskFromHandle(taskState.taskFileHandle);
    await saveHandle('taskFile', taskState.taskFileHandle);
  } catch (e) {
    if (e.name !== 'AbortError') showStatus('Error: ' + e.message);
  }
}

function injectPriorityLegend() {
  const board = document.getElementById('board');
  if (!board) return;
  // Inject once directly before .board
  if (board.previousElementSibling && board.previousElementSibling.classList.contains('priority-legend')) return;
  const legend = document.createElement('div');
  legend.className = 'priority-legend';
  legend.setAttribute('aria-label', 'Priority colour key');
  legend.innerHTML = `
    <span class="priority-dot priority-low" aria-hidden="true"></span><span>Low</span>
    <span class="priority-dot priority-medium" aria-hidden="true"></span><span>Medium</span>
    <span class="priority-dot priority-high" aria-hidden="true"></span><span>High</span>
  `;
  board.parentNode.insertBefore(legend, board);
}

export function initTasks() {
  const listViewBtn = document.getElementById('listViewBtn');
  const boardViewBtn = document.getElementById('boardViewBtn');
  const openTaskBtn = document.getElementById('openTaskBtn');
  const saveBtn = document.getElementById('saveBtn');

  injectPriorityLegend();
  initTaskFilters();
  initSavedViews({ renderFn: () => renderTasks });
  initTaskTemplates();
  initBulkSelection();
  initTaskKeyboard();
  initCaptureBar();
  setTimerCallbacks({ stateFn: () => taskState, renderFn: () => renderTasks });
  setProjectsViewCallbacks({ stateFn: () => taskState, renderFn: () => renderTasks });
  initTaskTimer();

  listViewBtn.addEventListener('click', () => switchTaskView('list'));
  boardViewBtn.addEventListener('click', () => switchTaskView('board'));

  const sortPriorityBtn = document.getElementById('sortPriorityBtn');
  if (sortPriorityBtn) {
    sortPriorityBtn.classList.add('active');
    sortPriorityBtn.addEventListener('click', () => {
      taskState.sortByPriority = !taskState.sortByPriority;
      sortPriorityBtn.classList.toggle('active', taskState.sortByPriority);
      renderTasks();
    });
  }

  const swimlanesBtn = document.getElementById('swimlanesBtn');
  if (swimlanesBtn) {
    swimlanesBtn.addEventListener('click', () => {
      taskState.swimlanesByEpic = !taskState.swimlanesByEpic;
      swimlanesBtn.classList.toggle('active', taskState.swimlanesByEpic);
      if (taskState.currentView !== 'board') switchTaskView('board');
      else renderTasks();
    });
  }

  const keyboardHintsBtn = document.getElementById('keyboardHintsBtn');
  if (keyboardHintsBtn) {
    keyboardHintsBtn.addEventListener('click', () => {
      const hint = document.getElementById('keyboardHints');
      if (hint) hint.hidden = !hint.hidden;
    });
  }
  openTaskBtn.addEventListener('click', openTaskFile);
  document.getElementById('openBtnLarge')?.addEventListener('click', openTaskFile);

  saveBtn.addEventListener('click', async () => {
    try {
      const content = serializeTasksJson(taskState.sections, taskState.tasks, taskState.ticketTypes, taskState.meta);
      if (taskState.taskFileHandle) {
        const writable = await taskState.taskFileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      } else {
        await httpSave('tasks.json', content);
      }
      taskState.hasChanges = false;
      saveBtn.disabled = true;
      showStatus('Saved');
    } catch (e) { showStatus('Error: ' + e.message); }
  });

  window.addEventListener('beforeunload', (e) => {
    if (taskState.hasChanges) { e.preventDefault(); e.returnValue = ''; }
  });
}
