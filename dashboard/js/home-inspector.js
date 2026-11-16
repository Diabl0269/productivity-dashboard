// home-inspector.js — Home's right inspector: registered tabs (How it works | Work | Tickets | Notes),
// one shown at a time, and a collapse toggle that slides the column shut (CSS animates the width).

import { inspectorTabList } from './home-state.js';
import { rovingTabs, markSelectedTab } from './home-keys.js';
import { keepFocusAndScroll } from './home-keep.js';

const OPEN_KEY = 'home.inspectorOpen';
const TAB_KEY = 'home.inspectorTab';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function load(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage off: still works for this visit */ }
}

let refs = null;
let mounted = null; // { id, ctx }

/**
 * Build the inspector once.
 * @param {HTMLElement} body the .hm-body grid whose second column is the inspector
 * @param {(tab: object) => object} makeCtx a fresh ctx for a mounted tab (its subscriptions end on unmount)
 */
export function buildInspector(body, makeCtx) {
  const aside = el('aside', 'hm-inspector');
  aside.setAttribute('aria-label', 'Inspector');
  const head = el('div', 'hm-insp-head');
  const tabs = el('div', 'hm-insp-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Inspector tabs');
  rovingTabs(tabs, id => showTab(id));
  const toggle = el('button', 'hm-insp-toggle');
  toggle.type = 'button';
  toggle.dataset.hmKey = 'insp-toggle';
  toggle.setAttribute('aria-controls', 'hmInspPane');
  toggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  toggle.addEventListener('click', () => setOpen(body.dataset.inspector !== 'open'));
  head.append(tabs, toggle);
  const pane = el('div', 'hm-insp-pane');
  pane.id = 'hmInspPane';
  const panel = el('div', 'hm-insp-body');
  panel.setAttribute('role', 'tabpanel');
  panel.tabIndex = -1;
  pane.appendChild(panel);
  aside.append(head, pane);
  refs = { body, aside, tabs, toggle, pane, panel, makeCtx };
  paintInspectorTabs();
  setOpen(load(OPEN_KEY, 'open') !== 'closed', { quiet: true });
  return aside;
}

/** Tab buttons, one per registered inspector tab. */
export function paintInspectorTabs() {
  if (!refs) return;
  const list = inspectorTabList();
  const have = [...refs.tabs.children].map(b => b.dataset.id).join('|');
  if (have !== list.map(t => t.id).join('|')) {
    refs.tabs.textContent = '';
    for (const t of list) {
      const b = el('button', 'hm-insp-tab', t.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'hmInspPane');
      b.dataset.id = t.id;
      b.dataset.hmKey = `insp-${t.id}`;
      b.addEventListener('click', () => showTab(t.id));
      refs.tabs.appendChild(b);
    }
  }
  const want = load(TAB_KEY, list[0]?.id);
  showTab(list.some(t => t.id === want) ? want : list[0]?.id);
}

function showTab(id, { force = false } = {}) {
  if (!refs || !id) return;
  markSelectedTab(refs.tabs, id);
  const tab = inspectorTabList().find(t => t.id === id);
  if (!tab) return;
  refs.panel.setAttribute('aria-label', tab.label);
  if (mounted?.id === id && !force) return;
  save(TAB_KEY, id);
  mount(tab);
}

function mount(tab) {
  mounted?.ctx._end();
  const ctx = refs.makeCtx(tab);
  mounted = { id: tab.id, ctx };
  refs.panel.textContent = '';
  refs.panel.classList.remove('hm-swap');
  void refs.panel.offsetWidth; // restart the short fade for the new tab
  refs.panel.classList.add('hm-swap');
  tab.render(refs.panel, ctx);
}

/** Redraw the shown tab in place (selection change, data refresh): no jump, focus kept. */
export function redrawInspector() {
  if (!refs || !mounted) return;
  const tab = inspectorTabList().find(t => t.id === mounted.id);
  if (!tab) return;
  keepFocusAndScroll(refs.panel, () => {
    refs.panel.textContent = '';
    tab.render(refs.panel, mounted.ctx);
  });
}

/** Open or collapse the inspector column; collapsed content is inert (no hidden Tab stops). */
export function setOpen(open, { quiet = false } = {}) {
  if (!refs) return;
  refs.body.dataset.inspector = open ? 'open' : 'closed';
  refs.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  const label = open ? 'Hide the inspector' : 'Show the inspector';
  refs.toggle.setAttribute('aria-label', label);
  refs.toggle.title = label;
  refs.tabs.inert = !open;
  refs.pane.inert = !open;
  if (!quiet) save(OPEN_KEY, open ? 'open' : 'closed');
}
