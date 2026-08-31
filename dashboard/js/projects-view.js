// projects-view.js — Project management: pick a project, see epic → task tree.

import { switchMainTab } from './state.js';
import {
  collectProjects,
  formatEstimate,
  dueBadgeHtml,
  isEffectivelyBlocked,
} from './task-fields.js';
import {
  escapeHtml,
  getTicketType,
  normalizeTicketTypes,
  resolveTaskColor,
} from './ticket-types.js';
import { openTaskDetail } from './task-detail.js';

const SELECTED_KEY = 'dashboard.selectedProject';

let getState = null;
let getRenderTasks = null;

export function setProjectsViewCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

function readSelected() {
  try {
    return localStorage.getItem(SELECTED_KEY) || '';
  } catch {
    return '';
  }
}

function writeSelected(id) {
  try {
    if (id) localStorage.setItem(SELECTED_KEY, id);
    else localStorage.removeItem(SELECTED_KEY);
  } catch { /* ignore */ }
}

function flatTasks(tasksBySection) {
  const list = [];
  for (const sec of Object.values(tasksBySection || {})) {
    for (const t of sec || []) {
      if (t.section === 'archive') continue;
      list.push(t);
    }
  }
  return list;
}

function projectList(state) {
  const fromMeta = (state.meta?.projects || []).map(p => ({
    id: p.id,
    name: p.name || p.id,
    color: p.color || null,
  }));
  const ids = new Set(fromMeta.map(p => p.id));
  for (const id of collectProjects(state.tasks, state.meta?.projects)) {
    if (!ids.has(id)) {
      fromMeta.push({ id, name: id, color: null });
      ids.add(id);
    }
  }
  return fromMeta.sort((a, b) => a.name.localeCompare(b.name));
}

function tasksForProject(state, projectId) {
  return flatTasks(state.tasks).filter(t => (t.project || '') === projectId);
}

/**
 * Build forest: roots are epics (or tasks with no parent in this project set),
 * children nest under parentId when parent is also in the project set.
 */
function buildForest(tasks, types) {
  const byId = new Map(tasks.map(t => [t.taskId, t]));
  const children = new Map(); // parentId -> task[]
  const roots = [];

  for (const t of tasks) {
    const parentInSet = t.parentId && byId.has(t.parentId);
    if (parentInSet) {
      if (!children.has(t.parentId)) children.set(t.parentId, []);
      children.get(t.parentId).push(t);
    } else {
      roots.push(t);
    }
  }

  const typeRank = (t) => {
    const idx = types.findIndex(tt => tt.id === (t.type || 'task'));
    return idx < 0 ? 99 : idx;
  };
  const sortFn = (a, b) => typeRank(a) - typeRank(b)
    || (a.priority === 'high' ? 0 : a.priority === 'medium' ? 1 : 2)
      - (b.priority === 'high' ? 0 : b.priority === 'medium' ? 1 : 2)
    || (a.title || '').localeCompare(b.title || '');

  roots.sort(sortFn);
  for (const list of children.values()) list.sort(sortFn);

  return { roots, children, byId };
}

function progressFor(task, childrenMap) {
  const kids = childrenMap.get(task.taskId) || [];
  if (kids.length === 0) {
    const done = task.checked || task.section === 'done';
    return { done: done ? 1 : 0, total: 1, pct: done ? 100 : 0 };
  }
  let done = 0;
  let total = 0;
  const walk = (list) => {
    for (const k of list) {
      const nested = childrenMap.get(k.taskId) || [];
      if (nested.length) walk(nested);
      else {
        total += 1;
        if (k.checked || k.section === 'done') done += 1;
      }
    }
  };
  walk(kids);
  if (total === 0) total = 1;
  return { done, total, pct: Math.round((done / total) * 100) };
}

function renderSidebar(projects, selectedId) {
  const nav = document.getElementById('projectsSidebarList');
  if (!nav) return;
  nav.innerHTML = '';
  if (projects.length === 0) {
    nav.innerHTML = '<div class="pv-empty">No projects yet. Set a <code>project</code> on a task, or add projects in tasks.json meta.</div>';
    return;
  }
  projects.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pv-project-btn' + (p.id === selectedId ? ' active' : '');
    btn.dataset.projectId = p.id;
    const swatch = p.color
      ? `<span class="pv-swatch" style="background:${escapeHtml(p.color)}"></span>`
      : '<span class="pv-swatch pv-swatch-default"></span>';
    btn.innerHTML = `${swatch}<span class="pv-project-name">${escapeHtml(p.name)}</span>`;
    btn.addEventListener('click', () => {
      writeSelected(p.id);
      renderProjectsView();
    });
    nav.appendChild(btn);
  });
}

function renderTreeNode(task, childrenMap, types, state, depth) {
  const wrap = document.createElement('div');
  wrap.className = 'pv-node';
  wrap.style.setProperty('--pv-depth', String(depth));

  const kids = childrenMap.get(task.taskId) || [];
  const prog = progressFor(task, childrenMap);
  const tt = getTicketType(types, task.type || 'task');
  const color = resolveTaskColor(task, types, state.tasks);
  const done = task.checked || task.section === 'done';
  const blocked = isEffectivelyBlocked(task, state.tasks);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'pv-row'
    + (done ? ' pv-done' : '')
    + (blocked ? ' pv-blocked' : '')
    + (kids.length ? ' pv-has-children' : '');
  row.innerHTML = `
    <span class="pv-type" style="--pv-color:${escapeHtml(color)}">${escapeHtml(tt.name)}</span>
    <span class="pv-id">${escapeHtml(task.taskId || '')}</span>
    <span class="pv-title">${escapeHtml(task.title || '')}</span>
    <span class="pv-meta">
      ${dueBadgeHtml(task)}
      ${task.estimateMinutes ? `<span class="pv-est">${escapeHtml(formatEstimate(task.estimateMinutes))}</span>` : ''}
      <span class="pv-section">${escapeHtml(task.section || '')}</span>
    </span>
    ${kids.length ? `
      <span class="pv-progress" title="${prog.done}/${prog.total} done">
        <span class="pv-progress-bar"><span style="width:${prog.pct}%"></span></span>
        <span class="pv-progress-label">${prog.pct}%</span>
      </span>` : ''}
  `;
  row.addEventListener('click', () => openTaskDetail(task));
  wrap.appendChild(row);

  if (kids.length) {
    const branch = document.createElement('div');
    branch.className = 'pv-branch';
    kids.forEach(k => branch.appendChild(renderTreeNode(k, childrenMap, types, state, depth + 1)));
    wrap.appendChild(branch);
  }
  return wrap;
}

function renderMain(state, project) {
  const main = document.getElementById('projectsMain');
  if (!main) return;

  if (!project) {
    main.innerHTML = `
      <div class="pv-hero-empty">
        <h2>Projects</h2>
        <p>Select a project to see its epics, tasks, and subtasks in one tree.</p>
      </div>`;
    return;
  }

  const tasks = tasksForProject(state, project.id);
  const types = normalizeTicketTypes(state.ticketTypes);
  const { roots, children } = buildForest(tasks, types);

  const totalEst = tasks.reduce((s, t) => s + (t.estimateMinutes || 0), 0);
  const totalLogged = tasks.reduce((s, t) => s + (t.loggedMinutes || 0), 0);
  const active = tasks.filter(t => t.section === 'todo' || t.section === 'in-progress').length;
  const done = tasks.filter(t => t.checked || t.section === 'done').length;

  main.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'pv-hero';
  const swatch = project.color
    ? `background:${escapeHtml(project.color)}`
    : '';
  header.innerHTML = `
    <div class="pv-hero-top">
      <span class="pv-hero-swatch" style="${swatch}"></span>
      <div>
        <h2 class="pv-hero-title">${escapeHtml(project.name)}</h2>
        <p class="pv-hero-sub">${escapeHtml(project.id)} · ${tasks.length} tickets</p>
      </div>
    </div>
    <div class="pv-hero-stats">
      <div class="pv-stat"><span class="pv-stat-n">${active}</span><span class="pv-stat-l">Active</span></div>
      <div class="pv-stat"><span class="pv-stat-n">${done}</span><span class="pv-stat-l">Done</span></div>
      <div class="pv-stat"><span class="pv-stat-n">${totalEst ? formatEstimate(totalEst) : '—'}</span><span class="pv-stat-l">Estimate</span></div>
      <div class="pv-stat"><span class="pv-stat-n">${totalLogged ? formatEstimate(totalLogged) : '—'}</span><span class="pv-stat-l">Logged</span></div>
    </div>
  `;
  main.appendChild(header);

  const tree = document.createElement('div');
  tree.className = 'pv-tree';
  if (roots.length === 0) {
    tree.innerHTML = '<div class="pv-empty">No tasks tagged with this project yet.</div>';
  } else {
    roots.forEach(r => tree.appendChild(renderTreeNode(r, children, types, state, 0)));
  }
  main.appendChild(tree);
}

export function renderProjectsView() {
  if (!getState) return;
  const state = getState();
  if (!state?.tasks) {
    const main = document.getElementById('projectsMain');
    if (main) main.innerHTML = '<div class="pv-hero-empty"><p>Load tasks to manage projects.</p></div>';
    return;
  }
  const projects = projectList(state);
  let selectedId = readSelected();
  if (selectedId && !projects.some(p => p.id === selectedId)) selectedId = '';
  if (!selectedId && projects.length) selectedId = projects[0].id;
  if (selectedId) writeSelected(selectedId);

  renderSidebar(projects, selectedId);
  const project = projects.find(p => p.id === selectedId) || null;
  renderMain(state, project);
}

export function openProject(projectId) {
  if (projectId) writeSelected(projectId);
  switchMainTab('projects');
  renderProjectsView();
}

export function initProjectsView() {
  renderProjectsView();
}

/** Call after tasks reload so the Projects tab stays current. */
export function refreshProjectsView() {
  const panel = document.getElementById('projectsPanel');
  if (panel?.classList.contains('active')) renderProjectsView();
}
