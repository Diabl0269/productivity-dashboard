// tasks-io.js - Auto-save, file watching, markChanged

import { todayStr } from './tasks-parser.js';
import { serializeTasksJson } from './tasks-json.js';
import { showStatus, showStatusAction } from './state.js';
import { httpSave, getLastTaskContent, setLastTaskContent } from './http-loader.js';

// Late-bind imports to avoid circular deps at module evaluation time
let getState = null;
let getRenderTasks = null;
let getParseTaskMarkdown = null;

export function setIOCallbacks({ stateFn, renderFn, parseFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
  getParseTaskMarkdown = parseFn;
}

let saveTimeout = null;
export let lastModified = 0;
export let isSaving = false;

export function setLastModified(val) {
  lastModified = val;
}

export function markChanged(task) {
  const state = getState();
  state.hasChanges = true;
  if (task) {
    task.updated = todayStr();
  }
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.disabled = false;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(autoSave, 500);
}

export async function autoSave() {
  const state = getState();
  if (!state.hasChanges || isSaving) return;
  isSaving = true;
  try {
    const content = serializeTasksJson(state.sections, state.tasks, state.ticketTypes, state.meta);
    if (state.taskFileHandle) {
      const writable = await state.taskFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      const file = await state.taskFileHandle.getFile();
      lastModified = file.lastModified;
    } else {
      await httpSave('tasks.json', content, { baseContent: getLastTaskContent() });
      setLastTaskContent(content);
    }
    state.hasChanges = false;
    document.getElementById('saveBtn').disabled = true;
    showStatus('Saved');
  } catch (e) {
    if (e.code === 'conflict') {
      showStatusAction('Save conflict — file changed externally', {
        actionLabel: 'Reload',
        onAction: () => {
          const result = getParseTaskMarkdown()(e.current);
          state.sections.length = 0;
          state.sections.push(...result.sections);
          for (const key of Object.keys(state.tasks)) delete state.tasks[key];
          Object.assign(state.tasks, result.tasks);
          if (result.ticketTypes) state.ticketTypes = result.ticketTypes;
          if (result.meta) state.meta = result.meta;
          getRenderTasks()();
          setLastTaskContent(e.current);
          state.hasChanges = false;
          document.getElementById('saveBtn').disabled = true;
          showStatus('Reloaded');
        },
        durationMs: 10000
      });
      state.hasChanges = true;
      document.getElementById('saveBtn').disabled = false;
      return;
    }
    showStatus('Save failed: ' + e.message);
  }
  isSaving = false;
}

let watchInterval = null;

export async function checkForExternalChanges() {
  const state = getState();
  if (!state.taskFileHandle || state.hasChanges || isSaving) return;
  try {
    const file = await state.taskFileHandle.getFile();
    if (file.lastModified > lastModified) {
      lastModified = file.lastModified;
      const content = await file.text();
      const result = getParseTaskMarkdown()(content);
      state.sections.length = 0;
      state.sections.push(...result.sections);
      // Clear and repopulate tasks
      for (const key of Object.keys(state.tasks)) delete state.tasks[key];
      Object.assign(state.tasks, result.tasks);
      if (result.ticketTypes) state.ticketTypes = result.ticketTypes;
      if (result.meta) state.meta = result.meta;
      getRenderTasks()();
      showStatus('Reloaded');
    }
  } catch (e) {
    console.log('Watch error:', e);
  }
}
// NOTE: getParseTaskMarkdown() is still wired via setIOCallbacks for the FS-Access
// handle path. tasks-main.js now passes loadTasksJson as parseFn.

export function startWatching() {
  if (watchInterval) clearInterval(watchInterval);
  watchInterval = setInterval(checkForExternalChanges, 1000);
}

export function stopWatching() {
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
  }
}
