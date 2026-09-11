// project-docs-panel.js — Collapse + resize for Projects documentation sidebar

const WIDTH_KEY = 'dashboard.projects.docsWidth';
const COLLAPSED_KEY = 'dashboard.projects.docsCollapsed';
const MIN_WIDTH = 220;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 300;

let initialized = false;
let onLayoutChange = null;

function readWidth() {
  const n = parseInt(localStorage.getItem(WIDTH_KEY) || '', 10);
  return Number.isFinite(n) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n)) : DEFAULT_WIDTH;
}

export function readDocsPanelCollapsed() {
  return localStorage.getItem(COLLAPSED_KEY) === '1';
}

function syncExpandTab(collapsed, panelHidden) {
  const expandTab = document.getElementById('projectsDocsExpandTab');
  if (!expandTab) return;
  const show = !panelHidden && collapsed;
  expandTab.hidden = !show;
  expandTab.setAttribute('aria-expanded', show ? 'false' : 'true');
}

function applyDocsLayout({ width, collapsed }) {
  const layout = document.querySelector('#projectsPanel .pv-layout');
  const panel = document.getElementById('projectsDocsPanel');
  if (!layout || !panel) return;

  layout.style.setProperty('--pv-docs-width', collapsed ? '0px' : `${width}px`);
  layout.classList.toggle('pv-docs-collapsed', collapsed);
  panel.classList.toggle('is-collapsed', collapsed);
  panel.setAttribute('aria-hidden', collapsed ? 'true' : 'false');

  const toggle = document.getElementById('projectsDocsToggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.title = collapsed ? 'Show documentation panel' : 'Hide documentation panel';
  }

  syncExpandTab(collapsed, panel.hidden);

  onLayoutChange?.({ collapsed, width });
}

export function setDocsPanelCallbacks({ onLayoutChange: fn } = {}) {
  onLayoutChange = fn;
}

export function toggleDocsPanel(forceOpen) {
  const collapsed = typeof forceOpen === 'boolean'
    ? !forceOpen
    : !readDocsPanelCollapsed();
  localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  applyDocsLayout({ width: readWidth(), collapsed });
  return !collapsed;
}

export function initProjectDocsPanel() {
  if (initialized) return;
  initialized = true;

  const layout = document.querySelector('#projectsPanel .pv-layout');
  const panel = document.getElementById('projectsDocsPanel');
  const resizer = document.getElementById('projectsDocsResizer');
  const toggle = document.getElementById('projectsDocsToggle');
  const expandTab = document.getElementById('projectsDocsExpandTab');
  if (!layout || !panel) return;

  let width = readWidth();
  let collapsed = readDocsPanelCollapsed();
  applyDocsLayout({ width, collapsed });

  const setCollapsed = (nextCollapsed) => {
    collapsed = nextCollapsed;
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    applyDocsLayout({ width, collapsed });
  };

  toggle?.addEventListener('click', () => {
    setCollapsed(!readDocsPanelCollapsed());
  });

  expandTab?.addEventListener('click', () => {
    setCollapsed(false);
  });

  if (resizer) {
    let dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const layoutRect = layout.getBoundingClientRect();
      const next = layoutRect.right - e.clientX;
      width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
      layout.style.setProperty('--pv-docs-width', `${width}px`);
      localStorage.setItem(WIDTH_KEY, String(width));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('pv-docs-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    resizer.addEventListener('mousedown', (e) => {
      if (readDocsPanelCollapsed()) return;
      e.preventDefault();
      dragging = true;
      document.body.classList.add('pv-docs-resizing');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }
}

export function syncProjectDocsPanelVisibility(hasProject) {
  const panel = document.getElementById('projectsDocsPanel');
  if (!panel) return;
  if (!hasProject) {
    panel.hidden = true;
    syncExpandTab(true, true);
    return;
  }
  panel.hidden = false;
  applyDocsLayout({ width: readWidth(), collapsed: readDocsPanelCollapsed() });
}

export function syncDocsHeroButton(btn) {
  if (!btn) return;
  const open = !readDocsPanelCollapsed();
  btn.classList.toggle('active', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.title = open ? 'Hide documentation panel' : 'Show documentation panel';
}
