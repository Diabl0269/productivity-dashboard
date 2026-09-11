// children-columns.js — Configurable columns for Work tab children grid

import { readCustomFields } from './custom-fields.js';

const STORAGE_KEY = 'dashboard.childrenColumns';

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

function allColumnIds() {
  const custom = readCustomFields().map(f => `custom:${f.id}`);
  return [...Object.keys(CHILD_COLUMN_DEFS), ...custom];
}

export function columnLabel(colId) {
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
