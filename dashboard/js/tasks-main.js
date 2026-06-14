// tasks-main.js - Main orchestrator for tasks functionality

import { taskSectionId, autoArchive } from './tasks-parser.js';
import { loadTasksJson, serializeTasksJson } from './tasks-json.js';
import { markChanged, startWatching, setIOCallbacks, setLastModified, autoSave } from './tasks-io.js';
import { renderBoard, setBoardCallbacks } from './tasks-board.js';
import { renderList, setListCallbacks } from './tasks-list.js';
import { showStatus, filePathEl, setTaskInfoGetter, activeMainTab } from './state.js';
import { saveHandle } from './persistence.js';
import { httpSave } from './http-loader.js';
import { reapplySearch } from './search.js';

// ===== Shared mutable state =====
export const taskState = {
  taskFileHandle: null,
  taskFileName: '',
  sections: [],
  tasks: {},
  hasChanges: false,
  currentView: 'board',
  quickAddSection: null,
  sortByPriority: true
};

export function renderTasks() {
  if (taskState.currentView === 'board') renderBoard();
  else renderList();
  reapplySearch();
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

setTaskInfoGetter(() => ({
  handle: taskState.taskFileHandle,
  name: taskState.taskFileName
}));

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
  taskState.sections.length = 0;
  taskState.sections.push(...result.sections);
  for (const key of Object.keys(taskState.tasks)) delete taskState.tasks[key];
  Object.assign(taskState.tasks, result.tasks);
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
  taskState.sections.length = 0;
  taskState.sections.push(...parsed.sections);
  for (const key of Object.keys(taskState.tasks)) delete taskState.tasks[key];
  Object.assign(taskState.tasks, parsed.tasks);
  autoArchive(taskState.sections, taskState.tasks);
  switchTaskView('board');
  taskState.taskFileName = 'tasks.json';
  if (activeMainTab === 'tasks') filePathEl.textContent = 'tasks.json';
  showStatus('Loaded tasks.json via HTTP');
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
  openTaskBtn.addEventListener('click', openTaskFile);
  document.getElementById('openBtnLarge')?.addEventListener('click', openTaskFile);

  saveBtn.addEventListener('click', async () => {
    try {
      const content = serializeTasksJson(taskState.sections, taskState.tasks);
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
