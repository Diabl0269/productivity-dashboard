// projects-view.js — Project management: pick a project, see epic → task tree, CRUD.

import { switchMainTab, showStatus } from './state.js';
import {
  collectProjects,
  formatEstimate,
  dueBadgeHtml,
  isEffectivelyBlocked,
  computeNextTaskId,
  derivePrefixFromSlug,
  projectPrefix,
  appendHistory,
} from './task-fields.js';
import {
  escapeHtml,
  getTicketType,
  normalizeTicketTypes,
  resolveTaskColor,
  DEFAULT_TICKET_TYPE_ID,
} from './ticket-types.js';
import { openTaskDetail } from './task-detail.js';
import { openCreateTaskModal } from './task-create.js';
import { markChanged } from './tasks-io.js';
import { todayStr } from './tasks-parser.js';
import { syncUrl, isRoutingReady } from './routing.js';
import { normalizePrefix } from '../../shared/task-ids.js';

const SELECTED_KEY = 'dashboard.selectedProject';
const PROJECT_ID_RE = /^[a-z][a-z0-9-]*$/;

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

export function getSelectedProjectId() {
  return readSelected();
}

export function selectProject(projectId, opts = {}) {
  if (projectId) writeSelected(projectId);
  renderProjectsView();
  if (!opts.fromRoute && isRoutingReady()) syncUrl();
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

function ensureMeta(state) {
  if (!state.meta) state.meta = { projects: [] };
  if (!Array.isArray(state.meta.projects)) state.meta.projects = [];
  return state.meta;
}

function slugifyProjectId(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return slug || 'project';
}

function uniqueProjectId(base, projects) {
  const used = new Set((projects || []).map(p => p.id));
  const root = slugifyProjectId(base);
  if (!used.has(root)) return root;
  let n = 2;
  while (used.has(`${root}-${n}`)) n++;
  return `${root}-${n}`;
}

function projectList(state) {
  const meta = ensureMeta(state);
  const fromMeta = (meta.projects || []).map(p => ({
    id: p.id,
    name: p.name || p.id,
    color: p.color || null,
    prefix: p.prefix || null,
  }));
  const ids = new Set(fromMeta.map(p => p.id));
  for (const id of collectProjects(state.tasks, meta.projects)) {
    if (!ids.has(id)) {
      fromMeta.push({ id, name: id, color: null, prefix: null });
      ids.add(id);
    }
  }
  return fromMeta.sort((a, b) => a.name.localeCompare(b.name));
}

function tasksForProject(state, projectId) {
  return flatTasks(state.tasks).filter(t => (t.project || '') === projectId);
}

function tasksNotInProject(state, projectId) {
  return flatTasks(state.tasks).filter(t => (t.project || '') !== projectId);
}

function buildForest(tasks, types) {
  const byId = new Map(tasks.map(t => [t.taskId, t]));
  const children = new Map();
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

function createProject(state, { id, name, color, prefix }) {
  const meta = ensureMeta(state);
  const row = {
    id,
    name: name || id,
  };
  if (color) row.color = color;
  const pfx = normalizePrefix(prefix) || derivePrefixFromSlug(id);
  if (pfx) row.prefix = pfx;
  meta.projects.push(row);
  markChanged();
  return row;
}

function updateProjectMeta(state, projectId, updates) {
  const meta = ensureMeta(state);
  let row = meta.projects.find(p => p.id === projectId);
  if (!row) {
    row = { id: projectId, name: projectId };
    meta.projects.push(row);
  }
  if (updates.name != null) row.name = String(updates.name).trim() || row.id;
  if (updates.color !== undefined) {
    if (updates.color) row.color = updates.color;
    else delete row.color;
  }
  if (updates.prefix !== undefined) {
    const pfx = normalizePrefix(updates.prefix);
    if (pfx) row.prefix = pfx;
    else delete row.prefix;
  }
  markChanged();
  return row;
}

function deleteProjectMeta(state, projectId) {
  const meta = ensureMeta(state);
  meta.projects = meta.projects.filter(p => p.id !== projectId);
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (t.project === projectId) {
        t.project = null;
        t.updated = todayStr();
      }
    }
  }
  markChanged();
}

function linkTask(state, taskId, projectId) {
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (t.taskId === taskId) {
        t.project = projectId;
        t.updated = todayStr();
        appendHistory(t, { event: 'project', to: projectId });
        markChanged(t);
        return t;
      }
    }
  }
  return null;
}

function unlinkTask(state, taskId) {
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (t.taskId === taskId) {
        t.project = null;
        t.updated = todayStr();
        appendHistory(t, { event: 'project', to: '' });
        markChanged(t);
        return t;
      }
    }
  }
  return null;
}

function showProjectForm(mode, project, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'pv-form-overlay';
  const isNew = mode === 'new';
  const title = isNew ? 'New project' : 'Edit project';
  const defaultId = isNew ? '' : project.id;
  const defaultName = isNew ? '' : project.name;
  const defaultColor = isNew ? '#3B82F6' : (project.color || '#3B82F6');
  const defaultPrefix = isNew ? '' : (project.prefix || projectPrefix(project));

  overlay.innerHTML = `
    <form class="pv-form" role="dialog" aria-label="${escapeHtml(title)}">
      <h3 class="pv-form-title">${escapeHtml(title)}</h3>
      <label class="pv-form-field">
        <span>Name</span>
        <input type="text" name="name" required value="${escapeHtml(defaultName)}" placeholder="My App">
      </label>
      <label class="pv-form-field">
        <span>ID (slug)</span>
        <input type="text" name="id" ${isNew ? '' : 'readonly'} value="${escapeHtml(defaultId)}" placeholder="my-app" pattern="[a-z][a-z0-9-]*">
      </label>
      <label class="pv-form-field">
        <span>Ticket prefix</span>
        <input type="text" name="prefix" value="${escapeHtml(defaultPrefix)}" placeholder="APP" maxlength="6" style="text-transform:uppercase">
      </label>
      <label class="pv-form-field pv-form-color">
        <span>Color</span>
        <input type="color" name="color" value="${escapeHtml(defaultColor)}">
      </label>
      <div class="pv-form-actions">
        <button type="button" class="pv-form-cancel">Cancel</button>
        <button type="submit" class="primary">${isNew ? 'Create' : 'Save'}</button>
      </div>
    </form>
  `;

  const form = overlay.querySelector('.pv-form');
  const nameInput = form.querySelector('[name="name"]');
  const idInput = form.querySelector('[name="id"]');
  const prefixInput = form.querySelector('[name="prefix"]');

  if (isNew) {
    nameInput.addEventListener('input', () => {
      if (!idInput.dataset.touched) {
        idInput.value = slugifyProjectId(nameInput.value);
      }
      if (!prefixInput.dataset.touched) {
        prefixInput.value = derivePrefixFromSlug(idInput.value || nameInput.value);
      }
    });
    idInput.addEventListener('input', () => { idInput.dataset.touched = '1'; });
    prefixInput.addEventListener('input', () => { prefixInput.dataset.touched = '1'; });
  }

  overlay.querySelector('.pv-form-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    let id = idInput.value.trim();
    if (!name) {
      showStatus('Project name is required');
      return;
    }
    if (isNew) {
      const state = getState();
      id = uniqueProjectId(id || name, ensureMeta(state).projects);
      if (!PROJECT_ID_RE.test(id)) {
        showStatus('ID must be lowercase letters, numbers, hyphens');
        return;
      }
    }
    const prefix = prefixInput.value.trim();
    if (prefix && !normalizePrefix(prefix)) {
      showStatus('Prefix must be 1–6 uppercase letters/digits');
      return;
    }
    const color = form.querySelector('[name="color"]').value;
    onDone({ id, name, color, prefix });
    overlay.remove();
  });

  document.body.appendChild(overlay);
  nameInput.focus();
}

function renderSidebar(projects, selectedId, state) {
  const nav = document.getElementById('projectsSidebarList');
  const head = document.querySelector('.pv-sidebar-head');
  if (!nav) return;

  if (head && !head.querySelector('.pv-new-btn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pv-new-btn';
    btn.textContent = '+ New';
    btn.title = 'Create project';
    btn.addEventListener('click', () => {
      showProjectForm('new', null, (data) => {
        createProject(state, data);
        selectProject(data.id);
        getRenderTasks?.()();
        showStatus(`Created project ${data.name}`);
      });
    });
    head.appendChild(btn);
  }

  nav.innerHTML = '';
  if (projects.length === 0) {
    nav.innerHTML = '<div class="pv-empty">No projects yet. Click <strong>+ New</strong> to create one.</div>';
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
    const prefix = projectPrefix(p);
    btn.innerHTML = `${swatch}<span class="pv-project-name">${escapeHtml(p.name)}</span><span class="pv-project-prefix">${escapeHtml(prefix)}</span>`;
    btn.addEventListener('click', () => {
      selectProject(p.id);
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

function renderLinkPanel(state, project) {
  const panel = document.createElement('div');
  panel.className = 'pv-link-panel';
  const candidates = tasksNotInProject(state, project.id)
    .sort((a, b) => (a.taskId || '').localeCompare(b.taskId || '', undefined, { numeric: true }));

  panel.innerHTML = `
    <h4 class="pv-link-title">Link existing ticket</h4>
    <div class="pv-link-row">
      <select class="pv-link-select" aria-label="Select ticket to link">
        <option value="">Choose a ticket…</option>
        ${candidates.map(t => `<option value="${escapeHtml(t.taskId)}">${escapeHtml(t.taskId)} — ${escapeHtml(t.title || '')}</option>`).join('')}
      </select>
      <button type="button" class="pv-link-btn">Link</button>
    </div>
  `;

  const select = panel.querySelector('.pv-link-select');
  panel.querySelector('.pv-link-btn').addEventListener('click', () => {
    const taskId = select.value;
    if (!taskId) return;
    linkTask(state, taskId, project.id);
    getRenderTasks?.()();
    showStatus(`Linked ${taskId} to ${project.name}`);
  });

  if (candidates.length === 0) {
    panel.querySelector('.pv-link-row').innerHTML = '<p class="pv-empty">All tickets are already in this project or none exist.</p>';
  }

  return panel;
}

function renderMain(state, project) {
  const main = document.getElementById('projectsMain');
  if (!main) return;

  if (!project) {
    main.innerHTML = `
      <div class="pv-hero-empty">
        <h2>Projects</h2>
        <p>Select a project to see its epics, tasks, and subtasks in one tree — or create one with <strong>+ New</strong>.</p>
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
  const prefix = projectPrefix(project);

  main.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'pv-hero';
  const swatch = project.color
    ? `background:${escapeHtml(project.color)}`
    : '';
  header.innerHTML = `
    <div class="pv-hero-top">
      <span class="pv-hero-swatch" style="${swatch}"></span>
      <div class="pv-hero-text">
        <h2 class="pv-hero-title">${escapeHtml(project.name)}</h2>
        <p class="pv-hero-sub">${escapeHtml(project.id)} · prefix <code>${escapeHtml(prefix)}</code> · ${tasks.length} tickets</p>
      </div>
      <div class="pv-hero-actions">
        <button type="button" class="pv-action-btn" data-action="edit">Edit</button>
        <button type="button" class="pv-action-btn" data-action="new-task">+ Ticket</button>
        <button type="button" class="pv-action-btn pv-danger" data-action="delete">Delete</button>
      </div>
    </div>
    <div class="pv-hero-stats">
      <div class="pv-stat"><span class="pv-stat-n">${active}</span><span class="pv-stat-l">Active</span></div>
      <div class="pv-stat"><span class="pv-stat-n">${done}</span><span class="pv-stat-l">Done</span></div>
      <div class="pv-stat"><span class="pv-stat-n">${totalEst ? formatEstimate(totalEst) : '—'}</span><span class="pv-stat-l">Estimate</span></div>
      <div class="pv-stat"><span class="pv-stat-n">${totalLogged ? formatEstimate(totalLogged) : '—'}</span><span class="pv-stat-l">Logged</span></div>
    </div>
  `;

  header.querySelector('[data-action="edit"]').addEventListener('click', () => {
    showProjectForm('edit', project, (data) => {
      updateProjectMeta(state, project.id, data);
      getRenderTasks?.()();
      showStatus('Project updated');
    });
  });

  header.querySelector('[data-action="new-task"]').addEventListener('click', () => {
    openCreateTaskModal('todo', { projectId: project.id });
  });

  header.querySelector('[data-action="delete"]').addEventListener('click', () => {
    const n = tasks.length;
    const msg = n
      ? `Delete project "${project.name}"? ${n} ticket(s) will be unlinked (not deleted).`
      : `Delete project "${project.name}"?`;
    if (!confirm(msg)) return;
    deleteProjectMeta(state, project.id);
    writeSelected('');
    getRenderTasks?.()();
    showStatus(`Deleted project ${project.name}`);
  });

  main.appendChild(header);
  main.appendChild(renderLinkPanel(state, project));

  const tree = document.createElement('div');
  tree.className = 'pv-tree';
  if (roots.length === 0) {
    tree.innerHTML = '<div class="pv-empty">No tasks in this project yet. Link an existing ticket or click <strong>+ Ticket</strong>.</div>';
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
  ensureMeta(state);
  const projects = projectList(state);
  let selectedId = readSelected();
  if (selectedId && !projects.some(p => p.id === selectedId)) selectedId = '';
  if (!selectedId && projects.length) selectedId = projects[0].id;
  if (selectedId) writeSelected(selectedId);

  renderSidebar(projects, selectedId, state);
  const project = projects.find(p => p.id === selectedId) || null;
  renderMain(state, project);
}

export function openProject(projectId) {
  selectProject(projectId);
  switchMainTab('projects');
}

export function initProjectsView() {
  renderProjectsView();
}

/** Call after tasks reload so the Projects tab stays current. */
export function refreshProjectsView() {
  const panel = document.getElementById('projectsPanel');
  if (panel?.classList.contains('active')) renderProjectsView();
}
