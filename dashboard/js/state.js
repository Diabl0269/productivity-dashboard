// ===== SHARED STATE =====

import { onTabSwitch } from './search.js';

export let activeMainTab = 'overview'; // 'overview', 'tasks', 'memory', or 'global-memory'

const statusEl = document.getElementById('status');
export const filePathEl = document.getElementById('filePath');

export function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.classList.add('visible');
  setTimeout(() => statusEl.classList.remove('visible'), 2000);
}

// These will be set by tasks-main.js and memory-renderer.js
let getTaskInfo = () => ({ handle: null, name: '' });
let getMemoryInfo = () => ({ handle: null });

export function setTaskInfoGetter(fn) { getTaskInfo = fn; }
export function setMemoryInfoGetter(fn) { getMemoryInfo = fn; }

// ===== MAIN TAB SWITCHING =====

export function switchMainTab(tab) {
  activeMainTab = tab;

  const overviewTabBtn = document.getElementById('overviewTabBtn');
  const tasksTabBtn = document.getElementById('tasksTabBtn');
  const memoryTabBtn = document.getElementById('memoryTabBtn');
  const globalMemoryTabBtn = document.getElementById('globalMemoryTabBtn');
  const overviewPanel = document.getElementById('overviewPanel');
  const tasksPanel = document.getElementById('tasksPanel');
  const memoryPanel = document.getElementById('memoryPanel');
  const globalMemoryPanel = document.getElementById('globalMemoryPanel');
  const taskViewToggle = document.getElementById('taskViewToggle');
  const openTaskBtn = document.getElementById('openTaskBtn');
  const openMemoryBtn = document.getElementById('openMemoryBtn');
  const saveBtn = document.getElementById('saveBtn');

  overviewTabBtn.classList.toggle('active', tab === 'overview');
  tasksTabBtn.classList.toggle('active', tab === 'tasks');
  memoryTabBtn.classList.toggle('active', tab === 'memory');
  globalMemoryTabBtn.classList.toggle('active', tab === 'global-memory');

  overviewPanel.classList.toggle('active', tab === 'overview');
  tasksPanel.classList.toggle('active', tab === 'tasks');
  memoryPanel.classList.toggle('active', tab === 'memory');
  globalMemoryPanel.classList.toggle('active', tab === 'global-memory');

  // Show/hide view toggle for tasks
  taskViewToggle.style.display = tab === 'tasks' ? 'flex' : 'none';

  // Show/hide appropriate buttons
  openTaskBtn.style.display = tab === 'tasks' ? 'inline-flex' : 'none';
  openMemoryBtn.style.display = tab === 'memory' ? 'inline-flex' : 'none';
  saveBtn.style.display = tab === 'tasks' ? 'inline-flex' : 'none';

  // Update file path display
  const taskInfo = getTaskInfo();
  const memInfo = getMemoryInfo();

  if (tab === 'tasks') {
    filePathEl.textContent = taskInfo.name || '';
  } else if (tab === 'memory') {
    filePathEl.textContent = memInfo.name || '';
  } else if (tab === 'global-memory') {
    filePathEl.textContent = '~/.claude/';
  } else {
    filePathEl.textContent = '';
  }
  onTabSwitch(tab);
}

export function initStateListeners() {
  const overviewTabBtn = document.getElementById('overviewTabBtn');
  const tasksTabBtn = document.getElementById('tasksTabBtn');
  const memoryTabBtn = document.getElementById('memoryTabBtn');
  const globalMemoryTabBtn = document.getElementById('globalMemoryTabBtn');

  overviewTabBtn.addEventListener('click', () => switchMainTab('overview'));
  tasksTabBtn.addEventListener('click', () => switchMainTab('tasks'));
  memoryTabBtn.addEventListener('click', () => switchMainTab('memory'));
  globalMemoryTabBtn.addEventListener('click', () => switchMainTab('global-memory'));

  // Initialize header state on page load
  switchMainTab('overview');
}
