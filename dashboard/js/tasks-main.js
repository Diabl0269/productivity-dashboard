// tasks-main.js - Main orchestrator for tasks functionality

import { parseTaskMarkdown, taskSectionId, toMarkdown, autoArchive } from './tasks-parser.js';
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
  parseFn: () => parseTaskMarkdown
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
  renderTasks();
}

export async function loadTaskFromHandle(handle) {
  taskState.taskFileHandle = handle;
  const file = await taskState.taskFileHandle.getFile();
  const content = await file.text();
  setLastModified(file.lastModified);
  const result = parseTaskMarkdown(content);
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
  taskState.taskFileName = 'TASKS.md';
  if (activeMainTab === 'tasks') filePathEl.textContent = 'TASKS.md';
  showStatus('Loaded TASKS.md via HTTP');
}

export async function openTaskFile() {
  try {
    [taskState.taskFileHandle] = await window.showOpenFilePicker({
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }]
    });
    await loadTaskFromHandle(taskState.taskFileHandle);
    await saveHandle('taskFile', taskState.taskFileHandle);
  } catch (e) {
    if (e.name !== 'AbortError') showStatus('Error: ' + e.message);
  }
}

export function initTasks() {
  const listViewBtn = document.getElementById('listViewBtn');
  const boardViewBtn = document.getElementById('boardViewBtn');
  const openTaskBtn = document.getElementById('openTaskBtn');
  const saveBtn = document.getElementById('saveBtn');

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
      const content = toMarkdown(taskState.sections, taskState.tasks);
      if (taskState.taskFileHandle) {
        const writable = await taskState.taskFileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      } else {
        await httpSave('TASKS.md', content);
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
