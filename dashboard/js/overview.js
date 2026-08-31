// ============================================================
// ===== OVERVIEW WIDGETS FUNCTIONALITY =====
// ============================================================

import {
  isEffectivelyBlocked,
  dueUrgency,
  daysUntilDue,
  parseYmd,
  sumEstimates,
  formatEstimate,
  rankFocusTasks,
  workloadByProject,
  plannedCapacityMinutes,
  tasksForCalendarMonth,
  dependencyEdges,
  unresolvedBlockedBy,
  dueBadgeHtml,
  todayYmd,
  isStale,
  isWaitingReminder,
  indexTasksById,
  computeNextTaskId,
  appendHistory,
} from './task-fields.js';
import { switchMainTab } from './state.js';
import { applyDeepLinkFilter, applyDueDayFilter } from './task-filters.js';
import { setTaskSearch } from './search.js';
import { escapeHtml } from './ticket-types.js';
import { markChanged } from './tasks-io.js';
import { todayStr } from './tasks-parser.js';

/** Whether corporate/team UI is hidden (Settings → Display → Hide corporate). */
let corporateHidden = false;

export function isCorporateHidden() {
  return corporateHidden
    || document.documentElement.getAttribute('data-hide-corporate') === 'true';
}

/** @deprecated Use isCorporateHidden */
export function isSprintsHidden() {
  return isCorporateHidden();
}

/**
 * Show or hide corporate UI (`[data-corporate-ui]`, legacy `[data-sprint-ui]`).
 * Covers sprints, Jira key fields/badges, assignee chips/filters, etc.
 * @param {boolean} hidden
 */
export function applyCorporateVisibility(hidden) {
  corporateHidden = !!hidden;
  const flag = corporateHidden ? 'true' : 'false';
  document.documentElement.setAttribute('data-hide-corporate', flag);
  // Legacy attr kept for older CSS / layout checks
  document.documentElement.setAttribute('data-hide-sprints', flag);
  document.querySelectorAll('[data-corporate-ui], [data-sprint-ui]').forEach(el => {
    el.hidden = corporateHidden;
  });
  if (!corporateHidden) updateSprintInfo();
  import('./overview-layout.js').then(m => m.applyOverviewLayout()).catch(() => {});
}

/** @deprecated Use applyCorporateVisibility */
export function applySprintVisibility(hidden) {
  applyCorporateVisibility(hidden);
}

// Sprint Info Widget
function updateSprintInfo() {
  if (corporateHidden) return;

  // Load sprints from config.json (see config.example.json for format)
  const configSprints = (window.dashboardConfig && window.dashboardConfig.sprints) || [];
  const sprints = configSprints.map(s => ({
    name: s.name,
    start: new Date(s.start),
    end: new Date(s.end)
  }));

  const now = new Date();
  const sprintNameEl = document.getElementById('sprintName');
  const sprintDaysEl = document.getElementById('sprintDays');
  const sprintProgressEl = document.getElementById('sprintProgress');
  if (!sprintNameEl || !sprintDaysEl || !sprintProgressEl) return;

  // Ensure progress-label span exists as sibling of progress-bar
  let progressLabelEl = document.getElementById('sprintProgressLabel');
  if (!progressLabelEl && sprintProgressEl) {
    progressLabelEl = document.createElement('span');
    progressLabelEl.id = 'sprintProgressLabel';
    progressLabelEl.className = 'progress-label';
    sprintProgressEl.parentElement.insertAdjacentElement('afterend', progressLabelEl);
  }

  let currentSprint = null;
  let nextSprint = null;

  for (let i = 0; i < sprints.length; i++) {
    if (now >= sprints[i].start && now <= sprints[i].end) {
      currentSprint = sprints[i];
      break;
    }
    if (now < sprints[i].start) {
      nextSprint = sprints[i];
      break;
    }
  }

  if (currentSprint) {
    const totalDays = Math.ceil((currentSprint.end - currentSprint.start) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.ceil((currentSprint.end - now) / (1000 * 60 * 60 * 24));
    const pct = Math.max(0, Math.min(100, ((totalDays - daysRemaining) / totalDays) * 100));

    sprintNameEl.textContent = currentSprint.name;
    sprintDaysEl.textContent = `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} remaining`;
    sprintProgressEl.style.width = `${pct}%`;
    if (progressLabelEl) progressLabelEl.textContent = Math.round(pct) + '%';
  } else if (nextSprint) {
    const daysUntil = Math.ceil((nextSprint.start - now) / (1000 * 60 * 60 * 24));
    sprintNameEl.textContent = 'Between Sprints';
    sprintDaysEl.textContent = `${nextSprint.name} starts in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}`;
    sprintProgressEl.style.width = '0%';
    if (progressLabelEl) progressLabelEl.textContent = '0%';
  } else {
    sprintNameEl.textContent = 'No Active Sprint';
    sprintDaysEl.textContent = 'Sprint schedule not available';
    sprintProgressEl.style.width = '0%';
    if (progressLabelEl) progressLabelEl.textContent = '0%';
  }
}

// Task Summary Widget - updates from parsed task data
export function updateTaskSummary(parsed) {
  if (!parsed || !parsed.tasks) return;
  const tasks = parsed.tasks;

  const inProgress = (tasks['in-progress'] || []).filter(t => !t.checked).length;
  const todo = (tasks['todo'] || []).length;
  const done = (tasks['done'] || []).length;

  let blocked = 0;
  ['in-progress', 'todo', 'backlog'].forEach(section => {
    (tasks[section] || []).forEach(t => {
      if (!t.checked && isEffectivelyBlocked(t, tasks)) blocked++;
    });
  });

  document.getElementById('statInProgress').textContent = inProgress;
  document.getElementById('statTodo').textContent = todo;
  document.getElementById('statDone').textContent = done;
  document.getElementById('statBlocked').textContent = blocked;

  const estEl = document.getElementById('statEstimateTotal');
  if (estEl) {
    const mins = sumEstimates(tasks, ['in-progress', 'todo']);
    estEl.textContent = mins > 0 ? formatEstimate(mins) : '—';
  }

  const statCells = [
    { id: 'statInProgress', count: inProgress, label: 'in-progress tasks' },
    { id: 'statTodo',       count: todo,        label: 'todo tasks' },
    { id: 'statDone',       count: done,        label: 'done tasks' },
    { id: 'statBlocked',    count: blocked,     label: 'blocked tasks' }
  ];
  statCells.forEach(({ id, count, label }) => {
    const cell = document.getElementById(id);
    if (!cell) return;
    const parent = cell.closest('.summary-stat');
    if (parent) {
      parent.setAttribute('aria-label', `Show ${count} ${label}`);
    }
  });
}

// ── Focus Agenda ────────────────────────────────────────────────

function openTaskInTasksTab(taskId) {
  if (!taskId) return;
  switchMainTab('tasks');
  setTaskSearch(taskId);
}

function priorityDotClass(priority) {
  const p = priority || 'medium';
  return `priority-dot priority-${p}`;
}

export function updateFocusAgenda(parsed) {
  const container = document.getElementById('focusList');
  if (!container) return;
  if (!parsed || !parsed.tasks) {
    container.innerHTML = '<div class="focus-empty">Load tasks to see focus items</div>';
    return;
  }

  const tasks = rankFocusTasks(parsed.tasks, 8);
  if (tasks.length === 0) {
    container.innerHTML = '<div class="focus-empty">No active tasks to focus on</div>';
    return;
  }

  container.innerHTML = '';
  tasks.forEach(task => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'focus-item';
    item.title = task.title;
    const dueHtml = dueBadgeHtml(task);
    const pri = task.priority || 'medium';
    item.innerHTML = `
      <span class="${priorityDotClass(pri)}" aria-hidden="true"></span>
      <span class="focus-item-id">${escapeHtml(task.taskId || '')}</span>
      <span class="focus-item-title">${escapeHtml(task.title)}</span>
      ${dueHtml ? `<span class="focus-item-due">${dueHtml}</span>` : ''}
    `;
    item.addEventListener('click', () => openTaskInTasksTab(task.taskId));
    container.appendChild(item);
  });
}

// ── By Project ──────────────────────────────────────────────────

export function updateProjects(parsed) {
  const container = document.getElementById('projectsList');
  if (!container) return;
  if (!parsed || !parsed.tasks) {
    container.innerHTML = '<div class="workload-empty">Load tasks to see projects</div>';
    return;
  }

  const rows = workloadByProject(parsed.tasks, parsed.meta?.projects || []);
  if (rows.length === 0) {
    container.innerHTML = '<div class="workload-empty">No active work — assign a project on tasks</div>';
    return;
  }

  container.innerHTML = '';
  rows.forEach(row => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'workload-row';
    el.title = 'Open project view';
    const est = row.estimateMinutes > 0 ? formatEstimate(row.estimateMinutes) : '—';
    const energyBits = Object.entries(row.energy || {})
      .map(([k, n]) => `${k}:${n}`)
      .join(' · ');
    el.innerHTML = `
      <span class="workload-assignee">${escapeHtml(row.name)}</span>
      <span class="workload-estimate">${escapeHtml(est)}</span>
      <span class="workload-count">${row.count} task${row.count === 1 ? '' : 's'}${energyBits ? ` · ${escapeHtml(energyBits)}` : ''}</span>
    `;
    el.addEventListener('click', () => {
      import('./projects-view.js').then(m => m.openProject(row.id)).catch(() => {});
    });
    container.appendChild(el);
  });
}

/** @deprecated alias */
export function updateWorkload(parsed) {
  return updateProjects(parsed);
}

function ensureDailyPlan(meta) {
  if (!meta.dailyPlan) meta.dailyPlan = { date: null, taskIds: [], carriedIds: [] };
  const today = todayYmd();
  const plan = meta.dailyPlan;
  if (plan.date && plan.date !== today) {
    const byId = indexTasksById(lastOverviewParsed?.tasks || {});
    const unfinished = (plan.taskIds || []).filter(id => {
      const t = byId.get(id);
      if (!t || t.checked) return false;
      if (t.section === 'done' || t.section === 'archive') return false;
      return true;
    });
    plan.date = today;
    plan.taskIds = unfinished;
    plan.carriedIds = unfinished;
  } else if (!plan.date) {
    plan.date = today;
  }
  return plan;
}

export function updateTodayPlan(parsed) {
  const container = document.getElementById('todayPlanList');
  if (!container) return;
  if (!parsed || !parsed.tasks) {
    container.innerHTML = '<div class="workload-empty">Load tasks to plan your day</div>';
    return;
  }
  if (!parsed.meta) parsed.meta = { dailyPlan: { date: todayYmd(), taskIds: [], carriedIds: [] } };
  const plan = ensureDailyPlan(parsed.meta);
  const byId = indexTasksById(parsed.tasks);
  const ids = plan.taskIds || [];
  let estSum = 0;
  if (ids.length === 0) {
    container.innerHTML = '<div class="workload-empty">Pin tasks from Focus or use <code>ch tasks plan --pin T1</code></div>';
    return;
  }
  container.innerHTML = '';
  ids.forEach(id => {
    const t = byId.get(id);
    const row = document.createElement('div');
    row.className = 'today-plan-row';
    const title = t ? t.title : '(missing)';
    const est = t?.estimateMinutes ? formatEstimate(t.estimateMinutes) : '';
    if (t?.estimateMinutes) estSum += t.estimateMinutes;
    const carried = (plan.carriedIds || []).includes(id) ? ' <span class="carried-tag">carried</span>' : '';
    row.innerHTML = `
      <button type="button" class="today-plan-item" data-id="${escapeHtml(id)}">
        <span class="focus-item-id">${escapeHtml(id)}</span>
        <span class="focus-item-title">${escapeHtml(title)}</span>
        ${est ? `<span class="workload-estimate">${escapeHtml(est)}</span>` : ''}
        ${carried}
      </button>
      <button type="button" class="topic-delete today-unpin" data-id="${escapeHtml(id)}" title="Unpin">×</button>
    `;
    row.querySelector('.today-plan-item')?.addEventListener('click', () => openTaskInTasksTab(id));
    row.querySelector('.today-unpin')?.addEventListener('click', () => {
      plan.taskIds = plan.taskIds.filter(x => x !== id);
      plan.carriedIds = (plan.carriedIds || []).filter(x => x !== id);
      persistMeta(parsed);
      updateTodayPlan(parsed);
    });
    container.appendChild(row);
  });
  const sum = document.createElement('div');
  sum.className = 'td-panel-hint';
  sum.textContent = `Estimate sum: ${estSum ? formatEstimate(estSum) : '—'}`;
  container.appendChild(sum);
}

export function updateCapacity(parsed) {
  const container = document.getElementById('capacityContent');
  if (!container) return;
  if (!parsed || !parsed.tasks) {
    container.innerHTML = '<div class="workload-empty">Load tasks to see capacity</div>';
    return;
  }
  const budget = parsed.meta?.weeklyCapacityMinutes || 600;
  const planned = plannedCapacityMinutes(parsed.tasks, parsed.meta?.dailyPlan);
  const pct = budget > 0 ? Math.min(100, Math.round((planned / budget) * 100)) : 0;
  container.innerHTML = `
    <div class="capacity-stats">
      <div><strong>${escapeHtml(formatEstimate(planned) || '0m')}</strong> planned</div>
      <div>of <strong>${escapeHtml(formatEstimate(budget))}</strong> weekly budget</div>
    </div>
    <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    <div class="td-panel-hint">${pct}% of capacity</div>
  `;
}

export function updateHabits(parsed) {
  const container = document.getElementById('habitsList');
  if (!container) return;
  if (!parsed?.tasks) {
    container.innerHTML = '<div class="workload-empty">No recurring habits</div>';
    return;
  }
  const habits = [];
  for (const list of Object.values(parsed.tasks)) {
    for (const t of list || []) {
      if (t.recurrence?.freq && !t.checked && t.section !== 'archive') {
        habits.push(t);
      }
    }
  }
  if (habits.length === 0) {
    container.innerHTML = '<div class="workload-empty">No recurring habits</div>';
    return;
  }
  container.innerHTML = '';
  habits.slice(0, 10).forEach(t => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'focus-item';
    const overdue = dueUrgency(t.dueDate) === 'overdue';
    el.innerHTML = `
      <span class="focus-item-id">${escapeHtml(t.taskId || '')}</span>
      <span class="focus-item-title">${escapeHtml(t.title)}</span>
      <span class="task-recur-badge">↻ ${escapeHtml(t.recurrence.freq)}</span>
      ${overdue ? '<span class="due-badge due-overdue">overdue</span>' : dueBadgeHtml(t)}
    `;
    el.addEventListener('click', () => openTaskInTasksTab(t.taskId));
    container.appendChild(el);
  });
}

export function updateStaleWaiting(parsed) {
  const container = document.getElementById('staleWaitingList');
  if (!container) return;
  if (!parsed?.tasks) {
    container.innerHTML = '<div class="workload-empty">All clear</div>';
    return;
  }
  const staleDays = (window.dashboardConfig && window.dashboardConfig.staleDays) || 14;
  const waitDays = (window.dashboardConfig && window.dashboardConfig.waitingReminderDays) || 5;
  const rows = [];
  for (const list of Object.values(parsed.tasks)) {
    for (const t of list || []) {
      if (t.checked || t.section === 'archive' || t.section === 'done') continue;
      if (isStale(t, staleDays)) rows.push({ t, kind: 'stale' });
      else if (isWaitingReminder(t, waitDays)) rows.push({ t, kind: 'waiting' });
    }
  }
  if (rows.length === 0) {
    container.innerHTML = '<div class="workload-empty">All clear</div>';
    return;
  }
  container.innerHTML = '';
  rows.slice(0, 12).forEach(({ t, kind }) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'focus-item';
    el.innerHTML = `
      <span class="${kind === 'stale' ? 'stale-badge' : 'task-blocked-badge'}">${kind === 'stale' ? 'Stale' : 'Waiting'}</span>
      <span class="focus-item-id">${escapeHtml(t.taskId || '')}</span>
      <span class="focus-item-title">${escapeHtml(t.title)}</span>
    `;
    el.addEventListener('click', () => openTaskInTasksTab(t.taskId));
    container.appendChild(el);
  });
}

export function updateDoneJournal(parsed) {
  const container = document.getElementById('doneJournalList');
  if (!container) return;
  const done = [...(parsed?.tasks?.done || [])]
    .filter(t => t.checked)
    .sort((a, b) => String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')))
    .slice(0, 10);
  if (done.length === 0) {
    container.innerHTML = '<div class="workload-empty">No recent completions</div>';
    return;
  }
  container.innerHTML = '';
  done.forEach(t => {
    const el = document.createElement('div');
    el.className = 'workload-row';
    const logged = t.loggedMinutes ? formatEstimate(t.loggedMinutes) : '';
    el.innerHTML = `
      <span class="workload-assignee">${escapeHtml(t.taskId || '')} ${escapeHtml(t.title)}</span>
      <span class="workload-estimate">${escapeHtml(t.updated || t.created || '')}</span>
      <span class="workload-count">${logged ? escapeHtml(logged) : ''}</span>
    `;
    container.appendChild(el);
  });
}

function persistMeta(parsed) {
  // Prefer live taskState when available
  import('./tasks-main.js').then(({ taskState, renderTasks }) => {
    if (taskState && parsed.meta) {
      taskState.meta = parsed.meta;
      markChanged();
      renderTasks();
    }
  }).catch(() => {});
}

function getLiveState() {
  try {
    return window.__taskStateRef || null;
  } catch {
    return null;
  }
}

// ── Ideas ───────────────────────────────────────────────────────

function renderIdeas(parsed) {
  const list = document.getElementById('ideasList');
  if (!list) return;
  const ideas = parsed?.meta?.ideas || [];
  if (ideas.length === 0) {
    list.innerHTML = '<div class="topics-empty">No ideas yet — park one below</div>';
    return;
  }
  list.innerHTML = ideas.map((idea, index) => `
    <div class="topic-item">
      <span>${escapeHtml(idea)}</span>
      <button type="button" class="topic-add-btn idea-promote" data-index="${index}" title="Promote to Inbox">→ Inbox</button>
      <button type="button" class="topic-delete idea-delete" data-index="${index}">×</button>
    </div>
  `).join('');
  list.querySelectorAll('.idea-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.index, 10);
      parsed.meta.ideas.splice(i, 1);
      persistMeta(parsed);
      renderIdeas(parsed);
    });
  });
  list.querySelectorAll('.idea-promote').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.index, 10);
      const text = parsed.meta.ideas[i];
      if (!text) return;
      import('./tasks-main.js').then(({ taskState, renderTasks }) => {
        if (!taskState.tasks.inbox) {
          if (!taskState.sections.find(s => s.id === 'inbox')) {
            taskState.sections.unshift({ id: 'inbox', name: 'Inbox' });
          }
          taskState.tasks.inbox = [];
        }
        const taskId = computeNextTaskId(taskState);
        const task = {
          id: Date.now() + Math.random(),
          taskId,
          title: text,
          description: '',
          checked: false,
          priority: 'medium',
          type: 'task',
          created: todayStr(),
          updated: null,
          subtasks: [],
          section: 'inbox',
          labels: [],
          links: [],
          blockedBy: [],
          notes: [],
          history: [],
          timeEntries: [],
          decisions: [],
        };
        appendHistory(task, { event: 'created', to: 'inbox', note: 'from idea' });
        taskState.tasks.inbox.unshift(task);
        parsed.meta.ideas.splice(i, 1);
        taskState.meta = parsed.meta;
        markChanged();
        renderTasks();
        renderIdeas(parsed);
      });
    });
  });
}

function addIdea(parsed) {
  const input = document.getElementById('ideaInput');
  const text = input?.value?.trim();
  if (!text) return;
  if (!parsed.meta) parsed.meta = { ideas: [] };
  if (!Array.isArray(parsed.meta.ideas)) parsed.meta.ideas = [];
  parsed.meta.ideas.push(text);
  input.value = '';
  persistMeta(parsed);
  renderIdeas(parsed);
}

// ── Weekly Review ───────────────────────────────────────────────

const REVIEW_CHECKS = [
  { id: 'inbox', label: 'Clear Inbox' },
  { id: 'archive', label: 'Archive Done' },
  { id: 'top5', label: 'Re-rank Top 5' },
  { id: 'overdue', label: 'Triage overdue' },
  { id: 'stale', label: 'Review stale' },
];

function renderReview(parsed) {
  const container = document.getElementById('reviewContent');
  if (!container) return;
  if (!parsed.meta) parsed.meta = {};
  if (!parsed.meta.review) parsed.meta.review = { weeklyDate: null, checks: {} };
  const checks = parsed.meta.review.checks || {};
  container.innerHTML = REVIEW_CHECKS.map(c => `
    <label class="review-check">
      <input type="checkbox" data-check="${c.id}" ${checks[c.id] ? 'checked' : ''}>
      ${escapeHtml(c.label)}
    </label>
  `).join('') + `<div class="td-panel-hint">Week of ${escapeHtml(parsed.meta.review.weeklyDate || todayYmd())}</div>`;
  container.querySelectorAll('input[data-check]').forEach(input => {
    input.addEventListener('change', () => {
      parsed.meta.review.checks[input.dataset.check] = input.checked;
      parsed.meta.review.weeklyDate = todayYmd();
      persistMeta(parsed);
    });
  });
}

// ── Calendar ────────────────────────────────────────────────────

let calendarYear = new Date().getFullYear();
let calendarMonth0 = new Date().getMonth();
let calendarNavBound = false;
let lastOverviewParsed = null;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function bindCalendarNav() {
  if (calendarNavBound) return;
  calendarNavBound = true;
  document.getElementById('calendarPrev')?.addEventListener('click', () => {
    calendarMonth0 -= 1;
    if (calendarMonth0 < 0) { calendarMonth0 = 11; calendarYear -= 1; }
    updateCalendar(lastOverviewParsed);
  });
  document.getElementById('calendarNext')?.addEventListener('click', () => {
    calendarMonth0 += 1;
    if (calendarMonth0 > 11) { calendarMonth0 = 0; calendarYear += 1; }
    updateCalendar(lastOverviewParsed);
  });
}

export function updateCalendar(parsed) {
  bindCalendarNav();
  if (parsed) lastOverviewParsed = parsed;

  const labelEl = document.getElementById('calendarMonthLabel');
  const gridEl = document.getElementById('calendarGrid');
  if (!labelEl || !gridEl) return;

  if (!parsed || !parsed.tasks) {
    labelEl.textContent = '';
    gridEl.innerHTML = '<div class="calendar-empty">Load tasks to see calendar</div>';
    return;
  }

  const monthDate = new Date(calendarYear, calendarMonth0, 1);
  labelEl.textContent = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const byDay = tasksForCalendarMonth(parsed.tasks, calendarYear, calendarMonth0);
  const today = todayYmd();
  const firstDow = monthDate.getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth0 + 1, 0).getDate();

  gridEl.innerHTML = '';
  gridEl.className = 'calendar-grid';

  for (const wd of WEEKDAY_LABELS) {
    const head = document.createElement('div');
    head.className = 'calendar-weekday';
    head.textContent = wd;
    gridEl.appendChild(head);
  }

  for (let i = 0; i < firstDow; i++) {
    const pad = document.createElement('div');
    pad.className = 'calendar-day calendar-day-pad';
    gridEl.appendChild(pad);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const ymd = `${calendarYear}-${String(calendarMonth0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTasks = byDay.get(ymd) || [];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'calendar-day';
    if (ymd === today) cell.classList.add('calendar-day-today');
    if (dayTasks.length > 0) cell.classList.add('calendar-day-has-tasks');

    cell.innerHTML = `
      <span class="calendar-day-num">${day}</span>
      ${dayTasks.length > 0 ? `<span class="calendar-day-dots" aria-label="${dayTasks.length} tasks">${dayTasks.length}</span>` : ''}
    `;
    cell.title = dayTasks.length
      ? dayTasks.map(t => {
          const kind = t.dueDate === ymd ? 'due' : (t.startDate === ymd ? 'start' : '');
          return `${t.taskId}${kind ? ` (${kind})` : ''}: ${t.title}`;
        }).join('\n')
      : ymd;

    if (dayTasks.length > 0) {
      cell.addEventListener('click', () => {
        switchMainTab('tasks');
        applyDueDayFilter(ymd);
      });
    }

    // Drag task onto day → set dueDate
    cell.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/plain') || e.dataTransfer.types.includes('application/x-task-id')) {
        e.preventDefault();
        cell.classList.add('calendar-day-drop');
      }
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('calendar-day-drop'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('calendar-day-drop');
      const taskId = e.dataTransfer.getData('application/x-task-id')
        || e.dataTransfer.getData('text/task-id');
      if (!taskId) return;
      import('./tasks-main.js').then(({ taskState, renderTasks }) => {
        const byId = indexTasksById(taskState.tasks);
        const task = byId.get(taskId);
        if (!task) return;
        task.dueDate = ymd;
        markChanged(task);
        renderTasks();
      });
    });

    gridEl.appendChild(cell);
  }
}

// ── Dependencies ────────────────────────────────────────────────

export function updateDepsGraph(parsed) {
  const container = document.getElementById('depsList');
  if (!container) return;
  if (!parsed || !parsed.tasks) {
    container.innerHTML = '<div class="deps-empty">Load tasks to see dependencies</div>';
    return;
  }

  const tasks = parsed.tasks;
  const edges = dependencyEdges(tasks).filter(e => {
    if (!e.toTask) return false;
    return unresolvedBlockedBy(e.toTask, tasks).includes(e.from);
  });

  if (edges.length === 0) {
    container.innerHTML = '<div class="deps-empty">No unresolved dependencies</div>';
    return;
  }

  container.innerHTML = '';
  edges.forEach(e => {
    const toTitle = e.toTask?.title || e.to;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'deps-edge';
    item.innerHTML = `
      <span class="deps-from">${escapeHtml(e.from)}</span>
      <span class="deps-arrow" aria-hidden="true">&rarr;</span>
      <span class="deps-to">${escapeHtml(e.to)}</span>
      <span class="deps-title">${escapeHtml(toTitle)}</span>
    `;
    item.title = `${e.from} blocks ${e.to}: ${toTitle}`;
    item.addEventListener('click', () => openTaskInTasksTab(e.to));
    container.appendChild(item);
  });
}

/** Refresh all task-driven Overview widgets in one call. */
export function refreshOverviewTaskWidgets(parsed) {
  if (!parsed || !parsed.tasks) return;
  lastOverviewParsed = parsed;
  updateTaskSummary(parsed);
  updateDeadlines(parsed);
  updateFocusAgenda(parsed);
  updateProjects(parsed);
  updateTodayPlan(parsed);
  updateCapacity(parsed);
  updateHabits(parsed);
  updateStaleWaiting(parsed);
  updateDoneJournal(parsed);
  updateCalendar(parsed);
  updateDepsGraph(parsed);
  renderIdeas(parsed);
  renderReview(parsed);
}

// Upcoming Deadlines Widget — prefers dueDate; falls back to text scrape
export function updateDeadlines(parsed) {
  if (!parsed || !parsed.tasks) return;
  const container = document.getElementById('deadlinesList');
  const deadlines = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const datePatterns = [
    { regex: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/gi, parse: matchToDate },
    { regex: /\b(\d{1,2})\.(\d{1,2})\b/g, parse: dotDateToDate },
    { regex: /\b(April|January|February|March|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/gi, parse: matchToDate }
  ];

  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

  function matchToDate(match) {
    const monthStr = match[1].toLowerCase().slice(0, 3);
    const day = parseInt(match[2]);
    const month = months[monthStr];
    if (month === undefined || day < 1 || day > 31) return null;
    const year = now.getMonth() > month + 1 ? now.getFullYear() + 1 : now.getFullYear();
    return new Date(year, month, day);
  }

  function dotDateToDate(match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]) - 1;
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    const year = now.getMonth() > month + 1 ? now.getFullYear() + 1 : now.getFullYear();
    return new Date(year, month, day);
  }

  function extractDates(text, taskTitle) {
    for (const pattern of datePatterns) {
      let match;
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      while ((match = regex.exec(text)) !== null) {
        const date = pattern.parse(match);
        if (date && date >= now) {
          const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
          deadlines.push({ date, diffDays, task: taskTitle, text: match[0] });
        }
      }
    }
  }

  ['in-progress', 'todo'].forEach(sectionId => {
    (parsed.tasks[sectionId] || []).forEach(task => {
      if (task.checked) return;
      if (task.dueDate) {
        const date = parseYmd(task.dueDate);
        if (!date) return;
        const diffDays = daysUntilDue(task.dueDate, now);
        if (diffDays == null) return;
        deadlines.push({
          date,
          diffDays,
          task: task.title,
          text: task.dueDate,
          fromDueDate: true,
        });
        return;
      }
      const fullText = `${task.title} ${task.description || ''} ${(task.subtasks || []).map(s => s.text).join(' ')}`;
      extractDates(fullText, task.title);
    });
  });

  const seen = new Set();
  const unique = deadlines.filter(d => {
    const key = `${d.date.getTime()}-${d.task}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => a.date - b.date);

  const items = unique.slice(0, 8);
  if (items.length === 0) {
    container.innerHTML = '<div class="deadline-empty">No upcoming deadlines found</div>';
    return;
  }

  container.innerHTML = '';
  items.forEach(d => {
    const dateStr = d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const urgency = d.fromDueDate
      ? dueUrgency(d.text, now)
      : (d.diffDays === 0 ? 'today' : d.diffDays <= 3 ? 'soon' : 'later');
    const urgencyClass = urgency === 'overdue' || urgency === 'today'
      ? 'deadline-today'
      : urgency === 'soon' ? 'deadline-soon' : '';
    const label = d.diffDays < 0
      ? `${Math.abs(d.diffDays)}d overdue`
      : d.diffDays === 0 ? 'Today'
        : d.diffDays === 1 ? 'Tomorrow'
          : `in ${d.diffDays}d`;

    const item = document.createElement('div');
    item.className = 'deadline-item' + (urgencyClass ? ' ' + urgencyClass : '');
    item.title = d.task;
    item.innerHTML = `
      <div class="deadline-date">${dateStr}</div>
      <div class="deadline-task">${d.task}</div>
      <div class="deadline-badge">${label}</div>
    `;
    container.appendChild(item);
  });
}

export function initOverview() {
  document.getElementById('ideaAddBtn')?.addEventListener('click', () => {
    if (lastOverviewParsed) addIdea(lastOverviewParsed);
  });
  document.getElementById('ideaInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && lastOverviewParsed) addIdea(lastOverviewParsed);
  });

  document.querySelectorAll('.summary-stat').forEach(cell => {
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    if (!cell.getAttribute('aria-label')) {
      cell.setAttribute('aria-label', 'Task stat');
    }
    const go = () => {
      const filter = cell.dataset.filter;
      if (!filter) return;
      switchMainTab('tasks');
      applyDeepLinkFilter(filter);
    };
    cell.addEventListener('click', go);
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  updateSprintInfo();

  import('./overview-layout.js').then(m => m.initOverviewLayout()).catch(() => {});

  setInterval(updateSprintInfo, 1000 * 60 * 60);
}
