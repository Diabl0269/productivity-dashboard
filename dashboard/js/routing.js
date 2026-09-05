// routing.js — URL ↔ dashboard state (History API, /dashboard/* paths)

const MAIN_TABS = new Set([
  'overview', 'tasks', 'projects', 'memory', 'global-memory', 'settings',
]);

let routingReady = false;
let applyingRoute = false;

let deps = {
  switchMainTab: null,
  switchTaskView: null,
  openTaskDetail: null,
  closeTaskDetail: null,
  isTaskDetailOpen: null,
  findTaskById: null,
  selectProject: null,
  selectMemoryTab: null,
  switchSettingsSubtab: null,
  switchGlobalMemorySubtab: null,
};

/** @returns {string} e.g. "/dashboard" */
export function getBasePath() {
  const m = window.location.pathname.match(/^(.*\/dashboard)\/?/);
  return m ? m[1] : '/dashboard';
}

/**
 * Parse current pathname into a route object.
 * @returns {{
 *   tab: string,
 *   taskView?: 'board'|'list',
 *   taskId?: string,
 *   projectId?: string,
 *   memoryTab?: string,
 *   settingsSubtab?: string,
 *   globalSubtab?: string,
 * }}
 */
export function parseRoute() {
  const base = getBasePath();
  let rest = window.location.pathname;
  if (rest.startsWith(base)) rest = rest.slice(base.length);
  rest = rest.replace(/^\/+|\/+$/g, '');
  const segments = rest ? rest.split('/').filter(Boolean) : [];

  const tab = segments[0] || 'overview';
  const route = { tab: MAIN_TABS.has(tab) ? tab : 'overview' };

  if (route.tab === 'tasks') {
    if (segments[1] === 'list') route.taskView = 'list';
    else if (segments[1] === 'board') route.taskView = 'board';
    else if (segments[1]) route.taskId = decodeURIComponent(segments[1]);
  } else if (route.tab === 'projects' && segments[1]) {
    route.projectId = decodeURIComponent(segments[1]);
  } else if (route.tab === 'memory' && segments[1]) {
    route.memoryTab = decodeURIComponent(segments[1]);
  } else if (route.tab === 'settings' && segments[1]) {
    route.settingsSubtab = decodeURIComponent(segments[1]);
  } else if (route.tab === 'global-memory' && segments[1]) {
    route.globalSubtab = decodeURIComponent(segments[1]);
  }

  return route;
}

/** Build a pathname from a route object (no query/hash). */
export function buildPath(route) {
  const base = getBasePath();
  const tab = route.tab || 'overview';
  const parts = [];

  if (tab !== 'overview') parts.push(tab);

  if (tab === 'tasks') {
    if (route.taskId) parts.push(encodeURIComponent(route.taskId));
    else if (route.taskView === 'list') parts.push('list');
    else if (route.taskView === 'board') parts.push('board');
  } else if (tab === 'projects' && route.projectId) {
    parts.push(encodeURIComponent(route.projectId));
  } else if (tab === 'memory' && route.memoryTab) {
    parts.push(encodeURIComponent(route.memoryTab));
  } else if (tab === 'settings' && route.settingsSubtab) {
    parts.push(encodeURIComponent(route.settingsSubtab));
  } else if (tab === 'global-memory' && route.globalSubtab) {
    parts.push(encodeURIComponent(route.globalSubtab));
  }

  if (parts.length === 0) return `${base}/`;
  return `${base}/${parts.join('/')}`;
}

/** Read live UI state and produce a route object. */
export function routeFromState() {
  const { activeMainTab } = deps;
  const route = { tab: activeMainTab?.() || 'overview' };

  if (route.tab === 'tasks') {
    const view = deps.getTaskView?.();
    if (view === 'list') route.taskView = 'list';
    if (deps.isTaskDetailOpen?.()) {
      const id = deps.getOpenTaskId?.();
      if (id) route.taskId = id;
    }
  } else if (route.tab === 'projects') {
    const pid = deps.getSelectedProjectId?.();
    if (pid) route.projectId = pid;
  } else if (route.tab === 'memory') {
    const mt = deps.getActiveMemoryTab?.();
    if (mt) route.memoryTab = mt;
  } else if (route.tab === 'settings') {
    const st = deps.getSettingsSubtab?.();
    if (st && st !== 'display') route.settingsSubtab = st;
  } else if (route.tab === 'global-memory') {
    const gs = deps.getGlobalMemorySubtab?.();
    if (gs && gs !== 'claude-md') route.globalSubtab = gs;
  }

  return route;
}

/**
 * Push or replace the browser URL to match `route`.
 * @param {object} route
 * @param {{ replace?: boolean }} [opts]
 */
export function navigateToRoute(route, opts = {}) {
  if (!routingReady || applyingRoute) return;
  const path = buildPath(route);
  const current = window.location.pathname;
  if (path === current) return;
  const state = { dashboardRoute: route };
  if (opts.replace) {
    window.history.replaceState(state, '', path);
  } else {
    window.history.pushState(state, '', path);
  }
}

/** Sync URL from current UI state. */
export function syncUrl(opts = {}) {
  navigateToRoute(routeFromState(), opts);
}

/** Apply a parsed route to the UI (does not change the URL). */
export function applyRoute(route) {
  if (!deps.switchMainTab) return;
  applyingRoute = true;
  try {
    const tab = route.tab || 'overview';
    deps.switchMainTab(tab, { fromRoute: true });

    if (tab === 'tasks' && route.taskView) {
      deps.switchTaskView?.(route.taskView, { fromRoute: true });
    }

    if (tab === 'projects' && route.projectId) {
      deps.selectProject?.(route.projectId, { fromRoute: true });
    }

    if (tab === 'memory' && route.memoryTab) {
      deps.selectMemoryTab?.(route.memoryTab, { fromRoute: true });
    }

    if (tab === 'settings' && route.settingsSubtab) {
      deps.switchSettingsSubtab?.(route.settingsSubtab, { fromRoute: true });
    }

    if (tab === 'global-memory' && route.globalSubtab) {
      deps.switchGlobalMemorySubtab?.(route.globalSubtab, { fromRoute: true });
    }

    if (tab === 'tasks' && route.taskId) {
      const task = deps.findTaskById?.(route.taskId);
      if (task) {
        deps.openTaskDetail?.(task, { focusTitle: false, fromRoute: true });
      } else {
        deps.pendingTaskId = route.taskId;
      }
    } else if (deps.isTaskDetailOpen?.()) {
      deps.closeTaskDetail?.({ fromRoute: true });
    }
  } finally {
    applyingRoute = false;
  }
}

/** Called after tasks load — opens a task that was in the URL on first paint. */
export function flushPendingRoute() {
  const taskId = deps.pendingTaskId;
  if (!taskId) return;
  deps.pendingTaskId = null;
  const task = deps.findTaskById?.(taskId);
  if (task) {
    applyingRoute = true;
    try {
      deps.openTaskDetail?.(task, { focusTitle: false, fromRoute: true });
    } finally {
      applyingRoute = false;
    }
  }
}

export function isApplyingRoute() {
  return applyingRoute;
}

export function isRoutingReady() {
  return routingReady;
}

/**
 * Wire routing. Call once after modules are initialized.
 * @param {object} callbacks — see `deps` keys above plus getters
 */
export function initRouting(callbacks) {
  Object.assign(deps, callbacks);
  deps.pendingTaskId = null;

  const initial = parseRoute();
  applyRoute(initial);
  window.history.replaceState({ dashboardRoute: initial }, '', buildPath(initial));

  window.addEventListener('popstate', () => {
    applyRoute(parseRoute());
  });

  routingReady = true;
}
