// tasks-io.js - Auto-save, file watching, markChanged

import { toMarkdown, todayStr } from './tasks-parser.js';
import { showStatus } from './state.js';
import { httpSave } from './http-loader.js';

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
  document.getElementById('saveBtn').disabled = false;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(autoSave, 500);
}

export async function autoSave() {
  const state = getState();
  if (!state.hasChanges || isSaving) return;
  isSaving = true;
  try {
    const content = toMarkdown(state.sections, state.tasks);
    if (state.taskFileHandle) {
      const writable = await state.taskFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      const file = await state.taskFileHandle.getFile();
      lastModified = file.lastModified;
    } else {
      await httpSave('TASKS.md', content);
    }
    state.hasChanges = false;
    document.getElementById('saveBtn').disabled = true;
    showStatus('Saved');
  } catch (e) {
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
      getRenderTasks()();
      showStatus('Reloaded');
    }
  } catch (e) {
    console.log('Watch error:', e);
  }
}

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
