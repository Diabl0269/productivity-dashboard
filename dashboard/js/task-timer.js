// task-timer.js — Active timer in localStorage; on stop write loggedMinutes + timeEntries.
//
// How it works:
// 1. Click Start (or Pomodoro 25m, if enabled) on a task — a session begins in this browser.
// 2. The header chip shows which task is running and elapsed mm:ss.
// 3. Click Stop — elapsed minutes (rounded up, min 1) are added to loggedMinutes
//    and a timeEntries[] row is appended. Pomodoro auto-stops at 25m.
// Pomodoro UI is opt-in via Settings → Display (dashboard.showPomodoro; default off).

import { markChanged } from './tasks-io.js';
import { findTaskByTaskId } from './ticket-types.js';
import { showStatus } from './state.js';
import { formatEstimate } from './task-fields.js';

const STORAGE_KEY = 'dashboard.activeTimer';
const SHOW_POMODORO_KEY = 'dashboard.showPomodoro';
const POMODORO_MS = 25 * 60 * 1000;

/** Whether Pomodoro buttons/hints are visible (default: hidden). */
export function readShowPomodoro() {
  try {
    return localStorage.getItem(SHOW_POMODORO_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeShowPomodoro(show) {
  try {
    localStorage.setItem(SHOW_POMODORO_KEY, show ? '1' : '0');
  } catch { /* ignore */ }
}

/** HTML for the timer panel explainer (respects Pomodoro setting). */
export function timerExplainerHtml() {
  const base = 'Start a timer while you work on this task. When you stop, elapsed time is added to <strong>Logged</strong> automatically (rounded up to whole minutes).';
  return readShowPomodoro()
    ? `${base} Pomodoro stops itself after 25 minutes.`
    : base;
}

/** Sync `data-show-pomodoro` for CSS + live UI. */
export function applyPomodoroVisibility(show = readShowPomodoro()) {
  const on = !!show;
  document.documentElement.setAttribute('data-show-pomodoro', on ? 'true' : 'false');
  document.querySelectorAll('.td-timer-pomo').forEach(el => {
    el.hidden = !on;
  });
  document.querySelectorAll('.td-timer-explainer').forEach(el => {
    el.innerHTML = timerExplainerHtml();
  });
}

let getState = null;
let getRenderTasks = null;
let tickTimer = null;

export function setTimerCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

export function readActiveTimer() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t || !t.taskId || !t.startedAt) return null;
    return t;
  } catch {
    return null;
  }
}

function writeActiveTimer(timer) {
  if (!timer) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(timer));
}

export function startTimer(taskId, { pomodoro = false } = {}) {
  if (!taskId) return;
  if (pomodoro && !readShowPomodoro()) {
    pomodoro = false;
  }
  const existing = readActiveTimer();
  if (existing && existing.taskId !== taskId) {
    stopTimer();
  }
  writeActiveTimer({
    taskId,
    startedAt: Date.now(),
    pomodoro: !!pomodoro,
    targetMs: pomodoro ? POMODORO_MS : null,
  });
  startTicking();
  renderTimerChip();
  showStatus(pomodoro ? 'Pomodoro started — auto-stops at 25m' : 'Timer running — stop to log time');
}

export function stopTimer({ note } = {}) {
  const active = readActiveTimer();
  // Clear storage + interval first so the chip cannot stick around
  writeActiveTimer(null);
  stopTicking();
  hideTimerChip();

  if (!active) return null;

  const elapsedMs = Date.now() - active.startedAt;
  const minutes = Math.max(1, Math.round(elapsedMs / 60000));

  const state = getState?.();
  if (!state) return { minutes, taskId: active.taskId };

  const task = findTaskByTaskId(state.tasks, active.taskId);
  if (task) {
    task.loggedMinutes = (task.loggedMinutes || 0) + minutes;
    if (!Array.isArray(task.timeEntries)) task.timeEntries = [];
    const entry = { at: new Date().toISOString(), minutes };
    if (note) entry.note = note;
    task.timeEntries.push(entry);
    if (task.timeEntries.length > 100) {
      task.timeEntries = task.timeEntries.slice(-100);
    }
    markChanged(task);
    getRenderTasks?.()?.();
    showStatus(`Logged ${formatEstimate(minutes)} on ${active.taskId}`);
  }

  // Re-hide after any re-render side effects
  hideTimerChip();
  refreshOpenDetailTimer(active.taskId);
  return { minutes, taskId: active.taskId };
}

function hideTimerChip() {
  const chip = document.getElementById('activeTimerChip');
  if (!chip) return;
  chip.hidden = true;
  chip.setAttribute('hidden', '');
  chip.style.display = 'none';
}

function showTimerChip(chip) {
  chip.hidden = false;
  chip.removeAttribute('hidden');
  chip.style.display = '';
}

function refreshOpenDetailTimer(taskId) {
  try {
    const idEl = document.getElementById('tdTaskId');
    if (idEl && idEl.textContent === taskId) {
      document.querySelectorAll('.td-timer-elapsed').forEach(el => {
        el.textContent = '';
      });
    }
  } catch { /* ignore */ }
}

function startTicking() {
  stopTicking();
  tickTimer = setInterval(() => {
    const active = readActiveTimer();
    if (!active) {
      stopTicking();
      hideTimerChip();
      return;
    }
    if (active.pomodoro && active.targetMs && (Date.now() - active.startedAt) >= active.targetMs) {
      stopTimer({ note: 'pomodoro' });
      showStatus('Pomodoro complete — time logged');
      return;
    }
    renderTimerChip();
    updateLiveElapsedLabels(active);
  }, 1000);
}

function stopTicking() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateLiveElapsedLabels(active) {
  const elapsed = formatElapsed(Date.now() - active.startedAt);
  let nodes;
  try {
    nodes = document.querySelectorAll(`[data-timer-for="${CSS.escape(active.taskId)}"] .td-timer-elapsed`);
  } catch {
    nodes = document.querySelectorAll(`[data-timer-for="${active.taskId}"] .td-timer-elapsed`);
  }
  nodes.forEach(el => {
    el.textContent = elapsed;
  });
}

export function renderTimerChip() {
  let chip = document.getElementById('activeTimerChip');
  const active = readActiveTimer();
  if (!active) {
    hideTimerChip();
    return;
  }
  if (!chip) {
    const host = document.querySelector('.buttons') || document.querySelector('header');
    if (!host) return;
    chip = document.createElement('div');
    chip.id = 'activeTimerChip';
    chip.className = 'active-timer-chip';
    chip.innerHTML = `
      <span class="timer-chip-pulse" aria-hidden="true"></span>
      <span class="timer-chip-label"></span>
      <button type="button" class="timer-chip-stop" title="Stop and log time">Stop & log</button>
    `;
    host.insertBefore(chip, host.firstChild);
    chip.querySelector('.timer-chip-stop').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      stopTimer();
    });
  }
  showTimerChip(chip);
  const label = chip.querySelector('.timer-chip-label');
  const elapsed = formatElapsed(Date.now() - active.startedAt);
  const pomo = active.pomodoro ? ' · 25m' : '';
  if (label) label.textContent = `${active.taskId}  ${elapsed}${pomo}`;
  updateLiveElapsedLabels(active);
}

export function initTaskTimer() {
  if (readActiveTimer()) startTicking();
  renderTimerChip();
}

/**
 * @param {string} taskId
 * @param {{ compact?: boolean }} [opts]
 */
export function timerControlsHtml(taskId, opts = {}) {
  const active = readActiveTimer();
  const isActive = active && active.taskId === taskId;
  const compact = !!opts.compact;
  const showPomo = readShowPomodoro();
  const pomoHidden = showPomo ? '' : ' hidden';

  if (isActive) {
    const elapsed = formatElapsed(Date.now() - active.startedAt);
    return `
      <div class="td-timer-controls running" data-timer-for="${taskId}">
        <span class="td-timer-live"><span class="td-timer-dot"></span><span class="td-timer-elapsed">${elapsed}</span></span>
        <button type="button" class="td-timer-stop">Stop & log</button>
      </div>`;
  }

  if (compact) {
    return `
      <div class="td-timer-controls compact" data-timer-for="${taskId}">
        <button type="button" class="td-timer-start" title="Start timer">▶ Start</button>
        <button type="button" class="td-timer-pomo" title="25-minute focus session"${pomoHidden}>25m</button>
      </div>`;
  }

  return `
    <div class="td-timer-controls" data-timer-for="${taskId}">
      <button type="button" class="td-timer-start">▶ Start timer</button>
      <button type="button" class="td-timer-pomo"${pomoHidden}>Pomodoro 25m</button>
    </div>`;
}

export function bindTimerControls(root, taskId) {
  const host = () => (
    root.matches?.('[data-timer-for]')
      ? root
      : root.querySelector?.('[data-timer-for]')
  );

  const swap = () => {
    const el = host();
    if (!el) {
      getRenderTasks?.()?.();
      return;
    }
    const compact = el.classList.contains('compact')
      || !!el.closest('.td-focus-timer');
    const tmp = document.createElement('div');
    tmp.innerHTML = timerControlsHtml(taskId, { compact });
    const next = tmp.firstElementChild;
    el.replaceWith(next);
    bindTimerControls(next, taskId);
    getRenderTasks?.()?.();
  };

  root.querySelector('.td-timer-start')?.addEventListener('click', () => {
    startTimer(taskId, { pomodoro: false });
    swap();
  });
  root.querySelector('.td-timer-pomo')?.addEventListener('click', () => {
    startTimer(taskId, { pomodoro: true });
    swap();
  });
  root.querySelector('.td-timer-stop')?.addEventListener('click', () => {
    stopTimer();
    swap();
  });
}
