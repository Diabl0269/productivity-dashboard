// ===== SHARED STATE =====

import { onTabSwitch } from './search.js';
import { syncUrl, isRoutingReady } from './routing.js';

export let activeMainTab = 'overview'; // overview | tasks | search | projects | plan | checks | memory | settings | metrics | home | automations

const MAIN_TAB_ORDER = [
  'overview', 'tasks', 'search', 'projects', 'plan', 'memory', 'settings', 'metrics', 'home', 'checks', 'automations',
];

// Externally-configured tabs (config.json externalTabs) register themselves here so
// switchMainTab can toggle their button/panel without hardcoding each one by id.
const externalTabs = new Map(); // id -> { btn, panel }

/** @param {string} id @param {{ btn?: HTMLElement, panel?: HTMLElement }} refs */
export function registerExternalTab(id, refs) {
  externalTabs.set(id, refs);
}

const MAIN_TAB_BTN_IDS = [
  'overviewTabBtn', 'tasksTabBtn', 'searchTabBtn', 'projectsTabBtn',
  'runPlanTabBtn', 'memoryTabBtn', 'settingsTabBtn', 'metricsTabBtn', 'homeTabBtn', 'checksTabBtn', 'automationsTabBtn',
];

const MOD_KEY_LABEL = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

function initTabShortcutBadges() {
  MAIN_TAB_BTN_IDS.forEach((id, i) => {
    const btn = document.getElementById(id);
    if (!btn || btn.querySelector('.tab-shortcut')) return;
    const kbd = document.createElement('kbd');
    kbd.className = 'tab-shortcut';
    kbd.textContent = `${MOD_KEY_LABEL}${(i + 1) % 10}`; // the 10th tab (Checks) is ⌘0
    kbd.setAttribute('aria-hidden', 'true');
    btn.appendChild(kbd);
  });
}

function initShortcutReveal() {
  const show = () => document.body.classList.add('show-shortcuts');
  const hide = () => document.body.classList.remove('show-shortcuts');

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) show();
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Meta' || e.key === 'Control') hide();
  });
  window.addEventListener('blur', hide);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

const statusEl = document.getElementById('status');
export const filePathEl = document.getElementById('filePath');

let statusTimer = null;
let actionUntil = 0; // while an Undo-style toast is up, a routine "Saved" must not replace it

export function showStatus(msg) {
  showStatusAction(msg, { durationMs: 2000 });
}

/** The routine "Saved" note after an autosave: skipped while an Undo toast is still showing (PRO85). */
export function showSaved(msg) {
  if (Date.now() < actionUntil) return;
  showStatus(msg);
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
      actionUntil = 0;
      statusEl.classList.remove('visible');
      onAction();
    });
    statusEl.appendChild(btn);
  }

  actionUntil = actionLabel && onAction && durationMs > 0 ? Date.now() + durationMs : 0;
  statusEl.classList.add('visible');
  statusTimer = durationMs > 0 ? setTimeout(() => statusEl.classList.remove('visible'), durationMs) : null; // 0 = stays until replaced or its action is used
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
  const searchTabBtn = document.getElementById('searchTabBtn');
  const projectsTabBtn = document.getElementById('projectsTabBtn');
  const runPlanTabBtn = document.getElementById('runPlanTabBtn');
  const checksTabBtn = document.getElementById('checksTabBtn');
  const metricsTabBtn = document.getElementById('metricsTabBtn');
  const memoryTabBtn = document.getElementById('memoryTabBtn');
  const settingsTabBtn = document.getElementById('settingsTabBtn');
  const overviewPanel = document.getElementById('overviewPanel');
  const tasksPanel = document.getElementById('tasksPanel');
  const searchPanel = document.getElementById('searchPanel');
  const projectsPanel = document.getElementById('projectsPanel');
  const runPlanPanel = document.getElementById('runPlanPanel');
  const checksPanel = document.getElementById('checksPanel');
  const metricsPanel = document.getElementById('metricsPanel');
  const memoryPanel = document.getElementById('memoryPanel');
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
    { btn: searchTabBtn, id: 'search' },
    { btn: projectsTabBtn, id: 'projects' },
    { btn: runPlanTabBtn, id: 'plan' },
    { btn: checksTabBtn, id: 'checks' },
    { btn: metricsTabBtn, id: 'metrics' },
    { btn: memoryTabBtn, id: 'memory' },
    { btn: settingsTabBtn, id: 'settings' },
    { btn: document.getElementById('homeTabBtn'), id: 'home' },
    { btn: document.getElementById('automationsTabBtn'), id: 'automations' },
  ];
  for (const { btn, id } of tabButtons) {
    if (!btn) continue;
    const isActive = tab === id;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  overviewPanel.classList.toggle('active', tab === 'overview');
  tasksPanel.classList.toggle('active', tab === 'tasks');
  if (searchPanel) searchPanel.classList.toggle('active', tab === 'search');
  if (projectsPanel) projectsPanel.classList.toggle('active', tab === 'projects');
  if (runPlanPanel) runPlanPanel.classList.toggle('active', tab === 'plan');
  if (checksPanel) checksPanel.classList.toggle('active', tab === 'checks');
  if (metricsPanel) metricsPanel.classList.toggle('active', tab === 'metrics');
  memoryPanel.classList.toggle('active', tab === 'memory');
  if (settingsPanel) settingsPanel.classList.toggle('active', tab === 'settings');
  document.getElementById('homePanel')?.classList.toggle('active', tab === 'home');
  document.getElementById('automationsPanel')?.classList.toggle('active', tab === 'automations');

  // Externally-configured (config.json externalTabs) tabs, if any.
  for (const [extId, { btn, panel }] of externalTabs) {
    const isActive = tab === extId;
    if (btn) {
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    if (panel) panel.classList.toggle('active', isActive);
  }

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
  // Save is available on Tasks (task edits), Projects (meta), and Settings (ticket-type edits → tasks.json)
  saveBtn.style.display = (tab === 'tasks' || tab === 'settings' || tab === 'projects') ? 'inline-flex' : 'none';

  // Update file path display
  const taskInfo = getTaskInfo();
  const memInfo = getMemoryInfo();

  if (tab === 'tasks' || tab === 'settings' || tab === 'projects') {
    filePathEl.textContent = taskInfo.name || '';
  } else if (tab === 'memory') {
    const activeMemTab = document.querySelector('#memoryTabsContainer .memory-tab.active');
    filePathEl.textContent = activeMemTab?.dataset.tab === 'global'
      ? '~/.claude/'
      : (memInfo.name || '');
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

  if (tab === 'plan') {
    import('./run-plan-view.js').then(m => m.renderRunPlanView()).catch(() => {});
  }

  if (tab === 'checks') {
    import('./checks-view.js').then(m => m.renderChecksView()).catch(() => {});
  }

  if (tab === 'metrics') {
    import('./metrics-view.js').then(m => m.onMetricsTabShow()).catch(() => {});
  }

  if (tab === 'home') {
    import('./home-view.js').then(m => m.renderHomeView()).catch(e => console.error('Home failed to load:', e));
  }

  if (tab === 'automations') {
    import('./automations-view.js').then(m => m.onAutomationsTabShow()).catch(e => console.error('Automations failed to load:', e));
  }

  if (tab === 'search') {
    import('./search-page.js').then(m => m.onSearchTabShow()).catch(() => {});
  }

  onTabSwitch(tab);

  if (!opts.fromRoute && isRoutingReady()) syncUrl();
}

export function initStateListeners() {
  initTabShortcutBadges();
  initShortcutReveal();

  const overviewTabBtn = document.getElementById('overviewTabBtn');
  const tasksTabBtn = document.getElementById('tasksTabBtn');
  const searchTabBtn = document.getElementById('searchTabBtn');
  const projectsTabBtn = document.getElementById('projectsTabBtn');
  const runPlanTabBtn = document.getElementById('runPlanTabBtn');
  const checksTabBtn = document.getElementById('checksTabBtn');
  const metricsTabBtn = document.getElementById('metricsTabBtn');
  const memoryTabBtn = document.getElementById('memoryTabBtn');
  const settingsTabBtn = document.getElementById('settingsTabBtn');

  overviewTabBtn.addEventListener('click', () => switchMainTab('overview'));
  tasksTabBtn.addEventListener('click', () => switchMainTab('tasks'));
  if (searchTabBtn) searchTabBtn.addEventListener('click', () => switchMainTab('search'));
  if (projectsTabBtn) projectsTabBtn.addEventListener('click', () => switchMainTab('projects'));
  if (runPlanTabBtn) runPlanTabBtn.addEventListener('click', () => switchMainTab('plan'));
  if (checksTabBtn) checksTabBtn.addEventListener('click', () => switchMainTab('checks'));
  if (metricsTabBtn) metricsTabBtn.addEventListener('click', () => switchMainTab('metrics'));
  memoryTabBtn.addEventListener('click', () => switchMainTab('memory'));
  if (settingsTabBtn) settingsTabBtn.addEventListener('click', () => switchMainTab('settings'));
  document.getElementById('homeTabBtn')?.addEventListener('click', () => switchMainTab('home'));
  document.getElementById('automationsTabBtn')?.addEventListener('click', () => switchMainTab('automations'));

  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    const k = parseInt(e.key, 10);
    const n = k === 0 ? 10 : k; // ⌘0 is the 10th tab; the first nine keep their keys
    if (n >= 1 && n <= MAIN_TAB_ORDER.length) {
      e.preventDefault();
      switchMainTab(MAIN_TAB_ORDER[n - 1]);
    }
  });
}
