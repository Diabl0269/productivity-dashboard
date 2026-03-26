// main.js - Entry point that imports everything and initializes

import { initTheme } from './theme.js';
import { initStateListeners } from './state.js';
import { getHandle, verifyPermission } from './persistence.js';
import { initOverview, updateTaskSummary, updateDeadlines } from './overview.js';
import { initTasks, loadTaskFromHandle, loadTaskFromHttp } from './tasks-main.js';
import { initMemory, loadMemoryFromHandle, loadMemoryFromHttpData } from './memory-renderer.js';
import { initGlobalMemory, loadGlobalMemory } from './global-memory.js';
import { initModal } from './memory-modal.js';
import { initInlineEdit } from './inline-edit.js';
import { loadTasksViaHttp, loadMemoryViaHttp, startHttpTaskWatching } from './http-loader.js';
import { initSearch } from './search.js';

// Load dashboard config (gitignored — personal quick links, sprints, etc.)
async function loadConfig() {
  try {
    const res = await fetch('../config.json');
    if (res.ok) window.dashboardConfig = await res.json();
  } catch (e) { /* config.json not found — using defaults */ }
  window.dashboardConfig = window.dashboardConfig || {};
}

function renderQuickLinks() {
  const container = document.getElementById('quickLinksList');
  if (!container) return;
  const links = (window.dashboardConfig && window.dashboardConfig.quickLinks) || [];
  if (links.length === 0) {
    container.innerHTML = '<div class="quick-links-empty">Configure quick links in config.json</div>';
    return;
  }
  container.innerHTML = links.map(link => `
    <a href="${link.url}" target="_blank" class="quick-link">
      <span class="quick-link-icon">${link.icon}</span>
      <span>${link.label}</span>
    </a>
  `).join('');
}

// Initialize all modules — config must load first for sprints/links
await loadConfig();
renderQuickLinks();
initTheme();
initStateListeners();
initOverview();
initTasks();
initMemory();
initGlobalMemory();
initModal();
initInlineEdit();
initSearch();

// Auto-restore file handles, fall back to HTTP fetch
let tasksLoaded = false;
let memoryLoaded = false;

// Try FileSystem API first
try {
  const taskHandle = await getHandle('taskFile');
  if (taskHandle && await verifyPermission(taskHandle, true)) {
    await loadTaskFromHandle(taskHandle);
    const taskState = window.taskState;
    if (taskState && taskState.tasks) {
      updateTaskSummary({ tasks: taskState.tasks });
      updateDeadlines({ tasks: taskState.tasks });
    }
    tasksLoaded = true;
  }
} catch (e) { console.log('Auto-restore tasks skipped:', e.message); }

try {
  const memHandle = await getHandle('memoryDir');
  if (memHandle && await verifyPermission(memHandle)) {
    await loadMemoryFromHandle(memHandle);
    memoryLoaded = true;
  }
} catch (e) { console.log('Auto-restore memory skipped:', e.message); }

// Fall back to HTTP fetch for anything that didn't load
if (!tasksLoaded) {
  try {
    const result = await loadTasksViaHttp();
    if (result) {
      loadTaskFromHttp(result.parsed);
      updateTaskSummary(result.parsed);
      updateDeadlines(result.parsed);
      startHttpTaskWatching((parsed) => {
        loadTaskFromHttp(parsed);
        updateTaskSummary(parsed);
        updateDeadlines(parsed);
      });
      tasksLoaded = true;
      console.log('Tasks loaded via HTTP');
    }
  } catch (e) { console.log('HTTP task load failed:', e.message); }
}

if (!memoryLoaded) {
  try {
    const data = await loadMemoryViaHttp();
    if (data) {
      loadMemoryFromHttpData(data);
      memoryLoaded = true;
      console.log('Memory loaded via HTTP');
    }
  } catch (e) { console.log('HTTP memory load failed:', e.message); }
}

// Load global memory (HTTP only, no FileSystem API needed)
try {
  await loadGlobalMemory();
  console.log('Global memory loaded');
} catch (e) { console.log('Global memory load failed:', e.message); }
