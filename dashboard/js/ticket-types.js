// ticket-types.js — Shared helpers for ticket-type hierarchy + colors

export const DEFAULT_TICKET_TYPES = [
  { id: 'epic', name: 'Epic', color: '#8B5CF6' },
  { id: 'task', name: 'Task', color: '#3B82F6' },
  { id: 'subtask', name: 'Subtask', color: '#14B8A6' },
];

export const DEFAULT_TICKET_TYPE_ID = 'task';

/** Deep-clone defaults or normalize a stored list. */
export function normalizeTicketTypes(types) {
  if (!Array.isArray(types) || types.length === 0) {
    return DEFAULT_TICKET_TYPES.map(t => ({ ...t }));
  }
  return types.map(t => ({
    id: String(t.id || ''),
    name: String(t.name || t.id || ''),
    color: String(t.color || '#888888'),
  }));
}

/** Look up a ticket type by id (falls back to default task type). */
export function getTicketType(types, typeId) {
  const list = normalizeTicketTypes(types);
  const id = typeId || DEFAULT_TICKET_TYPE_ID;
  return list.find(t => t.id === id) || list.find(t => t.id === DEFAULT_TICKET_TYPE_ID) || list[0];
}

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/** True if value is a #RRGGBB hex color. */
export function isHexColor(c) {
  return typeof c === 'string' && COLOR_RE.test(c);
}

/**
 * Find a task by stable taskId across all sections.
 * @returns {object|null}
 */
export function findTaskByTaskId(tasksBySection, taskId) {
  if (!taskId || !tasksBySection) return null;
  for (const list of Object.values(tasksBySection)) {
    for (const t of list || []) {
      if (t.taskId === taskId) return t;
    }
  }
  return null;
}

/**
 * Color inherited when the ticket has no custom override:
 * walk parent chain, then fall back to this ticket's type color.
 * @param {object} task
 * @param {any} ticketTypes
 * @param {object} [tasksBySection]
 * @returns {string}
 */
export function inheritedTaskColor(task, ticketTypes, tasksBySection, seen = new Set()) {
  const parentId = task?.parentId;
  if (parentId && tasksBySection) {
    if (task.taskId) seen.add(task.taskId);
    if (!seen.has(parentId)) {
      seen.add(parentId);
      const parent = findTaskByTaskId(tasksBySection, parentId);
      if (parent) return resolveTaskColor(parent, ticketTypes, tasksBySection, seen);
    }
  }
  return getTicketType(ticketTypes, task?.type).color;
}

/**
 * Effective color: custom override → parent chain → type default.
 * @param {object} task
 * @param {any} ticketTypes
 * @param {object} [tasksBySection]
 * @returns {string}
 */
export function resolveTaskColor(task, ticketTypes, tasksBySection, seen = new Set()) {
  if (isHexColor(task?.color)) return task.color;
  return inheritedTaskColor(task, ticketTypes, tasksBySection, seen);
}

/**
 * Short label for what a ticket inherits from (parent id or type name).
 */
export function inheritColorLabel(task, ticketTypes, tasksBySection) {
  if (task?.parentId && tasksBySection) {
    const parent = findTaskByTaskId(tasksBySection, task.parentId);
    if (parent) return parent.taskId || 'parent';
    return task.parentId;
  }
  return getTicketType(ticketTypes, task?.type).name + ' type';
}

/**
 * Inline color controls for create/detail modals.
 *
 * Returns:
 *   swatch  — circular label that opens the native color picker (when override is on)
 *   override — checkbox label ("Override parent/type color") for the main form
 *
 * @param {{
 *   color: string,
 *   customColor?: string|null,
 *   inheritedColor?: string,
 *   inheritFrom?: string,
 *   hasParent?: boolean,
 *   onChange: (hex: string|null) => void,
 * }} opts
 * @returns {{ swatch: HTMLLabelElement, override: HTMLLabelElement }}
 */
export function makeColorControls({
  color,
  customColor = null,
  inheritedColor = null,
  inheritFrom = 'type',
  hasParent = false,
  onChange,
}) {
  const inherit = isHexColor(inheritedColor)
    ? inheritedColor
    : (isHexColor(color) ? color : '#888888');
  let isOverride = isHexColor(customColor);
  let draftHex = isOverride ? customColor : inherit;

  const wrap = document.createElement('label');
  wrap.className = 'task-color-wrap' + (isOverride ? '' : ' disabled');
  wrap.title = isOverride
    ? 'Custom color — click to change'
    : `Inherits from ${inheritFrom} — enable override to change`;

  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'task-color-input';
  input.value = draftHex;
  input.disabled = !isOverride;
  input.setAttribute('aria-label', 'Ticket color');

  const swatch = document.createElement('span');
  swatch.className = 'task-type-dot task-color-swatch' + (isOverride ? '' : ' inherited');
  swatch.style.background = isOverride ? draftHex : inherit;

  wrap.appendChild(input);
  wrap.appendChild(swatch);

  const override = document.createElement('label');
  override.className = 'task-color-override';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = isOverride;
  const cbText = document.createElement('span');
  cbText.textContent = hasParent ? 'Override parent color' : 'Override type color';
  override.appendChild(cb);
  override.appendChild(cbText);

  const sync = () => {
    wrap.classList.toggle('disabled', !isOverride);
    wrap.title = isOverride
      ? 'Custom color — click to change'
      : `Inherits from ${inheritFrom} — enable override to change`;
    input.disabled = !isOverride;
    swatch.classList.toggle('inherited', !isOverride);
    const shown = isOverride ? draftHex : inherit;
    swatch.style.background = shown;
    input.value = shown;
  };

  cb.addEventListener('change', () => {
    isOverride = cb.checked;
    if (isOverride) draftHex = input.value || inherit;
    sync();
    onChange && onChange(isOverride ? draftHex : null);
  });

  input.addEventListener('input', () => {
    if (!isOverride) return;
    draftHex = input.value;
    swatch.style.background = draftHex;
    onChange && onChange(draftHex);
  });

  input.addEventListener('click', (e) => e.stopPropagation());

  return { swatch: wrap, override };
}

/** Index of a type in the hierarchy (lower = higher in tree). */
export function typeIndex(types, typeId) {
  const list = normalizeTicketTypes(types);
  const idx = list.findIndex(t => t.id === (typeId || DEFAULT_TICKET_TYPE_ID));
  return idx >= 0 ? idx : list.findIndex(t => t.id === DEFAULT_TICKET_TYPE_ID);
}

/**
 * Tasks whose parentId matches the given taskId.
 * @returns {object[]}
 */
export function childTasks(tasksBySection, parentTaskId) {
  if (!parentTaskId) return [];
  const out = [];
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.parentId === parentTaskId) out.push(t);
    }
  }
  return out;
}

/**
 * Valid parent candidates for a child of the given type:
 * any ticket whose type sits above this type in the hierarchy, excluding self.
 */
export function parentCandidates(ticketTypes, tasksBySection, childTypeId, excludeTaskId) {
  const childIdx = typeIndex(ticketTypes, childTypeId);
  if (childIdx <= 0) return [];
  const out = [];
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (!t.taskId || t.taskId === excludeTaskId) continue;
      if (typeIndex(ticketTypes, t.type) < childIdx) out.push(t);
    }
  }
  return out;
}

/** Escape text for safe HTML attribute/text insertion. */
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
