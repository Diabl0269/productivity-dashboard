// home-topbar.js — Home's top bar: project switcher, the selected place (breadcrumb chip with a clear
// button), the view switch (keys 1-9) and the slots later tickets fill (search, palette, note, usage).

import {
  homeViews, getHomeView, setView, getProject, setProject, getHomeData, getHomeConfig,
  getSelection, hasSelection, clearSelection, topBarItemsIn, TOP_BAR_SLOTS,
} from './home-state.js';
import { boxOfWhere } from '../../shared/home-config.js';
import { rovingTabs, markSelectedTab } from './home-keys.js';

const PROJECT_KEY = 'home.project';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

let refs = null;

/** The project last picked on this browser (a convenience; the URL wins). */
export function rememberedProject() {
  try { return localStorage.getItem(PROJECT_KEY) || null; } catch { return null; }
}

/**
 * Build the bar once.
 * @param {(item: object, root: HTMLElement) => void} mountItem mounts a registered top bar item
 */
export function buildTopBar(mountItem) {
  const bar = el('div', 'hm-top');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Home top bar');

  const left = el('div', 'hm-top-left');
  const label = el('label', 'hm-project');
  label.appendChild(el('span', 'hm-sr', 'Project'));
  const select = el('select', 'hm-select');
  select.id = 'hmProject';
  select.title = 'Project';
  select.addEventListener('change', () => {
    try { localStorage.setItem(PROJECT_KEY, select.value); } catch { /* storage off */ }
    setProject(select.value);
  });
  label.appendChild(select);
  left.appendChild(label);

  const where = el('div', 'hm-where');
  where.dataset.on = 'false';
  const wherePath = el('span', 'hm-where-path');
  wherePath.setAttribute('aria-live', 'polite');
  const clear = el('button', 'hm-where-clear', '×');
  clear.type = 'button';
  clear.dataset.hmKey = 'where-clear';
  clear.title = 'Clear the selected place (Esc)';
  clear.setAttribute('aria-label', 'Clear the selected place');
  clear.addEventListener('click', () => clearSelection());
  where.append(wherePath, clear);
  left.appendChild(where);

  const tabs = el('div', 'hm-views');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Home views');
  rovingTabs(tabs, id => setView(id));

  const slots = el('div', 'hm-slots');
  for (const slot of TOP_BAR_SLOTS) {
    const box = el('div', 'hm-slot');
    box.dataset.slot = slot;
    for (const item of topBarItemsIn(slot)) {
      const root = el('div', 'hm-slot-item');
      root.dataset.id = item.id;
      box.appendChild(root);
      mountItem(item, root);
    }
    slots.appendChild(box);
  }

  bar.append(left, tabs, slots);
  refs = { bar, select, where, wherePath, clear, tabs, slots };
  paintViewTabs();
  return bar;
}

/** The view switch: one tab per registered view, in key order. */
export function paintViewTabs() {
  if (!refs) return;
  const views = homeViews();
  const have = [...refs.tabs.children].map(b => b.dataset.id).join('|');
  if (have !== views.map(v => v.id).join('|')) {
    refs.tabs.textContent = '';
    for (const v of views) {
      const b = el('button', 'hm-view-tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'hmStage');
      b.dataset.id = v.id;
      b.dataset.hmKey = `view-${v.id}`;
      b.title = `${v.label} (${v.key})`;
      b.append(el('span', 'hm-view-label', v.label), el('kbd', 'hm-key', String(v.key)));
      b.querySelector('kbd').setAttribute('aria-hidden', 'true');
      b.addEventListener('click', () => setView(v.id));
      refs.tabs.appendChild(b);
    }
  }
  markSelectedTab(refs.tabs, getHomeView());
}

/** Project switcher options: projects with a home config, then the tracker's other projects. */
export function paintProjects(trackerProjects) {
  if (!refs) return;
  const configured = getHomeData()?.projects || Object.keys(window.dashboardConfig?.home || {});
  const names = new Map((trackerProjects || []).map(p => [p.id, p.name || p.id]));
  const ids = [...new Set([...configured, ...names.keys()])];
  const current = getProject();
  if (current && !ids.includes(current)) ids.unshift(current);
  const sig = ids.map(id => `${id}:${configured.includes(id)}`).join('|');
  if (refs.select.dataset.sig !== sig) {
    refs.select.textContent = '';
    if (!ids.length) refs.select.appendChild(el('option', '', 'No projects yet')).value = '';
    for (const id of ids) {
      const opt = el('option', '', names.get(id) || id);
      opt.value = id;
      if (!configured.includes(id)) opt.textContent += ' (not set up)';
      refs.select.appendChild(opt);
    }
    refs.select.dataset.sig = sig;
  }
  if (current) refs.select.value = current;
}

/** Breadcrumb of names for the current selection, e.g. ["Kitchen", "Oven"]. */
export function selectionNames() {
  const config = getHomeConfig();
  const w = getSelection();
  if (!config || !w.group) return [];
  const names = [];
  const g = boxOfWhere(config, { group: w.group });
  if (g) names.push(g.name);
  if (w.area) { const a = boxOfWhere(config, { group: w.group, area: w.area }); if (a) names.push(a.name); }
  if (w.part) { const p = boxOfWhere(config, w); if (p) names.push(p.name); }
  return names;
}

/** The selected-place chip; it fades in and out (CSS) instead of popping. */
export function paintWhere() {
  if (!refs) return;
  const on = hasSelection();
  const names = selectionNames();
  if (on) {
    // The place's own name stays readable; its parents shrink first when space is short.
    refs.wherePath.textContent = '';
    if (names.length > 1) refs.wherePath.appendChild(el('span', 'hm-where-up', names.slice(0, -1).join(' › ')));
    refs.wherePath.appendChild(el('span', 'hm-where-name', names[names.length - 1] || ''));
  }
  refs.where.dataset.on = on ? 'true' : 'false';
  refs.where.title = on ? `Selected place: ${names.join(' › ')}. Esc clears it.` : '';
  if (!on && document.activeElement === refs.clear) refs.tabs.querySelector('[aria-selected="true"]')?.focus();
  refs.clear.tabIndex = on ? 0 : -1;
  refs.clear.disabled = !on;
}
