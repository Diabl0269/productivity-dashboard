// task-detail.js - Task detail modal: the extensible "task management" hub.
//
// Clicking a task (board card body / list row) opens this modal showing its full
// record — title, priority, status/section, type, parent, created/updated,
// checklist subtasks, and the full note. Every block is a .td-panel so new fields
// can be added later without restructuring. Edits apply live and trigger autosave.

import { markChanged } from './tasks-io.js';
import { todayStr } from './tasks-parser.js';
import { deleteTask, moveTask } from './tasks-board.js';
import { showStatus } from './state.js';
import {
  normalizeTicketTypes,
  DEFAULT_TICKET_TYPE_ID,
  getTicketType,
  parentCandidates,
  findTaskByTaskId,
  childTasks,
  resolveTaskColor,
  inheritedTaskColor,
  inheritColorLabel,
  makeColorControls,
  isHexColor,
  escapeHtml,
} from './ticket-types.js';
import {
  ensureTaskFieldDefaults,
  blockedByCandidates,
  unresolvedBlockedBy,
  isEffectivelyBlocked,
  isTaskDone,
  appendHistory,
  appendNote,
  appendDecision,
  removeNoteAt,
  removeDecisionAt,
  updateNoteAt,
  updateDecisionAt,
  removeTimeEntryAt,
  updateTimeEntryAt,
  parseEstimate,
  formatEstimate,
  formatDueLabel,
  normalizeJiraKey,
  todayYmd,
  markCorporateUi,
  isCorporateUiHidden,
} from './task-fields.js';
import { normalizeModel, collectModels } from '../../shared/model.js';
import {
  readCustomFields,
  isFieldVisible,
  readCustomValue,
  writeCustomValue,
  customFieldKey,
} from './custom-fields.js';
import {
  readChildrenColumns,
  toggleChildrenColumn,
  columnLabel,
  CHILD_COLUMN_DEFS,
} from './children-columns.js';
import { memoryState } from './memory-renderer.js';
import { timerControlsHtml, bindTimerControls, timerExplainerHtml } from './task-timer.js';
import { mountFieldLayoutSections } from './task-field-layout.js';
import { mountTicketPicker, touchRecentTicket } from './ticket-picker.js';
import {
  taskIdDisplayState,
  buildParentPickerCandidates,
} from '../../shared/task-detail-fields.js';
import { syncUrl, isRoutingReady } from './routing.js';
import { confirmAndRenameTaskId } from './task-move.js';

let getState = null;
let getRenderTasks = null;
let activeTask = null;
let titleEditCancelled = false;
let pendingFocus = { focusTitle: true, focusSubtaskIdx: null, expandSubtask: false };

export function setTaskDetailCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

const PRIORITIES = ['low', 'medium', 'high'];

/* ── Open / close ─────────────────────────────────────────────── */

function syncTaskIdField(task) {
  const state = taskIdDisplayState(task);
  const btn = document.getElementById('tdTaskIdBtn');
  const input = document.getElementById('tdTaskId');
  if (btn) {
    btn.textContent = state.label;
    btn.title = state.title;
    btn.hidden = false;
  }
  if (input) {
    input.value = state.taskId;
    input.placeholder = state.placeholder;
    input.size = state.size;
    input.title = state.title;
    input.hidden = true;
  }
}

function beginTaskIdEdit() {
  const btn = document.getElementById('tdTaskIdBtn');
  const input = document.getElementById('tdTaskId');
  if (!btn || !input || !activeTask) return;
  btn.hidden = true;
  input.hidden = false;
  input.value = activeTask.taskId || '';
  input.focus();
  input.select();
}

export function openTaskDetail(task, opts = {}) {
  const {
    focusTitle = true,
    focusSubtaskIdx = null,
    expandSubtask = false,
  } = opts;
  if (!task) return;
  const overlay = document.getElementById('taskDetailOverlay');
  if (!overlay) return;

  if (!task.type) task.type = DEFAULT_TICKET_TYPE_ID;
  ensureTaskFieldDefaults(task);
  if (task.taskId) touchRecentTicket(task.taskId);

  activeTask = task;
  titleEditCancelled = false;
  pendingFocus = { focusTitle, focusSubtaskIdx, expandSubtask };
  buildPanels(task);
  const refresh = overlay.classList.contains('visible');

  const idEl = document.getElementById('tdTaskId');
  syncTaskIdField(task);

  overlay.hidden = false;
  // Force reflow before adding .visible so the enter animation plays.
  void overlay.offsetWidth;
  overlay.classList.add('visible');

  const titleInput = document.getElementById('tdTitle');
  if (titleInput) {
    titleInput.value = task.title || '';
  }

  requestAnimationFrame(() => {
    if (Number.isInteger(focusSubtaskIdx)) {
      const ta = document.querySelector(`.td-subtask-textarea[data-idx="${focusSubtaskIdx}"]`);
      if (ta) {
        expandSubtaskField(ta);
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        return;
      }
    }
    if (expandSubtask && focusSubtaskIdx == null) {
      const addBtn = document.querySelector('.td-add-subtask');
      if (addBtn) addBtn.click();
      return;
    }
    if (focusTitle && !refresh && titleInput) {
      titleInput.focus();
      titleInput.select();
    }
  });

  if (!opts.fromRoute && isRoutingReady()) syncUrl();
}

export function closeTaskDetail(opts = {}) {
  const overlay = document.getElementById('taskDetailOverlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.hidden = true;
  activeTask = null;
  if (!opts.fromRoute && isRoutingReady()) syncUrl();
}

export function getOpenTaskId() {
  return activeTask?.taskId || null;
}

export function isTaskDetailOpen() {
  const overlay = document.getElementById('taskDetailOverlay');
  return overlay && overlay.classList.contains('visible');
}

/**
 * After tasks are replaced from disk/HTTP, re-bind the open detail panel to the
 * new object for the same taskId (or close if it disappeared).
 */
export function syncTaskDetailAfterReload(tasksBySection) {
  if (!isTaskDetailOpen() || !activeTask) return;
  const taskId = activeTask.taskId;
  if (!taskId) {
    closeTaskDetail();
    return;
  }
  const next = findTaskByTaskId(tasksBySection, taskId);
  if (!next) {
    closeTaskDetail();
    return;
  }
  if (next !== activeTask) {
    openTaskDetail(next, { focusTitle: false });
  }
}

/**
 * Rebuild the open detail modal when the changed task is what's shown, one of its
 * children, or its parent (so epic children panels stay live without a page refresh).
 */
export function refreshTaskDetailIfAffected(changedTask) {
  if (!isTaskDetailOpen() || !activeTask || !changedTask?.taskId) return;
  const state = getState();
  if (!state?.tasks) return;

  const openId = activeTask.taskId;
  const changedId = changedTask.taskId;

  if (changedId === openId) {
    openTaskDetail(changedTask, { focusTitle: false });
    return;
  }

  if (childTasks(state.tasks, openId).some(c => c.taskId === changedId)) {
    const fresh = findTaskByTaskId(state.tasks, openId);
    if (fresh) openTaskDetail(fresh, { focusTitle: false });
    return;
  }

  if (activeTask.parentId === changedId) {
    openTaskDetail(activeTask, { focusTitle: false });
  }
}

/* ── Live-apply helpers ───────────────────────────────────────── */

function commit(note = 'Saved') {
  if (!activeTask) return;
  markChanged(activeTask);
  getRenderTasks && getRenderTasks()();
  flashSaved();
  if (note && note !== 'Saved') showStatus(note);
}

let savedFlashTimer = null;
function flashSaved() {
  const el = document.getElementById('tdSaved');
  if (!el) return;
  el.removeAttribute('hidden');
  el.setAttribute('aria-hidden', 'false');
  el.classList.add('show');
  if (savedFlashTimer) clearTimeout(savedFlashTimer);
  savedFlashTimer = setTimeout(() => {
    el.classList.remove('show');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
  }, 1200);
}

function autoResizeTextarea(ta) {
  ta.style.height = 'auto';
  const min = ta.classList.contains('expanded') ? 72 : 28;
  ta.style.height = Math.max(min, ta.scrollHeight) + 'px';
}

function expandSubtaskField(ta) {
  ta.classList.add('expanded');
  autoResizeTextarea(ta);
}

/* ── Panel construction ───────────────────────────────────────── */

const DETAIL_TABS = [
  { id: 'essentials', label: 'Essentials' },
  { id: 'work', label: 'Work' },
  { id: 'time', label: 'Time' },
  { id: 'notes', label: 'Notes' },
];

let activeDetailTab = 'essentials';

function buildPanels(task) {
  const body = document.getElementById('tdBody');
  if (!body) return;
  body.innerHTML = '';
  body.classList.add('td-body-structured');

  body.appendChild(buildFocusStrip(task));

  const tabs = document.createElement('div');
  tabs.className = 'td-tabs';
  tabs.setAttribute('role', 'tablist');
  const panes = document.createElement('div');
  panes.className = 'td-tab-panes';

  const paneEls = {};
  DETAIL_TABS.forEach(tab => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'td-tab' + (tab.id === activeDetailTab ? ' active' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', tab.id === activeDetailTab ? 'true' : 'false');
    btn.dataset.tab = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener('click', () => {
      activeDetailTab = tab.id;
      tabs.querySelectorAll('.td-tab').forEach(b => {
        const on = b.dataset.tab === tab.id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      Object.entries(paneEls).forEach(([id, el]) => {
        el.hidden = id !== tab.id;
      });
    });
    tabs.appendChild(btn);

    const pane = document.createElement('div');
    pane.className = 'td-tab-pane';
    pane.dataset.pane = tab.id;
    pane.hidden = tab.id !== activeDetailTab;
    panes.appendChild(pane);
    paneEls[tab.id] = pane;
  });

  body.appendChild(tabs);
  body.appendChild(panes);

  // Essentials — pinned / unpinned field layout (labels, links, description included)
  buildEssentialsForm(task, paneEls.essentials);

  // Work — checklist + children + deps
  buildSubtasksPanel(task, paneEls.work);
  buildChildrenPanel(task, paneEls.work);
  buildBlockedByPanel(task, paneEls.work);

  // Time — timer + estimate/logged + recurrence (no assignee when corporate hidden)
  buildTimerPanel(task, paneEls.time);
  buildAssigneeEstimatePanel(task, paneEls.time);
  buildRecurrencePanel(task, paneEls.time);

  // Notes — sub-tabbed: thread, decisions, activity
  buildNotesTabContent(task, paneEls.notes);
}

/** Compact always-visible strip: status chips + live timer. */
function buildFocusStrip(task) {
  const strip = document.createElement('div');
  strip.className = 'td-focus-strip';

  const chips = document.createElement('div');
  chips.className = 'td-focus-chips';
  const bits = [];
  bits.push(`<span class="td-focus-chip td-focus-pri priority-${escapeHtml(task.priority || 'medium')}">${escapeHtml((task.priority || 'medium'))}</span>`);
  if (task.section) bits.push(`<span class="td-focus-chip">${escapeHtml(task.section)}</span>`);
  if (task.project) bits.push(`<span class="td-focus-chip td-focus-project">${escapeHtml(task.project)}</span>`);
  if (task.dueDate) bits.push(`<span class="td-focus-chip">Due ${escapeHtml(task.dueDate)}</span>`);
  if (task.energy) bits.push(`<span class="td-focus-chip">${escapeHtml(task.energy)}</span>`);
  if (normalizeModel(task.model)) bits.push(`<span class="td-focus-chip">Model ${escapeHtml(normalizeModel(task.model))}</span>`);
  if (task.estimateMinutes) bits.push(`<span class="td-focus-chip">Est ${escapeHtml(formatEstimate(task.estimateMinutes))}</span>`);
  if (task.loggedMinutes) bits.push(`<span class="td-focus-chip">Logged ${escapeHtml(formatEstimate(task.loggedMinutes))}</span>`);
  chips.innerHTML = bits.join('');

  const timerSlot = document.createElement('div');
  timerSlot.className = 'td-focus-timer';
  timerSlot.innerHTML = timerControlsHtml(task.taskId, { compact: true });
  bindTimerControls(timerSlot, task.taskId);

  strip.appendChild(chips);
  if (task.taskId) strip.appendChild(timerSlot);
  return strip;
}

function buildTimerPanel(task, body) {
  if (!task.taskId) return;
  const wrap = document.createElement('div');
  wrap.className = 'td-timer-panel';
  wrap.innerHTML = `
    <p class="td-timer-explainer">${timerExplainerHtml()}</p>
    ${timerControlsHtml(task.taskId)}
  `;
  const logged = task.loggedMinutes
    ? `<div class="td-panel-hint">Total logged: ${formatEstimate(task.loggedMinutes)}</div>`
    : '';
  const entries = Array.isArray(task.timeEntries) && task.timeEntries.length
    ? `<div class="td-panel-hint">${task.timeEntries.length} session(s) recorded</div>`
    : '';
  const panel = sectionPanel('Focus timer', wrap);
  if (logged || entries) {
    const hints = document.createElement('div');
    hints.innerHTML = logged + entries;
    panel.appendChild(hints);
  }
  if (Array.isArray(task.timeEntries) && task.timeEntries.length) {
    const list = document.createElement('div');
    list.className = 'td-time-entries';
    const entries = task.timeEntries;
    entries.slice().reverse().forEach((e, revIdx) => {
      const idx = entries.length - 1 - revIdx;
      const row = document.createElement('div');
      row.className = 'td-time-entry';
      const when = (e.at || '').replace('T', ' ').slice(0, 16);

      const whenEl = document.createElement('span');
      whenEl.textContent = when;

      const minutesInput = document.createElement('input');
      minutesInput.type = 'number';
      minutesInput.min = '0';
      minutesInput.step = '1';
      minutesInput.className = 'td-time-minutes-input';
      minutesInput.value = String(e.minutes ?? 0);
      minutesInput.setAttribute('aria-label', 'Session minutes');
      minutesInput.title = 'Minutes logged';

      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.className = 'td-text-input td-time-note-input';
      noteInput.value = e.note || '';
      noteInput.placeholder = 'Session note…';
      noteInput.setAttribute('aria-label', 'Session note');

      const saveEntry = () => {
        const minutes = Math.max(0, parseInt(minutesInput.value, 10) || 0);
        const note = noteInput.value.trim();
        const prevMinutes = typeof e.minutes === 'number' ? e.minutes : 0;
        const prevNote = e.note || '';
        if (minutes === prevMinutes && note === prevNote) return;
        updateTimeEntryAt(task, idx + 1, { minutes, note });
        commit('Time session updated');
        openTaskDetail(task, { focusTitle: false });
      };

      const blurUnlessRowFocus = (ev, saveFn) => {
        if (row.contains(ev.relatedTarget)) return;
        saveFn();
      };

      minutesInput.addEventListener('blur', (ev) => blurUnlessRowFocus(ev, saveEntry));
      noteInput.addEventListener('blur', (ev) => blurUnlessRowFocus(ev, saveEntry));
      minutesInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); minutesInput.blur(); }
      });
      noteInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); noteInput.blur(); }
      });

      row.appendChild(whenEl);
      row.appendChild(minutesInput);
      row.appendChild(noteInput);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'td-entry-remove';
      remove.setAttribute('aria-label', 'Remove time session');
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        removeTimeEntryAt(task, idx + 1);
        commit('Time session removed');
        openTaskDetail(task, { focusTitle: false });
      });
      row.appendChild(remove);
      list.appendChild(row);
    });
    panel.appendChild(list);
  }
  body.appendChild(panel);
  bindTimerControls(panel, task.taskId);
}

const NOTES_SUBTABS = [
  { id: 'thread', label: 'Notes' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'activity', label: 'Activity' },
];

let activeNotesSubTab = 'thread';

function buildNotesTabContent(task, body) {
  body.classList.add('td-notes-tab-root');

  const subtabs = document.createElement('div');
  subtabs.className = 'td-subtabs';
  subtabs.setAttribute('role', 'tablist');

  const subpanes = document.createElement('div');
  subpanes.className = 'td-subtab-panes';

  const subpaneEls = {};
  NOTES_SUBTABS.forEach(tab => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'td-subtab' + (tab.id === activeNotesSubTab ? ' active' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', tab.id === activeNotesSubTab ? 'true' : 'false');
    btn.dataset.subtab = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener('click', () => {
      activeNotesSubTab = tab.id;
      subtabs.querySelectorAll('.td-subtab').forEach(b => {
        const on = b.dataset.subtab === tab.id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      Object.entries(subpaneEls).forEach(([id, el]) => {
        el.hidden = id !== tab.id;
      });
    });
    subtabs.appendChild(btn);

    const pane = document.createElement('div');
    pane.className = 'td-subtab-pane';
    pane.dataset.subpane = tab.id;
    pane.hidden = tab.id !== activeNotesSubTab;
    subpanes.appendChild(pane);
    subpaneEls[tab.id] = pane;
  });

  body.appendChild(subtabs);
  body.appendChild(subpanes);

  buildNotesPanel(task, subpaneEls.thread);
  buildDecisionsPanel(task, subpaneEls.decisions);
  buildHistoryPanel(task, subpaneEls.activity);
}

function buildEditableEntryCard({ when, text, variant, multiline = false, onSave, onRemove }) {
  const card = document.createElement('div');
  card.className = 'td-entry-card' + (variant ? ` td-entry-card-${variant}` : '');

  const meta = document.createElement('div');
  meta.className = 'td-entry-meta';
  meta.textContent = when;

  const editor = multiline ? document.createElement('textarea') : document.createElement('input');
  editor.className = multiline
    ? 'td-notes-textarea td-entry-edit'
    : 'td-text-input td-entry-edit';
  if (!multiline) editor.type = 'text';
  if (multiline) editor.rows = Math.min(6, Math.max(2, String(text || '').split('\n').length));
  editor.value = text || '';
  editor.setAttribute('aria-label', multiline ? 'Edit note' : 'Edit decision');

  const original = text || '';
  let skipBlur = false;

  const save = () => {
    const next = editor.value.trim();
    if (!next) {
      editor.value = original;
      return;
    }
    if (next !== original) onSave(next);
  };

  editor.addEventListener('blur', () => {
    if (skipBlur) {
      skipBlur = false;
      return;
    }
    save();
  });

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      skipBlur = true;
      editor.value = original;
      editor.blur();
      return;
    }
    if (!multiline && e.key === 'Enter') {
      e.preventDefault();
      editor.blur();
      return;
    }
    if (multiline && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      editor.blur();
    }
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'td-entry-remove';
  remove.setAttribute('aria-label', 'Remove entry');
  remove.textContent = '×';
  remove.addEventListener('mousedown', (e) => {
    e.preventDefault();
    skipBlur = true;
  });
  remove.addEventListener('click', onRemove);

  card.appendChild(meta);
  card.appendChild(editor);
  card.appendChild(remove);
  return card;
}

function buildDecisionsPanel(task, body) {
  ensureTaskFieldDefaults(task);
  const wrap = document.createElement('div');
  wrap.className = 'td-entry-list';

  const decisions = task.decisions || [];
  if (decisions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'td-panel-hint';
    empty.textContent = 'No decisions yet — record choices you want to remember.';
    wrap.appendChild(empty);
  } else {
    decisions.slice().reverse().forEach((d, revIdx) => {
      const idx = decisions.length - 1 - revIdx;
      const when = (d.at || '').replace('T', ' ').slice(0, 16);
      wrap.appendChild(buildEditableEntryCard({
        when,
        text: d.text || '',
        variant: 'decision',
        onSave: (next) => {
          updateDecisionAt(task, idx + 1, next);
          commit('Decision updated');
          openTaskDetail(task, { focusTitle: false });
        },
        onRemove: () => {
          removeDecisionAt(task, idx + 1);
          commit('Decision removed');
          openTaskDetail(task, { focusTitle: false });
        },
      }));
    });
  }

  const addRow = document.createElement('div');
  addRow.className = 'td-entry-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'td-text-input';
  input.placeholder = 'Record a decision…';
  input.setAttribute('aria-label', 'New decision');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'td-add-btn';
  btn.textContent = 'Add decision';
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    appendDecision(task, text);
    input.value = '';
    commit('Decision recorded');
    openTaskDetail(task, { focusTitle: false });
  };
  btn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  addRow.appendChild(input);
  addRow.appendChild(btn);
  wrap.appendChild(addRow);

  body.appendChild(wrap);
}

function sectionPanel(label, contentEl) {
  const panel = document.createElement('div');
  panel.className = 'td-panel td-panel-soft';
  if (label) {
    const lbl = document.createElement('div');
    lbl.className = 'td-panel-label';
    lbl.textContent = label;
    panel.appendChild(lbl);
  }
  const items = Array.isArray(contentEl) ? contentEl : [contentEl];
  items.forEach(el => el && panel.appendChild(el));
  return panel;
}


/** Date input with subtle × clear (no noisy Clear button). */
function dateControl(value, { ariaLabel, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'td-date-wrap';
  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'td-date-input';
  input.value = value || '';
  input.setAttribute('aria-label', ariaLabel);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'td-date-clear';
  clear.setAttribute('aria-label', 'Clear ' + ariaLabel);
  clear.textContent = '×';
  clear.hidden = !input.value;
  const sync = () => { clear.hidden = !input.value; };
  input.addEventListener('change', () => {
    sync();
    onChange(input.value || null, input, clear);
  });
  clear.addEventListener('click', () => {
    input.value = '';
    sync();
    onChange(null, input, clear);
  });
  wrap.appendChild(input);
  wrap.appendChild(clear);
  return wrap;
}

function buildEssentialsForm(task, body) {
  ensureTaskFieldDefaults(task);
  body.classList.add('td-essentials-layout');

  const wrap = document.createElement('div');
  wrap.className = 'td-essentials-fields';

  const refresh = () => openTaskDetail(task, { focusTitle: false });

  mountFieldLayoutSections(wrap, {
    factories: getEssentialsFieldFactories(task),
    onLayoutChange: refresh,
    markShell: (fieldId, shell) => {
      if (fieldId === 'jiraKey') markCorporateUi(shell);
    },
  });

  const foot = document.createElement('div');
  foot.className = 'td-form-footer';
  foot.innerHTML =
    `<span>Created <strong>${escapeHtml(task.created || '—')}</strong></span>` +
    `<span class="td-form-footer-sep">·</span>` +
    `<span>Updated <strong>${escapeHtml(task.updated || '—')}</strong></span>`;

  body.appendChild(wrap);
  body.appendChild(foot);
}

function essentialsField(label, control, { hint = '', block = false } = {}) {
  const field = document.createElement('div');
  field.className = 'td-field' + (block ? ' td-field-block' : '');
  if (label) {
    const lab = document.createElement('span');
    lab.className = 'td-field-label';
    lab.textContent = label;
    field.appendChild(lab);
  }
  if (hint) {
    // Prefer tooltip over layout text (avoids overflow beside date controls)
    if (!control.getAttribute('title')) control.setAttribute('title', hint);
    const labeled = control.querySelector?.('input, select, button, textarea');
    if (labeled && !labeled.getAttribute('title')) labeled.setAttribute('title', hint);
  }
  field.appendChild(control);
  return field;
}

function getEssentialsFieldFactories(task) {
  const state = getState() || {};
  const types = normalizeTicketTypes(state.ticketTypes);

  const factories = {
    priority: () => {
      const seg = document.createElement('div');
      seg.className = 'td-priority';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Priority');
      const currentP = task.priority || 'medium';
      PRIORITIES.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'td-priority-btn' + (p === currentP ? ' active' : '');
        btn.setAttribute('data-priority', p);
        const dot = document.createElement('span');
        dot.className = 'td-priority-dot priority-' + p;
        dot.setAttribute('aria-hidden', 'true');
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(p[0].toUpperCase() + p.slice(1)));
        btn.addEventListener('click', () => {
          const prev = task.priority || 'medium';
          if (prev === p) return;
          task.priority = p;
          appendHistory(task, { event: 'priority', from: prev, to: p });
          seg.querySelectorAll('.td-priority-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.priority === p));
          commit('Priority set to ' + p);
        });
        seg.appendChild(btn);
      });
      return essentialsField('Priority', seg);
    },

    status: () => {
      const select = document.createElement('select');
      select.className = 'td-select';
      select.setAttribute('aria-label', 'Status');
      const { sections } = state;
      (sections || []).forEach(sec => {
        const opt = document.createElement('option');
        opt.value = sec.id;
        opt.textContent = sec.name;
        if (sec.id === (task.section || task.sectionId)) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => {
        const target = select.value;
        if (!target || target === task.section) return;
        moveTask(task.id, target, -1);
        showStatus('Moved to ' + (sections.find(s => s.id === target)?.name || target));
      });
      return essentialsField('Status', select);
    },

    due: () => essentialsField('Due', dateControl(task.dueDate, {
      ariaLabel: 'Due date',
      onChange: (v) => {
        task.dueDate = v;
        commit(v ? 'Due set to ' + v : 'Due cleared');
        getRenderTasks && getRenderTasks()();
      },
    })),

    start: () => essentialsField('Start', dateControl(task.startDate, {
      ariaLabel: 'Start date',
      onChange: (v) => {
        task.startDate = v;
        commit(v ? 'Start set to ' + v : 'Start cleared');
        getRenderTasks && getRenderTasks()();
      },
    })),

    snoozeUntil: () => essentialsField('Snooze', dateControl(task.snoozeUntil, {
      ariaLabel: 'Snooze until',
      onChange: (v) => {
        task.snoozeUntil = v;
        commit(v ? 'Snoozed until ' + v : 'Snooze cleared');
        getRenderTasks && getRenderTasks()();
      },
    }), { hint: 'Hidden from Focus until this day' }),

    project: () => {
      const projectInput = document.createElement('input');
      projectInput.type = 'text';
      projectInput.className = 'td-text-input';
      projectInput.placeholder = 'e.g. my-app';
      projectInput.setAttribute('list', 'tdProjectList');
      projectInput.value = task.project || '';
      let pdl = document.getElementById('tdProjectList');
      if (!pdl) {
        pdl = document.createElement('datalist');
        pdl.id = 'tdProjectList';
        document.body.appendChild(pdl);
      }
      const metaProjects = (state.meta?.projects) || [];
      pdl.innerHTML = metaProjects.map(p =>
        `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`
      ).join('');
      projectInput.addEventListener('blur', () => {
        const v = projectInput.value.trim() || null;
        if (v !== (task.project || null)) {
          task.project = v;
          commit(v ? 'Project set' : 'Project cleared');
          getRenderTasks && getRenderTasks()();
        }
      });
      return essentialsField('Project', projectInput);
    },

    energy: () => {
      const energySelect = document.createElement('select');
      energySelect.className = 'td-select';
      [['', 'Any'], ['deep', 'Deep'], ['shallow', 'Shallow'], ['errands', 'Errands'], ['creative', 'Creative']].forEach(([v, label]) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = label;
        if ((task.energy || '') === v) opt.selected = true;
        energySelect.appendChild(opt);
      });
      energySelect.addEventListener('change', () => {
        task.energy = energySelect.value || null;
        commit(task.energy ? 'Energy: ' + task.energy : 'Energy cleared');
        getRenderTasks && getRenderTasks()();
      });
      return essentialsField('Energy', energySelect);
    },

    model: () => {
      const modelInput = document.createElement('input');
      modelInput.type = 'text';
      modelInput.className = 'td-text-input';
      modelInput.placeholder = 'e.g. claude-sonnet';
      modelInput.setAttribute('list', 'tdModelList');
      modelInput.value = task.model || '';
      modelInput.title = 'Agent model for this task';
      let mdl = document.getElementById('tdModelList');
      if (!mdl) {
        mdl = document.createElement('datalist');
        mdl.id = 'tdModelList';
        document.body.appendChild(mdl);
      }
      mdl.innerHTML = collectModels(state.tasks)
        .map(m => `<option value="${escapeHtml(m)}"></option>`)
        .join('');
      modelInput.addEventListener('blur', () => {
        const v = normalizeModel(modelInput.value);
        if (v !== normalizeModel(task.model)) {
          task.model = v;
          commit(v ? 'Model: ' + v : 'Model cleared');
          getRenderTasks && getRenderTasks()();
        }
      });
      return essentialsField('Model', modelInput, {
        hint: 'Agent model for this task',
      });
    },

    issueUrl: () => {
      const issueInput = document.createElement('input');
      issueInput.type = 'url';
      issueInput.className = 'td-text-input';
      issueInput.placeholder = 'https://github.com/…/issues/1';
      issueInput.value = task.issueUrl || '';
      issueInput.spellcheck = false;
      issueInput.addEventListener('blur', () => {
        const v = issueInput.value.trim() || null;
        if (v !== (task.issueUrl || null)) {
          task.issueUrl = v;
          commit(v ? 'Issue URL set' : 'Issue URL cleared');
          getRenderTasks && getRenderTasks()();
        }
      });
      return essentialsField('Issue link', issueInput, { block: true });
    },

    jiraKey: () => {
      if (isCorporateUiHidden()) return null;
      const jiraInput = document.createElement('input');
      jiraInput.type = 'text';
      jiraInput.className = 'td-text-input';
      jiraInput.placeholder = 'PROJECT-123';
      jiraInput.value = task.jiraKey || '';
      jiraInput.spellcheck = false;
      jiraInput.addEventListener('blur', () => {
        const raw = jiraInput.value.trim();
        if (!raw) {
          if (task.jiraKey) {
            task.jiraKey = null;
            commit('Jira key cleared');
            getRenderTasks && getRenderTasks()();
          }
          return;
        }
        const key = normalizeJiraKey(raw);
        if (key === undefined) {
          showStatus('Invalid Jira key — use format PROJECT-123');
          jiraInput.value = task.jiraKey || '';
          return;
        }
        if (key !== task.jiraKey) {
          task.jiraKey = key;
          jiraInput.value = key;
          commit('Jira key set to ' + key);
          getRenderTasks && getRenderTasks()();
        }
      });
      return essentialsField('Jira key', jiraInput, { block: true });
    },

    type: () => {
      const typeSelect = document.createElement('select');
      typeSelect.className = 'td-select';
      const currentType = task.type || DEFAULT_TICKET_TYPE_ID;
      types.forEach(tt => {
        const opt = document.createElement('option');
        opt.value = tt.id;
        opt.textContent = tt.name;
        if (tt.id === currentType) opt.selected = true;
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', () => {
        task.type = typeSelect.value;
        const stillValid = parentCandidates(types, state.tasks, task.type, task.taskId)
          .some(p => p.taskId === task.parentId);
        if (task.parentId && !stillValid) task.parentId = null;
        commit('Type set to ' + getTicketType(types, task.type).name);
        openTaskDetail(task, { focusTitle: false });
      });
      return essentialsField('Type', typeSelect);
    },

    color: () => {
      const { swatch, override } = makeColorControls({
        color: resolveTaskColor(task, types, state.tasks),
        customColor: isHexColor(task.color) ? task.color : null,
        inheritedColor: inheritedTaskColor(task, types, state.tasks),
        inheritFrom: inheritColorLabel(task, types, state.tasks),
        hasParent: !!task.parentId,
        onChange: (hex) => {
          task.color = hex;
          commit(hex ? 'Custom color set' : 'Color inherits from parent/type');
        },
      });
      const colorRow = document.createElement('div');
      colorRow.className = 'td-color-row';
      colorRow.appendChild(swatch);
      colorRow.appendChild(override);
      return essentialsField('Color', colorRow, { block: true });
    },

    parent: () => {
      const wrap = document.createElement('div');
      wrap.className = 'td-field td-field-block';
      const parentForLabel = task.parentId
        ? findTaskByTaskId(state.tasks, task.parentId)
        : null;
      const lab = document.createElement(
        parentForLabel ? 'button' : 'span'
      );
      lab.className = 'td-field-label' + (parentForLabel ? ' td-field-label-link' : '');
      lab.textContent = 'Parent';
      if (parentForLabel) {
        lab.type = 'button';
        lab.title = `Open parent ${parentForLabel.taskId}`;
        lab.addEventListener('click', () => {
          const parent = findTaskByTaskId(getState()?.tasks, task.parentId);
          if (parent) openTaskDetail(parent, { focusTitle: false });
        });
      }
      const pickerHost = document.createElement('div');
      pickerHost.className = 'td-ticket-picker-host';
      const candidates = buildParentPickerCandidates(
        parentCandidates(types, state.tasks, task.type || DEFAULT_TICKET_TYPE_ID, task.taskId),
        task,
        (parentId) => findTaskByTaskId(state.tasks, parentId),
      );
      mountTicketPicker(pickerHost, {
        tasks: candidates,
        value: task.parentId,
        allowNone: true,
        noneLabel: 'None',
        placeholder: 'Search parent ticket…',
        ariaLabel: 'Parent ticket',
        onChange: (id) => {
          task.parentId = id;
          commit(id ? 'Parent set to ' + id : 'Parent cleared');
          openTaskDetail(task, { focusTitle: false });
        },
      });
      wrap.appendChild(lab);
      wrap.appendChild(pickerHost);
      return wrap;
    },

    blocked: () => {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'td-toggle-btn' + (task.blocked ? ' active' : '');
      toggle.setAttribute('aria-pressed', task.blocked ? 'true' : 'false');
      toggle.textContent = task.blocked ? 'Blocked' : 'Not blocked';
      toggle.addEventListener('click', () => {
        task.blocked = !task.blocked;
        appendHistory(task, { event: task.blocked ? 'blocked' : 'unblocked' });
        toggle.classList.toggle('active', task.blocked);
        toggle.setAttribute('aria-pressed', task.blocked ? 'true' : 'false');
        toggle.textContent = task.blocked ? 'Blocked' : 'Not blocked';
        commit(task.blocked ? 'Marked blocked' : 'Unblocked');
        getRenderTasks && getRenderTasks()();
      });
      return essentialsField('Blocked', toggle);
    },

    waitingOn: () => {
      const waitInput = document.createElement('input');
      waitInput.type = 'text';
      waitInput.className = 'td-text-input';
      waitInput.placeholder = 'What’s in the way?';
      waitInput.value = task.waitingOn || '';
      waitInput.addEventListener('blur', () => {
        const v = waitInput.value.trim();
        if (v !== (task.waitingOn || '')) {
          task.waitingOn = v || null;
          commit(v ? 'Waiting on set' : 'Waiting on cleared');
          getRenderTasks && getRenderTasks()();
        }
      });
      waitInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); waitInput.blur(); }
      });
      return essentialsField('Waiting on', waitInput, { block: true });
    },

    labels: () => buildLabelsFieldContent(task),
    links: () => buildLinksFieldContent(task),
    description: () => buildDescriptionFieldContent(task),
  };

  for (const cf of readCustomFields()) {
    factories[customFieldKey(cf.id)] = () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'td-text-input';
      input.value = readCustomValue(task, cf.id);
      input.addEventListener('blur', () => {
        const prev = readCustomValue(task, cf.id);
        writeCustomValue(task, cf.id, input.value);
        const next = readCustomValue(task, cf.id);
        if (prev !== next) {
          commit(next ? `${cf.label}: ${next}` : `${cf.label} cleared`);
          getRenderTasks && getRenderTasks()();
        }
      });
      return essentialsField(cf.label, input);
    };
  }

  const wrapped = {};
  for (const [id, fn] of Object.entries(factories)) {
    wrapped[id] = () => (isFieldVisible(id) ? fn() : null);
  }
  return wrapped;
}

function buildLabelsFieldContent(task) {
  ensureTaskFieldDefaults(task);
  const wrap = document.createElement('div');
  wrap.className = 'td-field td-field-block';
  const lab = document.createElement('span');
  lab.className = 'td-field-label';
  lab.textContent = 'Labels';
  wrap.appendChild(lab);

  const labelsWrap = document.createElement('div');
  labelsWrap.className = 'td-chip-list';
  task.labels.forEach((name, idx) => {
    const chip = document.createElement('span');
    chip.className = 'td-chip';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'td-chip-input';
    input.value = name;
    input.setAttribute('aria-label', 'Edit label');
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      if (!v) {
        task.labels.splice(idx, 1);
        commit('Label removed');
      } else if (v !== name) {
        if (task.labels.includes(v) && task.labels.indexOf(v) !== idx) {
          task.labels.splice(idx, 1);
          commit('Duplicate label removed');
        } else {
          task.labels[idx] = v;
          commit('Label updated');
        }
      }
      openTaskDetail(task, { focusTitle: false });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = name; input.blur(); }
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'td-chip-remove';
    removeBtn.setAttribute('aria-label', 'Remove label');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      task.labels.splice(idx, 1);
      commit('Label removed');
      openTaskDetail(task, { focusTitle: false });
    });
    chip.appendChild(input);
    chip.appendChild(removeBtn);
    labelsWrap.appendChild(chip);
  });
  const labelAdd = document.createElement('div');
  labelAdd.className = 'td-inline-add';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'td-text-input';
  labelInput.placeholder = 'Add label…';
  const labelBtn = document.createElement('button');
  labelBtn.type = 'button';
  labelBtn.className = 'td-add-subtask';
  labelBtn.textContent = '+ Add';
  const addLabel = () => {
    const v = labelInput.value.trim();
    if (!v) return;
    if (!task.labels.includes(v)) task.labels.push(v);
    labelInput.value = '';
    commit('Label added');
    openTaskDetail(task, { focusTitle: false });
  };
  labelBtn.addEventListener('click', addLabel);
  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addLabel(); }
  });
  labelAdd.appendChild(labelInput);
  labelAdd.appendChild(labelBtn);
  labelsWrap.appendChild(labelAdd);
  wrap.appendChild(labelsWrap);
  return wrap;
}

function buildLinksFieldContent(task) {
  ensureTaskFieldDefaults(task);
  const wrap = document.createElement('div');
  wrap.className = 'td-field td-field-block';
  const lab = document.createElement('span');
  lab.className = 'td-field-label';
  lab.textContent = 'Links';
  wrap.appendChild(lab);

  const linksWrap = document.createElement('div');
  linksWrap.className = 'td-links-list';
  task.links.forEach((link, idx) => {
    const row = document.createElement('div');
    row.className = 'td-link-row td-link-row-editable';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'td-text-input td-link-label-input';
    labelInput.value = link.label || '';
    labelInput.placeholder = 'Label';
    labelInput.setAttribute('aria-label', 'Link label');

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'td-text-input td-link-url-input';
    urlInput.value = link.url || '';
    urlInput.placeholder = 'https://…';
    urlInput.setAttribute('aria-label', 'Link URL');

    const saveLink = () => {
      const url = urlInput.value.trim();
      if (!url) {
        task.links.splice(idx, 1);
        commit('Link removed');
        openTaskDetail(task, { focusTitle: false });
        return;
      }
      const label = labelInput.value.trim();
      const next = { url };
      if (label) next.label = label;
      const changed = link.url !== url || (link.label || '') !== label;
      if (changed) {
        task.links[idx] = next;
        commit('Link updated');
        openTaskDetail(task, { focusTitle: false });
      }
    };

    labelInput.addEventListener('blur', (ev) => {
      if (row.contains(ev.relatedTarget)) return;
      saveLink();
    });
    urlInput.addEventListener('blur', (ev) => {
      if (row.contains(ev.relatedTarget)) return;
      saveLink();
    });
    labelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); urlInput.focus(); }
    });
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); urlInput.blur(); }
      if (e.key === 'Escape') {
        labelInput.value = link.label || '';
        urlInput.value = link.url || '';
        urlInput.blur();
      }
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'td-chip-remove';
    remove.setAttribute('aria-label', 'Remove link');
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      task.links.splice(idx, 1);
      commit('Link removed');
      openTaskDetail(task, { focusTitle: false });
    });

    row.appendChild(labelInput);
    row.appendChild(urlInput);
    row.appendChild(remove);
    linksWrap.appendChild(row);
  });
  const linkAdd = document.createElement('div');
  linkAdd.className = 'td-inline-add td-link-add';
  const linkLabel = document.createElement('input');
  linkLabel.type = 'text';
  linkLabel.className = 'td-text-input';
  linkLabel.placeholder = 'Label (optional)';
  const linkUrl = document.createElement('input');
  linkUrl.type = 'url';
  linkUrl.className = 'td-text-input';
  linkUrl.placeholder = 'https://…';
  const linkBtn = document.createElement('button');
  linkBtn.type = 'button';
  linkBtn.className = 'td-add-subtask';
  linkBtn.textContent = '+ Link';
  const addLink = () => {
    const url = linkUrl.value.trim();
    if (!url) return;
    const row = { url };
    const name = linkLabel.value.trim();
    if (name) row.label = name;
    task.links.push(row);
    linkUrl.value = '';
    linkLabel.value = '';
    commit('Link added');
    openTaskDetail(task, { focusTitle: false });
  };
  linkBtn.addEventListener('click', addLink);
  linkUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addLink(); }
  });
  linkAdd.appendChild(linkLabel);
  linkAdd.appendChild(linkUrl);
  linkAdd.appendChild(linkBtn);
  linksWrap.appendChild(linkAdd);
  wrap.appendChild(linksWrap);
  return wrap;
}

function buildDescriptionFieldContent(task) {
  const wrap = document.createElement('div');
  wrap.className = 'td-field td-field-block';
  const lab = document.createElement('span');
  lab.className = 'td-field-label';
  lab.textContent = 'Description';
  const textarea = document.createElement('textarea');
  textarea.className = 'td-notes-textarea td-notes-textarea-compact';
  textarea.placeholder = 'Optional description…';
  textarea.value = task.description || '';
  textarea.setAttribute('aria-label', 'Description');
  let saved = false;
  const save = () => {
    if (saved) return;
    saved = true;
    const v = textarea.value.trim();
    if (v !== (task.description || '')) {
      task.description = v;
      commit();
    }
  };
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { saved = true; }
  });
  textarea.addEventListener('blur', save);
  wrap.appendChild(lab);
  wrap.appendChild(textarea);
  return wrap;
}


function peopleDatalistOptions() {

  const slugs = [];
  const people = memoryState?.memoryData?.memoryDirs?.people;
  if (Array.isArray(people)) {
    people.forEach(f => {
      const slug = (f.name || '').replace(/\.md$/i, '');
      if (slug) slugs.push(slug);
    });
  }
  return slugs.sort((a, b) => a.localeCompare(b));
}

function buildAssigneeEstimatePanel(task, body) {
  ensureTaskFieldDefaults(task);
  const row = document.createElement('div');
  row.className = 'td-panel-meta';

  // Assignee is corporate-only — skip entirely when Hide corporate is on
  if (!isCorporateUiHidden()) {
    const assigneeField = document.createElement('div');
    assigneeField.className = 'td-field';
    assigneeField.style.gridColumn = '1 / -1';
    markCorporateUi(assigneeField);
    const al = document.createElement('span');
    al.className = 'td-field-label';
    al.textContent = 'Assignee';
    const assigneeInput = document.createElement('input');
    assigneeInput.type = 'text';
    assigneeInput.className = 'td-text-input';
    assigneeInput.placeholder = 'Name or slug…';
    assigneeInput.value = task.assignee || '';
    assigneeInput.setAttribute('aria-label', 'Assignee');
    assigneeInput.setAttribute('list', 'assigneePeopleList');
    const peopleList = document.createElement('datalist');
    peopleList.id = 'assigneePeopleList';
    peopleDatalistOptions().forEach(slug => {
      const opt = document.createElement('option');
      opt.value = slug;
      peopleList.appendChild(opt);
    });
    assigneeInput.addEventListener('blur', () => {
      const v = assigneeInput.value.trim();
      const prev = task.assignee || '';
      if (v !== prev) {
        task.assignee = v || null;
        appendHistory(task, { event: 'assignee', from: prev, to: v });
        commit(v ? 'Assignee set' : 'Assignee cleared');
        getRenderTasks && getRenderTasks()();
      }
    });
    assigneeField.appendChild(al);
    assigneeField.appendChild(assigneeInput);
    assigneeField.appendChild(peopleList);
    row.appendChild(assigneeField);
  }

  const estField = document.createElement('div');
  estField.className = 'td-field';
  const el = document.createElement('span');
  el.className = 'td-field-label';
  el.textContent = 'Estimate';
  const estRow = document.createElement('div');
  estRow.className = 'td-due-row';
  const estInput = document.createElement('input');
  estInput.type = 'text';
  estInput.className = 'td-text-input';
  estInput.placeholder = 'e.g. 30m, 2h, 1d';
  estInput.value = task.estimateMinutes ? formatEstimate(task.estimateMinutes) : '';
  estInput.setAttribute('aria-label', 'Time estimate');
  const estHint = document.createElement('span');
  estHint.className = 'td-field-hint';
  estHint.textContent = 'minutes stored; 1d = 8h';
  const saveEst = () => {
    const raw = estInput.value.trim();
    if (!raw) {
      if (task.estimateMinutes) {
        appendHistory(task, { event: 'estimate', from: formatEstimate(task.estimateMinutes), to: '' });
        task.estimateMinutes = null;
        commit('Estimate cleared');
        updateLoggedHint();
        getRenderTasks && getRenderTasks()();
      }
      return;
    }
    const mins = parseEstimate(raw);
    if (mins == null) {
      showStatus('Invalid estimate — try 30m, 2h, or 1d');
      estInput.value = task.estimateMinutes ? formatEstimate(task.estimateMinutes) : '';
      return;
    }
    const prev = task.estimateMinutes ? formatEstimate(task.estimateMinutes) : '';
    const next = formatEstimate(mins);
    if (task.estimateMinutes !== mins) {
      task.estimateMinutes = mins;
      appendHistory(task, { event: 'estimate', from: prev, to: next });
      estInput.value = next;
      commit('Estimate set to ' + next);
      updateLoggedHint();
      getRenderTasks && getRenderTasks()();
    }
  };
  estInput.addEventListener('blur', saveEst);
  estInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); estInput.blur(); }
  });
  estRow.appendChild(estInput);
  estField.appendChild(el);
  estField.appendChild(estRow);
  estField.appendChild(estHint);
  row.appendChild(estField);

  const loggedField = document.createElement('div');
  loggedField.className = 'td-field';
  const ll = document.createElement('span');
  ll.className = 'td-field-label';
  ll.textContent = 'Logged';
  const loggedRow = document.createElement('div');
  loggedRow.className = 'td-due-row';
  const loggedInput = document.createElement('input');
  loggedInput.type = 'text';
  loggedInput.className = 'td-text-input';
  loggedInput.placeholder = 'e.g. 30m, 2h';
  loggedInput.value = task.loggedMinutes ? formatEstimate(task.loggedMinutes) : '';
  loggedInput.setAttribute('aria-label', 'Time logged');
  const logPlusBtn = document.createElement('button');
  logPlusBtn.type = 'button';
  logPlusBtn.className = 'td-add-subtask';
  logPlusBtn.textContent = 'Log +';
  logPlusBtn.title = 'Add time to logged total';
  const vsHint = document.createElement('span');
  vsHint.className = 'td-field-hint';
  const updateLoggedHint = () => {
    if (task.estimateMinutes && task.loggedMinutes) {
      const est = formatEstimate(task.estimateMinutes);
      const logged = formatEstimate(task.loggedMinutes);
      const diff = task.loggedMinutes - task.estimateMinutes;
      if (diff > 0) {
        vsHint.textContent = `${logged} / ${est} est — over by ${formatEstimate(diff)}`;
      } else if (diff < 0) {
        vsHint.textContent = `${logged} / ${est} est — ${formatEstimate(-diff)} remaining`;
      } else {
        vsHint.textContent = `${logged} / ${est} est — on target`;
      }
    } else {
      vsHint.textContent = '';
    }
  };
  updateLoggedHint();
  const saveLogged = () => {
    const raw = loggedInput.value.trim();
    if (!raw) {
      if (task.loggedMinutes) {
        task.loggedMinutes = null;
        commit('Logged time cleared');
        updateLoggedHint();
        getRenderTasks && getRenderTasks()();
      }
      return;
    }
    const mins = parseEstimate(raw);
    if (mins == null) {
      showStatus('Invalid time — try 30m, 2h, or 1d');
      loggedInput.value = task.loggedMinutes ? formatEstimate(task.loggedMinutes) : '';
      return;
    }
    if (task.loggedMinutes !== mins) {
      task.loggedMinutes = mins;
      loggedInput.value = formatEstimate(mins);
      commit('Logged set to ' + formatEstimate(mins));
      updateLoggedHint();
      getRenderTasks && getRenderTasks()();
    }
  };
  loggedInput.addEventListener('blur', saveLogged);
  loggedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); loggedInput.blur(); }
  });
  logPlusBtn.addEventListener('click', () => {
    const raw = loggedInput.value.trim();
    const add = raw ? parseEstimate(raw) : 30;
    if (add == null) {
      showStatus('Invalid time — try 30m, 2h, or 1d');
      return;
    }
    task.loggedMinutes = (task.loggedMinutes || 0) + add;
    loggedInput.value = formatEstimate(task.loggedMinutes);
    commit('Logged +' + formatEstimate(add));
    updateLoggedHint();
    getRenderTasks && getRenderTasks()();
  });
  loggedRow.appendChild(loggedInput);
  loggedRow.appendChild(logPlusBtn);
  loggedField.appendChild(ll);
  loggedField.appendChild(loggedRow);
  loggedField.appendChild(vsHint);
  row.appendChild(loggedField);

  body.appendChild(sectionPanel(isCorporateUiHidden() ? 'Estimate & logged' : 'Assignee / Estimate', row));
}

function buildRecurrencePanel(task, body) {
  ensureTaskFieldDefaults(task);
  const row = document.createElement('div');
  row.className = 'td-panel-meta';

  const freqField = document.createElement('div');
  freqField.className = 'td-field';
  const fl = document.createElement('span');
  fl.className = 'td-field-label';
  fl.textContent = 'Repeat';
  const freqSelect = document.createElement('select');
  freqSelect.className = 'td-select';
  freqSelect.setAttribute('aria-label', 'Recurrence frequency');
  [
    ['', 'None'],
    ['daily', 'Daily'],
    ['weekly', 'Weekly'],
    ['monthly', 'Monthly'],
  ].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if ((task.recurrence?.freq || '') === val) opt.selected = true;
    freqSelect.appendChild(opt);
  });
  freqField.appendChild(fl);
  freqField.appendChild(freqSelect);
  row.appendChild(freqField);

  const intervalField = document.createElement('div');
  intervalField.className = 'td-field';
  const il = document.createElement('span');
  il.className = 'td-field-label';
  il.textContent = 'Every';
  const intervalInput = document.createElement('input');
  intervalInput.type = 'number';
  intervalInput.min = '1';
  intervalInput.max = '365';
  intervalInput.className = 'td-text-input';
  intervalInput.style.width = '4rem';
  intervalInput.value = String(task.recurrence?.interval || 1);
  intervalInput.setAttribute('aria-label', 'Recurrence interval');
  intervalInput.disabled = !task.recurrence?.freq;
  const intervalUnit = document.createElement('span');
  intervalUnit.className = 'td-field-hint';
  intervalUnit.textContent = 'interval(s)';
  intervalField.appendChild(il);
  intervalField.appendChild(intervalInput);
  intervalField.appendChild(intervalUnit);
  row.appendChild(intervalField);

  const applyRecurrence = () => {
    const freq = freqSelect.value;
    if (!freq) {
      if (task.recurrence) {
        task.recurrence = null;
        intervalInput.disabled = true;
        commit('Recurrence cleared');
        getRenderTasks && getRenderTasks()();
      }
      return;
    }
    const interval = Math.max(1, parseInt(intervalInput.value, 10) || 1);
    intervalInput.value = String(interval);
    const prev = task.recurrence ? `${task.recurrence.freq}×${task.recurrence.interval}` : '';
    task.recurrence = { freq, interval };
    intervalInput.disabled = false;
    const next = `${freq}×${interval}`;
    if (prev !== next) {
      commit('Recurrence set to ' + next);
      getRenderTasks && getRenderTasks()();
    }
  };
  freqSelect.addEventListener('change', applyRecurrence);
  intervalInput.addEventListener('change', applyRecurrence);
  intervalInput.addEventListener('blur', applyRecurrence);

  body.appendChild(sectionPanel('Recurrence', row));
}

function buildNotesPanel(task, body) {
  ensureTaskFieldDefaults(task);
  const wrap = document.createElement('div');
  wrap.className = 'td-entry-list';

  const notes = task.notes || [];
  if (notes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'td-panel-hint';
    empty.textContent = 'No notes yet — add context, updates, or reminders.';
    wrap.appendChild(empty);
  } else {
    notes.slice().reverse().forEach((n, revIdx) => {
      const idx = notes.length - 1 - revIdx;
      const when = (n.at || '').replace('T', ' ').slice(0, 16);
      wrap.appendChild(buildEditableEntryCard({
        when,
        text: n.text || '',
        variant: 'note',
        multiline: true,
        onSave: (next) => {
          updateNoteAt(task, idx + 1, next);
          commit('Note updated');
          openTaskDetail(task, { focusTitle: false });
        },
        onRemove: () => {
          removeNoteAt(task, idx + 1);
          commit('Note removed');
          openTaskDetail(task, { focusTitle: false });
        },
      }));
    });
  }

  const addRow = document.createElement('div');
  addRow.className = 'td-entry-add';
  const noteInput = document.createElement('textarea');
  noteInput.className = 'td-notes-textarea td-notes-textarea-compact';
  noteInput.rows = 2;
  noteInput.placeholder = 'Add a note…';
  noteInput.setAttribute('aria-label', 'New note');
  const noteBtn = document.createElement('button');
  noteBtn.type = 'button';
  noteBtn.className = 'td-add-btn';
  noteBtn.textContent = 'Add note';
  const addNoteFn = () => {
    const text = noteInput.value.trim();
    if (!text) return;
    appendNote(task, text);
    noteInput.value = '';
    commit('Note added');
    openTaskDetail(task, { focusTitle: false });
  };
  noteBtn.addEventListener('click', addNoteFn);
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addNoteFn();
    }
  });
  addRow.appendChild(noteInput);
  addRow.appendChild(noteBtn);
  wrap.appendChild(addRow);

  body.appendChild(wrap);
}

function buildHistoryPanel(task, body) {
  ensureTaskFieldDefaults(task);
  const list = document.createElement('div');
  list.className = 'td-entry-list td-entry-list-readonly';
  const entries = [...(task.history || [])].reverse();
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'td-panel-hint';
    empty.textContent = 'No activity yet — changes to status, assignee, and other fields appear here.';
    list.appendChild(empty);
  } else {
    entries.forEach(h => {
      const when = (h.at || '').replace('T', ' ').slice(0, 16);
      let detail = h.event;
      if (h.from || h.to) detail += `: ${h.from || '—'} → ${h.to || '—'}`;
      if (h.note) detail += ` (${h.note})`;

      const card = document.createElement('div');
      card.className = 'td-entry-card td-entry-card-activity';

      const meta = document.createElement('div');
      meta.className = 'td-entry-meta';
      meta.textContent = when;

      const bodyEl = document.createElement('div');
      bodyEl.className = 'td-entry-text';
      bodyEl.textContent = detail;

      card.appendChild(meta);
      card.appendChild(bodyEl);
      list.appendChild(card);
    });
  }
  body.appendChild(list);
}

function buildBlockedByPanel(task, body) {
  ensureTaskFieldDefaults(task);
  const state = getState() || {};
  const wrap = document.createElement('div');
  wrap.className = 'td-blocked-by';

  const unresolved = unresolvedBlockedBy(task, state.tasks);
  if (unresolved.length) {
    const hint = document.createElement('div');
    hint.className = 'td-panel-hint';
    hint.textContent = `Unresolved deps: ${unresolved.join(', ')}`;
    wrap.appendChild(hint);
  }

  task.blockedBy.forEach((depId, idx) => {
    const dep = findTaskByTaskId(state.tasks, depId);
    const row = document.createElement('div');
    row.className = 'td-link-row';
    if (dep) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-parent-link';
      btn.innerHTML = `<span class="task-parent-id">${escapeHtml(dep.taskId)}</span>`
        + `<span class="task-parent-title">${escapeHtml(dep.title)}</span>`;
      btn.addEventListener('click', () => openTaskDetail(dep));
      row.appendChild(btn);
    } else {
      const missing = document.createElement('span');
      missing.textContent = `${depId} (missing)`;
      row.appendChild(missing);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'td-chip-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      task.blockedBy.splice(idx, 1);
      commit('Dependency removed');
      openTaskDetail(task, { focusTitle: false });
    });
    row.appendChild(remove);
    wrap.appendChild(row);
  });

  const addRow = document.createElement('div');
  addRow.className = 'td-inline-add';
  const select = document.createElement('select');
  select.className = 'td-select';
  select.setAttribute('aria-label', 'Add blocked-by dependency');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— Add dependency —';
  select.appendChild(none);
  blockedByCandidates(state.tasks, task.taskId)
    .filter(c => !task.blockedBy.includes(c.taskId))
    .forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.taskId;
      opt.textContent = `${c.taskId} · ${c.title}`;
      select.appendChild(opt);
    });
  select.addEventListener('change', () => {
    const v = select.value;
    if (!v) return;
    if (!task.blockedBy.includes(v)) task.blockedBy.push(v);
    commit('Dependency added');
    openTaskDetail(task, { focusTitle: false });
  });
  addRow.appendChild(select);
  wrap.appendChild(addRow);

  body.appendChild(sectionPanel('Blocked by (peer deps)', wrap));
}

function childBlockedHint(child, tasks) {
  if (!isEffectivelyBlocked(child, tasks)) return '';
  if (child.waitingOn) {
    const w = String(child.waitingOn);
    return w.length > 20 ? `${w.slice(0, 18)}…` : w;
  }
  const deps = unresolvedBlockedBy(child, tasks);
  if (deps.length) {
    const show = deps.slice(0, 2).join(', ');
    return deps.length > 2 ? `↳ ${show} +${deps.length - 2}` : `↳ ${show}`;
  }
  return 'Blocked';
}

function childBlockedTitle(child, tasks) {
  if (!isEffectivelyBlocked(child, tasks)) return '';
  if (child.waitingOn) return `Waiting on ${child.waitingOn}`;
  const deps = unresolvedBlockedBy(child, tasks);
  if (deps.length) return `Blocked by ${deps.join(', ')}`;
  return 'Blocked';
}

function sectionNameFor(child, sections) {
  const sec = child.section || '';
  const row = (sections || []).find(s => s.id === sec);
  return row?.name || sec || '—';
}

function childFieldCell(value, { title = '', className = '', empty = '—' } = {}) {
  const text = value != null && value !== '' ? String(value) : empty;
  const cls = 'td-child-cell' + (className ? ` ${className}` : '') + (text === empty ? ' td-child-cell-empty' : '');
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<span class="${cls}"${titleAttr}>${escapeHtml(text)}</span>`;
}

function childColumnData(child, colId, state, types) {
  if (colId.startsWith('custom:')) {
    const fieldId = colId.slice(7);
    const v = readCustomValue(child, fieldId);
    return { value: v, title: v, className: 'td-child-custom' };
  }
  switch (colId) {
    case 'status':
      return { value: sectionNameFor(child, state.sections), className: 'td-child-status' };
    case 'due': {
      const dueLabel = child.dueDate ? formatDueLabel(child.dueDate) : '';
      return { value: dueLabel, title: child.dueDate ? `Due ${child.dueDate}` : '', className: 'td-child-due' };
    }
    case 'estimate': {
      const estLabel = child.estimateMinutes ? formatEstimate(child.estimateMinutes) : '';
      return { value: estLabel, title: estLabel ? `Estimate ${estLabel}` : '', className: 'td-child-est' };
    }
    case 'energy':
      return { value: child.energy || '', title: child.energy ? `Energy: ${child.energy}` : '', className: 'td-child-energy' };
    case 'model': {
      const modelLabel = normalizeModel(child.model) || '';
      return { value: modelLabel, title: modelLabel ? `Model: ${modelLabel}` : '', className: 'td-child-model' };
    }
    case 'blocked': {
      const blockedHint = childBlockedHint(child, state.tasks);
      return {
        value: blockedHint,
        title: childBlockedTitle(child, state.tasks),
        className: blockedHint ? 'td-child-blocked' : 'td-child-blocked td-child-cell-empty',
      };
    }
    case 'type':
      return { value: getTicketType(types, child.type).name, className: 'td-child-type-col' };
    case 'priority':
      return { value: child.priority || 'medium', className: 'td-child-priority-col' };
    case 'project':
      return { value: child.project || '', className: 'td-child-project' };
    case 'assignee':
      return { value: child.assignee || '', className: 'td-child-assignee' };
    default:
      return { value: '', className: '' };
  }
}

function buildChildrenColumnPicker(task, columns) {
  const wrap = document.createElement('div');
  wrap.className = 'td-children-col-picker';
  const label = document.createElement('span');
  label.className = 'td-children-col-label';
  label.textContent = 'Columns';
  wrap.appendChild(label);

  const chips = document.createElement('div');
  chips.className = 'td-children-col-chips';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Visible child columns');

  const allIds = [
    ...Object.keys(CHILD_COLUMN_DEFS),
    ...readCustomFields().map(cf => `custom:${cf.id}`),
  ];
  allIds.forEach(colId => {
    const active = columns.includes(colId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'td-children-col-chip' + (active ? ' active' : '');
    btn.textContent = columnLabel(colId);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.title = active ? `Hide ${columnLabel(colId)}` : `Show ${columnLabel(colId)}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleChildrenColumn(colId);
      openTaskDetail(task, { focusTitle: false });
    });
    chips.appendChild(btn);
  });
  wrap.appendChild(chips);
  return wrap;
}

function buildChildrenPanel(task, body) {
  const state = getState() || {};
  const types = normalizeTicketTypes(state.ticketTypes);
  const children = childTasks(state.tasks, task.taskId);
  const columns = readChildrenColumns();

  const panel = document.createElement('div');
  panel.className = 'td-panel td-panel-soft td-children-panel';

  const head = document.createElement('div');
  head.className = 'td-children-panel-head';
  const title = document.createElement('div');
  title.className = 'td-panel-label';
  title.textContent = `Children (${children.length})`;
  head.appendChild(title);
  head.appendChild(buildChildrenColumnPicker(task, columns));
  panel.appendChild(head);

  const list = document.createElement('div');
  list.className = 'td-children';

  if (children.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'td-children-empty';
    empty.textContent = 'No child tickets linked to this one';
    list.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = 'td-children-grid';
    const headCols = columns.map(colId =>
      `<span class="td-child-col">${escapeHtml(columnLabel(colId))}</span>`
    ).join('');
    grid.innerHTML = `
      <div class="td-children-head" aria-hidden="true">
        <span class="td-child-col td-child-col-main">Ticket</span>
        ${headCols}
      </div>
    `;

    children.forEach(child => {
      const done = isTaskDone(child);
      const blocked = isEffectivelyBlocked(child, state.tasks);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'td-children-row'
        + (done ? ' td-child-done' : '')
        + (blocked ? ' td-child-link-blocked' : '');
      const cColor = resolveTaskColor(child, types, state.tasks);
      const cType = getTicketType(types, child.type);
      const pri = child.priority || 'medium';
      const colCells = columns.map(colId => {
        const data = childColumnData(child, colId, state, types);
        return childFieldCell(data.value, {
          title: data.title || '',
          className: data.className,
        });
      }).join('');

      row.innerHTML = `
        <span class="td-child-col td-child-col-main td-child-main">
          <span class="task-parent-swatch" style="background:${cColor}"></span>
          <span class="priority-dot priority-${escapeHtml(pri)} td-child-priority" title="${escapeHtml(pri)} priority"></span>
          <span class="task-parent-id">${escapeHtml(child.taskId || '—')}</span>
          <span class="td-child-type">${escapeHtml(cType.name)}</span>
          <span class="task-parent-title">${escapeHtml(child.title || '')}</span>
        </span>
        ${colCells}
      `;
      row.title = `Open ${child.taskId || 'child'}`;
      row.addEventListener('click', () => openTaskDetail(child));
      grid.appendChild(row);
    });

    list.appendChild(grid);
  }

  panel.appendChild(list);
  body.appendChild(panel);
}

function buildSubtasksPanel(task, body) {
  if (!Array.isArray(task.subtasks)) task.subtasks = [];

  const list = document.createElement('div');
  list.className = 'td-subtasks';

  task.subtasks.forEach((st, idx) => {
    const row = document.createElement('div');
    row.className = 'td-subtask' + (st.checked ? ' done' : '');

    const cb = document.createElement('span');
    cb.className = 'checkbox' + (st.checked ? ' checked' : '');
    cb.setAttribute('role', 'checkbox');
    cb.setAttribute('aria-checked', st.checked ? 'true' : 'false');
    cb.setAttribute('tabindex', '0');
    cb.addEventListener('click', () => {
      st.checked = !st.checked;
      cb.classList.toggle('checked', st.checked);
      cb.setAttribute('aria-checked', st.checked ? 'true' : 'false');
      row.classList.toggle('done', st.checked);
      commit();
    });
    cb.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cb.click(); }
    });

    const input = document.createElement('textarea');
    input.className = 'td-subtask-textarea';
    input.dataset.idx = String(idx);
    input.rows = 1;
    input.value = st.text || '';
    input.setAttribute('aria-label', 'Subtask ' + (idx + 1));
    input.placeholder = 'Subtask text…';

    // Collapse tall text until focused/clicked
    if ((st.text || '').length > 80 || (st.text || '').includes('\n')) {
      input.title = 'Click to expand';
    }

    let saved = false;
    const save = () => {
      if (saved) return;
      saved = true;
      const v = input.value.trim();
      if (v) {
        st.text = v;
        commit();
      } else {
        task.subtasks.splice(idx, 1);
        commit();
        openTaskDetail(task, { focusTitle: false });
      }
    };

    input.addEventListener('focus', () => expandSubtaskField(input));
    input.addEventListener('click', () => expandSubtaskField(input));
    input.addEventListener('input', () => autoResizeTextarea(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        saved = true;
        input.classList.remove('expanded');
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      input.classList.remove('expanded');
      autoResizeTextarea(input);
      save();
    });

    requestAnimationFrame(() => autoResizeTextarea(input));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'td-subtask-remove';
    remove.setAttribute('aria-label', 'Remove subtask');
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      task.subtasks.splice(idx, 1);
      commit();
      openTaskDetail(task, { focusTitle: false });
    });

    row.appendChild(cb);
    row.appendChild(input);
    row.appendChild(remove);
    list.appendChild(row);
  });

  if (task.subtasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'td-subtasks-empty';
    empty.textContent = 'No subtasks yet';
    list.appendChild(empty);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'td-add-subtask';
  addBtn.textContent = '+ Add subtask';
  addBtn.addEventListener('click', () => {
    task.subtasks.push({ text: '', checked: false });
    openTaskDetail(task, {
      focusTitle: false,
      focusSubtaskIdx: task.subtasks.length - 1,
      expandSubtask: true,
    });
  });
  list.appendChild(addBtn);

  body.appendChild(sectionPanel('Subtasks', list));

  // Expand a specific field if requested when rebuilding
  if (pendingFocus.expandSubtask && Number.isInteger(pendingFocus.focusSubtaskIdx)) {
    const ta = list.querySelector(`.td-subtask-textarea[data-idx="${pendingFocus.focusSubtaskIdx}"]`);
    if (ta) expandSubtaskField(ta);
  }
}


/* ── Init: wire up the shared overlay chrome ──────────────────── */

export function initTaskDetail() {
  const overlay = document.getElementById('taskDetailOverlay');
  const closeBtn = document.getElementById('tdClose');
  const closeBtn2 = document.getElementById('tdCloseBtn');
  const deleteBtn = document.getElementById('tdDelete');
  const titleInput = document.getElementById('tdTitle');

  if (closeBtn) closeBtn.addEventListener('click', closeTaskDetail);
  if (closeBtn2) closeBtn2.addEventListener('click', () => {
    closeTaskDetail();
  });

  if (deleteBtn) deleteBtn.addEventListener('click', () => {
    if (!activeTask) return;
    deleteTask(activeTask);
    closeTaskDetail();
  });

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeTaskDetail();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isTaskDetailOpen()) {
      closeTaskDetail();
    }
  });

  if (titleInput) {
    const saveTitle = () => {
      if (!activeTask || titleEditCancelled) return;
      const v = titleInput.value.trim();
      if (v && v !== activeTask.title) {
        activeTask.title = v;
        commit('Title updated');
      }
    };
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
    });
    titleInput.addEventListener('blur', saveTitle);
  }

  const idBtn = document.getElementById('tdTaskIdBtn');
  const idInput = document.getElementById('tdTaskId');
  if (idBtn) {
    idBtn.addEventListener('click', beginTaskIdEdit);
  }
  if (idInput) {
    idInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); idInput.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        syncTaskIdField(activeTask);
        idInput.blur();
      }
    });
    idInput.addEventListener('blur', () => {
      if (!activeTask) return;
      const next = idInput.value.trim().toUpperCase();
      if (!next || next === activeTask.taskId) {
        syncTaskIdField(activeTask);
        return;
      }
      const state = getState();
      if (!state) {
        syncTaskIdField(activeTask);
        return;
      }
      const ok = confirmAndRenameTaskId(state, activeTask, next, (result) => {
        activeTask = result.task;
        syncTaskIdField(activeTask);
        commit(`Renamed to ${result.newId}`);
        getRenderTasks?.()();
        if (isRoutingReady()) syncUrl();
      });
      if (!ok) syncTaskIdField(activeTask);
    });
  }
}
