// settings.js — Settings tab (Display prefs + Ticket Types)

import { markChanged } from './tasks-io.js';
import { escapeHtml, normalizeTicketTypes } from './ticket-types.js';
import { showStatus } from './state.js';
import { applyCorporateVisibility } from './overview.js';
import { applyPomodoroVisibility, readShowPomodoro, writeShowPomodoro } from './task-timer.js';

const HIDE_CORPORATE_KEY = 'dashboard.hideCorporate';
const LEGACY_HIDE_SPRINTS_KEY = 'dashboard.hideSprints';

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
    // Keep legacy key in sync so older FOUC snippets / caches stay consistent
    localStorage.setItem(LEGACY_HIDE_SPRINTS_KEY, hidden ? '1' : '0');
  } catch { /* ignore quota / private mode */ }
}

/** Apply stored display prefs (call early on boot). */
export function applyDisplayPrefs() {
  applyCorporateVisibility(readHideCorporate());
  applyPomodoroVisibility(readShowPomodoro());
}

function switchSettingsSubtab(subtab) {
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

export function initSettings() {
  applyDisplayPrefs();
  initDisplayPrefs();
  initSettingsSubtabs();
  renderSettingsTicketTypes();
}

export function renderSettingsTicketTypes() {
  const container = document.getElementById('settingsTicketTypesList');
  if (!container || !getState) return;

  const state = getState();
  const types = normalizeTicketTypes(state.ticketTypes);
  state.ticketTypes = types;

  container.innerHTML = types.map((tt, idx) => `
    <div class="tt-row" data-idx="${idx}">
      <label class="tt-color-wrap" title="Change color">
        <input type="color" class="tt-color" value="${escapeHtml(tt.color)}" data-idx="${idx}" aria-label="Color for ${escapeHtml(tt.name)}">
        <span class="tt-color-swatch" style="background:${escapeHtml(tt.color)}"></span>
      </label>
      <div class="tt-fields">
        <span class="tt-id">${escapeHtml(tt.id)}</span>
        <input type="text" class="tt-name" value="${escapeHtml(tt.name)}" data-idx="${idx}" aria-label="Display name for ${escapeHtml(tt.id)}">
      </div>
      <span class="tt-level" title="Hierarchy level (top = parent)">Level ${idx + 1}</span>
    </div>
  `).join('');

  container.querySelectorAll('.tt-color').forEach(input => {
    input.addEventListener('input', () => {
      const i = parseInt(input.dataset.idx, 10);
      const color = input.value;
      state.ticketTypes[i].color = color;
      const swatch = input.parentElement.querySelector('.tt-color-swatch');
      if (swatch) swatch.style.background = color;
      markChanged();
      getRenderTasks && getRenderTasks()();
      showStatus('Ticket type color updated');
    });
  });

  container.querySelectorAll('.tt-name').forEach(input => {
    input.addEventListener('change', () => {
      const i = parseInt(input.dataset.idx, 10);
      const name = input.value.trim();
      if (!name) {
        input.value = state.ticketTypes[i].name;
        return;
      }
      state.ticketTypes[i].name = name;
      markChanged();
      getRenderTasks && getRenderTasks()();
      showStatus('Ticket type renamed');
    });
  });
}

/** @deprecated Use readHideCorporate */
export function readHideSprints() {
  return readHideCorporate();
}
