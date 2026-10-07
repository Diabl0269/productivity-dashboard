// work-panels-prefs.js — Work-tab panels mirrored onto Essentials + section order.

const STORAGE_KEY = 'dashboard.workPanelsOnEssentials';
const ORDER_KEY = 'dashboard.essentialsSectionOrder';

/** @type {readonly string[]} */
export const WORK_PANEL_IDS = Object.freeze(['subtasks', 'children', 'blockedBy']);

/** Field sections + work panels that can appear on Essentials (and be reordered). */
export const ESSENTIALS_SECTION_IDS = Object.freeze([
  'pinned',
  'unpinned',
  'subtasks',
  'children',
  'blockedBy',
]);

const LABELS = {
  subtasks: 'Subtasks',
  children: 'Children',
  blockedBy: 'Blocked by',
  pinned: 'Pinned Fields',
  unpinned: 'More fields',
};

export function workPanelLabel(panelId) {
  return LABELS[panelId] || panelId;
}

export function essentialsSectionLabel(sectionId) {
  return LABELS[sectionId] || sectionId;
}

function normalizeWorkList(list) {
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

function normalizeSectionOrder(list) {
  const known = new Set(ESSENTIALS_SECTION_IDS);
  const out = [];
  const seen = new Set();
  for (const id of list || []) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of ESSENTIALS_SECTION_IDS) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

export function readWorkPanelsOnEssentials() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeWorkList(parsed) : [];
  } catch {
    return [];
  }
}

export function writeWorkPanelsOnEssentials(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeWorkList(ids)));
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

export function readEssentialsSectionOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return normalizeSectionOrder(null);
    const parsed = JSON.parse(raw);
    return normalizeSectionOrder(Array.isArray(parsed) ? parsed : null);
  } catch {
    return normalizeSectionOrder(null);
  }
}

export function writeEssentialsSectionOrder(ids) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(normalizeSectionOrder(ids)));
  } catch { /* ignore */ }
}

/** Work-tab panel display order follows the essentials section order. */
export function readWorkPanelOrder() {
  return readEssentialsSectionOrder().filter(id => WORK_PANEL_IDS.includes(id));
}

/**
 * Move a section before another (or to end if beforeId is null).
 * @param {string} dragId
 * @param {string|null} beforeId
 */
export function moveEssentialsSection(dragId, beforeId) {
  if (!ESSENTIALS_SECTION_IDS.includes(dragId)) return readEssentialsSectionOrder();
  const order = readEssentialsSectionOrder().filter(id => id !== dragId);
  let insertAt = order.length;
  if (beforeId && ESSENTIALS_SECTION_IDS.includes(beforeId)) {
    const idx = order.indexOf(beforeId);
    if (idx >= 0) insertAt = idx;
  }
  order.splice(insertAt, 0, dragId);
  writeEssentialsSectionOrder(order);
  return order;
}
