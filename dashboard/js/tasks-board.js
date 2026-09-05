// tasks-board.js - Board rendering, card creation, column creation, drag-drop for board view

import { markChanged } from './tasks-io.js';
import { taskSectionId, todayStr, renderLinks, daysSince } from './tasks-parser.js';
import { openTaskDetail, refreshTaskDetailIfAffected } from './task-detail.js';
import { openCreateTaskModal } from './task-create.js';
import {
  getTicketType, findTaskByTaskId, escapeHtml, resolveTaskColor,
} from './ticket-types.js';
import {
  dueBadgeHtml, labelsHtml, linksAffordanceHtml, blockedIndicatorHtml,
  wipLimitFor, appendHistory, estimateBadgeHtml, assigneeChipHtml,
  jiraKeyBadgeHtml, recurrenceBadgeHtml, loggedBadgeHtml,
  spawnRecurringFollowUp, staleBadgeHtml, snoozeBadgeHtml, energyBadgeHtml,
  isSnoozed, syncTaskCompletionWithSection,
} from './task-fields.js';
import { taskPassesFacets, hasActiveFacets } from './task-filters.js';
import { isSelected, toggleSelect } from './task-selection.js';
import { softDeleteTask } from './task-undo.js';

let getState = null;
let getRenderTasks = null;

const SUBTASK_COLLAPSE_THRESHOLD = 3;
const expandedSubtaskCards = new Set();

export function setBoardCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

function parentLinkHtml(task) {
  if (!task.parentId) return '';
  const state = getState() || {};
  const parent = findTaskByTaskId(state.tasks, task.parentId);
  if (!parent) {
    return `<button type="button" class="task-parent-link" data-action="open-parent" data-parent-id="${escapeHtml(task.parentId)}" title="Parent not found">
      <span class="task-parent-id">${escapeHtml(task.parentId)}</span>
      <span class="task-parent-title">missing parent</span>
    </button>`;
  }
  const pColor = resolveTaskColor(parent, state.ticketTypes, state.tasks);
  return `<button type="button" class="task-parent-link" data-action="open-parent" data-parent-id="${escapeHtml(parent.taskId)}" title="Open parent ${escapeHtml(parent.taskId)}">
    <span class="task-parent-swatch" style="background:${escapeHtml(pColor)}"></span>
    <span class="task-parent-id">${escapeHtml(parent.taskId)}</span>
    <span class="task-parent-title">${escapeHtml(parent.title)}</span>
  </button>`;
}

function typeBadgeHtml(task) {
  const state = getState() || {};
  const tt = getTicketType(state.ticketTypes, task.type);
  const color = resolveTaskColor(task, state.ticketTypes, state.tasks);
  return `<span class="task-type-badge" title="${escapeHtml(tt.name)}">
    <span class="task-type-dot" style="background:${escapeHtml(color)}"></span>${escapeHtml(tt.name)}
  </span>`;
}

function createCard(task, isArchive = false) {
  const card = document.createElement('div');
  card.className = 'task-card' + (isArchive ? ' archive-card' : '') + (isSelected(task) ? ' selected' : '');
  card.draggable = !isArchive;
  card.dataset.id = task.id;
  card.dataset.taskId = task.taskId || '';
  card.tabIndex = 0;

  const state = getState() || {};
  card.style.borderLeftColor = resolveTaskColor(task, state.ticketTypes, state.tasks);

  // Date badge
  let dateBadge = '';
  if (task.created) {
    if (task.checked && (task.updated || task.created)) {
      dateBadge = `<span class="date-badge">done ${daysSince(task)}d ago</span>`;
    } else {
      dateBadge = `<span class="date-badge">${task.created}</span>`;
    }
  }

  const priority = task.priority || 'medium';

  if (isArchive) {
    // Compact archive card - no edit, no drag, no delete
    let html = `
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <span class="checkbox checked" role="checkbox" aria-checked="true" aria-label="Completed"></span>
        <div>
          <span class="priority-dot priority-${priority}" aria-hidden="true"></span>
          ${typeBadgeHtml(task)}
          <div class="card-title">${renderLinks(task.title)}</div>
          ${parentLinkHtml(task)}
        </div>
      </div>
    `;
    if (task.description) {
      html += `<div class="card-note clamp" style="cursor: pointer;">${renderLinks(task.description)}</div>`;
    }
    if (dateBadge) {
      html += `<div class="card-date-row">${dateBadge}</div>`;
    }
    card.innerHTML = html;
    card.addEventListener('click', () => openTaskDetail(task));
    return card;
  }

  const priorityClass = `priority-${priority}`;
  const taskIdBadge = task.taskId ? `<span class="task-id">${task.taskId}</span>` : '';
  const staleDays = (window.dashboardConfig && window.dashboardConfig.staleDays) || 14;
  const metaBadges = blockedIndicatorHtml(task, state.tasks)
    + dueBadgeHtml(task)
    + jiraKeyBadgeHtml(task)
    + recurrenceBadgeHtml(task)
    + estimateBadgeHtml(task)
    + loggedBadgeHtml(task)
    + energyBadgeHtml(task)
    + staleBadgeHtml(task, staleDays)
    + snoozeBadgeHtml(task)
    + assigneeChipHtml(task)
    + linksAffordanceHtml(task)
    + labelsHtml(task);
  let html = `
    <div style="display: flex; align-items: flex-start; gap: 12px;">
      <button class="delete-btn" data-action="delete" aria-label="Delete task">&times;</button>
      <span class="task-select-box${isSelected(task) ? ' checked' : ''}" data-action="select"
            role="checkbox" aria-checked="${isSelected(task) ? 'true' : 'false'}"
            aria-label="Select task" tabindex="0"></span>
      <span class="checkbox ${task.checked ? 'checked' : ''}" data-action="toggle"
            role="checkbox" aria-checked="${task.checked ? 'true' : 'false'}" tabindex="0"></span>
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 8px; padding-right: 34px; flex-wrap: wrap;">
          <span class="priority-dot ${priorityClass}" data-action="cycle-priority"
                role="button" tabindex="0"
                aria-label="Priority: ${priority} — click to cycle"
                title="Priority: ${priority} — click to cycle"></span>
          ${typeBadgeHtml(task)}
          <div class="card-title task-clickable" data-action="open-detail">${renderLinks(task.title)}</div>
          ${taskIdBadge}
          ${metaBadges}
        </div>
        ${parentLinkHtml(task)}
      </div>
    </div>
  `;

  if (task.description) {
    html += `<div class="card-note clamp" data-action="open-detail" style="cursor: pointer;">${renderLinks(task.description)}</div>`;
  } else {
    html += `<div class="card-note add-on-hover" data-action="open-detail">+ Add description</div>`;
  }

  if (dateBadge) {
    html += `<div class="card-date-row">${dateBadge}</div>`;
  }

  if (task.subtasks.length > 0) {
    html += '<div class="card-subtasks">';

    const needsCollapse = task.subtasks.length > SUBTASK_COLLAPSE_THRESHOLD;
    const isExpanded = expandedSubtaskCards.has(task.id);
    const indexed = task.subtasks.map((st, idx) => [idx, st]);
    const visible = (!needsCollapse || isExpanded)
      ? indexed
      : indexed.filter(([, st]) => !st.checked).slice(0, SUBTASK_COLLAPSE_THRESHOLD);

    visible.forEach(([idx, st]) => {
      html += `<div class="subtask">
        <span class="checkbox ${st.checked ? 'checked' : ''}" data-action="toggle-sub" data-idx="${idx}"
              role="checkbox" aria-checked="${st.checked ? 'true' : 'false'}" tabindex="0"></span>
        <span data-action="edit-subtask" data-idx="${idx}" style="cursor: pointer;">${renderLinks(st.text)}</span>
      </div>`;
    });

    if (needsCollapse) {
      const hiddenCount = task.subtasks.length - visible.length;
      const label = isExpanded ? 'Show less' : `+ ${hiddenCount} more`;
      html += `<div class="subtask subtask-toggle" data-action="toggle-subtasks">${label}</div>`;
    }

    html += `<div class="subtask add-on-hover subtask-toggle" data-action="add-subtask">+ Add subtask</div>`;
    html += '</div>';
  } else {
    html += `<div class="card-subtasks add-on-hover">
      <div class="subtask subtask-toggle" data-action="add-subtask">+ Add subtask</div>
    </div>`;
  }

  card.innerHTML = html;

  // Keyboard handler for checkboxes and priority dots
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const action = e.target.dataset.action;
      if (action === 'toggle' || action === 'toggle-sub' || action === 'cycle-priority') {
        e.preventDefault();
        e.target.click();
      }
    }
  });

  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
    if (task.taskId) e.dataTransfer.setData('application/x-task-id', task.taskId);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });

  card.addEventListener('click', (e) => {
    const parentBtn = e.target.closest('[data-action="open-parent"]');
    if (parentBtn) {
      e.stopPropagation();
      const parent = findTaskByTaskId(getState().tasks, parentBtn.dataset.parentId);
      if (parent) openTaskDetail(parent);
      return;
    }

    const action = e.target.dataset.action;
    if (action === 'select') {
      e.stopPropagation();
      toggleSelect(task, { additive: e.metaKey || e.ctrlKey || e.shiftKey || true });
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation();
      toggleSelect(task, { additive: true });
      return;
    }
    if (action === 'toggle') {
      task.checked = !task.checked;
      if (task.checked) {
        task.updated = todayStr();
        moveTask(task.id, 'done', 0);
      } else if (task.section === 'done') {
        const { sections } = getState();
        const target = sections.find(s => s.id !== 'done' && s.id !== 'archive' && s.id !== 'backlog');
        moveTask(task.id, target ? target.id : task.section, 0);
      } else {
        markChanged(task);
        getRenderTasks()();
      }
    } else if (action === 'toggle-sub') {
      const idx = parseInt(e.target.dataset.idx);
      task.subtasks[idx].checked = !task.subtasks[idx].checked;
      markChanged(task);
      getRenderTasks()();
     } else if (action === 'open-detail' || action === 'edit-title' || action === 'edit-note'
        || action === 'edit-subtask' || action === 'add-subtask') {
        // Open the task detail modal; focus the checklist subtask when clicked.
        const focusSubIdx = action === 'edit-subtask' ? parseInt(e.target.dataset.idx, 10) : null;
        openTaskDetail(task, {
          focusTitle: action !== 'edit-subtask' && action !== 'add-subtask',
          focusSubtaskIdx: Number.isInteger(focusSubIdx) ? focusSubIdx : null,
          expandSubtask: action === 'edit-subtask' || action === 'add-subtask',
        });
     } else if (action === 'toggle-subtasks') {
        if (expandedSubtaskCards.has(task.id)) expandedSubtaskCards.delete(task.id);
        else expandedSubtaskCards.add(task.id);
        getRenderTasks()();
    } else if (action === 'cycle-priority') {
      const cycle = { low: 'medium', medium: 'high', high: 'low' };
      const prev = task.priority || 'medium';
      task.priority = cycle[prev];
      appendHistory(task, { event: 'priority', from: prev, to: task.priority });
      markChanged(task);
      getRenderTasks()();
    } else if (action === 'delete') {
      softDeleteTask(task);
    }
  });

  return card;
}

function startEditingTitle(titleEl, task) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = task.title;
  input.className = 'inline-edit-input';

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let saved = false;
  const saveEdit = () => {
    if (saved) return;
    saved = true;
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== task.title) {
      task.title = newTitle;
      markChanged(task);
    }
    getRenderTasks()();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { saved = true; getRenderTasks()(); }
  });
  input.addEventListener('blur', saveEdit);
}

function startEditingNote(noteEl, task) {
  const input = document.createElement('textarea');
  input.value = task.description || '';
  input.placeholder = 'Add a description... (Shift+Enter for new line)';
  input.className = 'inline-edit-textarea';
  input.rows = 1;

  const autoResize = () => {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  };

  noteEl.replaceWith(input);
  autoResize();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  input.addEventListener('input', autoResize);

  let saved = false;
  const saveEdit = () => {
    if (saved) return;
    saved = true;
    task.description = input.value.trim();
    markChanged(task);
    getRenderTasks()();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { saved = true; getRenderTasks()(); }
  });
  input.addEventListener('blur', saveEdit);
}

function startEditingSubtask(subtaskEl, task, idx) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = task.subtasks[idx].text;
  input.className = 'inline-edit-input';

  subtaskEl.replaceWith(input);
  input.focus();
  input.select();

  let saved = false;
  const saveEdit = () => {
    if (saved) return;
    saved = true;
    const newText = input.value.trim();
    if (newText) { task.subtasks[idx].text = newText; }
    else { task.subtasks.splice(idx, 1); }
    markChanged(task);
    getRenderTasks()();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { saved = true; getRenderTasks()(); }
  });
  input.addEventListener('blur', saveEdit);
}

function startAddingSubtask(el, task) {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'New subtask...';
  input.className = 'inline-edit-input';

  el.replaceWith(input);
  input.focus();

  let saved = false;
  const saveEdit = () => {
    if (saved) return;
    saved = true;
    const text = input.value.trim();
    if (text) { task.subtasks.push({ text, checked: false }); markChanged(task); }
    getRenderTasks()();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { saved = true; getRenderTasks()(); }
  });
  input.addEventListener('blur', saveEdit);
}

function startEditingColumnTitle(titleEl, colId) {
  const { sections, tasks } = getState();
  const section = sections.find(s => s.id === colId);
  if (!section) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = section.name;
  input.className = 'inline-edit-input';
  input.style.width = '180px';

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let saved = false;
  const saveEdit = () => {
    if (saved) return;
    saved = true;
    const newName = input.value.trim();
    if (newName && newName !== section.name) {
      const oldId = section.id;
      section.name = newName;
      const newId = taskSectionId(newName);
      if (newId !== oldId) {
        tasks[newId] = tasks[oldId] || [];
        delete tasks[oldId];
        tasks[newId].forEach(t => t.section = newId);
        section.id = newId;
      }
      markChanged();
    }
    getRenderTasks()();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { saved = true; getRenderTasks()(); }
  });
  input.addEventListener('blur', saveEdit);
}

function colorForSection(id) {
  const normalized = (id || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'inprogress' || normalized === 'in-progress') return 'var(--status-inprogress)';
  if (normalized === 'done' || normalized === 'completed') return 'var(--status-done)';
  if (normalized === 'todo' || normalized === 'to-do') return 'var(--status-todo)';
  if (normalized === 'backlog') return 'var(--status-backlog)';
  if (normalized === 'inbox') return 'var(--status-todo)';
  if (normalized === 'archive') return 'var(--text-tertiary)';
  return 'var(--border)';
}

function createColumn(id, title, items) {
  const col = document.createElement('div');
  col.className = 'column';

  // Set column identity stripe color via CSS custom property
  col.style.setProperty('--col-color', colorForSection(id));

  const isArchiveCol = id === 'archive';
  const isBacklogCol = id === 'backlog';
  if (isArchiveCol) {
    col.classList.add('archive-column');
    col.innerHTML = `
      <div class="column-header archive-header" role="button" tabindex="0" aria-expanded="false" style="cursor: pointer;">
        <span class="column-title">${title}</span>
        <span class="count">${items.length}</span>
        <span class="archive-toggle"></span>
      </div>
      <div class="archive-search" style="display: none;">
        <input type="text" class="archive-search-input" placeholder="Search archive..." />
      </div>
      <div class="cards" data-column="${id}" style="display: none;"></div>
    `;

    const archiveHeader = col.querySelector('.archive-header');
    const archiveCards = col.querySelector('.cards');
    const archiveSearch = col.querySelector('.archive-search');

    const toggleArchive = () => {
      const isOpen = col.classList.contains('open');
      col.classList.toggle('open', !isOpen);
      archiveCards.style.display = isOpen ? 'none' : 'block';
      archiveSearch.style.display = isOpen ? 'none' : 'block';
      archiveHeader.setAttribute('aria-expanded', String(!isOpen));
    };
    archiveHeader.addEventListener('click', toggleArchive);
    archiveHeader.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleArchive(); }
    });

    const searchInput = col.querySelector('.archive-search-input');
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      archiveCards.querySelectorAll('.task-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(query) ? '' : 'none';
      });
    });
  } else if (isBacklogCol) {
    col.classList.add('backlog-column');
    col.innerHTML = `
      <div class="column-header">
        <span class="column-title" data-section-id="${id}" style="cursor: pointer;">${title}</span>
        <span class="count">${items.length}</span>
      </div>
      <div class="cards" data-column="${id}"></div>
      <div class="add-card">
        <button data-add="${id}">+ Add task</button>
      </div>
    `;
  } else {
    const limit = wipLimitFor(id);
    const overWip = limit != null && items.length > limit;
    const wipWarn = overWip
      ? `<span class="wip-warning" title="Over WIP limit of ${limit}">${items.length}/${limit}</span>`
      : (limit != null ? `<span class="wip-limit" title="WIP limit">${items.length}/${limit}</span>` : '');
    col.innerHTML = `
      <div class="column-header${overWip ? ' wip-over' : ''}">
        <span class="column-title" data-section-id="${id}" style="cursor: pointer;">${title}</span>
        <span class="count">${items.length}</span>
        ${wipWarn}
      </div>
      <div class="cards" data-column="${id}"></div>
      <div class="add-card">
        <button data-add="${id}">+ Add task</button>
      </div>
    `;
  }

  if (!isArchiveCol && !isBacklogCol) {
    col.querySelector('.column-title').addEventListener('click', (e) => {
      if (!col.dragging) { startEditingColumnTitle(e.target, id); }
    });
  }

  const header = col.querySelector('.column-header');
  header.draggable = true;

  header.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    col.classList.add('dragging-column');
    e.dataTransfer.setData('text/column', id);
    e.dataTransfer.effectAllowed = 'move';
  });

  header.addEventListener('dragend', () => {
    col.classList.remove('dragging-column');
    const board = document.getElementById('board');
    board.querySelectorAll('.column-drop-indicator').forEach(el => el.remove());
  });

  col.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/column')) {
      e.preventDefault();
      e.stopPropagation();
      const board = document.getElementById('board');
      board.querySelectorAll('.column-drop-indicator').forEach(el => el.remove());
      const indicator = document.createElement('div');
      indicator.className = 'column-drop-indicator';
      const rect = col.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) { col.before(indicator); }
      else { col.after(indicator); }
    }
  });

  col.addEventListener('drop', (e) => {
    if (e.dataTransfer.types.includes('text/column')) {
      e.preventDefault();
      e.stopPropagation();
      const fromId = e.dataTransfer.getData('text/column');
      const toId = id;
      if (fromId !== toId) {
        const rect = col.getBoundingClientRect();
        const insertBefore = e.clientX < rect.left + rect.width / 2;
        moveSection(fromId, toId, insertBefore);
      }
      const board = document.getElementById('board');
      board.querySelectorAll('.column-drop-indicator').forEach(el => el.remove());
    }
  });

  const cardsContainer = col.querySelector('.cards');
  items.forEach(task => {
    const card = createCard(task, isArchiveCol);
    if (isBacklogCol) { card.classList.add('backlog-card'); }
    if (id === 'inbox') { card.classList.add('inbox-card'); }
    if (isSnoozed(task)) { card.classList.add('snoozed-card'); }
    cardsContainer.appendChild(card);
  });

  // Empty column state
  if (!isArchiveCol && items.length === 0) {
    cardsContainer.innerHTML = '<div class="column-empty-state">Drop tasks here<br>or click + Add task</div>';
  }

  const getDropPosition = (e) => {
    const allCards = [...cardsContainer.querySelectorAll('.task-card')];
    const visibleCards = allCards.filter(c => !c.classList.contains('dragging'));
    let insertBeforeCard = null;
    let dropIndex = visibleCards.length;
    for (let i = 0; i < visibleCards.length; i++) {
      const rect = visibleCards[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        insertBeforeCard = visibleCards[i];
        dropIndex = i;
        break;
      }
    }
    return { insertBeforeCard, dropIndex };
  };

  const showDropIndicator = (e) => {
    col.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    const { insertBeforeCard } = getDropPosition(e);
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    if (insertBeforeCard) { cardsContainer.insertBefore(indicator, insertBeforeCard); }
    else { cardsContainer.appendChild(indicator); }
  };

  col.addEventListener('dragover', (e) => {
    e.preventDefault();
    cardsContainer.classList.add('drag-over');
    showDropIndicator(e);
  });

  col.addEventListener('dragleave', (e) => {
    if (!col.contains(e.relatedTarget)) {
      cardsContainer.classList.remove('drag-over');
      col.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    }
  });

  col.addEventListener('drop', (e) => {
    e.preventDefault();
    cardsContainer.classList.remove('drag-over');
    col.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    const taskId = parseFloat(e.dataTransfer.getData('text/plain'));
    const { dropIndex } = getDropPosition(e);
    moveTask(taskId, id, dropIndex);
  });

  const addBtn = col.querySelector(`[data-add="${id}"]`);
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      addNewTask(id);
    });
  }

  return col;
}

function addNewTask(sectionId) {
  openCreateTaskModal(sectionId);
}

export function moveSection(fromId, toId, insertBefore) {
  const { sections } = getState();
  const fromIdx = sections.findIndex(s => s.id === fromId);
  const toIdx = sections.findIndex(s => s.id === toId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [section] = sections.splice(fromIdx, 1);
  let newIdx = sections.findIndex(s => s.id === toId);
  if (!insertBefore) newIdx++;
  sections.splice(newIdx, 0, section);
  markChanged();
  getRenderTasks()();
}

export function moveTask(taskId, toSectionId, dropIndex = -1, opts = {}) {
  const { skipRender = false } = opts;
  const state = getState();
  const { sections, tasks } = state;
  let task = null;
  let fromSectionId = null;
  for (const section of sections) {
    const sectionTasks = tasks[section.id] || [];
    const idx = sectionTasks.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      fromSectionId = section.id;
      task = sectionTasks.splice(idx, 1)[0];
      break;
    }
  }
  if (!task) return;
  const prevSection = fromSectionId || task.section;
  task.section = toSectionId;
  syncTaskCompletionWithSection(task, toSectionId, prevSection);
  if (prevSection !== toSectionId) {
    appendHistory(task, { event: 'moved', from: prevSection, to: toSectionId });
  }
  if (!tasks[toSectionId]) tasks[toSectionId] = [];
  if (dropIndex >= 0 && dropIndex <= tasks[toSectionId].length) {
    tasks[toSectionId].splice(dropIndex, 0, task);
  } else {
    tasks[toSectionId].push(task);
  }
  if (toSectionId === 'done' && prevSection !== 'done') {
    spawnRecurringFollowUp(task, state);
  }
  markChanged();
  if (!skipRender) getRenderTasks()();
  refreshTaskDetailIfAffected(task);
}

export function deleteTask(task) {
  softDeleteTask(task);
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
function sortByPriority(tasks) {
  return [...tasks].sort((a, b) =>
    (PRIORITY_ORDER[a.priority || 'medium'] ?? 1) - (PRIORITY_ORDER[b.priority || 'medium'] ?? 1)
  );
}

export function renderBoard() {
  const state = getState();
  const { sections, tasks } = state;
  const board = document.getElementById('board');

  const scrollPositions = {};
  board.querySelectorAll('.cards').forEach(cardsEl => {
    const column = cardsEl.closest('.column');
    if (column) {
      const sectionId = cardsEl.dataset.column;
      if (sectionId) scrollPositions[sectionId] = cardsEl.scrollTop;
    }
  });

  board.innerHTML = '';
  board.classList.toggle('swimlanes-mode', !!state.swimlanesByEpic);

  if (state.swimlanesByEpic) {
    renderSwimlaneBoard(board, state, sections, tasks);
  } else {
    sections.forEach(section => {
      let sectionTasks = tasks[section.id] || [];
      if (hasActiveFacets()) {
        sectionTasks = sectionTasks.filter(taskPassesFacets);
      }
      const displayTasks = state.sortByPriority ? sortByPriority(sectionTasks) : sectionTasks;
      board.appendChild(createColumn(section.id, section.name, displayTasks));
    });
  }

  const addSectionBtn = document.createElement('div');
  addSectionBtn.className = 'column-add-section';
  addSectionBtn.textContent = '+ Add Section';
  addSectionBtn.addEventListener('click', () => startAddingSection(addSectionBtn));
  board.appendChild(addSectionBtn);

  board.querySelectorAll('.cards').forEach(cardsEl => {
    const sectionId = cardsEl.dataset.column;
    if (sectionId && scrollPositions[sectionId] !== undefined) {
      cardsEl.scrollTop = scrollPositions[sectionId];
    }
  });
}

/** Group tasks into swimlanes by nearest epic parent (or No parent). */
function swimlaneKey(task, tasksBySection, ticketTypes) {
  if (!task.parentId) return { key: '__none__', title: 'No parent' };
  let cur = findTaskByTaskId(tasksBySection, task.parentId);
  let guard = 0;
  while (cur && guard++ < 20) {
    const tt = getTicketType(ticketTypes, cur.type);
    if (tt.id === 'epic' || (tt.name || '').toLowerCase() === 'epic') {
      return { key: cur.taskId, title: `${cur.taskId} · ${cur.title}` };
    }
    if (!cur.parentId) {
      return { key: cur.taskId, title: `${cur.taskId} · ${cur.title}` };
    }
    cur = findTaskByTaskId(tasksBySection, cur.parentId);
  }
  return { key: task.parentId, title: task.parentId };
}

function renderSwimlaneBoard(board, state, sections, tasks) {
  const lanes = new Map(); // key -> { title, bySection: { sectionId: tasks[] } }
  const ensure = (key, title) => {
    if (!lanes.has(key)) {
      const bySection = {};
      sections.forEach(s => { bySection[s.id] = []; });
      lanes.set(key, { title, bySection });
    }
    return lanes.get(key);
  };
  ensure('__none__', 'No parent');

  sections.forEach(section => {
    let sectionTasks = tasks[section.id] || [];
    if (hasActiveFacets()) sectionTasks = sectionTasks.filter(taskPassesFacets);
    const displayTasks = state.sortByPriority ? sortByPriority(sectionTasks) : sectionTasks;
    displayTasks.forEach(task => {
      const { key, title } = swimlaneKey(task, tasks, state.ticketTypes);
      ensure(key, title).bySection[section.id].push(task);
    });
  });

  // Stable order: No parent last, others by title
  const ordered = [...lanes.entries()].sort((a, b) => {
    if (a[0] === '__none__') return 1;
    if (b[0] === '__none__') return -1;
    return a[1].title.localeCompare(b[1].title);
  });

  ordered.forEach(([key, lane]) => {
    const hasAny = sections.some(s => (lane.bySection[s.id] || []).length > 0);
    if (!hasAny && key !== '__none__') return;

    const row = document.createElement('div');
    row.className = 'swimlane';
    row.dataset.lane = key;
    const header = document.createElement('div');
    header.className = 'swimlane-header';
    header.textContent = lane.title;
    row.appendChild(header);

    const cols = document.createElement('div');
    cols.className = 'swimlane-columns';
    sections.forEach(section => {
      const items = lane.bySection[section.id] || [];
      cols.appendChild(createColumn(section.id, section.name, items));
    });
    row.appendChild(cols);
    board.appendChild(row);
  });
}

export function startAddingSection(btn) {
  const { tasks } = getState();
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Section name...';
  input.className = 'inline-edit-input';
  input.style.width = '180px';

  btn.innerHTML = '';
  btn.appendChild(input);
  input.focus();

  let saved = false;
  const saveSection = () => {
    if (saved) return;
    saved = true;
    const name = input.value.trim();
    if (name) {
      const { sections } = getState();
      const id = taskSectionId(name);
      if (!tasks[id]) {
        sections.push({ id, name });
        tasks[id] = [];
        markChanged();
      }
    }
    getRenderTasks()();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveSection(); }
    else if (e.key === 'Escape') { saved = true; getRenderTasks()(); }
  });
  input.addEventListener('blur', saveSection);
}
