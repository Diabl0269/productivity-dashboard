// ticket-picker.js — Searchable ticket autocomplete with recent picks.

const RECENT_KEY = 'dashboard.recentTickets';
const RECENT_MAX = 8;
const RESULT_MAX = 20;

function readRecentIds() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Record a ticket as recently interacted (opened/edited). */
export function touchRecentTicket(taskId) {
  if (!taskId) return;
  const ids = readRecentIds().filter(id => id !== taskId);
  ids.unshift(taskId);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX)));
  } catch { /* ignore */ }
}

function taskSortKey(task) {
  return task.updated || task.created || '';
}

function matchesQuery(task, q) {
  if (!q) return true;
  const hay = `${task.taskId || ''} ${task.title || ''}`.toLowerCase();
  return hay.includes(q);
}

function formatOptionLabel(task) {
  const title = (task.title || '').trim();
  return title ? `${task.taskId} — ${title}` : (task.taskId || '');
}

/**
 * Mount a searchable ticket picker.
 * @param {HTMLElement} container
 * @param {{
 *   tasks: object[],
 *   value?: string|null,
 *   onChange: (taskId: string|null) => void,
 *   placeholder?: string,
 *   allowNone?: boolean,
 *   noneLabel?: string,
 *   disabled?: boolean,
 *   ariaLabel?: string,
 * }} opts
 * @returns {{ destroy: () => void, setValue: (id: string|null) => void }}
 */
export function mountTicketPicker(container, opts) {
  const {
    tasks = [],
    value = null,
    onChange,
    placeholder = 'Search tickets…',
    allowNone = true,
    noneLabel = '— None —',
    disabled = false,
    ariaLabel = 'Select ticket',
  } = opts;

  let selectedId = value || null;
  let open = false;
  let highlightIdx = -1;
  let outsideHandler = null;

  container.classList.add('tp-wrap');
  container.innerHTML = '';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tp-input';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-label', ariaLabel);
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.disabled = disabled;

  const menu = document.createElement('div');
  menu.className = 'tp-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'tp-clear';
  clearBtn.setAttribute('aria-label', 'Clear selection');
  clearBtn.textContent = '\u00d7';
  clearBtn.hidden = !selectedId;

  container.appendChild(input);
  container.appendChild(clearBtn);
  container.appendChild(menu);

  function selectedTask() {
    return tasks.find(t => t.taskId === selectedId) || null;
  }

  function syncInputFromSelection() {
    const t = selectedTask();
    input.value = t ? formatOptionLabel(t) : '';
    clearBtn.hidden = !selectedId;
  }

  function buildGroups(query) {
    const q = query.trim().toLowerCase();
    const byId = new Map(tasks.map(t => [t.taskId, t]));
    const recent = [];
    for (const id of readRecentIds()) {
      const t = byId.get(id);
      if (t && matchesQuery(t, q)) recent.push(t);
    }
    const recentSet = new Set(recent.map(t => t.taskId));
    const rest = tasks
      .filter(t => !recentSet.has(t.taskId) && matchesQuery(t, q))
      .sort((a, b) => taskSortKey(b).localeCompare(taskSortKey(a))
        || (a.taskId || '').localeCompare(b.taskId || '', undefined, { numeric: true }));
    return { recent, rest };
  }

  function flatOptions(groups) {
    const out = [];
    if (allowNone && !input.value.trim()) {
      out.push({ kind: 'none', id: '', label: noneLabel });
    }
    if (groups.recent.length) {
      out.push({ kind: 'heading', label: 'Recent' });
      for (const t of groups.recent.slice(0, RECENT_MAX)) {
        out.push({ kind: 'task', id: t.taskId, label: formatOptionLabel(t), task: t });
      }
    }
    const matches = groups.rest.slice(0, RESULT_MAX);
    if (matches.length) {
      if (groups.recent.length) out.push({ kind: 'heading', label: 'All tickets' });
      for (const t of matches) {
        out.push({ kind: 'task', id: t.taskId, label: formatOptionLabel(t), task: t });
      }
    }
    if (!out.some(o => o.kind === 'task' || o.kind === 'none')) {
      out.push({ kind: 'empty', label: 'No matching tickets' });
    }
    return out;
  }

  function renderMenu() {
    const groups = buildGroups(input.value);
    const options = flatOptions(groups);
    menu.innerHTML = '';
    highlightIdx = -1;

    for (const opt of options) {
      if (opt.kind === 'heading') {
        const h = document.createElement('div');
        h.className = 'tp-heading';
        h.textContent = opt.label;
        menu.appendChild(h);
        continue;
      }
      if (opt.kind === 'empty') {
        const empty = document.createElement('div');
        empty.className = 'tp-empty';
        empty.textContent = opt.label;
        menu.appendChild(empty);
        continue;
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tp-option';
      row.setAttribute('role', 'option');
      row.dataset.value = opt.id;
      row.textContent = opt.label;
      if (opt.id === selectedId) row.classList.add('selected');
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => pick(opt.id || null));
      menu.appendChild(row);
    }
  }

  function openMenu() {
    if (disabled) return;
    open = true;
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    renderMenu();
    if (!outsideHandler) {
      outsideHandler = (e) => {
        if (!container.contains(e.target)) closeMenu(true);
      };
      document.addEventListener('pointerdown', outsideHandler, true);
    }
  }

  function closeMenu(restoreSelection) {
    open = false;
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    highlightIdx = -1;
    if (outsideHandler) {
      document.removeEventListener('pointerdown', outsideHandler, true);
      outsideHandler = null;
    }
    if (restoreSelection) syncInputFromSelection();
  }

  function pick(taskId) {
    selectedId = taskId || null;
    if (selectedId) touchRecentTicket(selectedId);
    syncInputFromSelection();
    closeMenu(false);
    onChange(selectedId);
  }

  function moveHighlight(delta) {
    const rows = [...menu.querySelectorAll('.tp-option')];
    if (!rows.length) return;
    highlightIdx = (highlightIdx + delta + rows.length) % rows.length;
    rows.forEach((r, i) => r.classList.toggle('highlighted', i === highlightIdx));
    rows[highlightIdx]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('focus', () => {
    input.select();
    openMenu();
  });

  input.addEventListener('input', () => {
    if (!open) openMenu();
    else renderMenu();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openMenu();
      else moveHighlight(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openMenu();
      else moveHighlight(-1);
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const rows = [...menu.querySelectorAll('.tp-option')];
      const row = rows[highlightIdx] || rows[0];
      if (row) pick(row.dataset.value || null);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
      input.blur();
    }
  });

  clearBtn.addEventListener('click', () => pick(null));

  syncInputFromSelection();

  return {
    destroy() {
      closeMenu(false);
      container.innerHTML = '';
      container.classList.remove('tp-wrap');
    },
    setValue(id) {
      selectedId = id || null;
      syncInputFromSelection();
    },
  };
}
