// settings.js — Settings tab (Display prefs + Ticket Types)

import { markChanged } from './tasks-io.js';
import {
  escapeHtml,
  normalizeTicketTypes,
  isValidTypeId,
  slugifyTypeId,
  uniqueTypeId,
  pickNextTypeColor,
  countTasksWithType,
  canRemoveTicketType,
  isBuiltInTicketType,
  moveTicketType,
} from './ticket-types.js';
import { showStatus } from './state.js';
import { applyCorporateVisibility } from './overview.js';
import { applyPomodoroVisibility, readShowPomodoro, writeShowPomodoro } from './task-timer.js';
import { syncUrl, isRoutingReady } from './routing.js';

const HIDE_CORPORATE_KEY = 'dashboard.hideCorporate';
const LEGACY_HIDE_SPRINTS_KEY = 'dashboard.hideSprints';

/** Type ids added this session — id field stays editable until renamed away. */
const editableTypeIds = new Set();

let getState = null;
let getRenderTasks = null;

export function setSettingsCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

/**
 * Solo-first: hide corporate UI by default.
 * Migrates legacy dashboard.hideSprints when hideCorporate is unset.
 */
export function readHideCorporate() {
  try {
    const v = localStorage.getItem(HIDE_CORPORATE_KEY);
    if (v === '1' || v === '0') return v === '1';
    const legacy = localStorage.getItem(LEGACY_HIDE_SPRINTS_KEY);
    if (legacy === '1' || legacy === '0') return legacy === '1';
    return true;
  } catch {
    return true;
  }
}

function writeHideCorporate(hidden) {
  try {
    localStorage.setItem(HIDE_CORPORATE_KEY, hidden ? '1' : '0');
    localStorage.setItem(LEGACY_HIDE_SPRINTS_KEY, hidden ? '1' : '0');
  } catch { /* ignore quota / private mode */ }
}

/** Apply stored display prefs (call early on boot). */
export function applyDisplayPrefs() {
  applyCorporateVisibility(readHideCorporate());
  applyPomodoroVisibility(readShowPomodoro());
}

let activeSettingsSubtab = 'display';

export function getSettingsSubtab() {
  return activeSettingsSubtab;
}

export function switchSettingsSubtab(subtab, opts = {}) {
  const tabs = document.querySelectorAll('#settingsPanel .settings-sub-tab');
  const panels = document.querySelectorAll('#settingsPanel [data-settings-panel]');
  tabs.forEach(btn => {
    const active = btn.dataset.subtab === subtab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  panels.forEach(panel => {
    const match = panel.dataset.settingsPanel === subtab;
    panel.hidden = !match;
  });
  activeSettingsSubtab = subtab;
  if (!opts.fromRoute && isRoutingReady()) syncUrl();
}

function initDisplayPrefs() {
  const toggle = document.getElementById('hideCorporateToggle');
  if (toggle) {
    const hidden = readHideCorporate();
    toggle.checked = hidden;
    applyCorporateVisibility(hidden);

    toggle.addEventListener('change', () => {
      const next = !!toggle.checked;
      writeHideCorporate(next);
      applyCorporateVisibility(next);
      getRenderTasks && getRenderTasks()();
      showStatus(next ? 'Corporate UI hidden' : 'Corporate UI shown');
    });
  }

  const pomoToggle = document.getElementById('showPomodoroToggle');
  if (pomoToggle) {
    const show = readShowPomodoro();
    pomoToggle.checked = show;
    applyPomodoroVisibility(show);

    pomoToggle.addEventListener('change', () => {
      const next = !!pomoToggle.checked;
      writeShowPomodoro(next);
      applyPomodoroVisibility(next);
      getRenderTasks && getRenderTasks()();
      showStatus(next ? 'Pomodoro shown' : 'Pomodoro hidden');
    });
  }
}

function initSettingsSubtabs() {
  document.querySelectorAll('#settingsPanel .settings-sub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      if (subtab) switchSettingsSubtab(subtab);
    });
  });
}

/** Persist ticket-type edits without rebuilding the settings list (avoids input flicker). */
function persistTicketTypes(state) {
  markChanged();
  getRenderTasks && getRenderTasks()();
}

function parentTypesSummary(tt, allTypes) {
  const parents = tt.parentTypes || [];
  if (!parents.length) return 'Standalone';
  const names = parents
    .map(id => allTypes.find(t => t.id === id)?.name || id)
    .join(', ');
  return names;
}

function renderParentCheckboxes(tt, idx, allTypes) {
  const others = allTypes.filter(t => t.id !== tt.id);
  if (!others.length) {
    return '<div class="tt-parents tt-parents-empty">No parent types (top-level)</div>';
  }
  const selected = new Set(tt.parentTypes || []);
  const chips = others.map(pt => `
    <label class="tt-parent-chip">
      <input type="checkbox" class="tt-parent-cb" data-idx="${idx}" data-parent="${escapeHtml(pt.id)}"
        ${selected.has(pt.id) ? 'checked' : ''}
        aria-label="Allow linking under ${escapeHtml(pt.name)}">
      <span>${escapeHtml(pt.name)}</span>
    </label>
  `).join('');
  return `<div class="tt-parents" aria-label="Allowed parent types for ${escapeHtml(tt.name)}">
    <span class="tt-parents-label">Link under</span>
    <div class="tt-parent-chips">${chips}</div>
  </div>`;
}

function renderTypeIdField(tt, idx) {
  if (editableTypeIds.has(tt.id)) {
    return `<input type="text" class="tt-id-input" value="${escapeHtml(tt.id)}" data-idx="${idx}" aria-label="Id for ${escapeHtml(tt.name)}" spellcheck="false">`;
  }
  return `<span class="tt-id">${escapeHtml(tt.id)}</span>`;
}

function removeTitleForType(tt, types, state) {
  if (isBuiltInTicketType(tt.id)) return 'Built-in type cannot be removed';
  const inUse = countTasksWithType(state.tasks, tt.id);
  if (inUse > 0) return `${inUse} task${inUse === 1 ? '' : 's'} use this type`;
  if (types.length <= 1) return 'Keep at least one type';
  return `Remove ${tt.name}`;
}

function renderTypeRow(tt, idx, types, state) {
  const canRemove = canRemoveTicketType(tt.id, types, state.tasks);
  const removeTitle = removeTitleForType(tt, types, state);
  const builtIn = isBuiltInTicketType(tt.id);

  return `
    <div class="tt-row" data-idx="${idx}" data-type-id="${escapeHtml(tt.id)}">
      <div class="tt-main">
        <div class="tt-order" aria-label="Display order">
          <button type="button" class="tt-move" data-dir="up" data-idx="${idx}" aria-label="Move ${escapeHtml(tt.name)} up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="tt-move" data-dir="down" data-idx="${idx}" aria-label="Move ${escapeHtml(tt.name)} down" ${idx === types.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
        <label class="tt-color-wrap" title="Change color">
          <input type="color" class="tt-color" value="${escapeHtml(tt.color)}" data-idx="${idx}" aria-label="Color for ${escapeHtml(tt.name)}">
          <span class="tt-color-swatch" style="background:${escapeHtml(tt.color)}"></span>
        </label>
        <div class="tt-fields">
          ${renderTypeIdField(tt, idx)}
          <input type="text" class="tt-name" value="${escapeHtml(tt.name)}" data-idx="${idx}" aria-label="Display name for ${escapeHtml(tt.id)}">
        </div>
        <span class="tt-level" title="Allowed parent types">${escapeHtml(parentTypesSummary(tt, types))}</span>
        ${builtIn ? '<span class="tt-built-in" title="Built-in type">Built-in</span>' : ''}
        <button type="button" class="tt-remove" data-idx="${idx}" aria-label="${escapeHtml(removeTitle)}" title="${escapeHtml(removeTitle)}" ${canRemove ? '' : 'disabled'}>×</button>
      </div>
      ${renderParentCheckboxes(tt, idx, types)}
    </div>
  `;
}

function syncRowMeta(row, tt, types, state) {
  const idx = parseInt(row.dataset.idx, 10);
  row.dataset.typeId = tt.id;
  row.querySelectorAll('.tt-move').forEach(btn => {
    const up = btn.dataset.dir === 'up';
    btn.disabled = up ? idx === 0 : idx === types.length - 1;
    btn.setAttribute('aria-label', `${up ? 'Move' : 'Move'} ${tt.name} ${up ? 'up' : 'down'}`);
  });
  const colorInput = row.querySelector('.tt-color');
  if (colorInput) colorInput.setAttribute('aria-label', `Color for ${tt.name}`);
  const nameInput = row.querySelector('.tt-name');
  if (nameInput) nameInput.setAttribute('aria-label', `Display name for ${tt.id}`);
  const level = row.querySelector('.tt-level');
  if (level) level.textContent = parentTypesSummary(tt, types);
  const canRemove = canRemoveTicketType(tt.id, types, state.tasks);
  const removeTitle = removeTitleForType(tt, types, state);
  const removeBtn = row.querySelector('.tt-remove');
  if (removeBtn) {
    removeBtn.disabled = !canRemove;
    removeBtn.title = removeTitle;
    removeBtn.setAttribute('aria-label', removeTitle);
  }
}

function bindTypeRowEvents(row, state) {
  const colorInput = row.querySelector('.tt-color');
  if (colorInput && !colorInput.dataset.bound) {
    colorInput.dataset.bound = '1';
    colorInput.addEventListener('input', () => {
      const swatch = colorInput.parentElement.querySelector('.tt-color-swatch');
      if (swatch) swatch.style.background = colorInput.value;
    });
    colorInput.addEventListener('change', () => {
      const i = parseInt(colorInput.dataset.idx, 10);
      state.ticketTypes[i].color = colorInput.value;
      persistTicketTypes(state);
      showStatus('Ticket type color updated');
    });
  }

  const nameInput = row.querySelector('.tt-name');
  if (nameInput && !nameInput.dataset.bound) {
    nameInput.dataset.bound = '1';
    nameInput.addEventListener('change', () => {
      const i = parseInt(nameInput.dataset.idx, 10);
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.value = state.ticketTypes[i].name;
        return;
      }
      const tt = state.ticketTypes[i];
      const oldId = tt.id;
      tt.name = name;
      if (editableTypeIds.has(oldId)) {
        const used = state.ticketTypes.filter((_, j) => j !== i).map(t => t.id);
        const newId = uniqueTypeId(slugifyTypeId(name), used);
        if (newId !== oldId) {
          editableTypeIds.delete(oldId);
          editableTypeIds.add(newId);
          tt.id = newId;
          const idInput = row.querySelector('.tt-id-input');
          if (idInput) idInput.value = newId;
        }
      }
      syncRowMeta(row, tt, state.ticketTypes, state);
      persistTicketTypes(state);
      showStatus('Ticket type updated');
    });
  }

  const idInput = row.querySelector('.tt-id-input');
  if (idInput && !idInput.dataset.bound) {
    idInput.dataset.bound = '1';
    idInput.addEventListener('change', () => {
      const i = parseInt(idInput.dataset.idx, 10);
      commitTypeId(state, i, idInput, row);
    });
  }

  row.querySelectorAll('.tt-parent-cb').forEach(cb => {
    if (cb.dataset.bound) return;
    cb.dataset.bound = '1';
    cb.addEventListener('change', () => {
      const i = parseInt(cb.dataset.idx, 10);
      const tt = state.ticketTypes[i];
      const parentId = cb.dataset.parent;
      const set = new Set(tt.parentTypes || []);
      if (cb.checked) set.add(parentId);
      else set.delete(parentId);
      tt.parentTypes = [...set];
      const level = row.querySelector('.tt-level');
      if (level) level.textContent = parentTypesSummary(tt, state.ticketTypes);
      persistTicketTypes(state);
      showStatus('Parent links updated');
    });
  });

  row.querySelectorAll('.tt-move').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      const dir = btn.dataset.dir;
      moveTicketTypeAt(state, i, dir === 'up' ? i - 1 : i + 1);
    });
  });

  const removeBtn = row.querySelector('.tt-remove');
  if (removeBtn && !removeBtn.dataset.bound) {
    removeBtn.dataset.bound = '1';
    removeBtn.addEventListener('click', () => {
      const i = parseInt(removeBtn.dataset.idx, 10);
      removeTicketTypeAt(state, i);
    });
  }
}

function bindTicketTypeListEvents(container, state) {
  container.querySelectorAll('.tt-row').forEach(row => bindTypeRowEvents(row, state));
}

function addTicketType() {
  const state = getState();
  if (!state) return;
  const types = normalizeTicketTypes(state.ticketTypes);
  const id = uniqueTypeId('type', types.map(t => t.id));
  types.push({
    id,
    name: 'New type',
    color: pickNextTypeColor(types),
    parentTypes: types.map(t => t.id),
  });
  state.ticketTypes = types;
  editableTypeIds.add(id);
  persistTicketTypes(state);
  renderSettingsTicketTypes();
  showStatus('Ticket type added');
  const nameInput = document.querySelector(`.tt-name[data-idx="${types.length - 1}"]`);
  if (nameInput) {
    nameInput.focus();
    nameInput.select();
  }
}

function removeTicketTypeAt(state, idx) {
  const types = normalizeTicketTypes(state.ticketTypes);
  const tt = types[idx];
  if (!tt) return;
  if (!canRemoveTicketType(tt.id, types, state.tasks)) {
    showStatus(removeTitleForType(tt, types, state));
    return;
  }
  editableTypeIds.delete(tt.id);
  types.splice(idx, 1);
  for (const t of types) {
    if (Array.isArray(t.parentTypes)) {
      t.parentTypes = t.parentTypes.filter(pid => pid !== tt.id);
    }
  }
  state.ticketTypes = types;
  persistTicketTypes(state);
  renderSettingsTicketTypes();
  showStatus(`Removed ticket type "${tt.name}"`);
}

function moveTicketTypeAt(state, fromIdx, toIdx) {
  const types = normalizeTicketTypes(state.ticketTypes);
  state.ticketTypes = moveTicketType(types, fromIdx, toIdx);
  persistTicketTypes(state);
  renderSettingsTicketTypes();
  showStatus('Ticket type order updated');
}

function commitTypeId(state, idx, input, row) {
  const types = normalizeTicketTypes(state.ticketTypes);
  const tt = types[idx];
  if (!tt || !editableTypeIds.has(tt.id)) return;

  const nextId = slugifyTypeId(input.value);
  if (!isValidTypeId(nextId)) {
    input.value = tt.id;
    showStatus('Id must be lowercase letters, digits, and hyphens');
    return;
  }
  if (types.some((t, i) => i !== idx && t.id === nextId)) {
    input.value = tt.id;
    showStatus(`Id "${nextId}" is already in use`);
    return;
  }
  if (nextId === tt.id) return;

  const oldId = tt.id;
  editableTypeIds.delete(oldId);
  editableTypeIds.add(nextId);
  tt.id = nextId;
  for (const t of types) {
    if (Array.isArray(t.parentTypes)) {
      t.parentTypes = t.parentTypes.map(pid => (pid === oldId ? nextId : pid));
    }
  }
  state.ticketTypes = types;
  if (row) syncRowMeta(row, tt, types, state);
  persistTicketTypes(state);
  showStatus('Ticket type id updated');
}

export function initSettings() {
  applyDisplayPrefs();
  initDisplayPrefs();
  initSettingsSubtabs();
  renderSettingsTicketTypes();

  const addBtn = document.getElementById('settingsTicketTypeAdd');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', addTicketType);
  }
}

export function renderSettingsTicketTypes() {
  const container = document.getElementById('settingsTicketTypesList');
  if (!container || !getState) return;

  const state = getState();
  const types = normalizeTicketTypes(state.ticketTypes);
  state.ticketTypes = types;

  container.innerHTML = types.map((tt, idx) => renderTypeRow(tt, idx, types, state)).join('');
  bindTicketTypeListEvents(container, state);
}

/** @deprecated Use readHideCorporate */
export function readHideSprints() {
  return readHideCorporate();
}
