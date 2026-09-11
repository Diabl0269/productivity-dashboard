// projects-view.js — Project management: sub-projects, epics, tasks, docs.

import { switchMainTab, showStatus } from './state.js';
import {
  formatEstimate,
  dueBadgeHtml,
  isEffectivelyBlocked,
  derivePrefixFromSlug,
  projectPrefix,
  appendHistory,
} from './task-fields.js';
import {
  escapeHtml,
  getTicketType,
  normalizeTicketTypes,
  resolveTaskColor,
} from './ticket-types.js';
import { openTaskDetail } from './task-detail.js';
import { openCreateTaskModal } from './task-create.js';
import { markChanged, flushAutoSave } from './tasks-io.js';
import { todayStr } from './tasks-parser.js';
import { syncUrl, isRoutingReady } from './routing.js';
import { normalizePrefix } from '../../shared/task-ids.js';
import {
  mergedProjectList,
  buildProjectTree,
  isProjectAncestor,
  wouldCreateProjectCycle,
  getProjectChildIds,
  projectScopeIds,
} from '../../shared/projects.js';
import {
  needsPrefixMigration,
  migrateTaskToProjectInState,
} from '../../shared/task-rename.js';
import { createTasksBackup } from './tasks-backup.js';
import { mountTicketPicker } from './ticket-picker.js';
import { renderProjectDocsPanel, clearProjectDocsCache, setProjectDocsCallbacks } from './project-docs.js';
import { initProjectDocsPanel, syncProjectDocsPanelVisibility, toggleDocsPanel, setDocsPanelCallbacks, syncDocsHeroButton } from './project-docs-panel.js';
import { showTaskMovePopover } from './task-move.js';
import { attachTaskDragHandle, bindProjectsDragDrop } from './project-drag.js';

const SELECTED_KEY = 'dashboard.selectedProject';
const COLLAPSE_KEY = 'dashboard.projects.collapsed';
const FILTERS_KEY = 'dashboard.projects.filters';
const PROJECT_ID_RE = /^[a-z][a-z0-9-]*$/;

const SUBPROJECT_PALETTE = ['#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#EC4899', '#06B6D4'];

let getState = null;
let getRenderTasks = null;

export function setProjectsViewCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

function readSelected() {
  try { return localStorage.getItem(SELECTED_KEY) || ''; } catch { return ''; }
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

function readCollapse() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; }
}

function writeCollapse(map) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function isCollapsed(key) {
  return !!readCollapse()[key];
}

function toggleCollapsed(key) {
  const map = readCollapse();
  map[key] = !map[key];
  writeCollapse(map);
}

function defaultFilters() {
  return { showDone: true, showBacklog: true, showInbox: true };
}

function readFilters() {
  try {
    const f = JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}');
    return { ...defaultFilters(), ...f };
  } catch {
    return defaultFilters();
  }
}

function writeFilters(filters) {
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* ignore */ }
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

function projectColor(project) {
  return project?.color || '#3B82F6';
}

function tasksForProject(state, projectId) {
  return flatTasks(state.tasks).filter(t => (t.project || '') === projectId);
}

function tasksForScope(state, projectId) {
  const scope = new Set(projectScopeIds(ensureMeta(state).projects, projectId));
  return flatTasks(state.tasks).filter(t => t.project && scope.has(t.project));
}

function tasksNotInScope(state, projectId) {
  const scope = new Set(projectScopeIds(ensureMeta(state).projects, projectId));
  return flatTasks(state.tasks).filter(t => !t.project || !scope.has(t.project));
}

function taskPassesFilters(task, filters) {
  const section = task.section || 'todo';
  const done = task.checked || section === 'done';
  if (done && !filters.showDone) return false;
  if (section === 'backlog' && !filters.showBacklog) return false;
  if (section === 'inbox' && !filters.showInbox) return false;
  return true;
}

function filterTasks(tasks, filters) {
  return tasks.filter(t => taskPassesFilters(t, filters));
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

function groupTasksForView(state, project, projects) {
  const childIds = getProjectChildIds(projects, project.id);
  const childProjects = childIds
    .map(id => projects.find(p => p.id === id))
    .filter(Boolean);

  if (childProjects.length === 0) {
    return {
      mode: 'flat',
      direct: tasksForProject(state, project.id),
      sections: [],
    };
  }

  return {
    mode: 'grouped',
    direct: tasksForProject(state, project.id),
    sections: childProjects.map(p => ({
      project: p,
      tasks: tasksForProject(state, p.id),
    })),
  };
}

function metaProjectRow(state, projectId) {
  return ensureMeta(state).projects.find(p => p.id === projectId) || null;
}

function projectForDocs(state, project) {
  if (!project) return null;
  const row = metaProjectRow(state, project.id);
  return row ? { ...project, ...row } : project;
}

function countEpics(tasks, types) {
  return tasks.filter(t => (t.type || 'task') === 'epic').length;
}

function finishProjectSave() {
  markChanged();
  clearProjectDocsCache();
  renderProjectsView();
  getRenderTasks?.()();
  flushAutoSave().catch(() => {});
}

function createProject(state, { id, name, color, prefix, parentId, memorySlug, docDirs }) {
  const meta = ensureMeta(state);
  const row = { id, name: name || id };
  if (color) row.color = color;
  const pfx = normalizePrefix(prefix);
  if (pfx) row.prefix = pfx;
  if (parentId) row.parentId = parentId;
  if (memorySlug) row.memorySlug = memorySlug;
  if (docDirs?.length) row.docDirs = docDirs;
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
  if (updates.memorySlug !== undefined) {
    const slug = String(updates.memorySlug || '').trim();
    if (slug) row.memorySlug = slug;
    else delete row.memorySlug;
  }
  if (updates.docDirs !== undefined) {
    if (updates.docDirs?.length) row.docDirs = updates.docDirs;
    else delete row.docDirs;
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

function showProjectForm(mode, project, onDone, state, defaults = {}) {
  const isNew = mode === 'new';
  const modalTitle = isNew ? (defaults.parentId ? 'New sub-project' : 'New project') : 'Edit project';
  const defaultId = isNew ? '' : project.id;
  const defaultName = isNew ? '' : project.name;
  const defaultColor = isNew
    ? (defaults.color || SUBPROJECT_PALETTE[ensureMeta(state).projects.length % SUBPROJECT_PALETTE.length])
    : (project.color || '#3B82F6');
  const metaProjects = ensureMeta(state).projects;
  const defaultPrefix = isNew ? '' : (project.prefix || projectPrefix(project, metaProjects));
  const defaultParent = isNew ? (defaults.parentId || '') : (project.parentId || '');
  const metaRow = !isNew && project?.id ? metaProjectRow(state, project.id) : null;
  const defaultMemorySlug = isNew ? '' : (metaRow?.memorySlug || project?.memorySlug || '');
  const defaultDocDirs = isNew ? '' : (metaRow?.docDirs || []).join('\n');
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
          <span class="td-field-label">Memory slug</span>
          <input type="text" class="td-text-input" name="memorySlug" value="${escapeHtml(defaultMemorySlug)}" placeholder="Defaults to project id">
          <span class="pv-form-hint">Loads <code>memory/projects/{slug}.md</code> and nested files from this repo</span>
        </label>
        <label class="td-field td-field-block">
          <span class="td-field-label">Documentation directories</span>
          <textarea class="td-notes-textarea td-notes-textarea-compact" name="docDirs" rows="3" placeholder="/Users/you/projects/my-app">${escapeHtml(defaultDocDirs)}</textarea>
          <span class="pv-form-hint">Absolute paths on this computer — one per line. Saved in <code>tasks.json</code> under this project.</span>
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
          <div class="pv-color-row">
            <input type="color" name="color" value="${escapeHtml(defaultColor)}">
            <span class="pv-color-swatches">${SUBPROJECT_PALETTE.map(c => `<button type="button" class="pv-color-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</span>
          </div>
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
  const colorInput = form.querySelector('[name="color"]');

  overlay.querySelectorAll('.pv-color-swatch').forEach(btn => {
    btn.addEventListener('click', () => { colorInput.value = btn.dataset.color; });
  });

  const close = () => {
    overlay.classList.remove('visible');
    overlay.hidden = true;
    setTimeout(() => overlay.remove(), 200);
  };

  if (isNew) {
    nameInput.addEventListener('input', () => {
      if (!idInput.dataset.touched) idInput.value = slugifyProjectId(nameInput.value);
      if (!prefixInput.dataset.touched) prefixInput.value = derivePrefixFromSlug(idInput.value || nameInput.value);
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
    if (!name) { showStatus('Project name is required'); return; }
    if (isNew) {
      id = uniqueProjectId(id || name, ensureMeta(getState()).projects);
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
    const memorySlug = form.querySelector('[name="memorySlug"]').value.trim();
    const docDirs = form.querySelector('[name="docDirs"]').value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    if (parentId && wouldCreateProjectCycle(ensureMeta(getState()).projects, isNew ? id : project.id, parentId)) {
      showStatus('Invalid parent — would create a cycle');
      return;
    }
    onDone({ id, name, color: colorInput.value, prefix, parentId, memorySlug, docDirs });
    close();
  });

  document.body.appendChild(overlay);
  overlay.hidden = false;
  void overlay.offsetWidth;
  overlay.classList.add('visible');
  nameInput.focus();
}

function collapseBtn(key, label) {
  const collapsed = isCollapsed(key);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pv-collapse-btn';
  btn.dataset.collapseKey = key;
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  btn.setAttribute('aria-label', collapsed ? `Expand ${label}` : `Collapse ${label}`);
  btn.innerHTML = collapsed
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCollapsed(key);
    renderProjectsView();
  });
  return btn;
}

function renderTaskRow(task, childrenMap, types, state, depth, accentColor) {
  const wrap = document.createElement('div');
  wrap.className = 'pv-node' + ((task.type || 'task') === 'epic' ? ' pv-epic-node' : '');
  wrap.style.setProperty('--pv-depth', String(depth));
  if (accentColor) wrap.style.setProperty('--pv-accent', accentColor);
  if ((task.type || 'task') === 'epic') wrap.dataset.pvEpicId = task.taskId;

  const kids = childrenMap.get(task.taskId) || [];
  const isEpic = (task.type || 'task') === 'epic';
  const collapseKey = `epic:${task.taskId}`;
  const collapsed = isEpic && isCollapsed(collapseKey);
  const prog = progressFor(task, childrenMap);
  const tt = getTicketType(types, task.type || 'task');
  const color = resolveTaskColor(task, types, state.tasks);
  const done = task.checked || task.section === 'done';
  const blocked = isEffectivelyBlocked(task, state.tasks);

  const row = document.createElement('div');
  row.className = 'pv-row-wrap';

  const dragHandle = document.createElement('button');
  dragHandle.type = 'button';
  dragHandle.className = 'pv-drag-handle';
  dragHandle.draggable = true;
  dragHandle.title = 'Drag to move';
  dragHandle.setAttribute('aria-label', 'Drag to move ticket');
  dragHandle.textContent = '⋮⋮';
  attachTaskDragHandle(dragHandle, task, wrap);
  row.appendChild(dragHandle);

  if (isEpic) row.appendChild(collapseBtn(collapseKey, task.title || task.taskId));

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pv-row'
    + (done ? ' pv-done' : '')
    + (blocked ? ' pv-blocked' : '')
    + (isEpic ? ' pv-epic-row' : '')
    + (kids.length ? ' pv-has-children' : '');
  btn.innerHTML = `
    <span class="pv-row-left">
      <span class="pv-type" style="--pv-color:${escapeHtml(color)}">${escapeHtml(tt.name)}</span>
      <span class="pv-id">${escapeHtml(task.taskId || '')}</span>
      <span class="pv-title">${escapeHtml(task.title || '')}</span>
    </span>
    <span class="pv-row-right">
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
    </span>`;
  btn.addEventListener('click', () => openTaskDetail(task));
  row.appendChild(btn);

  const moveBtn = document.createElement('button');
  moveBtn.type = 'button';
  moveBtn.className = 'pv-move-btn';
  moveBtn.title = 'Move or rename';
  moveBtn.setAttribute('aria-label', 'Move or rename ticket');
  moveBtn.textContent = '⋯';
  moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showTaskMovePopover(moveBtn, task, state, (result) => {
      if (result?.action === 'open') openTaskDetail(task);
      getRenderTasks?.()();
      renderProjectsView();
    });
  });
  row.appendChild(moveBtn);
  wrap.appendChild(row);

  if (kids.length && !collapsed) {
    const branch = document.createElement('div');
    branch.className = 'pv-branch';
    kids.forEach(k => branch.appendChild(renderTaskRow(k, childrenMap, types, state, depth + 1, accentColor)));
    wrap.appendChild(branch);
  } else if (isEpic && !collapsed && kids.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pv-epic-drop-hint';
    empty.textContent = 'Drop tickets here';
    wrap.appendChild(empty);
  }
  return wrap;
}

function renderTaskForest(tasks, types, state, accentColor) {
  const filtered = tasks;
  const { roots, children } = buildForest(filtered, types);
  const container = document.createElement('div');
  container.className = 'pv-tree';

  if (roots.length === 0) {
    container.innerHTML = '<div class="pv-empty-inline">No matching tickets</div>';
    return container;
  }

  const epics = roots.filter(t => (t.type || 'task') === 'epic');
  const loose = roots.filter(t => (t.type || 'task') !== 'epic');

  for (const epic of epics) {
    container.appendChild(renderTaskRow(epic, children, types, state, 0, accentColor));
  }
  if (loose.length) {
    if (epics.length) {
      const looseHead = document.createElement('div');
      looseHead.className = 'pv-loose-head';
      looseHead.dataset.pvUnlinkEpic = '1';
      looseHead.textContent = 'Other tickets — drop here to remove from epic';
      container.appendChild(looseHead);
    }
    for (const t of loose) {
      container.appendChild(renderTaskRow(t, children, types, state, 0, accentColor));
    }
  }
  return container;
}

function renderSubProjectSection(section, types, state, filters) {
  const { project: sub, tasks: rawTasks } = section;
  const tasks = filterTasks(rawTasks, filters);
  const color = projectColor(sub);
  const collapseKey = `sub:${sub.id}`;
  const collapsed = isCollapsed(collapseKey);
  const metaProjects = ensureMeta(state).projects;
  const prefix = projectPrefix(sub, metaProjects);
  const epicCount = countEpics(tasks, types);

  const sectionEl = document.createElement('section');
  sectionEl.className = 'pv-subproj';
  sectionEl.dataset.pvProjectId = sub.id;
  sectionEl.style.setProperty('--pv-sub-color', color);

  const head = document.createElement('header');
  head.className = 'pv-subproj-head';
  head.appendChild(collapseBtn(collapseKey, sub.name));

  const swatch = document.createElement('span');
  swatch.className = 'pv-subproj-swatch';
  swatch.style.background = color;
  head.appendChild(swatch);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'pv-subproj-title-wrap';
  titleWrap.innerHTML = `
    <h3 class="pv-subproj-title">${escapeHtml(sub.name)}</h3>
    <span class="pv-subproj-meta">${escapeHtml(prefix)} · ${tasks.length} tickets${epicCount ? ` · ${epicCount} epics` : ''}</span>`;
  head.appendChild(titleWrap);

  const actions = document.createElement('div');
  actions.className = 'pv-subproj-actions';
  const focusBtn = document.createElement('button');
  focusBtn.type = 'button';
  focusBtn.className = 'pv-subproj-focus';
  focusBtn.textContent = 'Focus';
  focusBtn.title = 'View this sub-project only';
  focusBtn.addEventListener('click', () => selectProject(sub.id));
  actions.appendChild(focusBtn);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'pv-subproj-add';
  addBtn.textContent = '+ Ticket';
  addBtn.addEventListener('click', () => openCreateTaskModal('todo', { projectId: sub.id }));
  actions.appendChild(addBtn);
  head.appendChild(actions);

  sectionEl.appendChild(head);

  if (!collapsed) {
    const body = document.createElement('div');
    body.className = 'pv-subproj-body';
    if (tasks.length === 0) {
      body.innerHTML = '<div class="pv-empty-inline">No tickets in this sub-project</div>';
    } else {
      body.appendChild(renderTaskForest(tasks, types, state, color));
    }
    sectionEl.appendChild(body);
  }

  return sectionEl;
}

function renderToolbar(filters, project, hasSubProjects) {
  const bar = document.createElement('div');
  bar.className = 'pv-toolbar';

  const left = document.createElement('div');
  left.className = 'pv-toolbar-left';

  const expandAll = document.createElement('button');
  expandAll.type = 'button';
  expandAll.className = 'pv-toolbar-btn';
  expandAll.textContent = 'Expand all';
  expandAll.addEventListener('click', () => {
    writeCollapse({});
    renderProjectsView();
  });
  left.appendChild(expandAll);

  const collapseAll = document.createElement('button');
  collapseAll.type = 'button';
  collapseAll.className = 'pv-toolbar-btn';
  collapseAll.textContent = 'Collapse all';
  collapseAll.addEventListener('click', () => {
    const map = {};
    for (const id of getProjectChildIds(ensureMeta(getState()).projects, project.id)) {
      map[`sub:${id}`] = true;
    }
    flatTasks(getState().tasks)
      .filter(t => t.project && projectScopeIds(ensureMeta(getState()).projects, project.id).includes(t.project))
      .filter(t => (t.type || 'task') === 'epic')
      .forEach(t => { map[`epic:${t.taskId}`] = true; });
    writeCollapse(map);
    renderProjectsView();
  });
  left.appendChild(collapseAll);

  bar.appendChild(left);

  const filtersEl = document.createElement('div');
  filtersEl.className = 'pv-toolbar-filters';
  filtersEl.innerHTML = '<span class="pv-toolbar-label">Show</span>';

  const toggles = [
    { key: 'showDone', label: 'Done' },
    { key: 'showBacklog', label: 'Backlog' },
    { key: 'showInbox', label: 'Inbox' },
  ];
  for (const { key, label } of toggles) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pv-filter-chip' + (filters[key] ? ' active' : '');
    chip.textContent = label;
    chip.addEventListener('click', () => {
      const next = { ...readFilters(), [key]: !filters[key] };
      writeFilters(next);
      renderProjectsView();
    });
    filtersEl.appendChild(chip);
  }
  bar.appendChild(filtersEl);

  if (hasSubProjects) {
    const hint = document.createElement('span');
    hint.className = 'pv-toolbar-hint';
    hint.textContent = 'Grouped by sub-project';
    bar.appendChild(hint);
  }

  return bar;
}

function renderSidebarNode(p, selectedId, state, depth) {
  const metaProjects = ensureMeta(state).projects;
  const wrap = document.createElement('div');
  wrap.className = 'pv-sidebar-node';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pv-project-btn' + (p.id === selectedId ? ' active' : '');
  btn.dataset.projectId = p.id;
  btn.style.setProperty('--pv-proj-depth', String(depth));
  btn.style.setProperty('--pv-proj-color', projectColor(p));
  const swatch = `<span class="pv-swatch" style="background:${escapeHtml(projectColor(p))}"></span>`;
  const prefix = projectPrefix(p, metaProjects);
  const childCount = (p.children || []).length;
  btn.innerHTML = `${swatch}<span class="pv-project-name">${escapeHtml(p.name)}</span>${childCount ? `<span class="pv-project-children">${childCount}</span>` : ''}<span class="pv-project-prefix">${escapeHtml(prefix)}</span>`;
  btn.addEventListener('click', () => selectProject(p.id));
  wrap.appendChild(btn);

  if (p.children?.length) {
    const childWrap = document.createElement('div');
    childWrap.className = 'pv-sidebar-children';
    for (const c of p.children) childWrap.appendChild(renderSidebarNode(c, selectedId, state, depth + 1));
    wrap.appendChild(childWrap);
  }
  return wrap;
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
  for (const n of roots) nav.appendChild(renderSidebarNode(n, selectedId, state, 0));
}

function renderLinkPanel(state, project) {
  const panel = document.createElement('details');
  panel.className = 'pv-link-panel';
  panel.innerHTML = `
    <summary class="pv-link-title">Link existing ticket</summary>
    <div class="pv-link-row">
      <div class="pv-link-picker"></div>
      <button type="button" class="pv-link-btn">Link</button>
    </div>
  `;

  const candidates = tasksNotInScope(state, project.id)
    .sort((a, b) => (a.taskId || '').localeCompare(b.taskId || '', undefined, { numeric: true }));

  let selectedTaskId = null;
  const picker = mountTicketPicker(panel.querySelector('.pv-link-picker'), {
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
      if (!confirm(msg + '\n\nOK = backup & link · Cancel = abort')) return;
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
    showStatus(result?.migrated
      ? `Linked ${result.oldId} → ${result.newId} in ${project.name}`
      : `Linked ${taskId} to ${project.name}`);
  });

  if (candidates.length === 0) {
    picker.destroy();
    panel.querySelector('.pv-link-row').innerHTML = '<p class="pv-empty">All tickets are already linked or none exist.</p>';
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
        <p>Select a project to browse sub-projects, epics, and tasks — with filters and linked documentation.</p>
      </div>`;
    return;
  }

  const projects = projectList(state);
  const filters = readFilters();
  const types = normalizeTicketTypes(state.ticketTypes);
  const grouped = groupTasksForView(state, project, projects);
  const scopeTasks = grouped.mode === 'grouped'
    ? [...grouped.direct, ...grouped.sections.flatMap(s => s.tasks)]
    : grouped.direct;
  const visibleTasks = filterTasks(scopeTasks, filters);

  const totalEst = scopeTasks.reduce((s, t) => s + (t.estimateMinutes || 0), 0);
  const totalLogged = scopeTasks.reduce((s, t) => s + (t.loggedMinutes || 0), 0);
  const active = scopeTasks.filter(t => t.section === 'todo' || t.section === 'in-progress').length;
  const done = scopeTasks.filter(t => t.checked || t.section === 'done').length;
  const prefix = projectPrefix(project, ensureMeta(state).projects);
  const parent = project.parentId ? projects.find(p => p.id === project.parentId) : null;
  const parentLine = parent ? ` · under <code>${escapeHtml(parent.name)}</code>` : '';
  const childCount = getProjectChildIds(projects, project.id).length;
  const color = projectColor(project);

  main.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'pv-hero';
  header.innerHTML = `
    <div class="pv-hero-top">
      <span class="pv-hero-swatch" style="background:${escapeHtml(color)}"></span>
      <div class="pv-hero-text">
        <h2 class="pv-hero-title">${escapeHtml(project.name)}</h2>
        <p class="pv-hero-sub">${escapeHtml(project.id)} · prefix <code>${escapeHtml(prefix)}</code>${parentLine}${childCount ? ` · ${childCount} sub-projects` : ''} · ${scopeTasks.length} tickets</p>
      </div>
      <div class="pv-hero-actions">
        <button type="button" class="pv-action-btn" data-action="edit">Edit</button>
        <button type="button" class="pv-action-btn" data-action="sub">+ Sub-project</button>
        <button type="button" class="pv-action-btn" data-action="new-task">+ Ticket</button>
        <button type="button" class="pv-action-btn pv-action-docs" data-action="docs" id="projectsDocsHeroBtn" aria-expanded="false">Docs</button>
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
    showProjectForm('edit', projectForDocs(state, project), (data) => {
      updateProjectMeta(state, project.id, data);
      showStatus('Project updated');
      finishProjectSave();
    }, state);
  });

  header.querySelector('[data-action="sub"]').addEventListener('click', () => {
    showProjectForm('new', null, (data) => {
      createProject(state, data);
      selectProject(data.id);
      getRenderTasks?.()();
      showStatus(`Created sub-project ${data.name}`);
    }, state, { parentId: project.id, color: SUBPROJECT_PALETTE[getProjectChildIds(projects, project.id).length % SUBPROJECT_PALETTE.length] });
  });

  header.querySelector('[data-action="new-task"]').addEventListener('click', () => {
    openCreateTaskModal('todo', { projectId: project.id });
  });

  const docsBtn = header.querySelector('[data-action="docs"]');
  syncDocsHeroButton(docsBtn);
  docsBtn?.addEventListener('click', () => {
    toggleDocsPanel();
    syncDocsHeroButton(docsBtn);
  });

  header.querySelector('[data-action="delete"]').addEventListener('click', () => {
    const n = scopeTasks.length;
    const msg = n
      ? `Delete project "${project.name}"? ${n} ticket(s) will be unlinked (not deleted). Sub-projects become top-level.`
      : `Delete project "${project.name}"?`;
    if (!confirm(msg)) return;
    deleteProjectMeta(state, project.id);
    writeSelected('');
    getRenderTasks?.()();
    showStatus(`Deleted project ${project.name}`);
  });

  main.appendChild(header);
  main.appendChild(renderToolbar(filters, project, grouped.mode === 'grouped'));
  main.appendChild(renderLinkPanel(state, project));

  const content = document.createElement('div');
  content.className = 'pv-content';

  if (grouped.mode === 'grouped') {
    const directTasks = filterTasks(grouped.direct, filters);
    if (directTasks.length) {
      const directSection = document.createElement('section');
      directSection.className = 'pv-subproj pv-subproj-direct';
      directSection.dataset.pvProjectId = project.id;
      directSection.style.setProperty('--pv-sub-color', color);
      directSection.innerHTML = `<header class="pv-subproj-head pv-subproj-head-static"><span class="pv-subproj-swatch" style="background:${escapeHtml(color)}"></span><h3 class="pv-subproj-title">${escapeHtml(project.name)}</h3><span class="pv-subproj-meta">${directTasks.length} ticket(s) · epics first</span></header>`;
      const body = document.createElement('div');
      body.className = 'pv-subproj-body';
      body.appendChild(renderTaskForest(directTasks, types, state, color));
      directSection.appendChild(body);
      content.appendChild(directSection);
    }
    for (const section of grouped.sections) {
      content.appendChild(renderSubProjectSection(section, types, state, filters));
    }
    if (grouped.sections.every(s => filterTasks(s.tasks, filters).length === 0) && directTasks.length === 0) {
      content.innerHTML = '<div class="pv-empty">No tickets match your filters. Adjust filters above or create tickets in sub-projects.</div>';
    }
  } else {
    const tasks = filterTasks(grouped.direct, filters);
    if (tasks.length === 0) {
      content.innerHTML = '<div class="pv-empty">No tasks in this project yet. Link an existing ticket or click <strong>+ Ticket</strong>.</div>';
    } else {
      content.appendChild(renderTaskForest(tasks, types, state, color));
    }
  }

  main.appendChild(content);
  bindProjectsDragDrop(content, state, () => {
    getRenderTasks?.()();
  });
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
  syncProjectDocsPanelVisibility(!!project);
  renderProjectDocsPanel(projectForDocs(state, project)).catch(() => {});
}

export function openProject(projectId) {
  selectProject(projectId);
  switchMainTab('projects');
}

export function initProjectsView() {
  setProjectDocsCallbacks({
    configureProject: (project) => {
      if (!getState || !project) return;
      const state = getState();
      showProjectForm('edit', projectForDocs(state, project), (data) => {
        updateProjectMeta(state, project.id, data);
        showStatus('Project paths saved');
        finishProjectSave();
      }, state);
    },
  });
  setDocsPanelCallbacks({
    onLayoutChange: () => {
      syncDocsHeroButton(document.getElementById('projectsDocsHeroBtn'));
    },
  });
  initProjectDocsPanel();
  renderProjectsView();
}

export function refreshProjectsView() {
  const panel = document.getElementById('projectsPanel');
  if (panel?.classList.contains('active')) renderProjectsView();
}
