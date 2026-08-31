// search.js - Unified search/filter for tasks and memory tabs

import { activeMainTab } from './state.js';
import { renderMemoryContent, renderMemorySearchResults } from './memory-renderer.js';
import { hasActiveFacets, renderFilterBar } from './task-filters.js';

let searchInput, clearBtn, container, shortcutHint;
let currentTerm = '';
let includeArchiveNotes = false;

export function initSearch() {
  container = document.getElementById('unifiedSearch');
  searchInput = document.getElementById('unifiedSearchInput');
  clearBtn = document.getElementById('unifiedSearchClear');
  shortcutHint = container.querySelector('.unified-search-shortcut');
  const archiveToggle = document.getElementById('searchIncludeArchive');

  searchInput.addEventListener('input', () => {
    currentTerm = searchInput.value.trim().toLowerCase();
    clearBtn.style.display = currentTerm ? '' : 'none';
    container.classList.toggle('has-value', !!currentTerm);
    applyFilter();
  });

  archiveToggle?.addEventListener('change', () => {
    includeArchiveNotes = !!archiveToggle.checked;
    applyFilter();
  });

  clearBtn.addEventListener('click', () => {
    clearSearch();
    searchInput.focus();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      if (activeMainTab === 'tasks' || activeMainTab === 'memory' || activeMainTab === 'global-memory') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    }
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      clearSearch();
      searchInput.blur();
    }
  });
}

export function onTabSwitch(tab) {
  if (!container) return;
  const filters = document.getElementById('tasksFilters');
  const savedViews = document.getElementById('savedViewsBar');
  const templates = document.getElementById('taskTemplatesBar');
  if (tab === 'overview' || tab === 'settings' || tab === 'projects') {
    container.style.display = 'none';
    if (filters) filters.style.display = 'none';
    if (savedViews) savedViews.style.display = 'none';
    if (templates) templates.style.display = 'none';
    clearSearch();
  } else {
    container.style.display = 'flex';
    if (tab === 'tasks') {
      searchInput.placeholder = 'Search tasks...';
      if (filters) {
        filters.style.display = 'flex';
        renderFilterBar();
      }
      if (savedViews) savedViews.style.display = 'flex';
      if (templates) templates.style.display = 'flex';
    } else {
      if (filters) filters.style.display = 'none';
      if (savedViews) savedViews.style.display = 'none';
      if (templates) templates.style.display = 'none';
      if (tab === 'memory') searchInput.placeholder = 'Search all memory...';
      else searchInput.placeholder = 'Search global memory...';
    }
    clearSearch();
  }
}

export function reapplySearch() {
  if (currentTerm || hasActiveFacets()) applyFilter();
  else {
    updateColumnCounts('');
    updateSectionCounts('');
  }
}

/** Programmatically set the tasks search term (e.g. from Overview widgets). */
export function setTaskSearch(term) {
  if (!searchInput) return;
  currentTerm = String(term || '').trim().toLowerCase();
  searchInput.value = term || '';
  if (clearBtn) clearBtn.style.display = currentTerm ? '' : 'none';
  if (container) container.classList.toggle('has-value', !!currentTerm);
  if (activeMainTab === 'tasks') filterTasks(currentTerm);
}

function clearSearch() {
  currentTerm = '';
  if (searchInput) searchInput.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  if (container) container.classList.remove('has-value');
  showAllTasks();
  showAllMemory();
  showAllGlobalMemory();
}

function applyFilter() {
  if (activeMainTab === 'tasks') {
    filterTasks(currentTerm);
  } else if (activeMainTab === 'memory') {
    filterMemory(currentTerm);
  } else if (activeMainTab === 'global-memory') {
    filterGlobalMemory(currentTerm);
  }
}

// ===== TASK FILTERING =====
// Facets are applied at render time; text search further hides cards.

function filterTasks(term) {
  document.querySelectorAll('#board .column').forEach(col => {
    const isArchive = col.classList.contains('archive-column');
    if (isArchive && !includeArchiveNotes && !term) {
      // leave archive collapsed/hidden behavior alone when not searching
    }
    col.querySelectorAll('.task-card').forEach(card => {
      if (isArchive && !includeArchiveNotes && term) {
        // still allow matching when toggle on; when off skip archive unless toggle
        if (!includeArchiveNotes) {
          card.style.display = 'none';
          return;
        }
      }
      const noteText = includeArchiveNotes
        ? (card.querySelector('.card-note')?.textContent || '')
        : '';
      const text = (card.textContent + ' ' + noteText).toLowerCase();
      const inArchive = isArchive;
      if (inArchive && !includeArchiveNotes) {
        card.style.display = 'none';
        return;
      }
      card.style.display = (!term || text.includes(term)) ? '' : 'none';
    });
  });
  updateColumnCounts(term);

  document.querySelectorAll('#listView .list-section').forEach(section => {
    const isArchive = section.classList.contains('archive-section');
    section.querySelectorAll('.list-item').forEach(item => {
      if (isArchive && !includeArchiveNotes) {
        item.style.display = 'none';
        return;
      }
      const text = item.textContent.toLowerCase();
      item.style.display = (!term || text.includes(term)) ? '' : 'none';
    });
  });
  updateSectionCounts(term);
}

function updateColumnCounts(term) {
  document.querySelectorAll('#board .column').forEach(col => {
    const countEl = col.querySelector('.count');
    if (!countEl) return;
    const total = col.querySelectorAll('.task-card').length;
    if (term) {
      const visible = col.querySelectorAll('.task-card:not([style*="display: none"])').length;
      countEl.textContent = `${visible}/${total}`;
    } else {
      countEl.textContent = total;
    }
  });
}

function updateSectionCounts(term) {
  document.querySelectorAll('#listView .list-section').forEach(section => {
    const countEl = section.querySelector('.count');
    if (!countEl) return;
    const total = section.querySelectorAll('.list-item').length;
    if (term) {
      const visible = section.querySelectorAll('.list-item:not([style*="display: none"])').length;
      countEl.textContent = `${visible}/${total}`;
    } else {
      countEl.textContent = total;
    }
  });
}

function showAllTasks() {
  document.querySelectorAll('#board .task-card, #listView .list-item').forEach(el => {
    el.style.display = '';
  });
  updateColumnCounts('');
  updateSectionCounts('');
}

// ===== MEMORY FILTERING =====

function filterMemory(term) {
  if (term) {
    renderMemorySearchResults(term);
  } else {
    renderMemoryContent();
  }
}

function showAllMemory() {
  if (activeMainTab === 'memory') {
    renderMemoryContent();
  }
}

// ===== GLOBAL MEMORY FILTERING =====

function filterGlobalMemory(term) {
  document.querySelectorAll('#globalMemoryContainer .gm-card').forEach(card => {
    const searchText = card.dataset.search || card.textContent.toLowerCase();
    card.style.display = (!term || searchText.includes(term)) ? '' : 'none';
  });
  document.querySelectorAll('#globalMemoryContainer .gm-project-group').forEach(group => {
    const visibleCards = group.querySelectorAll('.gm-card:not([style*="display: none"])').length;
    group.style.display = visibleCards > 0 ? '' : 'none';
  });
}

function showAllGlobalMemory() {
  document.querySelectorAll('#globalMemoryContainer .gm-card, #globalMemoryContainer .gm-project-group').forEach(el => {
    el.style.display = '';
  });
}
