// task-filters.js — Faceted filter pills for the Tasks tab (AND with text search).

import {
  collectLabels,
  collectAssignees,
  collectProjects,
  dueUrgency,
  isEffectivelyBlocked,
  isStale,
  isSnoozed,
  isCorporateUiHidden,
  taskMatchesFacets,
} from './task-fields.js';
import { renderSavedViewsBar } from './saved-views.js';
import { normalizeTicketTypes, escapeHtml } from './ticket-types.js';

let getState = null;
let getRenderTasks = null;

/** Active facet state. Sets are OR within a facet; facets AND together. */
export const facetState = {
  priorities: new Set(),
  types: new Set(),
  due: new Set(),
  labels: new Set(),
  assignees: new Set(),
  projects: new Set(),
  energy: new Set(),
  sections: new Set(),
  hasParent: null, // null | true
  blocked: null,   // null | true
  stale: null,     // null | true
  snoozed: null,   // null | true
  staleDays: 14,
  dueExact: null,  // null | YYYY-MM-DD
};

export function setFilterCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

export function hasActiveFacets() {
  return facetState.priorities.size > 0
    || facetState.types.size > 0
    || facetState.due.size > 0
    || facetState.labels.size > 0
    || facetState.assignees.size > 0
    || facetState.projects.size > 0
    || facetState.energy.size > 0
    || facetState.sections.size > 0
    || facetState.hasParent != null
    || facetState.blocked != null
    || facetState.stale != null
    || facetState.snoozed != null
    || facetState.dueExact != null;
}

export function clearFacets() {
  facetState.priorities.clear();
  facetState.types.clear();
  facetState.due.clear();
  facetState.labels.clear();
  facetState.assignees.clear();
  facetState.projects.clear();
  facetState.energy.clear();
  facetState.sections.clear();
  facetState.hasParent = null;
  facetState.blocked = null;
  facetState.stale = null;
  facetState.snoozed = null;
  facetState.dueExact = null;
}

/**
 * Filter tasks tab to a calendar day (YYYY-MM-DD).
 * Matches tasks whose dueDate OR startDate falls on that day
 * (calendar counts both; filter must too).
 * @param {string} ymd
 */
export function applyDueDayFilter(ymd) {
  clearFacets();
  facetState.dueExact = ymd;
  renderFilterBar();
  getRenderTasks && getRenderTasks()();
}

/**
 * Apply a named deep-link filter from Overview stats.
 * @param {'in-progress'|'todo'|'done'|'blocked'} key
 */
export function applyDeepLinkFilter(key) {
  clearFacets();
  if (key === 'blocked') {
    facetState.blocked = true;
  } else if (key === 'in-progress' || key === 'todo' || key === 'done') {
    facetState.sections.add(key);
  }
  renderFilterBar();
  getRenderTasks && getRenderTasks()();
}

export function taskPassesFacets(task) {
  if (!hasActiveFacets()) return true;
  const state = getState() || {};
  return taskMatchesFacets(task, facetState, state.tasks);
}

function toggleInSet(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function pill(label, active, onClick, count) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gm-filter-pill' + (active ? ' active' : '');
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.innerHTML = escapeHtml(label)
    + (count != null ? ` <span class="count">${count}</span>` : '');
  btn.addEventListener('click', onClick);
  return btn;
}

function countMatching(predicate) {
  const state = getState() || {};
  let n = 0;
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (predicate(t)) n++;
    }
  }
  return n;
}

export function renderFilterBar() {
  const bar = document.getElementById('tasksFilters');
  if (!bar || !getState) return;

  const state = getState();
  const types = normalizeTicketTypes(state.ticketTypes);
  const labels = collectLabels(state.tasks);
  const assignees = collectAssignees(state.tasks);
  const projects = collectProjects(state.tasks, state.meta?.projects);
  facetState.staleDays = (window.dashboardConfig && window.dashboardConfig.staleDays) || 14;

  bar.innerHTML = '';
  bar.style.display = 'flex';

  const clearBtn = pill('All', !hasActiveFacets(), () => {
    clearFacets();
    renderFilterBar();
    getRenderTasks && getRenderTasks()();
  }, null);
  bar.appendChild(clearBtn);

  // Priority
  for (const p of ['high', 'medium', 'low']) {
    const active = facetState.priorities.has(p);
    bar.appendChild(pill(p[0].toUpperCase() + p.slice(1), active, () => {
      toggleInSet(facetState.priorities, p);
      renderFilterBar();
      getRenderTasks && getRenderTasks()();
    }, countMatching(t => (t.priority || 'medium') === p)));
  }

  // Type
  for (const tt of types) {
    const active = facetState.types.has(tt.id);
    bar.appendChild(pill(tt.name, active, () => {
      toggleInSet(facetState.types, tt.id);
      renderFilterBar();
      getRenderTasks && getRenderTasks()();
    }, countMatching(t => (t.type || 'task') === tt.id)));
  }

  // Exact calendar day (due or start)
  if (facetState.dueExact) {
    const ymd = facetState.dueExact;
    const label = `On ${ymd}`;
    bar.appendChild(pill(label, true, () => {
      facetState.dueExact = null;
      renderFilterBar();
      getRenderTasks && getRenderTasks()();
    }, countMatching(t => t.dueDate === ymd || t.startDate === ymd)));
  }

  // Due
  const dueOpts = [
    { id: 'overdue', label: 'Overdue' },
    { id: 'today', label: 'Due today' },
    { id: 'soon', label: 'Due soon' },
    { id: 'has-due', label: 'Has due' },
  ];
  for (const d of dueOpts) {
    const active = facetState.due.has(d.id);
    bar.appendChild(pill(d.label, active, () => {
      toggleInSet(facetState.due, d.id);
      renderFilterBar();
      getRenderTasks && getRenderTasks()();
    }, countMatching(t => {
      if (d.id === 'has-due') return !!t.dueDate;
      const u = dueUrgency(t.dueDate);
      if (d.id === 'soon') return u === 'soon' || u === 'today';
      return u === d.id;
    })));
  }

  // Parent
  bar.appendChild(pill('Has parent', facetState.hasParent === true, () => {
    facetState.hasParent = facetState.hasParent === true ? null : true;
    renderFilterBar();
    getRenderTasks && getRenderTasks()();
  }, countMatching(t => !!t.parentId)));

  // Blocked
  bar.appendChild(pill('Blocked', facetState.blocked === true, () => {
    facetState.blocked = facetState.blocked === true ? null : true;
    renderFilterBar();
    getRenderTasks && getRenderTasks()();
  }, countMatching(t => isEffectivelyBlocked(t, state.tasks))));

  bar.appendChild(pill('Stale', facetState.stale === true, () => {
    facetState.stale = facetState.stale === true ? null : true;
    renderFilterBar();
    getRenderTasks && getRenderTasks()();
  }, countMatching(t => isStale(t, facetState.staleDays))));

  bar.appendChild(pill('Snoozed', facetState.snoozed === true, () => {
    facetState.snoozed = facetState.snoozed === true ? null : true;
    renderFilterBar();
    getRenderTasks && getRenderTasks()();
  }, countMatching(t => isSnoozed(t))));

  // Section
  for (const sec of [
    { id: 'inbox', label: 'Inbox' },
    { id: 'todo', label: 'Todo' },
    { id: 'in-progress', label: 'In Progress' },
    { id: 'done', label: 'Done' },
  ]) {
    const active = facetState.sections.has(sec.id);
    bar.appendChild(pill(sec.label, active, () => {
      toggleInSet(facetState.sections, sec.id);
      renderFilterBar();
      getRenderTasks && getRenderTasks()();
    }, countMatching(t => t.section === sec.id)));
  }

  // Energy
  for (const e of ['deep', 'shallow', 'errands', 'creative']) {
    const active = facetState.energy.has(e);
    bar.appendChild(pill(e, active, () => {
      toggleInSet(facetState.energy, e);
      renderFilterBar();
      getRenderTasks && getRenderTasks()();
    }, countMatching(t => t.energy === e)));
  }

  // Labels
  for (const lab of labels) {
    const active = facetState.labels.has(lab);
    bar.appendChild(pill(lab, active, () => {
      toggleInSet(facetState.labels, lab);
      renderFilterBar();
      getRenderTasks && getRenderTasks()();
    }, countMatching(t => (t.labels || []).includes(lab))));
  }

  // Projects
  for (const pid of projects) {
    const active = facetState.projects.has(pid);
    bar.appendChild(pill(pid, active, () => {
      toggleInSet(facetState.projects, pid);
      renderFilterBar();
      getRenderTasks && getRenderTasks()();
    }, countMatching(t => t.project === pid)));
  }

  // Assignees (corporate — hidden when Hide corporate is on)
  if (!isCorporateUiHidden()) {
    for (const who of assignees) {
      const active = facetState.assignees.has(who);
      bar.appendChild(pill('@' + who, active, () => {
        toggleInSet(facetState.assignees, who);
        renderFilterBar();
        getRenderTasks && getRenderTasks()();
      }, countMatching(t => t.assignee === who)));
    }
  }

  renderSavedViewsBar();
}

export function initTaskFilters() {
  renderFilterBar();
}
