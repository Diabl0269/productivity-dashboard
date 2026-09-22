// work-panels-prefs.js — Which Work-tab panels are mirrored onto Essentials.

const STORAGE_KEY = 'dashboard.workPanelsOnEssentials';

/** @type {readonly string[]} */
export const WORK_PANEL_IDS = Object.freeze(['subtasks', 'children', 'blockedBy']);

const LABELS = {
  subtasks: 'Subtasks',
  children: 'Children',
  blockedBy: 'Blocked by',
};

export function workPanelLabel(panelId) {
  return LABELS[panelId] || panelId;
}

function normalize(list) {
  const known = new Set(WORK_PANEL_IDS);
  const out = [];
  const seen = new Set();
  for (const id of list || []) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function readWorkPanelsOnEssentials() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalize(parsed) : [];
  } catch {
    return [];
  }
}

export function writeWorkPanelsOnEssentials(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(ids)));
  } catch { /* ignore */ }
}

export function isWorkPanelOnEssentials(panelId) {
  return readWorkPanelsOnEssentials().includes(panelId);
}

export function toggleWorkPanelOnEssentials(panelId) {
  if (!WORK_PANEL_IDS.includes(panelId)) return readWorkPanelsOnEssentials();
  const list = readWorkPanelsOnEssentials();
  const idx = list.indexOf(panelId);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(panelId);
  writeWorkPanelsOnEssentials(list);
  return list;
}
