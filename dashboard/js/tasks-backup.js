// tasks-backup.js — Backup & restore tasks.json from the dashboard (Settings → Data)

import { showStatus } from './state.js';
import { serializeTasksJson } from './tasks-json.js';
import { loadTasksJson } from './tasks-json.js';
import { markChanged } from './tasks-io.js';
import { httpSave, getLastTaskContent, setLastTaskContent } from './http-loader.js';

let getState = null;
let getRenderTasks = null;

export function setBackupCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function createTasksBackup() {
  const data = await apiFetch('/api/tasks-backup', { method: 'POST' });
  return data;
}

export async function listTasksBackups() {
  const data = await apiFetch('/api/tasks-backups');
  return data.backups || [];
}

export async function restoreTasksBackup(name) {
  const state = getState();
  const data = await apiFetch('/api/tasks-restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const parsed = loadTasksJson(data.content);
  state.sections.length = 0;
  state.sections.push(...parsed.sections);
  for (const key of Object.keys(state.tasks)) delete state.tasks[key];
  Object.assign(state.tasks, parsed.tasks);
  if (parsed.ticketTypes) state.ticketTypes = parsed.ticketTypes;
  if (parsed.meta) state.meta = parsed.meta;
  state.hasChanges = false;
  setLastTaskContent(data.content);
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.disabled = true;
  getRenderTasks?.()();
  return data;
}

/** Download current in-memory tasks as a backup file (works without server API). */
export function downloadTasksBackup(state) {
  const content = serializeTasksJson(state.sections, state.tasks, state.ticketTypes, state.meta);
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
  const name = `tasks-${ts}.json`;
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

export async function restoreFromFile(file) {
  const text = await file.text();
  const parsed = loadTasksJson(text);
  const state = getState();
  state.sections.length = 0;
  state.sections.push(...parsed.sections);
  for (const key of Object.keys(state.tasks)) delete state.tasks[key];
  Object.assign(state.tasks, parsed.tasks);
  if (parsed.ticketTypes) state.ticketTypes = parsed.ticketTypes;
  if (parsed.meta) state.meta = parsed.meta;
  markChanged();
  const content = serializeTasksJson(state.sections, state.tasks, state.ticketTypes, state.meta);
  try {
    if (state.taskFileHandle) {
      const writable = await state.taskFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    } else {
      await httpSave('tasks.json', content, { baseContent: getLastTaskContent() });
      setLastTaskContent(content);
    }
    state.hasChanges = false;
    document.getElementById('saveBtn')?.disabled = true;
  } catch (e) {
    showStatus('Restore loaded — save failed: ' + e.message);
    getRenderTasks?.()();
    throw e;
  }
  getRenderTasks?.()();
}

function formatBackupTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export async function renderBackupPanel() {
  const listEl = document.getElementById('settingsBackupList');
  const statusEl = document.getElementById('settingsBackupStatus');
  if (!listEl) return;

  listEl.innerHTML = '<div class="settings-backup-loading">Loading backups…</div>';
  if (statusEl) statusEl.textContent = '';

  try {
    const backups = await listTasksBackups();
    if (backups.length === 0) {
      listEl.innerHTML = '<p class="settings-backup-empty">No server backups yet. Click <strong>Create backup</strong> before migrating ticket IDs.</p>';
      return;
    }
    listEl.innerHTML = backups.map(b => `
      <div class="settings-backup-row">
        <div class="settings-backup-meta">
          <span class="settings-backup-name">${b.name}</span>
          <span class="settings-backup-detail">${formatBackupTime(b.mtime)} · ${formatSize(b.size)}</span>
        </div>
        <button type="button" class="settings-backup-restore" data-name="${b.name}">Restore</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.settings-backup-restore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        if (!confirm(`Restore from ${name}? Current tasks.json will be replaced.`)) return;
        btn.disabled = true;
        try {
          await restoreTasksBackup(name);
          showStatus(`Restored from ${name}`);
          if (statusEl) statusEl.textContent = `Restored ${name}`;
          await renderBackupPanel();
        } catch (e) {
          showStatus('Restore failed: ' + e.message);
        } finally {
          btn.disabled = false;
        }
      });
    });
  } catch (e) {
    listEl.innerHTML = `<p class="settings-backup-empty">Server backups unavailable (${e.message}). Use <strong>Download backup</strong> instead.</p>`;
  }
}

export function initTasksBackup() {
  const createBtn = document.getElementById('settingsBackupCreate');
  const downloadBtn = document.getElementById('settingsBackupDownload');
  const fileInput = document.getElementById('settingsBackupFile');
  const statusEl = document.getElementById('settingsBackupStatus');

  createBtn?.addEventListener('click', async () => {
    createBtn.disabled = true;
    try {
      const data = await createTasksBackup();
      showStatus(`Backup created: ${data.name}`);
      if (statusEl) statusEl.textContent = `Created ${data.name}`;
      await renderBackupPanel();
    } catch (e) {
      showStatus('Backup failed: ' + e.message);
    } finally {
      createBtn.disabled = false;
    }
  });

  downloadBtn?.addEventListener('click', () => {
    const state = getState?.();
    if (!state?.tasks) {
      showStatus('Load tasks first');
      return;
    }
    const name = downloadTasksBackup(state);
    showStatus(`Downloaded ${name}`);
    if (statusEl) statusEl.textContent = `Downloaded ${name}`;
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (!confirm(`Restore from ${file.name}? Current tasks will be replaced.`)) return;
    try {
      await restoreFromFile(file);
      showStatus(`Restored from ${file.name}`);
      if (statusEl) statusEl.textContent = `Restored ${file.name}`;
      await renderBackupPanel();
    } catch (e) {
      showStatus('Restore failed: ' + e.message);
    }
  });

  document.querySelector('[data-subtab="data"]')?.addEventListener('click', () => {
    renderBackupPanel();
  });
}
