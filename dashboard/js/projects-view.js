// projects-view.js — Project management: pick a project, see epic → task tree, CRUD.

import { switchMainTab, showStatus } from './state.js';
import {
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
import {
  mergedProjectList,
  buildProjectTree,
  isProjectAncestor,
  wouldCreateProjectCycle,
} from '../../shared/projects.js';
import {
  needsPrefixMigration,
  migrateTaskToProjectInState,
} from '../../shared/task-rename.js';
import { createTasksBackup } from './tasks-backup.js';
import { mountTicketPicker } from './ticket-picker.js';

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
  return mergedProjectList(state.tasks, ensureMeta(state).projects);
}

function projectTree(state) {
  const meta = ensureMeta(state);
  return buildProjectTree(projectList(state));
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

function createProject(state, { id, name, color, prefix, parentId }) {
  const meta = ensureMeta(state);
  const row = {
    id,
    name: name || id,
  };
  if (color) row.color = color;
  const pfx = normalizePrefix(prefix);
  if (pfx) row.prefix = pfx;
  if (parentId) row.parentId = parentId;
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
  if (updates.parentId !== undefined) {
    if (updates.parentId) row.parentId = updates.parentId;
    else delete row.parentId;
  }
  markChanged();
  return row;
}

function deleteProjectMeta(state, projectId) {
  const meta = ensureMeta(state);
  meta.projects = meta.projects.filter(p => p.id !== projectId);
  for (const p of meta.projects) {
    if (p.parentId === projectId) delete p.parentId;
  }
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
  const result = migrateTaskToProjectInState(state, taskId, projectId);
  const finalId = result.newId;
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (t.taskId === finalId) {
        t.updated = todayStr();
        appendHistory(t, { event: 'project', to: projectId });
        markChanged(t);
        return { task: t, ...result };
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

function showProjectForm(mode, project, onDone, state) {
  const isNew = mode === 'new';
  const modalTitle = isNew ? 'New project' : 'Edit project';
  const defaultId = isNew ? '' : project.id;
  const defaultName = isNew ? '' : project.name;
  const defaultColor = isNew ? '#3B82F6' : (project.color || '#3B82F6');
  const metaProjects = ensureMeta(state).projects;
  const defaultPrefix = isNew ? '' : (project.prefix || projectPrefix(project, metaProjects));
  const defaultParent = isNew ? '' : (project.parentId || '');
  const excludeIds = new Set();
  if (!isNew && project?.id) {
    excludeIds.add(project.id);
    for (const p of metaProjects) {
      if (isProjectAncestor(metaProjects, project.id, p.id)) excludeIds.add(p.id);
    }
  }
  const parentOptions = metaProjects
    .filter(p => !excludeIds.has(p.id))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

  const overlay = document.createElement('div');
  overlay.className = 'td-overlay';
  overlay.innerHTML = `
    <form class="td-modal tc-modal pv-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(modalTitle)}">
      <div class="td-header">
        <span class="td-id">${isNew ? 'New' : escapeHtml(project.id)}</span>
        <input type="text" class="td-title-input" name="name" required value="${escapeHtml(defaultName)}" placeholder="Project name" aria-label="Project name">
        <button type="button" class="td-close pv-modal-close" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="td-body pv-modal-body">
        <label class="td-field td-field-block">
          <span class="td-field-label">ID (slug)</span>
          <input type="text" class="td-text-input" name="id" ${isNew ? '' : 'readonly'} value="${escapeHtml(defaultId)}" placeholder="my-app" pattern="[a-z][a-z0-9-]*">
        </label>
        <label class="td-field td-field-block">
          <span class="td-field-label">Parent project</span>
          <select class="td-select" name="parentId">
            <option value="">None (top-level)</option>
            ${parentOptions.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === defaultParent ? 'selected' : ''}>${escapeHtml(p.name || p.id)}</option>`).join('')}
          </select>
        </label>
        <label class="td-field td-field-block">
          <span class="td-field-label">Ticket prefix</span>
          <input type="text" class="td-text-input" name="prefix" value="${escapeHtml(defaultPrefix)}" placeholder="APP" maxlength="6" style="text-transform:uppercase">
          <span class="pv-form-hint">Leave blank to inherit from parent or derive from slug</span>
        </label>
        <label class="td-field td-field-block pv-form-color">
          <span class="td-field-label">Color</span>
          <input type="color" name="color" value="${escapeHtml(defaultColor)}">
        </label>
      </div>
      <div class="td-footer">
        <button type="button" class="pv-modal-cancel">Cancel</button>
        <div class="td-footer-spacer"></div>
        <button type="submit" class="primary">${isNew ? 'Create' : 'Save'}</button>
      </div>
    </form>
  `;

  const form = overlay.querySelector('form');
  const nameInput = form.querySelector('[name="name"]');
  const idInput = form.querySelector('[name="id"]');
  const prefixInput = form.querySelector('[name="prefix"]');

  const close = () => {
    overlay.classList.remove('visible');
    overlay.hidden = true;
    setTimeout(() => overlay.remove(), 200);
  };

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

  overlay.querySelector('.pv-modal-cancel').addEventListener('click', close);
  overlay.querySelector('.pv-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

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
    const parentId = form.querySelector('[name="parentId"]').value.trim() || null;
    if (parentId && wouldCreateProjectCycle(ensureMeta(getState()).projects, isNew ? id : project.id, parentId)) {
      showStatus('Invalid parent — would create a cycle');
      return;
    }
    const color = form.querySelector('[name="color"]').value;
    onDone({ id, name, color, prefix, parentId });
    close();
  });

  document.body.appendChild(overlay);
  overlay.hidden = false;
  void overlay.offsetWidth;
  overlay.classList.add('visible');
  nameInput.focus();
}

function renderSidebarNode(p, selectedId, state, depth) {
  const metaProjects = ensureMeta(state).projects;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pv-project-btn' + (p.id === selectedId ? ' active' : '');
  btn.dataset.projectId = p.id;
  btn.style.setProperty('--pv-proj-depth', String(depth));
  const swatch = p.color
    ? `<span class="pv-swatch" style="background:${escapeHtml(p.color)}"></span>`
    : '<span class="pv-swatch pv-swatch-default"></span>';
  const prefix = projectPrefix(p, metaProjects);
  btn.innerHTML = `${swatch}<span class="pv-project-name">${escapeHtml(p.name)}</span><span class="pv-project-prefix">${escapeHtml(prefix)}</span>`;
  btn.addEventListener('click', () => selectProject(p.id));
  return btn;
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
      }, state);
    });
    head.appendChild(btn);
  }

  nav.innerHTML = '';
  if (projects.length === 0) {
    nav.innerHTML = '<div class="pv-empty">No projects yet. Click <strong>+ New</strong> to create one.</div>';
    return;
  }

  const { roots } = buildProjectTree(projects);
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      nav.appendChild(renderSidebarNode(n, selectedId, state, depth));
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
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
      <div class="pv-link-picker"></div>
      <button type="button" class="pv-link-btn">Link</button>
    </div>
  `;

  let selectedTaskId = null;
  const pickerEl = panel.querySelector('.pv-link-picker');
  const picker = mountTicketPicker(pickerEl, {
    tasks: candidates,
    value: null,
    allowNone: false,
    placeholder: 'Search tickets to link…',
    ariaLabel: 'Select ticket to link',
    onChange: (id) => { selectedTaskId = id; },
  });

  panel.querySelector('.pv-link-btn').addEventListener('click', async () => {
    const taskId = selectedTaskId;
    if (!taskId) return;
    const metaProjects = ensureMeta(state).projects;
    const willMigrate = needsPrefixMigration(taskId, project.id, metaProjects);
    if (willMigrate) {
      const targetPrefix = projectPrefix(project, metaProjects);
      const msg = `${taskId} will be renamed to use prefix ${targetPrefix} when linked.\n\nCreate a backup first?`;
      const choice = confirm(msg + '\n\nOK = backup & link · Cancel = abort');
      if (!choice) return;
      try {
        await createTasksBackup();
        showStatus('Backup created');
      } catch (e) {
        if (!confirm(`Backup failed (${e.message}). Link anyway?`)) return;
      }
    }
    const result = linkTask(state, taskId, project.id);
    picker.setValue(null);
    selectedTaskId = null;
    getRenderTasks?.()();
    if (result?.migrated) {
      showStatus(`Linked ${result.oldId} → ${result.newId} in ${project.name}`);
    } else {
      showStatus(`Linked ${taskId} to ${project.name}`);
    }
  });

  if (candidates.length === 0) {
    picker.destroy();
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
  const prefix = projectPrefix(project, ensureMeta(state).projects);
  const parent = project.parentId
    ? projectList(state).find(p => p.id === project.parentId)
    : null;
  const parentLine = parent ? ` · parent <code>${escapeHtml(parent.name)}</code>` : '';

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
        <p class="pv-hero-sub">${escapeHtml(project.id)} · prefix <code>${escapeHtml(prefix)}</code>${parentLine} · ${tasks.length} tickets</p>
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
    }, state);
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
