// search.js - Unified search/filter for tasks and memory tabs

import { activeMainTab } from './state.js';
import { renderMemoryContent, renderMemorySearchResults, isViewingGlobalMemory } from './memory-renderer.js';
import { hasActiveFacets, renderFilterBar } from './task-filters.js';
import { scheduleFilterUrlSync, isUrlFilterBootstrapping } from './url-filters.js';

let searchInput, clearBtn, container, shortcutHint;
let currentTerm = '';
let includeArchiveNotes = false;

export function getSearchTerm() {
  return currentTerm;
}

/**
 * Set the search box + filter tasks (optionally skip URL sync).
 * @param {string} term
 * @param {{ skipUrl?: boolean }} [opts]
 */
export function setSearchTerm(term, opts = {}) {
  if (!searchInput) {
    currentTerm = String(term || '').trim().toLowerCase();
    return;
  }
  currentTerm = String(term || '').trim().toLowerCase();
  searchInput.value = term || '';
  if (clearBtn) clearBtn.style.display = currentTerm ? '' : 'none';
  if (container) container.classList.toggle('has-value', !!currentTerm);
  if (activeMainTab === 'tasks') filterTasks(currentTerm);
  if (activeMainTab === 'projects') filterProjects(currentTerm);
  if (!opts.skipUrl) scheduleFilterUrlSync();
}

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
    scheduleFilterUrlSync();
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
      if (activeMainTab === 'tasks' || activeMainTab === 'projects' || activeMainTab === 'memory') {
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
  const searchFilters = document.getElementById('searchFilters');
  const archiveToggle = document.getElementById('searchIncludeArchive');
  const archiveLabel = archiveToggle?.closest('.search-archive-toggle');
  if (archiveLabel) archiveLabel.style.display = tab === 'tasks' ? '' : 'none';

  if (tab === 'search') {
    container.style.display = 'none';
    if (filters) filters.style.display = 'none';
    if (savedViews) savedViews.style.display = 'none';
    if (templates) templates.style.display = 'none';
    if (searchFilters) searchFilters.style.display = 'flex';
    clearSearch({ skipUrl: false });
  } else if (tab === 'tasks' || tab === 'projects' || tab === 'memory') {
    container.style.display = 'flex';
    if (searchFilters) searchFilters.style.display = 'none';
    if (tab === 'tasks') {
      searchInput.placeholder = 'Search tasks...';
      if (filters) {
        filters.style.display = 'flex';
        renderFilterBar();
      }
      if (savedViews) savedViews.style.display = 'flex';
      if (templates) templates.style.display = 'flex';
      if (hasActiveFacets() || currentTerm) {
        import('./tasks-main.js').then(m => m.renderFilteredViews()).catch(() => {});
      }
    } else if (tab === 'projects') {
      searchInput.placeholder = 'Search projects...';
      if (filters) filters.style.display = 'none';
      if (savedViews) savedViews.style.display = 'none';
      if (templates) templates.style.display = 'none';
      if (currentTerm) filterProjects(currentTerm);
    } else {
      if (filters) filters.style.display = 'none';
      if (savedViews) savedViews.style.display = 'none';
      if (templates) templates.style.display = 'none';
      searchInput.placeholder = isViewingGlobalMemory()
        ? 'Search global memory...'
        : 'Search all memory...';
      clearSearch();
    }
  } else {
    // overview, settings, and any externally-configured tab (config.json
    // externalTabs) — no search UI applies.
    container.style.display = 'none';
    if (filters) filters.style.display = 'none';
    if (searchFilters) searchFilters.style.display = 'none';
    if (savedViews) savedViews.style.display = 'none';
    if (templates) templates.style.display = 'none';
    if (!isUrlFilterBootstrapping()) clearSearch({ skipUrl: false });
  }
}

export function reapplySearch() {
  const shouldFilterTasks = activeMainTab === 'tasks' && (currentTerm || hasActiveFacets());
  const shouldFilterProjects = activeMainTab === 'projects' && currentTerm;
  const shouldFilterMemory = activeMainTab === 'memory' && currentTerm && !isViewingGlobalMemory();
  const shouldFilterGlobalMemory = activeMainTab === 'memory' && currentTerm && isViewingGlobalMemory();

  if (shouldFilterTasks || shouldFilterProjects || shouldFilterMemory || shouldFilterGlobalMemory) {
    applyFilter();
  } else {
    updateColumnCounts('');
    updateSectionCounts('');
  }
}

/** Re-apply an active memory text search after tab content re-renders. */
export function reapplyMemorySearch() {
  if (activeMainTab === 'memory' && currentTerm && !isViewingGlobalMemory()) {
    renderMemorySearchResults(currentTerm);
  }
}

/** Re-apply global memory search after switching to the Global sidebar tab. */
export function reapplyGlobalMemorySearch() {
  if (activeMainTab === 'memory' && currentTerm && isViewingGlobalMemory()) {
    filterGlobalMemory(currentTerm);
  }
}

/** Refresh search placeholder and filters when switching memory sidebar tabs. */
export function updateMemorySearchUi() {
  if (!searchInput || activeMainTab !== 'memory') return;
  searchInput.placeholder = isViewingGlobalMemory()
    ? 'Search global memory...'
    : 'Search all memory...';
  if (currentTerm) applyFilter();
}

/** Programmatically set the tasks search term (e.g. from Overview widgets). */
export function setTaskSearch(term) {
  setSearchTerm(term);
}
export function clearSearch(opts = {}) {
  currentTerm = '';
  if (searchInput) searchInput.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  if (container) container.classList.remove('has-value');
  showAllTasks();
  showAllProjects();
  showAllMemory();
  showAllGlobalMemory();
  if (!opts.skipUrl) scheduleFilterUrlSync();
}

function applyFilter() {
  if (activeMainTab === 'tasks') {
    filterTasks(currentTerm);
  } else if (activeMainTab === 'projects') {
    filterProjects(currentTerm);
  } else if (activeMainTab === 'memory' && isViewingGlobalMemory()) {
    filterGlobalMemory(currentTerm);
  } else if (activeMainTab === 'memory') {
    filterMemory(currentTerm);
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
  if (activeMainTab === 'memory' && !isViewingGlobalMemory()) {
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

// ===== PROJECTS FILTERING =====

function projectTaskNodeMatches(node, term) {
  const row = node.querySelector(':scope > .pv-row-wrap .pv-row');
  if (row && row.textContent.toLowerCase().includes(term)) return true;
  for (const child of node.querySelectorAll(':scope > .pv-branch > .pv-node')) {
    if (projectTaskNodeMatches(child, term)) return true;
  }
  return false;
}

function projectSidebarNodeMatches(node, term) {
  const btn = node.querySelector(':scope > .pv-project-btn');
  if (btn && btn.textContent.toLowerCase().includes(term)) return true;
  for (const child of node.querySelectorAll(':scope > .pv-sidebar-children > .pv-sidebar-node')) {
    if (projectSidebarNodeMatches(child, term)) return true;
  }
  return false;
}

function filterProjects(term) {
  document.querySelectorAll('#projectsPanel .pv-node').forEach(node => {
    node.style.display = (!term || projectTaskNodeMatches(node, term)) ? '' : 'none';
  });

  document.querySelectorAll('#projectsPanel .pv-subproj').forEach(section => {
    if (!term) {
      section.style.display = '';
      return;
    }
    const headText = section.querySelector('.pv-subproj-head')?.textContent.toLowerCase() || '';
    const hasVisibleTask = [...section.querySelectorAll('.pv-node')].some(n => n.style.display !== 'none');
    section.style.display = (headText.includes(term) || hasVisibleTask) ? '' : 'none';
  });

  document.querySelectorAll('#projectsPanel .pv-sidebar-node').forEach(node => {
    node.style.display = (!term || projectSidebarNodeMatches(node, term)) ? '' : 'none';
  });
}

function showAllProjects() {
  document.querySelectorAll('#projectsPanel .pv-node, #projectsPanel .pv-subproj, #projectsPanel .pv-sidebar-node').forEach(el => {
    el.style.display = '';
  });
}
