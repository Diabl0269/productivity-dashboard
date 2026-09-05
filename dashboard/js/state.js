// ===== SHARED STATE =====

import { onTabSwitch } from './search.js';
import { syncUrl, isRoutingReady } from './routing.js';

export let activeMainTab = 'overview'; // overview | tasks | projects | memory | global-memory | settings

const statusEl = document.getElementById('status');
export const filePathEl = document.getElementById('filePath');

let statusTimer = null;

export function showStatus(msg) {
  showStatusAction(msg, { durationMs: 2000 });
}

/**
 * Status toast with optional action button (e.g. Undo).
 * @param {string} msg
 * @param {{ actionLabel?: string, onAction?: () => void, durationMs?: number }} [opts]
 */
export function showStatusAction(msg, opts = {}) {
  const { actionLabel, onAction, durationMs = 2000 } = opts;
  if (!statusEl) return;
  if (statusTimer) clearTimeout(statusTimer);

  statusEl.textContent = '';
  const text = document.createElement('span');
  text.textContent = msg;
  statusEl.appendChild(text);

  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'status-action-btn';
    btn.textContent = actionLabel;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (statusTimer) clearTimeout(statusTimer);
      statusEl.classList.remove('visible');
      onAction();
    });
    statusEl.appendChild(btn);
  }

  statusEl.classList.add('visible');
  statusTimer = setTimeout(() => statusEl.classList.remove('visible'), durationMs);
}

// These will be set by tasks-main.js and memory-renderer.js
let getTaskInfo = () => ({ handle: null, name: '' });
let getMemoryInfo = () => ({ handle: null });

export function setTaskInfoGetter(fn) { getTaskInfo = fn; }
export function setMemoryInfoGetter(fn) { getMemoryInfo = fn; }

// ===== MAIN TAB SWITCHING =====

export function switchMainTab(tab, opts = {}) {
  activeMainTab = tab;

  const overviewTabBtn = document.getElementById('overviewTabBtn');
  const tasksTabBtn = document.getElementById('tasksTabBtn');
  const projectsTabBtn = document.getElementById('projectsTabBtn');
  const memoryTabBtn = document.getElementById('memoryTabBtn');
  const globalMemoryTabBtn = document.getElementById('globalMemoryTabBtn');
  const settingsTabBtn = document.getElementById('settingsTabBtn');
  const overviewPanel = document.getElementById('overviewPanel');
  const tasksPanel = document.getElementById('tasksPanel');
  const projectsPanel = document.getElementById('projectsPanel');
  const memoryPanel = document.getElementById('memoryPanel');
  const globalMemoryPanel = document.getElementById('globalMemoryPanel');
  const settingsPanel = document.getElementById('settingsPanel');
  const taskViewToggle = document.getElementById('taskViewToggle');
  const sortPriorityBtn = document.getElementById('sortPriorityBtn');
  const swimlanesBtn = document.getElementById('swimlanesBtn');
  const keyboardHintsBtn = document.getElementById('keyboardHintsBtn');
  const openTaskBtn = document.getElementById('openTaskBtn');
  const openMemoryBtn = document.getElementById('openMemoryBtn');
  const saveBtn = document.getElementById('saveBtn');
  const headerLeft = document.querySelector('.header-left');

  // Toggle .active and aria-selected on tab buttons
  const tabButtons = [
    { btn: overviewTabBtn, id: 'overview' },
    { btn: tasksTabBtn, id: 'tasks' },
    { btn: projectsTabBtn, id: 'projects' },
    { btn: memoryTabBtn, id: 'memory' },
    { btn: globalMemoryTabBtn, id: 'global-memory' },
    { btn: settingsTabBtn, id: 'settings' },
  ];
  for (const { btn, id } of tabButtons) {
    if (!btn) continue;
    const isActive = tab === id;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  overviewPanel.classList.toggle('active', tab === 'overview');
  tasksPanel.classList.toggle('active', tab === 'tasks');
  if (projectsPanel) projectsPanel.classList.toggle('active', tab === 'projects');
  memoryPanel.classList.toggle('active', tab === 'memory');
  globalMemoryPanel.classList.toggle('active', tab === 'global-memory');
  if (settingsPanel) settingsPanel.classList.toggle('active', tab === 'settings');

  // Show/hide view toggle for tasks
  taskViewToggle.style.display = tab === 'tasks' ? 'flex' : 'none';

  // Sort priority button — now a standalone sibling, visibility managed by class
  if (sortPriorityBtn) {
    sortPriorityBtn.classList.toggle('hidden', tab !== 'tasks');
  }
  if (swimlanesBtn) swimlanesBtn.classList.toggle('hidden', tab !== 'tasks');
  if (keyboardHintsBtn) keyboardHintsBtn.classList.toggle('hidden', tab !== 'tasks');

  // Show/hide appropriate buttons
  openTaskBtn.style.display = tab === 'tasks' ? 'inline-flex' : 'none';
  openMemoryBtn.style.display = tab === 'memory' ? 'inline-flex' : 'none';
  // Save is available on Tasks (task edits) and Settings (ticket-type edits → tasks.json)
  saveBtn.style.display = (tab === 'tasks' || tab === 'settings') ? 'inline-flex' : 'none';

  // Update file path display
  const taskInfo = getTaskInfo();
  const memInfo = getMemoryInfo();

  if (tab === 'tasks' || tab === 'settings' || tab === 'projects') {
    filePathEl.textContent = taskInfo.name || '';
  } else if (tab === 'memory') {
    filePathEl.textContent = memInfo.name || '';
  } else if (tab === 'global-memory') {
    filePathEl.textContent = '~/.claude/';
  } else {
    filePathEl.textContent = '';
  }

  // Toggle .has-path on .header-left to show/hide the file-path subtitle
  if (headerLeft) {
    headerLeft.classList.toggle('has-path', !!filePathEl.textContent.trim());
  }

  if (tab === 'projects') {
    import('./projects-view.js').then(m => m.renderProjectsView()).catch(() => {});
  }

  onTabSwitch(tab);

  if (!opts.fromRoute && isRoutingReady()) syncUrl();
}

export function initStateListeners() {
  const overviewTabBtn = document.getElementById('overviewTabBtn');
  const tasksTabBtn = document.getElementById('tasksTabBtn');
  const projectsTabBtn = document.getElementById('projectsTabBtn');
  const memoryTabBtn = document.getElementById('memoryTabBtn');
  const globalMemoryTabBtn = document.getElementById('globalMemoryTabBtn');
  const settingsTabBtn = document.getElementById('settingsTabBtn');

  overviewTabBtn.addEventListener('click', () => switchMainTab('overview'));
  tasksTabBtn.addEventListener('click', () => switchMainTab('tasks'));
  if (projectsTabBtn) projectsTabBtn.addEventListener('click', () => switchMainTab('projects'));
  memoryTabBtn.addEventListener('click', () => switchMainTab('memory'));
  globalMemoryTabBtn.addEventListener('click', () => switchMainTab('global-memory'));
  if (settingsTabBtn) settingsTabBtn.addEventListener('click', () => switchMainTab('settings'));
}
