// custom-fields.js — Custom task fields + hide built-in fields (localStorage)

import { ALL_FIELD_IDS } from './task-field-layout.js';
import { escapeHtml } from './ticket-types.js';

const CUSTOM_FIELDS_KEY = 'dashboard.customFields';
const HIDDEN_FIELDS_KEY = 'dashboard.hiddenFields';

/** Built-in field labels for settings UI. */
export const BUILTIN_FIELD_LABELS = {
  priority: 'Priority',
  status: 'Status',
  due: 'Due',
  start: 'Start',
  jiraKey: 'Jira key',
  issueUrl: 'Issue URL',
  project: 'Project',
  energy: 'Energy',
  model: 'Model',
  snoozeUntil: 'Snooze until',
  type: 'Type',
  color: 'Color',
  parent: 'Parent',
  blocked: 'Blocked',
  waitingOn: 'Waiting on',
  assignee: 'Assignee',
  estimate: 'Estimate',
  recurrence: 'Recurrence',
  labels: 'Labels',
  links: 'Links',
  description: 'Description',
};

const FIELD_ID_RE = /^[a-z][a-z0-9-]*$/;

export function isValidCustomFieldId(id) {
  return typeof id === 'string' && FIELD_ID_RE.test(id);
}

export function slugifyFieldId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'field';
}

/** @returns {{ id: string, label: string }[]} */
export function readCustomFields() {
  try {
    const raw = localStorage.getItem(CUSTOM_FIELDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(f => f && typeof f.id === 'string' && typeof f.label === 'string')
      .map(f => ({ id: f.id.trim(), label: f.label.trim() }))
      .filter(f => isValidCustomFieldId(f.id) && f.label);
  } catch {
    return [];
  }
}

export function writeCustomFields(fields) {
  try {
    localStorage.setItem(CUSTOM_FIELDS_KEY, JSON.stringify(fields));
  } catch { /* ignore */ }
}

/** @returns {Set<string>} */
export function readHiddenFields() {
  try {
    const raw = localStorage.getItem(HIDDEN_FIELDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(id => ALL_FIELD_IDS.includes(id) || String(id).startsWith('custom:')));
  } catch {
    return new Set();
  }
}

export function writeHiddenFields(ids) {
  try {
    localStorage.setItem(HIDDEN_FIELDS_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

export function customFieldKey(fieldId) {
  return `custom:${fieldId}`;
}

export function parseCustomFieldKey(fieldKey) {
  if (!fieldKey || !String(fieldKey).startsWith('custom:')) return null;
  return String(fieldKey).slice(7);
}

export function isBuiltinFieldHidden(fieldId) {
  return readHiddenFields().has(fieldId);
}

/** Whether a built-in or custom field should appear in create/detail modals. */
export function isFieldVisible(fieldId) {
  return !readHiddenFields().has(fieldId);
}

export function allLayoutFieldIds() {
  const custom = readCustomFields().map(f => customFieldKey(f.id));
  const builtin = [...ALL_FIELD_IDS];
  return [...builtin, ...custom];
}

export function readCustomValue(task, fieldId) {
  if (!task?.custom || typeof task.custom !== 'object') return '';
  const v = task.custom[fieldId];
  return v == null ? '' : String(v);
}

export function writeCustomValue(task, fieldId, value) {
  if (!task.custom || typeof task.custom !== 'object') task.custom = {};
  const s = String(value || '').trim();
  if (!s) {
    delete task.custom[fieldId];
    if (Object.keys(task.custom).length === 0) delete task.custom;
  } else {
    task.custom[fieldId] = s;
  }
}

export function readCustomFromJson(t) {
  if (!t?.custom || typeof t.custom !== 'object' || Array.isArray(t.custom)) return {};
  const out = {};
  for (const [k, v] of Object.entries(t.custom)) {
    if (!isValidCustomFieldId(k)) continue;
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : {};
}

export function serializeCustomToJson(task) {
  if (!task?.custom || typeof task.custom !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(task.custom)) {
    if (!isValidCustomFieldId(k)) continue;
    const s = String(v || '').trim();
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}
