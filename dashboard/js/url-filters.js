// url-filters.js — Persist task search + facet filters in URL query params.

import { facetState, hasActiveFacets, clearFacets, renderFilterBar } from './task-filters.js';
import { getSearchTerm, setSearchTerm, clearSearch, reapplySearch } from './search.js';
import { isRoutingReady } from './routing.js';

let applyingFromUrl = false;
let syncScheduled = false;

const SET_KEYS = [
  ['priority', 'priorities'],
  ['type', 'types'],
  ['status', 'sections'],
  ['due', 'due'],
  ['label', 'labels'],
  ['project', 'projects'],
  ['energy', 'energy'],
  ['assignee', 'assignees'],
];

function readParams() {
  return new URLSearchParams(window.location.search);
}

function setFromCsv(set, value) {
  set.clear();
  if (!value) return;
  for (const part of String(value).split(',')) {
    const v = part.trim();
    if (v) set.add(v);
  }
}

/** Apply URL query params to facet state + search (tasks tab). */
export function applyFiltersFromUrl() {
  applyingFromUrl = true;
  try {
    const params = readParams();
    clearFacets();

    for (const [param, key] of SET_KEYS) {
      setFromCsv(facetState[key], params.get(param));
    }

    const parent = params.get('parent');
    facetState.hasParent = parent === '1' || parent === 'true' ? true : null;

    const blocked = params.get('blocked');
    facetState.blocked = blocked === '1' || blocked === 'true' ? true : null;

    const stale = params.get('stale');
    facetState.stale = stale === '1' || stale === 'true' ? true : null;

    const snoozed = params.get('snoozed');
    facetState.snoozed = snoozed === '1' || snoozed === 'true' ? true : null;

    const dueOn = params.get('dueOn');
    facetState.dueExact = dueOn && /^\d{4}-\d{2}-\d{2}$/.test(dueOn) ? dueOn : null;

    const q = params.get('q');
    if (q) setSearchTerm(q, { skipUrl: true });
    else clearSearch({ skipUrl: true });

    renderFilterBar();
    reapplySearch();
  } finally {
    applyingFromUrl = false;
  }
}

/** Build query string for active filters/search (empty string when none). */
export function buildFilterQueryString() {
  const params = new URLSearchParams();
  const q = getSearchTerm();
  if (q) params.set('q', q);

  for (const [param, key] of SET_KEYS) {
    const set = facetState[key];
    if (set?.size) params.set(param, [...set].join(','));
  }

  if (facetState.hasParent === true) params.set('parent', '1');
  if (facetState.blocked === true) params.set('blocked', '1');
  if (facetState.stale === true) params.set('stale', '1');
  if (facetState.snoozed === true) params.set('snoozed', '1');
  if (facetState.dueExact) params.set('dueOn', facetState.dueExact);

  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Push filter/search state into the URL without changing pathname. */
export function syncFilterUrl() {
  if (!isRoutingReady() || applyingFromUrl) return;

  const qs = buildFilterQueryString();
  const path = window.location.pathname;
  const next = path + qs;
  if (window.location.pathname + window.location.search === next) return;

  const state = window.history.state || {};
  window.history.replaceState(state, '', next);
}

export function scheduleFilterUrlSync() {
  if (applyingFromUrl) return;
  if (syncScheduled) return;
  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    syncFilterUrl();
  });
}

/** Clear facets and search together (used by Esc / Clear all). */
export function clearFiltersAndSearch() {
  clearFacets();
  clearSearch({ skipUrl: true });
  renderFilterBar();
  scheduleFilterUrlSync();
}

export function hasUrlFilterState() {
  const params = readParams();
  if (params.get('q')) return true;
  for (const [param] of SET_KEYS) {
    if (params.get(param)) return true;
  }
  return ['parent', 'blocked', 'stale', 'snoozed', 'dueOn'].some(k => params.get(k));
}

export function filtersOrSearchActive() {
  return hasActiveFacets() || !!getSearchTerm();
}
