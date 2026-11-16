// home-view.js — the Home tab shell: four zones (top bar, centre view, right inspector, lower strip),
// the view switch with a short cross-fade, the project's home config, and the ctx every feature gets.
// Features never edit this file: they register in home-registry.js (see home-state.js for the API).
//
// ctx (one per mounted view, tab or item; its subscriptions end when it unmounts):
//   state()        the tracker task state (sections, tasks by section, meta)
//   doc()          the same as a tasks.json-shaped doc ({ meta, sections[].tasks[] }), cached per refresh
//   selection()    { project, group, area, part }
//   setSelection(boxId | { group, area, part } | null), clearSelection()
//   config()       the project's normalised home config, or null;  home() the whole /api/home answer
//   project()      the selected project slug
//   openTicket(id), idButton(id, className?), toast(message)
//   redraw()       redraw this view/tab/item in place (focus and scroll kept)
//   subscribe(fn)  fn({ type }) on 'view' | 'selection' | 'project' | 'config' | 'tasks'; returns unsubscribe

import './home-registry.js';
import {
  homeViews, homeView, getHomeView, getSelection, setSelection, clearSelection, getHomeConfig,
  getHomeData, getProject, setHomeData, setHomeLoading, isHomeLoading, subscribe, notify,
  setHomeUrlSync, stripItemList,
} from './home-state.js';
import { buildTopBar, paintViewTabs, paintProjects, paintWhere, rememberedProject } from './home-topbar.js';
import { buildInspector, redrawInspector, paintInspectorTabs } from './home-inspector.js';
import { installHomeKeys } from './home-keys.js';
import { keepFocusAndScroll } from './home-keep.js';
import { paintNotice } from './home-notice.js';
import { taskState } from './tasks-main.js';
import { stateToDoc } from './epic-ready-ui.js';
import { idButton, openTicket } from './ticket-id-button.js';
import { showStatus, activeMainTab } from './state.js';
import { syncUrl, isRoutingReady } from './routing.js';

let shell = null; // { root, stage, notice, strip }
let current = null; // { id, el, ctx } of the mounted view
const mountedItems = []; // { def, root, ctx } top bar and strip items
let docCache = null;
let loadSeq = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const isShowing = () => activeMainTab === 'home';
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A fresh ctx; `redraw` repaints whatever `owner()` returns ({ def, root }). */
function makeCtx(owner) {
  const offs = [];
  return {
    state: () => taskState,
    doc: () => (docCache ||= stateToDoc(taskState)),
    selection: getSelection,
    setSelection,
    clearSelection,
    config: getHomeConfig,
    home: getHomeData,
    project: getProject,
    openTicket,
    idButton: (id, className) => idButton(id, className || 'rp-link rp-chip-id'),
    toast: showStatus,
    redraw: () => { const o = owner(); if (o) repaint(o.def, o.root, o.ctx); },
    subscribe: (fn) => { const off = subscribe(fn); offs.push(off); return off; },
    _end: () => { offs.splice(0).forEach(off => off()); },
  };
}

function repaint(def, root, ctx) {
  keepFocusAndScroll(root, () => {
    if (typeof def.update === 'function') def.update(root, ctx);
    else { root.textContent = ''; def.render(root, ctx); }
  });
}

function safe(label, fn) {
  try { fn(); } catch (e) { console.error(`Home: ${label} failed`, e); }
}

function mountItem(def, root) {
  const entry = { def, root, ctx: null };
  entry.ctx = makeCtx(() => entry);
  mountedItems.push(entry);
  safe(def.id, () => def.render(root, entry.ctx));
}

// ===== the centre view =====

function mountView(id, { animate }) {
  const def = homeView(id);
  if (!def || !shell) return;
  const old = current;
  const hadFocus = old && old.el.contains(document.activeElement);
  if (old) {
    old.ctx._end();
    safe(`${old.id} dispose`, () => homeView(old.id)?.dispose?.(old.el));
  }
  const view = el('div', 'hm-view');
  view.dataset.view = id;
  view.tabIndex = -1;
  view.setAttribute('aria-label', def.label);
  const entry = { id, el: view, ctx: null, def };
  entry.ctx = makeCtx(() => (current === entry ? { def: homeView(id), root: view, ctx: entry.ctx } : null));
  current = entry;
  const fwd = !old || (homeView(old.id)?.key ?? 0) <= def.key;
  if (animate && old && !reducedMotion()) view.classList.add('hm-enter', fwd ? 'hm-from-right' : 'hm-from-left');
  shell.stage.appendChild(view);
  safe(id, () => def.render(view, entry.ctx));
  shell.stage.setAttribute('aria-label', `${def.label} view`);
  if (!old) return;
  if (!animate || reducedMotion()) {
    old.el.remove();
  } else {
    old.el.classList.add('hm-leave', fwd ? 'hm-to-left' : 'hm-to-right');
    old.el.inert = true;
    const drop = () => old.el.remove();
    old.el.addEventListener('animationend', drop, { once: true });
    setTimeout(drop, 400);
    view.addEventListener('animationend', () => view.classList.remove('hm-enter', 'hm-from-right', 'hm-from-left'), { once: true });
  }
  shell.centre.scrollTop = 0;
  if (hadFocus) view.focus({ preventScroll: true });
}

function redrawView() {
  if (!current) return;
  const def = homeView(current.id);
  if (def) repaint(def, current.el, current.ctx);
}

// ===== data =====

async function loadHome() {
  const my = ++loadSeq;
  const project = getProject() || rememberedProject();
  setHomeLoading(true);
  paintNotice(shell.notice, getHomeData(), true);
  let data;
  try {
    const res = await fetch(`/api/home${project ? `?project=${encodeURIComponent(project)}` : ''}`, { cache: 'no-store' });
    data = res.ok ? await res.json() : { project, projects: [], config: null, missing: false, errors: [(await res.json().catch(() => ({}))).error || `The server answered ${res.status}.`] };
  } catch (e) {
    data = { project, projects: [], config: null, missing: false, errors: [`The dashboard server could not be reached (${e.message}).`] };
  }
  if (my !== loadSeq) return;
  setHomeLoading(false);
  const unknown = setHomeData(data);
  if (unknown) showStatus(`No place called "${unknown}" on this project's map`);
  if (isShowing() && isRoutingReady()) syncUrl({ replace: true });
}

// ===== shell =====

function buildShell(root) {
  root.textContent = '';
  const top = buildTopBar(mountItem);
  const body = el('div', 'hm-body');
  const centre = el('main', 'hm-centre');
  centre.setAttribute('aria-label', 'Home view');
  const notice = el('div', 'hm-notice');
  const stage = el('div', 'hm-stage');
  stage.id = 'hmStage';
  stage.setAttribute('role', 'tabpanel');
  centre.append(notice, stage);
  body.appendChild(centre);
  body.appendChild(buildInspector(body, () => {
    const c = makeCtx(() => null);
    c.redraw = () => redrawInspector();
    return c;
  }));
  const strip = el('div', 'hm-strip');
  strip.setAttribute('role', 'region');
  strip.setAttribute('aria-label', 'Running now and For you');
  for (const def of stripItemList()) {
    const item = el('div', 'hm-strip-item');
    item.dataset.id = def.id;
    strip.appendChild(item);
    mountItem(def, item);
  }
  root.append(top, body, strip);
  shell = { root, centre, notice, stage, strip };

  setHomeUrlSync(() => { if (isShowing() && isRoutingReady()) syncUrl(); });
  installHomeKeys(isShowing);
  subscribe(onChange);
}

function onChange(event) {
  if (!shell) return;
  switch (event.type) {
    case 'view':
      paintViewTabs();
      if (current?.id !== getHomeView()) mountView(getHomeView(), { animate: true });
      break;
    case 'selection':
      paintWhere();
      redrawInspector();
      break;
    case 'project':
      paintProjects(taskState.meta?.projects);
      paintWhere();
      loadHome();
      break;
    case 'config':
      paintProjects(taskState.meta?.projects);
      paintNotice(shell.notice, getHomeData(), isHomeLoading());
      paintWhere();
      redrawInspector();
      for (const item of mountedItems) repaint(item.def, item.root, item.ctx);
      if (current) mountView(current.id, { animate: false });
      break;
    case 'registry':
      paintViewTabs();
      paintInspectorTabs();
      break;
    default:
      break;
  }
}

/** Show the Home tab (first visit builds the shell and loads the project's config). */
export function renderHomeView() {
  const root = document.getElementById('homeMain');
  if (!root) return;
  if (!shell) {
    buildShell(root);
    paintProjects(taskState.meta?.projects);
    paintWhere();
    mountView(getHomeView(), { animate: false });
    loadHome();
    return;
  }
  if (current?.id !== getHomeView()) mountView(getHomeView(), { animate: false });
  paintViewTabs();
  paintWhere();
  if (!getHomeData() && !isHomeLoading()) loadHome();
}

/** Task data changed (save, 5 s poll): redraw every zone in place, keeping focus and scroll. */
export function refreshHomeView() {
  if (!shell || !isShowing()) return;
  docCache = null;
  paintProjects(taskState.meta?.projects);
  redrawView();
  redrawInspector();
  for (const item of mountedItems) repaint(item.def, item.root, item.ctx);
  notify({ type: 'tasks' });
}

/** The registered view ids in switch order (for tests and other modules). */
export function homeViewIds() { return homeViews().map(v => v.id); }
