// search-page.js — All-tickets search (Jira-style) with text query + facet filters

import { taskState } from './tasks-main.js';
import { facetState, hasActiveFacets, taskPassesFacets, renderFilterBar } from './task-filters.js';
import { openTaskDetail } from './task-detail.js';
import {
  escapeHtml,
  getTicketType,
  normalizeTicketTypes,
} from './ticket-types.js';
import {
  formatDueLabel,
  formatEstimate,
  isEffectivelyBlocked,
  isTaskDone,
} from './task-fields.js';
import { normalizeModel } from '../../shared/model.js';
import { readCustomFields, readCustomValue } from './custom-fields.js';
import { scheduleFilterUrlSync } from './url-filters.js';

const STATE_KEY = 'dashboard.searchPageState';

let searchInput = null;
let resultsEl = null;
let helpEl = null;
let query = '';

/**
 * Supported query syntax (simple JQL-like):
 * - Free text matches title, description, task id, labels (space-separated = AND)
 * - id:T42 or key:T42 — exact task id
 * - label:auth — label contains
 * - project:my-app — project slug
 * - type:bug — ticket type id
 * - status:todo — section id
 */

export function getSearchPageQuery() {
  return query;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.query === 'string') query = s.query;
  } catch { /* ignore */ }
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ query }));
  } catch { /* ignore */ }
}

function flatTasks() {
  const out = [];
  for (const list of Object.values(taskState.tasks || {})) {
    for (const t of list || []) out.push(t);
  }
  return out;
}

function sectionName(task) {
  const sec = (taskState.sections || []).find(s => s.id === task.section);
  return sec?.name || task.section || '';
}

function parseStructuredToken(token) {
  const m = token.match(/^([a-z]+):(.+)$/i);
  if (!m) return null;
  return { key: m[1].toLowerCase(), value: m[2].trim().toLowerCase() };
}

function taskMatchesQuery(task, q) {
  if (!q) return true;
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  for (const token of tokens) {
    const structured = parseStructuredToken(token);
    if (structured) {
      const { key, value } = structured;
      if (key === 'id' || key === 'key') {
        if ((task.taskId || '').toLowerCase() !== value) return false;
        continue;
      }
      if (key === 'label') {
        const labels = (task.labels || []).map(l => l.toLowerCase());
        if (!labels.some(l => l.includes(value))) return false;
        continue;
      }
      if (key === 'project') {
        if ((task.project || '').toLowerCase() !== value) return false;
        continue;
      }
      if (key === 'type') {
        if ((task.type || '').toLowerCase() !== value) return false;
        continue;
      }
      if (key === 'status' || key === 'section') {
        if ((task.section || '').toLowerCase() !== value) return false;
        continue;
      }
      if (key === 'model') {
        if (!(normalizeModel(task.model) || '').toLowerCase().includes(value)) return false;
        continue;
      }
      // unknown structured token — fall through to text match
    }

    const hay = [
      task.title,
      task.description,
      task.taskId,
      ...(task.labels || []),
      task.project,
      task.assignee,
      normalizeModel(task.model),
    ].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(token.toLowerCase())) return false;
  }
  return true;
}

function renderResults() {
  if (!resultsEl) return;
  const types = normalizeTicketTypes(taskState.ticketTypes);
  const tasks = flatTasks().filter(t => taskPassesFacets(t) && taskMatchesQuery(t, query));

  if (!tasks.length) {
    resultsEl.innerHTML = '<div class="search-page-empty">No tickets match your search.</div>';
    return;
  }

  const customCols = readCustomFields();
  const head = `
    <div class="search-results-head" aria-hidden="true">
      <span class="search-col search-col-id">ID</span>
      <span class="search-col search-col-title">Title</span>
      <span class="search-col">Status</span>
      <span class="search-col">Type</span>
      <span class="search-col">Due</span>
      <span class="search-col">Model</span>
      ${customCols.map(cf => `<span class="search-col">${escapeHtml(cf.label)}</span>`).join('')}
    </div>
  `;

  const rows = tasks.map(task => {
    const tt = getTicketType(types, task.type);
    const done = isTaskDone(task);
    const blocked = isEffectivelyBlocked(task, taskState.tasks);
    const due = task.dueDate ? formatDueLabel(task.dueDate) : '';
    const model = normalizeModel(task.model) || '';
    const customCells = customCols.map(cf => {
      const v = readCustomValue(task, cf.id);
      return `<span class="search-col" title="${escapeHtml(cf.label)}">${escapeHtml(v)}</span>`;
    }).join('');
    return `
      <button type="button" class="search-results-row${done ? ' search-row-done' : ''}${blocked ? ' search-row-blocked' : ''}"
        data-task-id="${escapeHtml(task.taskId || '')}">
        <span class="search-col search-col-id">${escapeHtml(task.taskId || '—')}</span>
        <span class="search-col search-col-title">${escapeHtml(task.title || '')}</span>
        <span class="search-col">${escapeHtml(sectionName(task))}</span>
        <span class="search-col">${escapeHtml(tt.name)}</span>
        <span class="search-col">${escapeHtml(due)}</span>
        <span class="search-col">${escapeHtml(model)}</span>
        ${customCells}
      </button>
    `;
  }).join('');

  resultsEl.innerHTML = head + rows;
  resultsEl.querySelectorAll('.search-results-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.taskId;
      const task = flatTasks().find(t => t.taskId === id);
      if (task) openTaskDetail(task);
    });
  });
}

export function renderSearchPage() {
  renderFilterBar('searchFilters');
  renderResults();
}

export function initSearchPage() {
  loadState();
  searchInput = document.getElementById('searchPageInput');
  resultsEl = document.getElementById('searchPageResults');
  helpEl = document.getElementById('searchPageHelp');

  if (searchInput) {
    searchInput.value = query;
    searchInput.addEventListener('input', () => {
      query = searchInput.value;
      saveState();
      renderResults();
      scheduleFilterUrlSync();
    });
  }

  document.getElementById('searchPageClear')?.addEventListener('click', () => {
    query = '';
    if (searchInput) searchInput.value = '';
    saveState();
    renderResults();
    searchInput?.focus();
  });
}

export function onSearchTabShow() {
  if (searchInput && searchInput.value !== query) searchInput.value = query;
  renderSearchPage();
}

export function refreshSearchPageIfActive() {
  if (document.getElementById('searchPanel')?.classList.contains('active')) {
    renderResults();
  }
}
