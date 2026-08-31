// overview-layout.js — Customize Overview cards (order, titles, visibility, width).

import { showStatus } from './state.js';

const STORAGE_KEY = 'dashboard.overviewLayout';

function corporateHiddenPref() {
  return document.documentElement.getAttribute('data-hide-corporate') === 'true'
    || document.documentElement.getAttribute('data-hide-sprints') === 'true';
}

/** Canonical widget definitions (DOM must use matching data-widget-id). */
export const OVERVIEW_WIDGETS = [
  { id: 'sprint', title: 'Sprint Info', wide: false, sprint: true },
  { id: 'today-plan', title: 'Today Plan', wide: false },
  { id: 'task-summary', title: 'Task Summary', wide: false },
  { id: 'focus', title: 'Focus Agenda', wide: false },
  { id: 'projects', title: 'By Project', wide: false },
  { id: 'capacity', title: 'Capacity', wide: false },
  { id: 'calendar', title: 'Calendar', wide: true },
  { id: 'habits', title: 'Habits', wide: false },
  { id: 'stale-waiting', title: 'Stale / Waiting', wide: false },
  { id: 'deps', title: 'Dependencies', wide: false },
  { id: 'quick-links', title: 'Quick Links', wide: false },
  { id: 'ideas', title: 'Ideas', wide: false },
  { id: 'deadlines', title: 'Upcoming Deadlines', wide: false },
  { id: 'review', title: 'Weekly Review', wide: false },
  { id: 'done-journal', title: 'Done Journal', wide: false },
];

/** Migrate legacy layout widget ids from team-centric Overview. */
const LAYOUT_ID_MIGRATION = {
  workload: 'projects',
  topics: 'ideas',
  workshops: 'review',
};

function migrateLayoutIds(ids) {
  if (!Array.isArray(ids)) return ids;
  return ids.map(id => LAYOUT_ID_MIGRATION[id] || id);
}

let editing = false;
let dragId = null;

function defaultLayout() {
  return {
    order: OVERVIEW_WIDGETS.map(w => w.id),
    hidden: [],
    titles: {},
    wide: Object.fromEntries(OVERVIEW_WIDGETS.map(w => [w.id, !!w.wide])),
  };
}

export function loadOverviewLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw);
    const base = defaultLayout();
    const known = new Set(OVERVIEW_WIDGETS.map(w => w.id));
    const order = Array.isArray(parsed.order)
      ? migrateLayoutIds(parsed.order).filter(id => known.has(id))
      : base.order;
    // Dedupe after migration
    const seen = new Set();
    const deduped = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      deduped.push(id);
    }
    for (const id of base.order) {
      if (!deduped.includes(id)) deduped.push(id);
    }
    const hidden = Array.isArray(parsed.hidden)
      ? migrateLayoutIds(parsed.hidden).filter(id => known.has(id))
      : [];
    const titlesRaw = parsed.titles && typeof parsed.titles === 'object' ? parsed.titles : {};
    const titles = {};
    for (const [k, v] of Object.entries(titlesRaw)) {
      titles[LAYOUT_ID_MIGRATION[k] || k] = v;
    }
    const wideRaw = parsed.wide && typeof parsed.wide === 'object' ? parsed.wide : {};
    const wideMigrated = {};
    for (const [k, v] of Object.entries(wideRaw)) {
      wideMigrated[LAYOUT_ID_MIGRATION[k] || k] = v;
    }
    return {
      order: deduped,
      hidden,
      titles,
      wide: { ...base.wide, ...wideMigrated },
    };
  } catch {
    return defaultLayout();
  }
}

function saveOverviewLayout(layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch { /* ignore */ }
}

function metaFor(id) {
  return OVERVIEW_WIDGETS.find(w => w.id === id);
}

function cardEl(id) {
  return document.querySelector(`.overview-grid [data-widget-id="${id}"]`);
}

function applyTitle(card, id, layout) {
  const h3 = card.querySelector('h3');
  if (!h3) return;
  const custom = layout.titles[id];
  const fallback = metaFor(id)?.title || h3.textContent;
  h3.textContent = (custom && String(custom).trim()) || fallback;
  h3.dataset.defaultTitle = fallback;
}

/**
 * Apply stored layout to the Overview grid (order, titles, wide, hidden).
 * Respects Settings → Hide corporate for the sprint widget.
 */
export function applyOverviewLayout() {
  const grid = document.querySelector('#overviewPanel .overview-grid');
  if (!grid) return;

  const layout = loadOverviewLayout();
  const hideCorporate = corporateHiddenPref();

  for (const id of layout.order) {
    const card = cardEl(id);
    if (!card) continue;
    grid.appendChild(card);
    applyTitle(card, id, layout);
    card.classList.toggle('widget-card-wide', !!layout.wide[id]);

    const corporateForced = id === 'sprint' && hideCorporate;
    const userHidden = layout.hidden.includes(id);
    card.hidden = corporateForced || userHidden;
    card.classList.toggle('overview-widget-hidden', userHidden && !corporateForced);
  }

  renderHiddenTray(layout);
  syncEditChrome();
}

function renderHiddenTray(layout) {
  let tray = document.getElementById('overviewHiddenTray');
  if (!tray) return;

  const hideCorporate = corporateHiddenPref();
  const hiddenIds = layout.hidden.filter(id => !(id === 'sprint' && hideCorporate));

  if (!editing || hiddenIds.length === 0) {
    tray.hidden = true;
    tray.innerHTML = '';
    return;
  }

  tray.hidden = false;
  tray.innerHTML = '<span class="overview-hidden-label">Hidden cards</span>';
  hiddenIds.forEach(id => {
    const meta = metaFor(id);
    const title = layout.titles[id] || meta?.title || id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'overview-restore-pill';
    btn.textContent = title;
    btn.title = 'Show again';
    btn.addEventListener('click', () => {
      const next = loadOverviewLayout();
      next.hidden = next.hidden.filter(x => x !== id);
      saveOverviewLayout(next);
      applyOverviewLayout();
      showStatus(`Restored “${title}”`);
    });
    tray.appendChild(btn);
  });
}

function setEditing(on) {
  editing = !!on;
  const panel = document.getElementById('overviewPanel');
  if (panel) panel.classList.toggle('overview-editing', editing);
  const btn = document.getElementById('overviewEditBtn');
  if (btn) {
    btn.textContent = editing ? 'Done' : 'Edit';
    btn.setAttribute('aria-pressed', editing ? 'true' : 'false');
    btn.classList.toggle('active', editing);
  }
  applyOverviewLayout();
}

function syncEditChrome() {
  document.querySelectorAll('.overview-grid [data-widget-id]').forEach(card => {
    let chrome = card.querySelector('.overview-edit-chrome');
    if (!editing) {
      if (chrome) chrome.remove();
      card.removeAttribute('draggable');
      return;
    }
    if (card.hidden) return;
    if (!chrome) {
      chrome = document.createElement('div');
      chrome.className = 'overview-edit-chrome';
      chrome.innerHTML = `
        <button type="button" class="overview-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</button>
        <button type="button" class="overview-wide-btn" title="Toggle full width">Wide</button>
        <button type="button" class="overview-hide-btn" title="Hide card">Hide</button>
      `;
      card.insertBefore(chrome, card.firstChild);

      chrome.querySelector('.overview-hide-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const id = card.dataset.widgetId;
        const layout = loadOverviewLayout();
        if (!layout.hidden.includes(id)) layout.hidden.push(id);
        saveOverviewLayout(layout);
        applyOverviewLayout();
        showStatus('Card hidden — restore from Hidden cards');
      });

      chrome.querySelector('.overview-wide-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const id = card.dataset.widgetId;
        const layout = loadOverviewLayout();
        layout.wide[id] = !layout.wide[id];
        saveOverviewLayout(layout);
        applyOverviewLayout();
      });

      const handle = chrome.querySelector('.overview-drag-handle');
      handle.addEventListener('mousedown', () => { card.draggable = true; });
      handle.addEventListener('mouseup', () => { card.draggable = false; });
    }

    const id = card.dataset.widgetId;
    const layout = loadOverviewLayout();
    chrome.querySelector('.overview-wide-btn')?.classList.toggle('active', !!layout.wide[id]);

    // Editable title
    const h3 = card.querySelector('h3');
    if (h3 && !h3.isContentEditable) {
      h3.contentEditable = 'true';
      h3.spellcheck = false;
      h3.title = 'Click to rename';
      h3.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); h3.blur(); }
      });
      h3.addEventListener('blur', () => {
        const layoutNow = loadOverviewLayout();
        const text = h3.textContent.trim();
        const def = h3.dataset.defaultTitle || metaFor(id)?.title || '';
        if (!text || text === def) {
          delete layoutNow.titles[id];
          h3.textContent = def;
        } else {
          layoutNow.titles[id] = text;
        }
        saveOverviewLayout(layoutNow);
      });
    }
  });

  // When leaving edit mode, turn off contentEditable
  if (!editing) {
    document.querySelectorAll('.overview-grid [data-widget-id] h3').forEach(h3 => {
      h3.contentEditable = 'false';
      h3.removeAttribute('title');
    });
  }

  bindGridDrag();
}

let dragBound = false;
function bindGridDrag() {
  const grid = document.querySelector('#overviewPanel .overview-grid');
  if (!grid || dragBound) return;
  dragBound = true;

  grid.addEventListener('dragstart', (e) => {
    if (!editing) return;
    const card = e.target.closest('[data-widget-id]');
    if (!card) return;
    dragId = card.dataset.widgetId;
    card.classList.add('overview-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });

  grid.addEventListener('dragend', (e) => {
    const card = e.target.closest('[data-widget-id]');
    if (card) card.classList.remove('overview-dragging');
    dragId = null;
    grid.querySelectorAll('.overview-drag-over').forEach(el => el.classList.remove('overview-drag-over'));
  });

  grid.addEventListener('dragover', (e) => {
    if (!editing || !dragId) return;
    e.preventDefault();
    const over = e.target.closest('[data-widget-id]');
    grid.querySelectorAll('.overview-drag-over').forEach(el => el.classList.remove('overview-drag-over'));
    if (over && over.dataset.widgetId !== dragId) over.classList.add('overview-drag-over');
  });

  grid.addEventListener('drop', (e) => {
    if (!editing || !dragId) return;
    e.preventDefault();
    const over = e.target.closest('[data-widget-id]');
    grid.querySelectorAll('.overview-drag-over').forEach(el => el.classList.remove('overview-drag-over'));
    if (!over || over.dataset.widgetId === dragId) return;

    const layout = loadOverviewLayout();
    const from = layout.order.indexOf(dragId);
    const to = layout.order.indexOf(over.dataset.widgetId);
    if (from < 0 || to < 0) return;
    layout.order.splice(from, 1);
    layout.order.splice(to, 0, dragId);
    saveOverviewLayout(layout);
    applyOverviewLayout();
  });
}

export function initOverviewLayout() {
  const panel = document.getElementById('overviewPanel');
  if (!panel) return;

  // Ensure toolbar + tray exist
  let toolbar = document.getElementById('overviewToolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'overviewToolbar';
    toolbar.className = 'overview-toolbar';
    toolbar.innerHTML = `
      <button type="button" id="overviewEditBtn" class="overview-edit-btn" aria-pressed="false">Edit</button>
      <span class="overview-edit-hint" id="overviewEditHint">Reorder, rename, hide, or widen cards</span>
    `;
    const grid = panel.querySelector('.overview-grid');
    if (grid) panel.insertBefore(toolbar, grid);
  }

  let tray = document.getElementById('overviewHiddenTray');
  if (!tray) {
    tray = document.createElement('div');
    tray.id = 'overviewHiddenTray';
    tray.className = 'overview-hidden-tray';
    tray.hidden = true;
    const grid = panel.querySelector('.overview-grid');
    if (grid) panel.insertBefore(tray, grid);
  }

  document.getElementById('overviewEditBtn')?.addEventListener('click', () => {
    setEditing(!editing);
  });

  applyOverviewLayout();
}
