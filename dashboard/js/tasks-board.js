// tasks-board.js - Board rendering, card creation, column creation, drag-drop for board view

import { markChanged } from './tasks-io.js';
import { taskSectionId, todayStr } from './tasks-parser.js';

let getState = null;
let getRenderTasks = null;

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
      const doneDate = new Date((task.updated || task.created) + 'T00:00:00');
      const daysAgo = Math.floor((new Date() - doneDate) / (1000 * 60 * 60 * 24));
      dateBadge = `<span class="date-badge">done ${daysAgo}d ago</span>`;
    } else {
      dateBadge = `<span class="date-badge">${task.created}</span>`;
    }
  }

  if (isArchive) {
    // Compact archive card - no edit, no drag, no delete
    let html = `
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <span class="checkbox checked"></span>
        <div>
          <span class="priority-dot priority-${task.priority || 'medium'}"></span>
          <div class="card-title">${task.title}</div>
        </div>
      </div>
    `;
    if (task.note) {
      html += `<div class="card-note" style="margin-left: 30px;">${task.note}</div>`;
    }
    if (dateBadge) {
      html += `<div style="margin-left: 30px; margin-top: 4px;">${dateBadge}</div>`;
    }
    card.innerHTML = html;
    return card;
  }

  const priorityClass = `priority-${task.priority || 'medium'}`;
  const taskIdBadge = task.taskId ? `<span class="task-id">${task.taskId}</span>` : '';
  let html = `
    <div style="display: flex; align-items: flex-start; gap: 12px;">
      <button class="delete-btn" data-action="delete" title="Delete task">&times;</button>
      <span class="checkbox ${task.checked ? 'checked' : ''}" data-action="toggle"></span>
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="priority-dot ${priorityClass}" data-action="cycle-priority" title="${task.priority || 'medium'} priority"></span>
          <div class="card-title" data-action="edit-title">${task.title}</div>
          ${taskIdBadge}
        </div>
      </div>
    </div>
  `;

  if (task.note) {
    html += `<div class="card-note" data-action="edit-note" style="cursor: pointer; margin-left: 30px;">${task.note}</div>`;
  } else {
    html += `<div class="card-note add-on-hover" data-action="edit-note" style="cursor: pointer; margin-left: 30px; font-style: italic;">+ Add note</div>`;
  }

  if (dateBadge) {
    html += `<div style="margin-left: 30px; margin-top: 4px;">${dateBadge}</div>`;
  }

  if (task.subtasks.length > 0) {
    html += '<div class="card-subtasks" style="margin-left: 30px;">';
    task.subtasks.forEach((st, idx) => {
      html += `<div class="subtask">
        <span class="checkbox ${st.checked ? 'checked' : ''}" data-action="toggle-sub" data-idx="${idx}" style="width: 16px; height: 16px; min-width: 16px; min-height: 16px;"></span>
        <span data-action="edit-subtask" data-idx="${idx}" style="cursor: pointer;">${st.text}</span>
      </div>`;
    });
    html += `<div class="subtask add-on-hover" data-action="add-subtask" style="color: var(--text-muted); cursor: pointer; font-style: italic; padding-left: 24px;">+ Add subtask</div>`;
    html += '</div>';
  } else {
    html += `<div class="card-subtasks add-on-hover" style="margin-left: 30px;">
      <div class="subtask" data-action="add-subtask" style="color: var(--text-muted); cursor: pointer; font-style: italic;">+ Add subtask</div>
    </div>`;
  }

  card.innerHTML = html;

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
  input.style.cssText = 'width: 100%; background: var(--bg-card); border: 2px solid var(--accent); border-radius: 6px; padding: 6px 10px; color: var(--text-primary); font-size: 14px; font-family: inherit; outline: none;';

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
  input.style.cssText = 'width: 100%; background: var(--bg-card); border: 2px solid var(--accent); border-radius: 6px; padding: 4px 8px; color: var(--text-primary); font-size: 13px; font-family: inherit; outline: none; resize: none; overflow: hidden; box-sizing: border-box;';
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
  input.style.cssText = 'width: calc(100% - 30px); background: var(--bg-card); border: 2px solid var(--accent); border-radius: 4px; padding: 2px 6px; color: var(--text-primary); font-size: 13px; font-family: inherit; outline: none;';

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
  input.style.cssText = 'width: calc(100% - 10px); background: var(--bg-card); border: 2px solid var(--accent); border-radius: 4px; padding: 2px 6px; color: var(--text-primary); font-size: 13px; font-family: inherit; outline: none;';

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
  input.style.cssText = 'width: 180px; background: var(--bg-card); border: 2px solid var(--accent); border-radius: 6px; padding: 4px 10px; color: var(--text-primary); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-family: inherit; outline: none;';

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

function createColumn(id, title, items) {
  const col = document.createElement('div');
  col.className = 'column';

  const isArchiveCol = id === 'archive';
  const isBacklogCol = id === 'backlog';
  if (isArchiveCol) {
    col.classList.add('archive-column');
    col.innerHTML = `
      <div class="column-header archive-header" style="cursor: pointer;">
        <span class="column-title">${title}</span>
        <span class="count">${items.length}</span>
        <span class="archive-toggle">&#9654;</span>
      </div>
      <div class="archive-search" style="display: none; padding: 0 12px 8px;">
        <input type="text" class="archive-search-input" placeholder="Search archive..." />
      </div>
      <div class="cards" data-column="${id}" style="display: none;"></div>
    `;

    const archiveHeader = col.querySelector('.archive-header');
    const archiveCards = col.querySelector('.cards');
    const archiveSearch = col.querySelector('.archive-search');
    const archiveToggle = col.querySelector('.archive-toggle');

    archiveHeader.addEventListener('click', () => {
      const isOpen = archiveCards.style.display !== 'none';
      archiveCards.style.display = isOpen ? 'none' : 'block';
      archiveSearch.style.display = isOpen ? 'none' : 'block';
      archiveToggle.textContent = isOpen ? '\u25B6' : '\u25BC';
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
    indicator.style.cssText = 'height: 3px; background: var(--accent); border-radius: 2px; margin: 5px 0;';
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
  addSectionBtn.className = 'column';
  addSectionBtn.style.cssText = 'background: transparent; border: 2px dashed var(--border); display: flex; align-items: center; justify-content: center; cursor: pointer; min-height: 120px;';
  addSectionBtn.innerHTML = '<span style="color: var(--text-muted); font-size: 14px; font-weight: 500;">+ Add Section</span>';
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
  input.style.cssText = 'width: 220px; background: var(--bg-card); border: 2px solid var(--accent); border-radius: 8px; padding: 10px 14px; color: var(--text-primary); font-size: 14px; font-family: inherit; outline: none;';

  btn.innerHTML = '';
  btn.style.cssText = 'background: var(--bg-secondary); border: 2px dashed var(--accent); display: flex; align-items: center; justify-content: center; cursor: default; min-height: 120px; min-width: 340px; border-radius: 12px;';
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
