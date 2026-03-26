// search.js - Unified search/filter for tasks and memory tabs

import { activeMainTab } from './state.js';

let searchInput, clearBtn, container, shortcutHint;
let currentTerm = '';

export function initSearch() {
  container = document.getElementById('unifiedSearch');
  searchInput = document.getElementById('unifiedSearchInput');
  clearBtn = document.getElementById('unifiedSearchClear');
  shortcutHint = container.querySelector('.unified-search-shortcut');

  searchInput.addEventListener('input', () => {
    currentTerm = searchInput.value.trim().toLowerCase();
    clearBtn.style.display = currentTerm ? '' : 'none';
    container.classList.toggle('has-value', !!currentTerm);
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
  if (tab === 'overview') {
    container.style.display = 'none';
    clearSearch();
  } else {
    container.style.display = 'flex';
    if (tab === 'tasks') searchInput.placeholder = 'Search tasks...';
    else if (tab === 'memory') searchInput.placeholder = 'Search memory...';
    else searchInput.placeholder = 'Search global memory...';
    clearSearch();
  }
}

export function reapplySearch() {
  if (currentTerm) applyFilter();
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

function filterTasks(term) {
  // Board view
  document.querySelectorAll('#board .task-card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = (!term || text.includes(term)) ? '' : 'none';
  });
  updateColumnCounts(term);

  // List view
  document.querySelectorAll('#listView .list-item').forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = (!term || text.includes(term)) ? '' : 'none';
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
  // Grid cards (people, projects directories)
  document.querySelectorAll('#memoryContentContainer .memory-card').forEach(card => {
    const searchText = card.dataset.search || card.textContent.toLowerCase();
    card.style.display = (!term || searchText.includes(term)) ? '' : 'none';
  });

  // Table rows in flat/context directories
  document.querySelectorAll('#memoryContentContainer tr[data-search]').forEach(row => {
    const searchText = row.dataset.search || '';
    row.style.display = (!term || searchText.includes(term)) ? '' : 'none';
  });

  // File cards (non-directory content)
  document.querySelectorAll('#memoryContentContainer .file-card').forEach(card => {
    if (!card.closest('.memory-grid') && !card.querySelector('tr[data-search]')) {
      const text = card.textContent.toLowerCase();
      card.style.display = (!term || text.includes(term)) ? '' : 'none';
    }
  });
}

function showAllMemory() {
  document.querySelectorAll('#memoryContentContainer .memory-card, #memoryContentContainer tr[data-search], #memoryContentContainer .file-card').forEach(el => {
    el.style.display = '';
  });
}

// ===== GLOBAL MEMORY FILTERING =====

function filterGlobalMemory(term) {
  document.querySelectorAll('#globalMemoryContainer .gm-card').forEach(card => {
    const searchText = card.dataset.search || card.textContent.toLowerCase();
    card.style.display = (!term || searchText.includes(term)) ? '' : 'none';
  });
  // Hide project groups where all cards are hidden
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
