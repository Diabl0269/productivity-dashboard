// saved-views.js — Persist named facet filter presets in localStorage.

import {
  facetState,
  clearFacets,
  renderFilterBar,
} from './task-filters.js';

const STORAGE_KEY = 'dashboard.savedViews';

let getRenderTasks = null;

export function loadSavedViews() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSavedViews(views) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

export function serializeFacetState(state = facetState) {
  return {
    priorities: [...state.priorities],
    types: [...state.types],
    due: [...state.due],
    labels: [...state.labels],
    assignees: [...state.assignees],
    sections: [...state.sections],
    hasParent: state.hasParent,
    blocked: state.blocked,
    dueExact: state.dueExact ?? null,
  };
}

export function applySerializedFacets(obj) {
  clearFacets();
  if (!obj) return;
  for (const p of (obj.priorities || [])) facetState.priorities.add(p);
  for (const t of (obj.types || [])) facetState.types.add(t);
  for (const d of (obj.due || [])) facetState.due.add(d);
  for (const l of (obj.labels || [])) facetState.labels.add(l);
  for (const a of (obj.assignees || [])) facetState.assignees.add(a);
  for (const s of (obj.sections || [])) facetState.sections.add(s);
  facetState.hasParent = obj.hasParent ?? null;
  facetState.blocked = obj.blocked ?? null;
  facetState.dueExact = obj.dueExact ?? null;
}

function nextViewId() {
  return 'sv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function applyView(view) {
  applySerializedFacets(view.facets);
  renderFilterBar();
  getRenderTasks && getRenderTasks()();
  renderSavedViewsBar(view.id);
}

function deleteView(id) {
  const views = loadSavedViews().filter(v => v.id !== id);
  saveSavedViews(views);
  renderSavedViewsBar();
}

export function renderSavedViewsBar(activeId = null) {
  const bar = document.getElementById('savedViewsBar');
  if (!bar) return;

  const views = loadSavedViews();
  bar.innerHTML = '';
  bar.style.display = 'flex';

  for (const view of views) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'saved-view-pill' + (view.id === activeId ? ' active' : '');
    pill.setAttribute('aria-pressed', view.id === activeId ? 'true' : 'false');
    pill.dataset.viewId = view.id;
    pill.innerHTML = `<span class="saved-view-name">${escapeViewName(view.name)}</span>`
      + `<span class="saved-view-delete" aria-label="Delete view" title="Delete (middle-click)">&times;</span>`;
    pill.addEventListener('click', (e) => {
      if (e.target.closest('.saved-view-delete')) return;
      applyView(view);
    });
    pill.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        deleteView(view.id);
      }
    });
    pill.querySelector('.saved-view-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteView(view.id);
    });
    bar.appendChild(pill);
  }

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'saved-view-save-btn';
  saveBtn.textContent = 'Save view';
  saveBtn.addEventListener('click', () => {
    const name = window.prompt('Name this filter view:');
    if (!name || !name.trim()) return;
    const views = loadSavedViews();
    const view = {
      id: nextViewId(),
      name: name.trim(),
      facets: serializeFacetState(),
    };
    views.push(view);
    saveSavedViews(views);
    renderSavedViewsBar(view.id);
  });
  bar.appendChild(saveBtn);
}

function escapeViewName(name) {
  const div = document.createElement('span');
  div.textContent = name;
  return div.innerHTML;
}

export function initSavedViews({ renderFn } = {}) {
  getRenderTasks = renderFn || null;
  renderSavedViewsBar();
}
