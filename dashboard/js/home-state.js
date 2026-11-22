// home-state.js — Home tab state and its four registries (no DOM; safe to import from any feature module).
//
// Extension points (a feature module imports these, registers at import time, and gets one import
// line in home-registry.js; nothing else in the shell changes):
//   registerHomeView({ id, label, key, render(root, ctx), update?(root, ctx), dispose?(root) })
//   registerInspectorTab({ id, label, render(root, ctx) })
//   registerTopBarItem({ id, slot, render(root, ctx) })   slot: 'search' | 'palette' | 'note' | 'usage'
//   registerStripItem({ id, render(root, ctx) })
// A registration with `placeholder: true` gives way to a real one with the same id, whatever the
// import order, so a later ticket never has to delete the placeholder's line.
// The selection ("where") is { project, group, area, part }: kept across views, in the URL as
// ?where=<box id>&hproject=<slug>, cleared by Esc. See docs/home-page.md.

import { findWhere } from '../../shared/home-config.js';

export const TOP_BAR_SLOTS = ['search', 'palette', 'note', 'usage'];
export const DEFAULT_HOME_VIEW = 'overview';

const HOME_VIEW_ALIASES = Object.freeze({ automations: 'how-it-runs' });

function resolveHomeViewId(id) { return HOME_VIEW_ALIASES[id] || id; }

const views = new Map();
const inspectorTabs = new Map();
const topBarItems = new Map();
const stripItems = new Map();

function isFn(f) { return typeof f === 'function'; }

function put(map, kind, def) {
  if (!def || typeof def.id !== 'string' || !def.id) throw new Error(`${kind}: "id" is required`);
  if (!isFn(def.render)) throw new Error(`${kind} "${def.id}": "render(root, ctx)" is required`);
  const had = map.get(def.id);
  if (had && !had.placeholder && def.placeholder) return; // a real one already won
  if (had && !had.placeholder && !def.placeholder) {
    console.warn(`${kind} "${def.id}" is registered twice; the first one is kept.`);
    return;
  }
  map.set(def.id, Object.freeze({ ...def, placeholder: !!def.placeholder }));
  notify({ type: 'registry', kind });
}

/** A centre view. `key` is its number key (1-9) and its place in the view switch. */
export function registerHomeView(def) {
  if (!Number.isInteger(def?.key) || def.key < 1 || def.key > 9) {
    throw new Error(`registerHomeView "${def?.id}": "key" should be a whole number 1-9`);
  }
  if (typeof def.label !== 'string' || !def.label) throw new Error(`registerHomeView "${def.id}": "label" is required`);
  put(views, 'registerHomeView', def);
}

/** A tab of the right inspector (shown in registration order). */
export function registerInspectorTab(def) {
  if (typeof def?.label !== 'string' || !def.label) throw new Error(`registerInspectorTab "${def?.id}": "label" is required`);
  put(inspectorTabs, 'registerInspectorTab', def);
}

/** An item in one of the top bar's slots. */
export function registerTopBarItem(def) {
  if (!TOP_BAR_SLOTS.includes(def?.slot)) {
    throw new Error(`registerTopBarItem "${def?.id}": "slot" should be one of ${TOP_BAR_SLOTS.join(', ')}`);
  }
  put(topBarItems, 'registerTopBarItem', def);
}

/** An item of the lower strip (left to right in registration order). */
export function registerStripItem(def) {
  put(stripItems, 'registerStripItem', def);
}

/** Registered views, ordered by key. */
export function homeViews() { return [...views.values()].sort((a, b) => a.key - b.key); }
export function homeView(id) { return views.get(resolveHomeViewId(id)) || null; }
export function inspectorTabList() { return [...inspectorTabs.values()]; }
/** Items of one top bar slot; any real item there hides the slot's placeholder, whatever its id. */
export function topBarItemsIn(slot) {
  const all = [...topBarItems.values()].filter(i => i.slot === slot);
  return all.some(i => !i.placeholder) ? all.filter(i => !i.placeholder) : all;
}
export function stripItemList() { return [...stripItems.values()]; }

// ===== state =====

const EMPTY_WHERE = Object.freeze({ group: null, area: null, part: null });

const state = {
  view: DEFAULT_HOME_VIEW,
  project: null,
  where: EMPTY_WHERE,
  pendingWhere: null, // a ?where= id waiting for the config to load
  home: null, // the /api/home answer for `project`: { config, errors, missing, path, projects, ... }
  automationId: null,
  automationDefaults: false,
  loading: false,
};

const listeners = new Set();
let urlSync = null;

/**
 * Listen to Home changes. fn({ type }) with type 'view' | 'selection' | 'project' | 'config' |
 * 'tasks' | 'registry'. Returns the unsubscribe function.
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(event) {
  for (const fn of [...listeners]) {
    try { fn(event); } catch (e) { console.error('Home listener failed:', e); }
  }
}

/** home-view.js sets how a change reaches the URL (only while the Home tab shows). */
export function setHomeUrlSync(fn) { urlSync = fn; }
function sync() { urlSync?.(); }

export function getHomeView() {
  const id = resolveHomeViewId(state.view);
  return views.has(id) ? id : (views.has(DEFAULT_HOME_VIEW) ? DEFAULT_HOME_VIEW : homeViews()[0]?.id || DEFAULT_HOME_VIEW);
}
export function getProject() { return state.project; }
export function getHomeData() { return state.home; }
export function getHomeConfig() { return state.home?.config || null; }
export function isHomeLoading() { return state.loading; }

/** The selection: { project, group, area, part } (ids; null when not chosen). */
export function getSelection() {
  return { project: state.project, ...state.where };
}

/** The deepest selected box id (what ?where= holds), or null. */
export function selectedBoxId() {
  return state.where.part || state.where.area || state.where.group || null;
}

export function hasSelection() { return !!selectedBoxId(); }

export function setView(id) {
  id = resolveHomeViewId(id);
  if (!views.has(id) || id === getHomeView()) return;
  state.view = id;
  notify({ type: 'view' });
  sync();
}

/**
 * Select a place. `where` is a box id (group, area or part), an object { group, area, part }
 * (the deepest id given wins), or null to clear.
 */
export function setSelection(where) {
  const boxId = typeof where === 'string' ? where
    : where ? (where.part || where.area || where.group || null) : null;
  if (!boxId) return clearSelection();
  const config = getHomeConfig();
  if (!config) { state.pendingWhere = boxId; return; }
  const found = findWhere(config, boxId);
  if (!found) return;
  if (sameWhere(found, state.where)) return;
  state.where = Object.freeze(found);
  state.pendingWhere = null;
  notify({ type: 'selection' });
  sync();
}

export function clearSelection() {
  state.pendingWhere = null;
  if (!hasSelection()) return;
  state.where = EMPTY_WHERE;
  notify({ type: 'selection' });
  sync();
}

function sameWhere(a, b) {
  return a.group === b.group && a.area === b.area && a.part === b.part;
}

/** Switch project: the selection belongs to the old map, so it is cleared. */
const placeByProject = new Map(); // project -> the box id selected there (this visit), PRO127

export function setProject(slug) {
  if (!slug || slug === state.project) return;
  if (state.project) placeByProject.set(state.project, selectedBoxId());
  state.project = slug;
  state.where = EMPTY_WHERE;
  state.pendingWhere = placeByProject.get(slug) || null; // resolved by setHomeData once the config is in
  state.home = null;
  notify({ type: 'project' });
  sync();
}

export function setHomeLoading(on) { state.loading = !!on; }

/**
 * Store the /api/home answer, then resolve a ?where= that arrived before it.
 * @returns {string|null} the id of a ?where= that names no box in this map (to tell the user), else null
 */
export function setHomeData(data) {
  state.home = data;
  if (data?.project && !state.project) state.project = data.project;
  let unknown = null;
  const pending = state.pendingWhere;
  state.pendingWhere = null;
  if (pending) {
    const found = findWhere(data?.config, pending);
    if (found) state.where = Object.freeze(found);
    else unknown = pending;
  } else if (hasSelection() && !findWhere(data?.config, selectedBoxId())) {
    state.where = EMPTY_WHERE;
  }
  notify({ type: 'config' });
  if (unknown) sync();
  return unknown;
}

// ===== routing (routing.js reads and applies these through main.js) =====

/** The Home part of the route, including an optional automation editor. */
export function homeRouteState() {
  return {
    homeView: getHomeView(),
    automationId: state.automationId || undefined,
    automationDefaults: state.automationDefaults || undefined,
    where: selectedBoxId() || state.pendingWhere || undefined,
    homeProject: state.project || undefined,
  };
}

export function getAutomationId() { return state.automationId; }
export function isEditingAutomationDefaults() { return state.automationDefaults; }

export function editAutomationDefaults(on = true) {
  state.automationDefaults = !!on;
  if (state.automationDefaults) state.automationId = null;
  notify({ type: 'automation' });
  sync();
}

export function editAutomation(id) {
  const next = id ? String(id) : null;
  if (state.automationId === next) return;
  state.automationDefaults = false;
  state.automationId = next;
  notify({ type: 'automation' });
  sync();
}

/** Apply a parsed route (from the URL or Back/Forward) without writing the URL again. */
export function applyHomeRoute(route) {
  const prevProject = state.project;
  if (route.homeProject && route.homeProject !== state.project) {
    state.project = route.homeProject;
    state.home = null;
  }
  // Kept as asked even before the views register (the registry loads with the tab); getHomeView falls back.
  const view = route.homeView || DEFAULT_HOME_VIEW;
  const viewChanged = view !== state.view;
  state.view = view;
  const nextAutomation = route.homeView === 'how-it-runs' && route.automationId ? route.automationId : null;
  const nextDefaults = route.homeView === 'how-it-runs' && route.automationDefaults === true;
  const automationChanged = nextAutomation !== state.automationId || nextDefaults !== state.automationDefaults;
  state.automationId = nextDefaults ? null : nextAutomation;
  state.automationDefaults = nextDefaults;
  const before = selectedBoxId();
  if (route.where) {
    const found = findWhere(getHomeConfig(), route.where);
    if (found) { state.where = Object.freeze(found); state.pendingWhere = null; } else { state.where = EMPTY_WHERE; state.pendingWhere = route.where; }
  } else {
    state.where = EMPTY_WHERE;
    state.pendingWhere = null;
  }
  if (state.project !== prevProject) notify({ type: 'project' });
  if (viewChanged) notify({ type: 'view' });
  if (automationChanged) notify({ type: 'automation' });
  if (selectedBoxId() !== before) notify({ type: 'selection' });
}

// ===== commands (PRO125; the registry itself is home-commands.js) =====
// registerHomeCommand({ id, title, hint?, keys?, group, run(ctx), when?(ctx), keywords? }): a palette command, and a key when `keys` is set.
export { registerHomeCommand, homeCommands } from './home-commands.js';
