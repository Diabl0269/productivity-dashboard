// task-field-layout.js — Pinned / unpinned field order for create + detail modals.

export const STORAGE_KEY = 'dashboard.taskFieldLayout';
const LEGACY_STORAGE_KEY = 'dashboard.taskCreateFieldLayout';

/** All pinable field ids (title stays in the modal header). */
export const ALL_FIELD_IDS = [
  'priority', 'status', 'due', 'start', 'jiraKey', 'issueUrl', 'project', 'energy',
  'snoozeUntil', 'type', 'color', 'parent', 'blocked', 'waitingOn', 'assignee',
  'estimate', 'recurrence', 'labels', 'links', 'description',
];

const DEFAULT_PINNED = ['priority', 'status', 'type', 'parent', 'labels', 'links'];

const DEFAULT_UNPINNED = ALL_FIELD_IDS.filter(id => !DEFAULT_PINNED.includes(id));

/** Fields that span the full row in the layout grid. */
export const WIDE_FIELD_IDS = new Set([
  'issueUrl', 'waitingOn', 'assignee', 'description', 'labels', 'links', 'color', 'recurrence', 'parent',
]);

function defaultLayout() {
  return {
    pinned: [...DEFAULT_PINNED],
    unpinned: [...DEFAULT_UNPINNED],
  };
}

function dedupeList(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeLayout(parsed) {
  const base = defaultLayout();
  const known = new Set(ALL_FIELD_IDS);

  let pinned = Array.isArray(parsed?.pinned)
    ? dedupeList(parsed.pinned.filter(id => known.has(id)))
    : [...base.pinned];
  let unpinned = Array.isArray(parsed?.unpinned)
    ? dedupeList(parsed.unpinned.filter(id => known.has(id)))
    : [...base.unpinned];

  const pinnedSet = new Set(pinned);
  unpinned = unpinned.filter(id => !pinnedSet.has(id));

  for (const id of ALL_FIELD_IDS) {
    if (!pinnedSet.has(id) && !unpinned.includes(id)) unpinned.push(id);
  }

  return { pinned, unpinned };
}

export function loadFieldLayout() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
      }
    }
    if (!raw) return defaultLayout();
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return defaultLayout();
  }
}

export function saveFieldLayout(layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeLayout(layout)));
  } catch { /* ignore */ }
}

export function isFieldPinned(fieldId, layout = loadFieldLayout()) {
  return layout.pinned.includes(fieldId);
}

export function toggleFieldPin(fieldId) {
  const layout = loadFieldLayout();
  const pinIdx = layout.pinned.indexOf(fieldId);
  if (pinIdx >= 0) {
    layout.pinned.splice(pinIdx, 1);
    layout.unpinned.unshift(fieldId);
  } else {
    const unIdx = layout.unpinned.indexOf(fieldId);
    if (unIdx >= 0) layout.unpinned.splice(unIdx, 1);
    layout.pinned.push(fieldId);
  }
  saveFieldLayout(layout);
  return layout;
}

/**
 * Move a field within or across pinned / unpinned lists.
 * @param {string} fieldId
 * @param {'pinned'|'unpinned'} targetSection
 * @param {string|null} beforeFieldId Insert before this id; null = append.
 */
export function moveField(fieldId, targetSection, beforeFieldId = null) {
  const layout = loadFieldLayout();
  layout.pinned = layout.pinned.filter(id => id !== fieldId);
  layout.unpinned = layout.unpinned.filter(id => id !== fieldId);

  const list = targetSection === 'pinned' ? layout.pinned : layout.unpinned;
  if (beforeFieldId && beforeFieldId !== fieldId) {
    const idx = list.indexOf(beforeFieldId);
    list.splice(idx >= 0 ? idx : list.length, 0, fieldId);
  } else {
    list.push(fieldId);
  }

  saveFieldLayout(layout);
  return layout;
}

let dragId = null;
const boundBodies = new WeakSet();
/** @type {WeakMap<HTMLElement, () => void>} */
const bodyCallbacks = new WeakMap();

/**
 * Bind HTML5 drag-and-drop on a container (create body or detail essentials pane).
 * Safe to call multiple times / on multiple containers.
 * @param {HTMLElement} body
 * @param {() => void} onLayoutChange
 */
export function bindFieldLayoutDnD(body, onLayoutChange) {
  if (!body) return;
  bodyCallbacks.set(body, onLayoutChange);
  if (boundBodies.has(body)) return;
  boundBodies.add(body);

  body.addEventListener('dragstart', (e) => {
    const shell = e.target.closest('.td-field-shell');
    if (!shell || !body.contains(shell)) return;
    dragId = shell.dataset.fieldId;
    shell.classList.add('td-field-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });

  body.addEventListener('dragend', (e) => {
    const shell = e.target.closest('.td-field-shell');
    if (shell) shell.classList.remove('td-field-dragging');
    dragId = null;
    body.querySelectorAll('.td-field-drag-over').forEach(el => el.classList.remove('td-field-drag-over'));
  });

  body.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest('.td-field-shell');
    const list = e.target.closest('.tc-field-list');
    body.querySelectorAll('.td-field-drag-over').forEach(el => el.classList.remove('td-field-drag-over'));
    if (over && body.contains(over) && over.dataset.fieldId !== dragId) {
      over.classList.add('td-field-drag-over');
    } else if (list && body.contains(list) && !over) {
      list.classList.add('td-field-drag-over');
    }
  });

  body.addEventListener('dragleave', (e) => {
    const list = e.target.closest('.tc-field-list');
    if (list && body.contains(list) && !list.contains(e.relatedTarget)) {
      list.classList.remove('td-field-drag-over');
    }
  });

  body.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest('.td-field-shell');
    const list = e.target.closest('.tc-field-list');
    body.querySelectorAll('.td-field-drag-over').forEach(el => el.classList.remove('td-field-drag-over'));
    if (!list || !body.contains(list)) return;

    const targetSection = list.dataset.section === 'pinned' ? 'pinned' : 'unpinned';
    const beforeFieldId = over && over.dataset.fieldId !== dragId ? over.dataset.fieldId : null;
    moveField(dragId, targetSection, beforeFieldId);
    dragId = null;
    const cb = bodyCallbacks.get(body);
    if (cb) cb();
  });
}

const PIN_ICON_FILLED =
  '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.193c.046.702-.275 1.533-.64 1.899a.5.5 0 0 1-.707 0l-2.475-2.475-3.182 3.182a.5.5 0 0 1-.707-.707L5.318 9.975 2.843 7.5a.5.5 0 0 1 0-.707c.366-.366 1.197-.687 1.899-.64.39.03.8.097 1.193.16l3.134-3.134a2.712 2.712 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/></svg>';

const PIN_ICON_OUTLINE =
  '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.146l.888.332A2.5 2.5 0 0 1 14 9.07V10.5a.5.5 0 0 1-.5.5h-3v3.5a.5.5 0 0 1-1 0V11h-3a.5.5 0 0 1-.5-.5V9.07a2.5 2.5 0 0 1 1.512-2.294L7 6.423V2.277a2.23 2.23 0 0 1-.354-.298C6.342 1.674 6 1.179 6 .5a.5.5 0 0 1-.354-.854zM5.002 1.5a1.627 1.627 0 0 0 .172.5H10.83a1.61 1.61 0 0 0 .17-.5H5.002zM7.888 7.154A1.5 1.5 0 0 0 7 8.57V10h5V8.57a1.5 1.5 0 0 0-.888-1.416L8.5 6.226l-.612.928z" opacity="0.7"/></svg>';

const UNPINNED_EXPANDED_KEY = 'dashboard.taskFieldUnpinnedExpanded';

/** Default collapsed so Pinned vs Unpinned is obvious on first open. */
export function isUnpinnedExpanded() {
  try {
    const v = localStorage.getItem(UNPINNED_EXPANDED_KEY);
    if (v == null) return false;
    return v !== '0';
  } catch {
    return false;
  }
}

export function setUnpinnedExpanded(expanded) {
  try {
    localStorage.setItem(UNPINNED_EXPANDED_KEY, expanded ? '1' : '0');
  } catch { /* ignore */ }
}

/**
 * Wrap field content in a compact row: [drag] [content] [pin].
 * @param {string} fieldId
 * @param {HTMLElement} contentEl
 * @param {() => void} onPinToggle
 */
export function wrapFieldShell(fieldId, contentEl, onPinToggle) {
  const pinned = isFieldPinned(fieldId);
  const shell = document.createElement('div');
  shell.className = 'td-field-shell'
    + (WIDE_FIELD_IDS.has(fieldId) ? ' td-field-shell-wide' : '')
    + (pinned ? ' is-pinned' : ' is-unpinned');
  shell.dataset.fieldId = fieldId;

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'td-field-drag-handle';
  handle.title = 'Drag to reorder';
  handle.setAttribute('aria-label', 'Drag to reorder');
  handle.textContent = '⋮⋮';
  handle.addEventListener('mousedown', () => { shell.draggable = true; });
  handle.addEventListener('mouseup', () => { shell.draggable = false; });
  handle.addEventListener('mouseleave', () => { shell.draggable = false; });

  const content = document.createElement('div');
  content.className = 'td-field-shell-content';
  content.appendChild(contentEl);

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'td-field-pin-btn' + (pinned ? ' pinned' : '');
  pinBtn.title = pinned ? 'Unpin — move to Unpinned' : 'Pin — move to Pinned';
  pinBtn.setAttribute('aria-label', pinned ? 'Unpin field' : 'Pin field');
  pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  pinBtn.innerHTML = pinned ? PIN_ICON_FILLED : PIN_ICON_OUTLINE;
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onPinToggle(fieldId);
  });

  shell.appendChild(handle);
  shell.appendChild(content);
  shell.appendChild(pinBtn);

  return shell;
}

/**
 * Mount Pinned + Unpinned sections into a container.
 * @param {HTMLElement} container
 * @param {{
 *   factories: Record<string, () => (HTMLElement|null|undefined)>,
 *   onLayoutChange: () => void,
 *   markShell?: (fieldId: string, shell: HTMLElement) => void,
 * }} opts
 */
export function mountFieldLayoutSections(container, { factories, onLayoutChange, markShell }) {
  const layout = loadFieldLayout();

  const pinToggle = (fieldId) => {
    toggleFieldPin(fieldId);
    onLayoutChange();
  };

  container.appendChild(createFieldSection({
    title: 'Pinned Fields',
    hint: '',
    sectionKey: 'pinned',
    fieldIds: layout.pinned,
    factories,
    collapsible: false,
    onPinToggle: pinToggle,
    markShell,
  }));

  container.appendChild(createFieldSection({
    title: 'More fields',
    hint: '',
    sectionKey: 'unpinned',
    fieldIds: layout.unpinned,
    factories,
    collapsible: true,
    onPinToggle: pinToggle,
    markShell,
  }));

  bindFieldLayoutDnD(container, onLayoutChange);
}

function createFieldSection({
  title, hint, sectionKey, fieldIds, factories, collapsible, onPinToggle, markShell,
}) {
  const section = document.createElement('section');
  section.className = 'tc-field-section tc-field-section-' + sectionKey;

  const header = document.createElement(collapsible ? 'button' : 'div');
  if (collapsible) header.type = 'button';
  header.className = 'tc-field-section-header' + (collapsible ? ' tc-field-section-toggle' : '');

  const titleEl = document.createElement('span');
  titleEl.className = 'tc-field-section-title';
  titleEl.textContent = title;

  const countEl = document.createElement('span');
  countEl.className = 'tc-field-section-count';

  header.appendChild(titleEl);
  header.appendChild(countEl);

  if (collapsible) {
    const chevron = document.createElement('span');
    chevron.className = 'tc-field-section-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';
    header.appendChild(chevron);
  }

  section.appendChild(header);

  if (hint) {
    const hintEl = document.createElement('p');
    hintEl.className = 'tc-field-section-hint';
    hintEl.textContent = hint;
    section.appendChild(hintEl);
  }

  const list = document.createElement('div');
  list.className = 'tc-field-list';
  list.dataset.section = sectionKey;

  let visibleCount = 0;
  fieldIds.forEach(fieldId => {
    const factory = factories[fieldId];
    if (!factory) return;
    const content = factory();
    if (!content) return;
    const shell = wrapFieldShell(fieldId, content, onPinToggle);
    if (markShell) markShell(fieldId, shell);
    list.appendChild(shell);
    visibleCount += 1;
  });

  countEl.textContent = String(visibleCount);
  section.appendChild(list);

  if (collapsible) {
    const expanded = isUnpinnedExpanded();
    section.classList.toggle('is-collapsed', !expanded);
    header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    header.addEventListener('click', () => {
      const next = section.classList.contains('is-collapsed');
      section.classList.toggle('is-collapsed', !next);
      header.setAttribute('aria-expanded', next ? 'true' : 'false');
      setUnpinnedExpanded(next);
    });
  }

  return section;
}
