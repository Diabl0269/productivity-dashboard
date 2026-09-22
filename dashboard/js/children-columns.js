// children-columns.js — Configurable columns for Work tab children grid

import { readCustomFields } from './custom-fields.js';

const STORAGE_KEY = 'dashboard.childrenColumns';
const WIDTHS_KEY = 'dashboard.childrenColumnWidths';

/** Stable id for the main ticket/title column. */
export const TICKET_COLUMN_ID = 'ticket';

/** @type {Record<string, { label: string, builtin?: boolean }>} */
export const CHILD_COLUMN_DEFS = {
  status: { label: 'Status', builtin: true },
  due: { label: 'Due', builtin: true },
  estimate: { label: 'Est', builtin: true },
  energy: { label: 'Energy', builtin: true },
  model: { label: 'Model', builtin: true },
  blocked: { label: 'Blocked', builtin: true },
  type: { label: 'Type', builtin: true },
  priority: { label: 'Priority', builtin: true },
  project: { label: 'Project', builtin: true },
  assignee: { label: 'Assignee', builtin: true },
};

export const DEFAULT_CHILD_COLUMNS = ['status', 'due', 'estimate', 'energy', 'model', 'blocked'];

const DEFAULT_WIDTHS = {
  [TICKET_COLUMN_ID]: 220,
  status: 88,
  due: 72,
  estimate: 56,
  energy: 64,
  model: 56,
  blocked: 88,
  type: 72,
  priority: 72,
  project: 96,
  assignee: 96,
};

const MIN_WIDTH = {
  [TICKET_COLUMN_ID]: 120,
  default: 48,
};

const MAX_WIDTH = {
  [TICKET_COLUMN_ID]: 520,
  default: 280,
};

function allColumnIds() {
  const custom = readCustomFields().map(f => `custom:${f.id}`);
  return [...Object.keys(CHILD_COLUMN_DEFS), ...custom];
}

export function columnLabel(colId) {
  if (colId === TICKET_COLUMN_ID) return 'Ticket';
  if (colId.startsWith('custom:')) {
    const id = colId.slice(7);
    const cf = readCustomFields().find(f => f.id === id);
    return cf?.label || id;
  }
  return CHILD_COLUMN_DEFS[colId]?.label || colId;
}

export function readChildrenColumns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const known = new Set(allColumnIds());
    if (!raw) return [...DEFAULT_CHILD_COLUMNS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_CHILD_COLUMNS];
    const cols = parsed.filter(id => known.has(id));
    return cols.length ? cols : [...DEFAULT_CHILD_COLUMNS];
  } catch {
    return [...DEFAULT_CHILD_COLUMNS];
  }
}

export function writeChildrenColumns(cols) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
  } catch { /* ignore */ }
}

export function toggleChildrenColumn(colId) {
  const cols = readChildrenColumns();
  const idx = cols.indexOf(colId);
  if (idx >= 0) cols.splice(idx, 1);
  else cols.push(colId);
  writeChildrenColumns(cols);
  return cols;
}

function clampWidth(colId, px) {
  const min = MIN_WIDTH[colId] ?? MIN_WIDTH.default;
  const max = MAX_WIDTH[colId] ?? MAX_WIDTH.default;
  const n = Math.round(Number(px));
  if (!Number.isFinite(n)) return defaultWidthFor(colId);
  return Math.min(max, Math.max(min, n));
}

function defaultWidthFor(colId) {
  if (DEFAULT_WIDTHS[colId] != null) return DEFAULT_WIDTHS[colId];
  if (colId.startsWith('custom:')) return 96;
  return 72;
}

export function readChildrenColumnWidths() {
  try {
    const raw = localStorage.getItem(WIDTHS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [id, val] of Object.entries(parsed)) {
      if (typeof val === 'number' && Number.isFinite(val)) out[id] = clampWidth(id, val);
    }
    return out;
  } catch {
    return {};
  }
}

export function writeChildrenColumnWidths(widths) {
  try {
    const clean = {};
    for (const [id, val] of Object.entries(widths || {})) {
      if (typeof val === 'number' && Number.isFinite(val)) clean[id] = clampWidth(id, val);
    }
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(clean));
  } catch { /* ignore */ }
}

export function setChildrenColumnWidth(colId, px) {
  const widths = readChildrenColumnWidths();
  widths[colId] = clampWidth(colId, px);
  writeChildrenColumnWidths(widths);
  return widths[colId];
}

export function widthForColumn(colId, widths = readChildrenColumnWidths()) {
  if (widths[colId] != null) return clampWidth(colId, widths[colId]);
  return defaultWidthFor(colId);
}

/**
 * CSS grid-template-columns for ticket + visible data columns.
 * @param {string[]} columns
 * @param {Record<string, number>} [widths]
 */
export function childrenGridTemplate(columns, widths = readChildrenColumnWidths()) {
  const parts = [`${widthForColumn(TICKET_COLUMN_ID, widths)}px`];
  for (const colId of columns) {
    parts.push(`${widthForColumn(colId, widths)}px`);
  }
  return parts.join(' ');
}

/** Apply persisted column widths to a children grid element. */
export function applyChildrenGridWidths(grid, columns, widths = readChildrenColumnWidths()) {
  if (!grid) return;
  grid.style.setProperty('--td-children-cols', childrenGridTemplate(columns, widths));
}

/**
 * Bind drag-to-resize on a header cell. Persists width on pointer up.
 * @param {HTMLElement} handle
 * @param {string} colId
 * @param {HTMLElement} grid
 * @param {string[]} columns
 */
export function bindChildrenColumnResize(handle, colId, grid, columns) {
  if (!handle || !grid) return;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startW = widthForColumn(colId);
    const widths = { ...readChildrenColumnWidths() };
    handle.setPointerCapture?.(e.pointerId);
    document.body.classList.add('td-children-resizing');

    const onMove = (ev) => {
      const next = clampWidth(colId, startW + (ev.clientX - startX));
      widths[colId] = next;
      applyChildrenGridWidths(grid, columns, widths);
    };
    const onUp = (ev) => {
      document.body.classList.remove('td-children-resizing');
      handle.releasePointerCapture?.(ev.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const finalW = clampWidth(colId, startW + (ev.clientX - startX));
      setChildrenColumnWidth(colId, finalW);
      applyChildrenGridWidths(grid, columns);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}
