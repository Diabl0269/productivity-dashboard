// tasks-io.js - Auto-save, file watching, markChanged

import { todayStr } from './tasks-parser.js';
import { serializeTasksJson, loadTasksJson } from './tasks-json.js';
import { showStatus, showSaved, showStatusAction } from './state.js';
import { httpSave, getLastTaskContent, setLastTaskContent } from './http-loader.js';
import { mergeTasksDocs } from '../../shared/tasks-merge.js';

// Late-bind imports to avoid circular deps at module evaluation time
let getState = null;
let getRenderTasks = null;
let getParseTaskMarkdown = null;
let getApplyLoaded = null;

/** `applyFn(parsed)` puts a loadTasksJson result into the state (optional; a plain replace otherwise). */
export function setIOCallbacks({ stateFn, renderFn, parseFn, applyFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
  getParseTaskMarkdown = parseFn;
  getApplyLoaded = applyFn || null;
}

/** How many times a save that hit a conflict merges and retries before it warns. */
export const MAX_CONFLICT_RETRIES = 4;

function applyParsed(state, parsed) {
  if (getApplyLoaded) { getApplyLoaded(parsed); return; }
  state.sections.length = 0;
  state.sections.push(...parsed.sections);
  for (const key of Object.keys(state.tasks)) delete state.tasks[key];
  Object.assign(state.tasks, parsed.tasks);
  if (parsed.ticketTypes) state.ticketTypes = parsed.ticketTypes;
  if (parsed.meta) state.meta = parsed.meta;
}

/** A document in the dashboard's own canonical shape, so base/local/current compare field for field. */
function canonicalDoc(text) {
  const r = loadTasksJson(text);
  return JSON.parse(serializeTasksJson(r.sections, r.tasks, r.ticketTypes, r.meta));
}

/**
 * The file changed under us (a `ch` write from another session). Merge our edits with the
 * file as it is now, put the result into the state and return the text to save next.
 */
function mergeConflict(state, currentText) {
  const local = JSON.parse(serializeTasksJson(state.sections, state.tasks, state.ticketTypes, state.meta));
  const baseText = getLastTaskContent();
  const base = baseText ? canonicalDoc(baseText) : { sections: [] };
  const merged = mergeTasksDocs(base, local, canonicalDoc(currentText));
  applyParsed(state, loadTasksJson(JSON.stringify(merged)));
  setLastTaskContent(currentText);
  getRenderTasks()();
  return serializeTasksJson(state.sections, state.tasks, state.ticketTypes, state.meta);
}

let saveTimeout = null;
let changeSeq = 0; // bumped on every edit so a save can tell if newer edits landed mid-flight
export let lastModified = 0;
export let isSaving = false;

export function setLastModified(val) {
  lastModified = val;
}

export function markChanged(task) {
  const state = getState();
  state.hasChanges = true;
  changeSeq++;
  if (task) {
    task.updated = todayStr();
  }
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.disabled = false;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(autoSave, 500);
}

/** Persist pending edits immediately (e.g. after project metadata save). */
export function flushAutoSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  return autoSave();
}

export async function autoSave() {
  const state = getState();
  if (!state.hasChanges) return;
  if (isSaving) {
    // An edit arrived mid-save: retry once the in-flight save finishes instead of dropping it.
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(autoSave, 200);
    return;
  }
  isSaving = true;
  let seqAtStart = changeSeq;
  let merged = false;
  try {
    let content = serializeTasksJson(state.sections, state.tasks, state.ticketTypes, state.meta);
    if (state.taskFileHandle) {
      const writable = await state.taskFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      const file = await state.taskFileHandle.getFile();
      lastModified = file.lastModified;
    } else {
      for (let attempt = 0; ; attempt++) {
        try {
          await httpSave('tasks.json', content, { baseContent: getLastTaskContent() });
          setLastTaskContent(content);
          break;
        } catch (e) {
          if (e.code !== 'conflict') throw e;
          if (attempt >= MAX_CONFLICT_RETRIES) { warnUnsaved(state, 'the file keeps changing underneath'); return; }
          try {
            content = mergeConflict(state, e.current);
          } catch (mergeErr) {
            warnUnsaved(state, `could not merge: ${mergeErr.message}`);
            return;
          }
          seqAtStart = changeSeq; // the merge started from the latest edits
          merged = true;
        }
      }
    }
    if (changeSeq === seqAtStart) {
      state.hasChanges = false;
      document.getElementById('saveBtn').disabled = true;
      showSaved(merged ? 'Saved (merged)' : 'Saved');
    } else {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(autoSave, 0);
    }
  } catch (e) {
    showStatus('Save failed: ' + e.message);
  } finally {
    isSaving = false;
  }
}

/** Edits are only in memory: say so, stay on screen until dealt with, and never offer a discarding Reload. */
function warnUnsaved(state, why) {
  state.hasChanges = true;
  document.getElementById('saveBtn').disabled = false;
  showStatusAction(`NOT SAVED: ${why}. Your edits are kept in this tab; keep it open.`, {
    actionLabel: 'Retry save',
    onAction: () => { autoSave(); },
    durationMs: 0, // 0 = stays until dismissed or the save works
  });
}

let watchInterval = null;

export async function checkForExternalChanges() {
  const state = getState();
  if (!state.taskFileHandle || state.hasChanges || isSaving) return;
  try {
    const file = await state.taskFileHandle.getFile();
    if (file.lastModified > lastModified) {
      // Re-check after await — a save may have finished mid-flight.
      if (state.hasChanges || isSaving) return;
      lastModified = file.lastModified;
      const content = await file.text();
      if (state.hasChanges || isSaving) return;
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
