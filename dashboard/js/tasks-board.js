// tasks-board.js - Board rendering, card creation, column creation, drag-drop for board view

import { markChanged } from './tasks-io.js';
import { taskSectionId, todayStr, renderLinks, daysSince } from './tasks-parser.js';

let getState = null;
let getRenderTasks = null;

const SUBTASK_COLLAPSE_THRESHOLD = 3;
const expandedSubtaskCards = new Set();

export function setBoardCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

function createCard(task, isArchive = false) {
  const card = document.createElement('div');
  card.className = 'task-card' + (isArchive ? ' archive-card' : '');
  card.draggable = !isArchive;
  card.dataset.id = task.id;

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
          <div class="card-title">${renderLinks(task.title)}</div>
        </div>
      </div>
    `;
    if (task.note) {
      html += `<div class="card-note">${renderLinks(task.note)}</div>`;
    }
    if (dateBadge) {
      html += `<div class="card-date-row">${dateBadge}</div>`;
    }
    card.innerHTML = html;
    return card;
  }

  const priorityClass = `priority-${priority}`;
  const taskIdBadge = task.taskId ? `<span class="task-id">${task.taskId}</span>` : '';
  let html = `
    <div style="display: flex; align-items: flex-start; gap: 12px;">
      <button class="delete-btn" data-action="delete" aria-label="Delete task">&times;</button>
      <span class="checkbox ${task.checked ? 'checked' : ''}" data-action="toggle"
            role="checkbox" aria-checked="${task.checked ? 'true' : 'false'}" tabindex="0"></span>
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="priority-dot ${priorityClass}" data-action="cycle-priority"
                role="button" tabindex="0"
                aria-label="Priority: ${priority} — click to cycle"
                title="Priority: ${priority} — click to cycle"></span>
          <div class="card-title" data-action="edit-title">${renderLinks(task.title)}</div>
          ${taskIdBadge}
        </div>
      </div>
    </div>
  `;

  if (task.note) {
    html += `<div class="card-note" data-action="edit-note" style="cursor: pointer;">${renderLinks(task.note)}</div>`;
  } else {
    html += `<div class="card-note add-on-hover" data-action="edit-note">+ Add note</div>`;
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
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });

  card.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
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
    } else if (action === 'edit-title') {
      startEditingTitle(e.target, task);
    } else if (action === 'edit-note') {
      startEditingNote(e.target, task);
    } else if (action === 'edit-subtask') {
      const idx = parseInt(e.target.dataset.idx);
      startEditingSubtask(e.target, task, idx);
    } else if (action === 'toggle-subtasks') {
      if (expandedSubtaskCards.has(task.id)) expandedSubtaskCards.delete(task.id);
      else expandedSubtaskCards.add(task.id);
      getRenderTasks()();
    } else if (action === 'add-subtask') {
      startAddingSubtask(e.target, task);
    } else if (action === 'cycle-priority') {
      const cycle = { low: 'medium', medium: 'high', high: 'low' };
      task.priority = cycle[task.priority || 'medium'];
      markChanged(task);
      getRenderTasks()();
    } else if (action === 'delete') {
      deleteTask(task);
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
  input.value = task.note || '';
  input.placeholder = 'Add a note... (Shift+Enter for new line)';
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
    task.note = input.value.trim();
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
      addNewTask(id, col.querySelector('.cards'));
    });
  }

  return col;
}

function addNewTask(sectionId, container) {
  const { sections, tasks } = getState();
  const existing = container.querySelector('.new-task-input');
  if (existing) return;

  const input = document.createElement('textarea');
  input.className = 'new-task-input';
  input.placeholder = 'What needs to be done?';
  input.rows = 2;
  container.appendChild(input);
  input.focus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const title = input.value.trim();
      if (title) {
        if (!tasks[sectionId]) tasks[sectionId] = [];

        // Auto-assign next task ID
        let maxId = 0;
        sections.forEach(section => {
          const sectionTasks = tasks[section.id] || [];
          sectionTasks.forEach(t => {
            if (t.taskId) {
              const num = parseInt(t.taskId.substring(1));
              if (!isNaN(num) && num > maxId) maxId = num;
            }
          });
        });
        const nextTaskId = `T${maxId + 1}`;

        tasks[sectionId].push({
          id: Date.now() + Math.random(),
          title,
          note: '',
          checked: false,
          subtasks: [],
          section: sectionId,
          created: todayStr(),
          updated: null,
          priority: 'medium',
          taskId: nextTaskId
        });
        markChanged();
        getRenderTasks()();
      } else { input.remove(); }
    } else if (e.key === 'Escape') { input.remove(); }
  });

  input.addEventListener('blur', () => { setTimeout(() => input.remove(), 100); });
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

export function moveTask(taskId, toSectionId, dropIndex = -1) {
  const { sections, tasks } = getState();
  let task = null;
  for (const section of sections) {
    const sectionTasks = tasks[section.id] || [];
    const idx = sectionTasks.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      task = sectionTasks.splice(idx, 1)[0];
      break;
    }
  }
  if (!task) return;
  task.section = toSectionId;
  if (!tasks[toSectionId]) tasks[toSectionId] = [];
  if (dropIndex >= 0 && dropIndex <= tasks[toSectionId].length) {
    tasks[toSectionId].splice(dropIndex, 0, task);
  } else {
    tasks[toSectionId].push(task);
  }
  markChanged();
  getRenderTasks()();
}

export function deleteTask(task) {
  const { sections, tasks } = getState();
  if (!confirm(`Delete "${task.title}"?`)) return;
  for (const section of sections) {
    const sectionTasks = tasks[section.id] || [];
    const idx = sectionTasks.findIndex(t => t.id === task.id);
    if (idx !== -1) { sectionTasks.splice(idx, 1); break; }
  }
  markChanged();
  getRenderTasks()();
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

  // Save scroll positions of existing columns before clearing
  const scrollPositions = {};
  board.querySelectorAll('.cards').forEach(cardsEl => {
    const column = cardsEl.closest('.column');
    if (column) {
      const sectionId = cardsEl.dataset.column;
      if (sectionId) {
        scrollPositions[sectionId] = cardsEl.scrollTop;
      }
    }
  });

  board.innerHTML = '';
  sections.forEach(section => {
    const sectionTasks = tasks[section.id] || [];
    const displayTasks = state.sortByPriority ? sortByPriority(sectionTasks) : sectionTasks;
    board.appendChild(createColumn(section.id, section.name, displayTasks));
  });

  const addSectionBtn = document.createElement('div');
  addSectionBtn.className = 'column-add-section';
  addSectionBtn.textContent = '+ Add Section';
  addSectionBtn.addEventListener('click', () => startAddingSection(addSectionBtn));
  board.appendChild(addSectionBtn);

  // Restore scroll positions after rendering
  board.querySelectorAll('.cards').forEach(cardsEl => {
    const sectionId = cardsEl.dataset.column;
    if (sectionId && scrollPositions[sectionId] !== undefined) {
      cardsEl.scrollTop = scrollPositions[sectionId];
    }
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
