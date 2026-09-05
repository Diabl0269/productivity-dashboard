// ticket-types.js — Shared helpers for ticket-type hierarchy + colors

export const DEFAULT_TICKET_TYPES = [
  { id: 'epic', name: 'Epic', color: '#8B5CF6', parentTypes: [] },
  { id: 'feature', name: 'Feature', color: '#F59E0B', parentTypes: ['epic'] },
  { id: 'task', name: 'Task', color: '#3B82F6', parentTypes: ['epic', 'feature'] },
  { id: 'bug', name: 'Bug', color: '#EF4444', parentTypes: ['epic', 'feature', 'task'] },
];

/** Built-in types are always present and cannot be removed from Settings. */
export const BUILT_IN_TICKET_TYPE_IDS = DEFAULT_TICKET_TYPES.map(t => t.id);

export function isBuiltInTicketType(typeId) {
  return BUILT_IN_TICKET_TYPE_IDS.includes(typeId);
}

/** Valid ticket-type id: lowercase slug (a-z, digits, hyphens). */
export const TYPE_ID_RE = /^[a-z][a-z0-9-]*$/;

/** Palette for auto-picking colors when adding a type in Settings. */
export const TYPE_COLOR_PALETTE = [
  '#8B5CF6', '#F59E0B', '#3B82F6', '#EF4444', '#14B8A6',
  '#EC4899', '#10B981', '#6366F1', '#F97316', '#06B6D4',
];

export const DEFAULT_TICKET_TYPE_ID = 'task';

/** Deep-clone defaults or normalize a stored list. Re-injects missing built-in types. */
export function normalizeTicketTypes(types) {
  let list;
  if (!Array.isArray(types) || types.length === 0) {
    list = DEFAULT_TICKET_TYPES.map(t => ({
      ...t,
      parentTypes: [...t.parentTypes],
    }));
  } else {
    list = types.map((t, idx, all) => {
      const row = {
        id: String(t.id || ''),
        name: String(t.name || t.id || ''),
        color: String(t.color || '#888888'),
      };
      if (Array.isArray(t.parentTypes)) {
        row.parentTypes = t.parentTypes.map(id => String(id));
      } else {
        row.parentTypes = idx > 0
          ? all.slice(0, idx).map(x => String(x.id || '')).filter(Boolean)
          : [];
      }
      return row;
    });
  }
  return ensureBuiltInTicketTypes(list);
}

/** Keep built-in types in canonical order, then append custom types. */
export function ensureBuiltInTicketTypes(types) {
  const byId = new Map((types || []).map(t => [t.id, t]));
  const builtIn = DEFAULT_TICKET_TYPES.map(def => {
    const existing = byId.get(def.id);
    if (!existing) {
      return { ...def, parentTypes: [...def.parentTypes] };
    }
    return {
      id: existing.id,
      name: existing.name || def.name,
      color: existing.color || def.color,
      parentTypes: Array.isArray(existing.parentTypes)
        ? [...existing.parentTypes]
        : [...def.parentTypes],
    };
  });
  const custom = (types || []).filter(t => !isBuiltInTicketType(t.id));
  return [...builtIn, ...custom];
}

/** Whether Settings may delete this type. */
export function canRemoveTicketType(typeId, types, tasksBySection) {
  if (isBuiltInTicketType(typeId)) return false;
  if ((types || []).length <= 1) return false;
  return countTasksWithType(tasksBySection, typeId) === 0;
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
 * Inline color controls for the Color field in create/detail modals.
 *
 * Returns (keep both in the same field so checkbox + picker share state):
 *   swatch   — circular label that opens the native color picker (when override is on)
 *   override — checkbox label ("Override parent/type color")
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

  // Live preview only — native color inputs fire `input` continuously while
  // dragging; persist on `change` (picker closed / value committed).
  input.addEventListener('input', () => {
    if (!isOverride) return;
    draftHex = input.value;
    swatch.style.background = draftHex;
  });

  input.addEventListener('change', () => {
    if (!isOverride) return;
    draftHex = input.value;
    swatch.style.background = draftHex;
    onChange && onChange(draftHex);
  });

  input.addEventListener('click', (e) => e.stopPropagation());

  return { swatch: wrap, override };
}

/** True if id matches the ticket-type slug pattern. */
export function isValidTypeId(id) {
  return typeof id === 'string' && TYPE_ID_RE.test(id);
}

/** Turn a display name into a slug id. */
export function slugifyTypeId(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return slug || 'type';
}

/** Pick an unused id, appending -2, -3, … when needed. */
export function uniqueTypeId(base, usedIds) {
  const used = new Set(usedIds);
  const root = slugifyTypeId(base) || 'type';
  if (!used.has(root)) return root;
  let n = 2;
  while (used.has(`${root}-${n}`)) n++;
  return `${root}-${n}`;
}

/** Next palette color not already used by existing types. */
export function pickNextTypeColor(types) {
  const used = new Set((types || []).map(t => String(t.color || '').toLowerCase()));
  for (const color of TYPE_COLOR_PALETTE) {
    if (!used.has(color.toLowerCase())) return color;
  }
  return TYPE_COLOR_PALETTE[(types || []).length % TYPE_COLOR_PALETTE.length];
}

/** Count tasks assigned to a ticket type across all sections. */
export function countTasksWithType(tasksBySection, typeId) {
  let count = 0;
  for (const list of Object.values(tasksBySection || {})) {
    for (const task of list || []) {
      if (task.type === typeId) count++;
    }
  }
  return count;
}

/** Reorder ticket types (returns a new array). */
export function moveTicketType(types, fromIdx, toIdx) {
  const list = [...types];
  if (fromIdx < 0 || fromIdx >= list.length || toIdx < 0 || toIdx >= list.length) return list;
  const [item] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, item);
  return list;
}

/** Type ids this child may link under (empty = standalone only). */
export function allowedParentTypeIds(ticketTypes, childTypeId) {
  const list = normalizeTicketTypes(ticketTypes);
  const child = list.find(t => t.id === (childTypeId || DEFAULT_TICKET_TYPE_ID));
  if (!child) return [];
  const known = new Set(list.map(t => t.id));
  return (child.parentTypes || []).filter(id => known.has(id) && id !== child.id);
}

/** True when a task of parentTypeId may be a hierarchy parent for childTypeId. */
export function canLinkParentType(ticketTypes, childTypeId, parentTypeId) {
  return allowedParentTypeIds(ticketTypes, childTypeId).includes(parentTypeId);
}

/** Index of a type in the list (display order only). */
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
 * tasks whose type is in this type's allowed parentTypes list.
 */
export function parentCandidates(ticketTypes, tasksBySection, childTypeId, excludeTaskId) {
  const allowed = new Set(allowedParentTypeIds(ticketTypes, childTypeId));
  if (!allowed.size) return [];
  const out = [];
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (!t.taskId || t.taskId === excludeTaskId) continue;
      if (allowed.has(t.type)) out.push(t);
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
