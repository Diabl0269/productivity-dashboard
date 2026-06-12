// tasks-list.js - List view rendering

import { markChanged } from './tasks-io.js';
import { moveTask, deleteTask } from './tasks-board.js';
import { taskSectionId, todayStr, renderLinks } from './tasks-parser.js';

let getState = null;
let getRenderTasks = null;

const SUBTASK_COLLAPSE_THRESHOLD = 3;
const expandedSubtaskItems = new Set();

export function setListCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

export function renderList() {
  const state = getState();
  const { sections, tasks, quickAddSection } = state;
  const listView = document.getElementById('listView');

  // Save scroll positions of existing sections before clearing
  const scrollPositions = {};
  listView.querySelectorAll('.list-tasks-container').forEach(container => {
    const sectionId = container.dataset.sectionId;
    if (sectionId) {
      scrollPositions[sectionId] = container.scrollTop;
    }
  });

  listView.innerHTML = '';

  let currentQuickAddSection = quickAddSection;
  if (!currentQuickAddSection && sections.length > 0) {
    currentQuickAddSection = sections[0].id;
    getState().quickAddSection = currentQuickAddSection;
  }

  // Quick add at top
  const quickAdd = document.createElement('div');
  quickAdd.className = 'quick-add';

  const sectionName = sections.find(s => s.id === currentQuickAddSection)?.name || 'Select section';
  quickAdd.innerHTML = `
    <span class="checkbox checkbox--ghost" role="checkbox" aria-checked="false" aria-label="Task completion"></span>
    <input type="text" class="quick-add-input" placeholder="Add a task..." id="quickAddInput">
    <span class="quick-add-section" id="quickAddSectionBtn">${sectionName}</span>
  `;
  listView.appendChild(quickAdd);

  const quickInput = document.getElementById('quickAddInput');
  const sectionBtn = document.getElementById('quickAddSectionBtn');

  quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && quickInput.value.trim()) {
      const title = quickInput.value.trim();
      const currentSection = getState().quickAddSection;
      if (!tasks[currentSection]) tasks[currentSection] = [];

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

      tasks[currentSection].unshift({
        id: Date.now() + Math.random(),
        title,
        note: '',
        checked: false,
        subtasks: [],
        section: currentSection,
        created: todayStr(),
        updated: null,
        priority: 'medium',
        taskId: nextTaskId
      });
      quickInput.value = '';
      markChanged(tasks[currentSection][0]);
      getRenderTasks()();
      setTimeout(() => document.getElementById('quickAddInput')?.focus(), 10);
    }
  });

  sectionBtn.addEventListener('click', (e) => { showSectionPicker(e.target); });

  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

  // Render each section
  sections.forEach(section => {
    const rawTasks = tasks[section.id] || [];
    const sectionTasks = state.sortByPriority
      ? [...rawTasks].sort((a, b) =>
          (PRIORITY_ORDER[a.priority || 'medium'] ?? 1) - (PRIORITY_ORDER[b.priority || 'medium'] ?? 1)
        )
      : rawTasks;
    const isArchive = section.id === 'archive';
    const isBacklog = section.id === 'backlog';
    const sectionEl = document.createElement('div');
    sectionEl.className = 'list-section' + (isArchive ? ' archive-section' : '') + (isBacklog ? ' backlog-section' : '');
    sectionEl.dataset.sectionId = section.id;

    const header = document.createElement('div');
    header.className = 'list-section-header' + (isArchive ? ' archive-header' : '');
    if (isArchive) {
      header.innerHTML = `
        <span class="section-title">${section.name}</span>
        <span class="count">${sectionTasks.length}</span>
        <span class="archive-toggle"></span>
      `;
      header.setAttribute('aria-expanded', 'false');
    } else {
      header.innerHTML = `
        <span class="section-title" data-section-id="${section.id}">${section.name}</span>
        <span class="count">${sectionTasks.length}</span>
      `;
      header.querySelector('.section-title').addEventListener('click', (e) => {
        startEditingListSectionTitle(e.target, section);
      });
    }

    sectionEl.appendChild(header);

    // Archive search input
    let archiveSearchInput = null;
    if (isArchive) {
      const searchContainer = document.createElement('div');
      searchContainer.className = 'archive-search';
      searchContainer.style.display = 'none';
      searchContainer.innerHTML = '<input type="text" class="archive-search-input" placeholder="Search archive..." />';
      archiveSearchInput = searchContainer.querySelector('input');
      sectionEl.appendChild(searchContainer);
    }

    const tasksContainer = document.createElement('div');
    tasksContainer.className = 'list-tasks-container';
    tasksContainer.dataset.sectionId = section.id;
    if (isArchive) tasksContainer.style.display = 'none';

    sectionTasks.forEach(task => {
      const item = isArchive ? createArchiveListItem(task) : createListItem(task, section);
      if (isBacklog) item.classList.add('backlog-item');
      tasksContainer.appendChild(item);
    });

    // Empty section state (non-archive sections only)
    if (!isArchive && sectionTasks.length === 0) {
      tasksContainer.innerHTML = '<div class="list-section-empty">No tasks — press Enter in the quick-add bar to add one</div>';
    }

    sectionEl.appendChild(tasksContainer);

    // Archive toggle and search
    if (isArchive) {
      header.addEventListener('click', () => {
        const isOpen = sectionEl.classList.contains('open');
        sectionEl.classList.toggle('open', !isOpen);
        tasksContainer.style.display = isOpen ? 'none' : 'block';
        sectionEl.querySelector('.archive-search').style.display = isOpen ? 'none' : 'block';
        header.setAttribute('aria-expanded', String(!isOpen));
      });

      archiveSearchInput.addEventListener('input', () => {
        const query = archiveSearchInput.value.toLowerCase();
        tasksContainer.querySelectorAll('.list-item').forEach(item => {
          const text = item.textContent.toLowerCase();
          item.style.display = text.includes(query) ? '' : 'none';
        });
      });
    } else {
      // Drag-and-drop handlers for section
      const getDropPosition = (e, container) => {
        const items = [...container.querySelectorAll('.list-item:not(.dragging)')];
        let insertBeforeEl = null;
        let dropIndex = items.length;
        for (let i = 0; i < items.length; i++) {
          const rect = items[i].getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            insertBeforeEl = items[i];
            dropIndex = i;
            break;
          }
        }
        return { insertBeforeEl, dropIndex };
      };

      const showDropIndicator = (e) => {
        tasksContainer.querySelectorAll('.list-drop-indicator').forEach(el => el.remove());
        const { insertBeforeEl } = getDropPosition(e, tasksContainer);
        const indicator = document.createElement('div');
        indicator.className = 'list-drop-indicator';
        if (insertBeforeEl) { tasksContainer.insertBefore(indicator, insertBeforeEl); }
        else { tasksContainer.appendChild(indicator); }
      };

      sectionEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        sectionEl.classList.add('drag-over');
        showDropIndicator(e);
      });

      sectionEl.addEventListener('dragleave', (e) => {
        if (!sectionEl.contains(e.relatedTarget)) {
          sectionEl.classList.remove('drag-over');
          tasksContainer.querySelectorAll('.list-drop-indicator').forEach(el => el.remove());
        }
      });

      sectionEl.addEventListener('drop', (e) => {
        e.preventDefault();
        sectionEl.classList.remove('drag-over');
        tasksContainer.querySelectorAll('.list-drop-indicator').forEach(el => el.remove());
        const taskId = parseFloat(e.dataTransfer.getData('text/plain'));
        if (!taskId) return;
        const { dropIndex } = getDropPosition(e, tasksContainer);
        moveTask(taskId, section.id, dropIndex);
      });
    }

    listView.appendChild(sectionEl);
  });

  // Add Section button
  const addSectionBtn = document.createElement('div');
  addSectionBtn.className = 'list-add-section';
  addSectionBtn.textContent = '+ Add Section';
  addSectionBtn.addEventListener('click', () => { startAddingListSection(addSectionBtn); });
  listView.appendChild(addSectionBtn);

  // Restore scroll positions after rendering
  listView.querySelectorAll('.list-tasks-container').forEach(container => {
    const sectionId = container.dataset.sectionId;
    if (sectionId && scrollPositions[sectionId] !== undefined) {
      container.scrollTop = scrollPositions[sectionId];
    }
  });
}

function startEditingListSectionTitle(titleEl, section) {
  const { tasks } = getState();
  const input = document.createElement('input');
  input.type = 'text';
  input.value = section.name;
  input.className = 'inline-edit-input';
  input.style.width = '200px';

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

function startAddingListSection(btn) {
  const { sections, tasks } = getState();
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Section name...';
  input.className = 'inline-edit-input';

  btn.innerHTML = '';
  btn.appendChild(input);
  input.focus();

  let saved = false;
  const saveSection = () => {
    if (saved) return;
    saved = true;
    const name = input.value.trim();
    if (name) {
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

function createListItem(task, section) {
  const item = document.createElement('div');
  item.className = 'list-item';
  item.draggable = true;
  item.dataset.taskId = task.id;

  item.addEventListener('dragstart', (e) => {
    item.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.querySelectorAll('.list-drop-indicator').forEach(el => el.remove());
    document.querySelectorAll('.list-section.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  const checkbox = document.createElement('span');
  checkbox.className = `checkbox ${task.checked ? 'checked' : ''}`;
  checkbox.setAttribute('role', 'checkbox');
  checkbox.setAttribute('aria-checked', task.checked ? 'true' : 'false');
  checkbox.setAttribute('tabindex', '0');
  const toggleCheckbox = (e) => {
    e.stopPropagation();
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
  };
  checkbox.addEventListener('click', toggleCheckbox);
  checkbox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCheckbox(e); }
  });

  const content = document.createElement('div');
  content.className = 'list-item-content';

  const titleRow = document.createElement('div');
  titleRow.className = 'list-item-title-row';

  const priority = task.priority || 'medium';
  const priorityDot = document.createElement('span');
  priorityDot.className = `priority-dot priority-${priority}`;
  priorityDot.setAttribute('role', 'button');
  priorityDot.setAttribute('tabindex', '0');
  priorityDot.setAttribute('aria-label', `Priority: ${priority} — click to cycle`);
  priorityDot.title = `Priority: ${priority} — click to cycle`;
  const cyclePriority = (e) => {
    e.stopPropagation();
    const cycle = { low: 'medium', medium: 'high', high: 'low' };
    task.priority = cycle[task.priority || 'medium'];
    markChanged(task);
    getRenderTasks()();
  };
  priorityDot.addEventListener('click', cyclePriority);
  priorityDot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cyclePriority(e); }
  });

  const title = document.createElement('div');
  title.className = `list-item-title ${task.checked ? 'checked' : ''}`;
  title.innerHTML = renderLinks(task.title);
  title.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    e.stopPropagation();
    startEditingListItem(title, task);
  });

  titleRow.appendChild(priorityDot);
  titleRow.appendChild(title);

  if (task.taskId) {
    const taskIdSpan = document.createElement('span');
    taskIdSpan.className = 'task-id';
    taskIdSpan.textContent = task.taskId;
    titleRow.appendChild(taskIdSpan);
  }

  content.appendChild(titleRow);

  if (task.note) {
    const note = document.createElement('div');
    note.className = 'list-item-note';
    note.innerHTML = renderLinks(task.note);
    note.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      e.stopPropagation();
      startEditingListNote(note, task);
    });
    content.appendChild(note);
  } else {
    const addNote = document.createElement('div');
    addNote.className = 'list-item-note add-note';
    addNote.textContent = '+ Add note';
    addNote.addEventListener('click', (e) => {
      e.stopPropagation();
      startEditingListNote(addNote, task);
    });
    content.appendChild(addNote);
  }

  // Date badge
  if (task.created) {
    const badge = document.createElement('span');
    badge.className = 'date-badge';
    if (task.checked && (task.updated || task.created)) {
      const doneDate = new Date((task.updated || task.created) + 'T00:00:00');
      const daysAgo = Math.floor((new Date() - doneDate) / (1000 * 60 * 60 * 24));
      badge.textContent = `done ${daysAgo}d ago`;
    } else {
      badge.textContent = task.created;
    }
    content.appendChild(badge);
  }

  if (task.subtasks && task.subtasks.length > 0) {
    const subtasksContainer = document.createElement('div');
    subtasksContainer.className = 'list-item-subtasks';

    const needsCollapse = task.subtasks.length > SUBTASK_COLLAPSE_THRESHOLD;
    const isExpanded = expandedSubtaskItems.has(task.id);
    const indexed = task.subtasks.map((st, idx) => [idx, st]);
    const visible = (!needsCollapse || isExpanded)
      ? indexed
      : indexed.filter(([, st]) => !st.checked).slice(0, SUBTASK_COLLAPSE_THRESHOLD);

    visible.forEach(([idx, st]) => {
      const subtaskEl = document.createElement('div');
      subtaskEl.className = 'list-item-subtask';

      const stCheckbox = document.createElement('span');
      stCheckbox.className = `checkbox ${st.checked ? 'checked' : ''}`;
      stCheckbox.setAttribute('role', 'checkbox');
      stCheckbox.setAttribute('aria-checked', st.checked ? 'true' : 'false');
      stCheckbox.setAttribute('tabindex', '0');
      const toggleSt = (e) => {
        e.stopPropagation();
        st.checked = !st.checked;
        markChanged(task);
        getRenderTasks()();
      };
      stCheckbox.addEventListener('click', toggleSt);
      stCheckbox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSt(e); }
      });

      const stText = document.createElement('span');
      stText.innerHTML = renderLinks(st.text);
      if (st.checked) {
        stText.classList.add('subtask-text--done');
      }
      stText.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        e.stopPropagation();
        startEditingListSubtask(stText, task, idx);
      });

      subtaskEl.appendChild(stCheckbox);
      subtaskEl.appendChild(stText);
      subtasksContainer.appendChild(subtaskEl);
    });

    if (needsCollapse) {
      const hiddenCount = task.subtasks.length - visible.length;
      const toggleEl = document.createElement('div');
      toggleEl.className = 'list-item-subtask subtask-toggle';
      toggleEl.classList.add('subtask-toggle');
      toggleEl.textContent = isExpanded ? 'Show less' : `+ ${hiddenCount} more`;
      toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expandedSubtaskItems.has(task.id)) expandedSubtaskItems.delete(task.id);
        else expandedSubtaskItems.add(task.id);
        getRenderTasks()();
      });
      subtasksContainer.appendChild(toggleEl);
    }

    content.appendChild(subtasksContainer);
  }

  const addSubtask = document.createElement('div');
  addSubtask.className = 'list-item-add-subtask';
  addSubtask.textContent = '+ Add subtask';
  addSubtask.addEventListener('click', (e) => {
    e.stopPropagation();
    startAddingListSubtask(addSubtask, task);
  });
  content.appendChild(addSubtask);

  const actions = document.createElement('div');
  actions.className = 'list-item-actions';
  actions.innerHTML = '<button aria-label="Delete task" title="Delete task">&times;</button>';
  actions.querySelector('button').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task);
  });

  item.appendChild(checkbox);
  item.appendChild(content);
  item.appendChild(actions);

  return item;
}

function startEditingListNote(noteEl, task) {
  const input = document.createElement('textarea');
  input.rows = 2;
  input.value = task.note || '';
  input.placeholder = 'Add a note...';
  input.className = 'inline-edit-textarea';

  noteEl.replaceWith(input);
  input.focus();

  let saved = false;
  const saveEdit = () => {
    if (saved) return;
    saved = true;
    task.note = input.value.trim();
    markChanged(task);
    getRenderTasks()();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { saved = true; getRenderTasks()(); }
  });
  input.addEventListener('blur', saveEdit);
}

function startEditingListSubtask(subtaskEl, task, idx) {
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

function startAddingListSubtask(el, task) {
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
    if (text) {
      if (!task.subtasks) task.subtasks = [];
      task.subtasks.push({ text, checked: false });
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

function startEditingListItem(titleEl, task) {
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

function createArchiveListItem(task) {
  const item = document.createElement('div');
  item.className = 'list-item archive-item';
  item.draggable = false;

  const checkbox = document.createElement('span');
  checkbox.className = 'checkbox checked';

  const content = document.createElement('div');
  content.className = 'list-item-content';

  const title = document.createElement('div');
  title.className = 'list-item-title checked';
  title.innerHTML = renderLinks(task.title);
  content.appendChild(title);

  if (task.note) {
    const note = document.createElement('div');
    note.className = 'list-item-note';
    note.innerHTML = renderLinks(task.note);
    content.appendChild(note);
  }

  // Date badge
  if (task.created) {
    const badge = document.createElement('span');
    badge.className = 'date-badge';
    const doneDate = new Date((task.updated || task.created) + 'T00:00:00');
    const daysAgo = Math.floor((new Date() - doneDate) / (1000 * 60 * 60 * 24));
    badge.textContent = `done ${daysAgo}d ago`;
    content.appendChild(badge);
  }

  item.appendChild(checkbox);
  item.appendChild(content);

  return item;
}

function showSectionPicker(anchorEl) {
  const { sections } = getState();
  document.querySelectorAll('.section-picker').forEach(el => el.remove());
  const picker = document.createElement('div');
  picker.className = 'section-picker';
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.style.right = (window.innerWidth - rect.right) + 'px';

  sections.forEach(section => {
    const btn = document.createElement('button');
    btn.textContent = section.name;
    btn.addEventListener('click', () => {
      getState().quickAddSection = section.id;
      picker.remove();
      getRenderTasks()();
      setTimeout(() => document.getElementById('quickAddInput')?.focus(), 10);
    });
    picker.appendChild(btn);
  });

  document.body.appendChild(picker);
  setTimeout(() => {
    document.addEventListener('click', function closeHandler(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    });
  }, 10);
}
