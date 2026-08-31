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
  appendHistory,
  appendNote,
  parseEstimate,
  formatEstimate,
  normalizeJiraKey,
  todayYmd,
  markCorporateUi,
  isCorporateUiHidden,
} from './task-fields.js';
import { memoryState } from './memory-renderer.js';
import { timerControlsHtml, bindTimerControls, timerExplainerHtml } from './task-timer.js';
import { mountFieldLayoutSections } from './task-field-layout.js';

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

  activeTask = task;
  titleEditCancelled = false;
  pendingFocus = { focusTitle, focusSubtaskIdx, expandSubtask };
  buildPanels(task);
  const refresh = overlay.classList.contains('visible');

  const idEl = document.getElementById('tdTaskId');
  if (idEl) idEl.textContent = task.taskId || '\u2014';

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
}

function closeTaskDetail() {
  const overlay = document.getElementById('taskDetailOverlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.hidden = true;
  activeTask = null;
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
  el.classList.add('show');
  if (savedFlashTimer) clearTimeout(savedFlashTimer);
  savedFlashTimer = setTimeout(() => el.classList.remove('show'), 1200);
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

  // Notes — conversation, decisions, history
  buildNotesPanel(task, paneEls.notes);
  buildDecisionsPanel(task, paneEls.notes);
  buildHistoryPanel(task, paneEls.notes);
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
    task.timeEntries.slice(-8).reverse().forEach(e => {
      const row = document.createElement('div');
      row.className = 'td-time-entry';
      const when = (e.at || '').replace('T', ' ').slice(0, 16);
      row.innerHTML = `<span>${escapeHtml(when)}</span><span>${escapeHtml(formatEstimate(e.minutes))}</span>${e.note ? `<span class="td-time-note">${escapeHtml(e.note)}</span>` : ''}`;
      list.appendChild(row);
    });
    panel.appendChild(list);
  }
  body.appendChild(panel);
  bindTimerControls(panel, task.taskId);
}

function buildDecisionsPanel(task, body) {
  ensureTaskFieldDefaults(task);
  const list = document.createElement('div');
  list.className = 'td-notes-list';
  const decisions = task.decisions || [];
  if (decisions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'td-panel-hint';
    empty.textContent = 'No decisions yet';
    list.appendChild(empty);
  } else {
    decisions.slice().reverse().forEach(d => {
      const row = document.createElement('div');
      row.className = 'td-note-row';
      const when = (d.at || '').split('T')[0] || '';
      row.innerHTML = `<span class="td-note-date">${escapeHtml(when)}</span><span class="td-note-text">${escapeHtml(d.text)}</span>`;
      list.appendChild(row);
    });
  }
  const addRow = document.createElement('div');
  addRow.className = 'td-note-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'td-text-input';
  input.placeholder = 'Record a decision…';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'td-add-btn';
  btn.textContent = 'Add';
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    if (!Array.isArray(task.decisions)) task.decisions = [];
    task.decisions.push({ at: new Date().toISOString(), text });
    if (task.decisions.length > 50) task.decisions = task.decisions.slice(-50);
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
  body.appendChild(sectionPanel('Decisions', [list, addRow]));
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

  return {
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
        if (target && target !== task.section) {
          task.updated = task.checked ? todayStr() : task.updated;
          moveTask(task.id, target, -1);
          flashSaved();
          return;
        }
        commit('Moved to ' + (sections.find(s => s.id === target)?.name || target));
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
        lab.addEventListener('click', () => openTaskDetail(parentForLabel, { focusTitle: false }));
      }
      const parentSelect = document.createElement('select');
      parentSelect.className = 'td-select';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'None';
      parentSelect.appendChild(none);
      const candidates = parentCandidates(types, state.tasks, task.type || DEFAULT_TICKET_TYPE_ID, task.taskId);
      candidates.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.taskId;
        opt.textContent = `${p.taskId} — ${p.title || ''}`;
        if (p.taskId === task.parentId) opt.selected = true;
        parentSelect.appendChild(opt);
      });
      if (task.parentId && !candidates.some(p => p.taskId === task.parentId)) {
        const orphan = findTaskByTaskId(state.tasks, task.parentId);
        const opt = document.createElement('option');
        opt.value = task.parentId;
        opt.selected = true;
        opt.textContent = orphan
          ? `${task.parentId} — ${orphan.title || ''}`
          : `${task.parentId} (missing)`;
        parentSelect.appendChild(opt);
      }
      parentSelect.addEventListener('change', () => {
        task.parentId = parentSelect.value || null;
        commit(task.parentId ? 'Parent set to ' + task.parentId : 'Parent cleared');
        openTaskDetail(task, { focusTitle: false });
      });
      wrap.appendChild(lab);
      wrap.appendChild(parentSelect);
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
    chip.innerHTML = `${escapeHtml(name)}<button type="button" class="td-chip-remove" aria-label="Remove label">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      task.labels.splice(idx, 1);
      commit('Label removed');
      openTaskDetail(task, { focusTitle: false });
    });
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
    row.className = 'td-link-row';
    const a = document.createElement('a');
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = link.label || link.url;
    a.className = 'td-link-anchor';
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
    row.appendChild(a);
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
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(56, Math.min(160, textarea.scrollHeight)) + 'px';
  };
  setTimeout(resize, 0);
  textarea.addEventListener('input', resize);
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
  wrap.className = 'td-notes-list';

  const notes = [...(task.notes || [])].reverse();
  if (notes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'td-panel-hint';
    empty.textContent = 'No notes yet';
    wrap.appendChild(empty);
  } else {
    notes.forEach(n => {
      const row = document.createElement('div');
      row.className = 'td-history-row';
      const when = (n.at || '').replace('T', ' ').slice(0, 16);
      row.innerHTML = `<span class="td-history-at">${escapeHtml(when)}</span>`
        + `<span class="td-history-event">${escapeHtml(n.text || '')}</span>`;
      wrap.appendChild(row);
    });
  }

  const addRow = document.createElement('div');
  addRow.className = 'td-inline-add';
  addRow.style.marginTop = '8px';
  const noteInput = document.createElement('textarea');
  noteInput.className = 'td-notes-textarea';
  noteInput.rows = 2;
  noteInput.placeholder = 'Add a note…';
  noteInput.setAttribute('aria-label', 'New note');
  noteInput.style.minHeight = '48px';
  const noteBtn = document.createElement('button');
  noteBtn.type = 'button';
  noteBtn.className = 'td-add-subtask';
  noteBtn.textContent = 'Add note';
  const addNote = () => {
    const text = noteInput.value.trim();
    if (!text) return;
    appendNote(task, text);
    noteInput.value = '';
    commit('Note added');
    openTaskDetail(task, { focusTitle: false });
  };
  noteBtn.addEventListener('click', addNote);
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addNote();
    }
  });
  addRow.appendChild(noteInput);
  addRow.appendChild(noteBtn);
  wrap.appendChild(addRow);

  body.appendChild(sectionPanel('Notes', wrap));
}

function buildHistoryPanel(task, body) {
  ensureTaskFieldDefaults(task);
  const list = document.createElement('div');
  list.className = 'td-history';
  const entries = [...(task.history || [])].reverse();
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'td-panel-hint';
    empty.textContent = 'No activity yet';
    list.appendChild(empty);
  } else {
    entries.forEach(h => {
      const row = document.createElement('div');
      row.className = 'td-history-row';
      const when = (h.at || '').replace('T', ' ').slice(0, 16);
      let detail = h.event;
      if (h.from || h.to) detail += `: ${h.from || '—'} → ${h.to || '—'}`;
      if (h.note) detail += ` (${h.note})`;
      row.innerHTML = `<span class="td-history-at">${escapeHtml(when)}</span>`
        + `<span class="td-history-event">${escapeHtml(detail)}</span>`;
      list.appendChild(row);
    });
  }
  body.appendChild(sectionPanel('Activity', list));
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

function buildChildrenPanel(task, body) {
  const state = getState() || {};
  const types = normalizeTicketTypes(state.ticketTypes);
  const children = childTasks(state.tasks, task.taskId);

  const list = document.createElement('div');
  list.className = 'td-children';

  if (children.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'td-children-empty';
    empty.textContent = 'No child tickets linked to this one';
    list.appendChild(empty);
  } else {
    children.forEach(child => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'task-parent-link td-child-link';
      const cColor = resolveTaskColor(child, types, state.tasks);
      const cType = getTicketType(types, child.type);
      btn.innerHTML = `<span class="task-parent-swatch" style="background:${cColor}"></span>`
        + `<span class="task-parent-id">${child.taskId || '—'}</span>`
        + `<span class="td-child-type">${cType.name}</span>`
        + `<span class="task-parent-title">${child.title || ''}</span>`;
      btn.title = `Open ${child.taskId}`;
      btn.addEventListener('click', () => openTaskDetail(child));
      list.appendChild(btn);
    });
  }

  body.appendChild(sectionPanel(`Children (${children.length})`, list));
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
}
