// task-filters.js — Collapsible per-field filters for the Tasks tab (AND with text search).
// UI is built once and updated in place — opening a field or toggling a value
// must NOT wipe and rebuild the whole bar (that caused blink + flaky dynamic fields).

import {
  collectLabels,
  collectAssignees,
  collectProjects,
  dueUrgency,
  isEffectivelyBlocked,
  isStale,
  isSnoozed,
  isCorporateUiHidden,
  taskMatchesFacets,
} from './task-fields.js';
import { renderSavedViewsBar } from './saved-views.js';
import { normalizeTicketTypes } from './ticket-types.js';

let getState = null;
let getRenderTasks = null;
/** Lightweight board/list refresh — preferred over full renderTasks for facet toggles. */
let getApplyViews = null;

const COLLAPSE_KEY = 'dashboard.filtersExpanded';

/** Which multi-select dropdown is open. */
let openFieldId = null;
/** Portaled menu element for openFieldId. */
let openMenuEl = null;

/** Expanded body visible. Default collapsed to save space. */
let filtersExpanded = (() => {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; }
  catch { return false; }
})();

/**
 * Session catalogs — only grow until a full page reload.
 * Prevents Labels/Energy/etc. from vanishing if a transient reload
 * briefly returns empty values (HTTP race) or after first add.
 */
const knownLabels = new Set();
const knownEnergies = new Set();
const knownProjects = new Set();
const knownAssignees = new Set();

/** Active facet state. Sets are OR within a facet; facets AND together. */
export const facetState = {
  priorities: new Set(),
  types: new Set(),
  due: new Set(),
  labels: new Set(),
  assignees: new Set(),
  projects: new Set(),
  energy: new Set(),
  sections: new Set(),
  hasParent: null, // null | true
  blocked: null,   // null | true
  stale: null,     // null | true
  snoozed: null,   // null | true
  staleDays: 14,
  dueExact: null,  // null | YYYY-MM-DD
};

/** Built DOM refs (survive across syncs). */
let shell = null; // { bar, header, toggle, badge, summary, dayChip, clearBtn, body, grid, flags }

export function setFilterCallbacks({ stateFn, renderFn, applyFn } = {}) {
  getState = stateFn || null;
  getRenderTasks = renderFn || null;
  getApplyViews = applyFn || null;
}

export function hasActiveFacets() {
  return facetState.priorities.size > 0
    || facetState.types.size > 0
    || facetState.due.size > 0
    || facetState.labels.size > 0
    || facetState.assignees.size > 0
    || facetState.projects.size > 0
    || facetState.energy.size > 0
    || facetState.sections.size > 0
    || facetState.hasParent != null
    || facetState.blocked != null
    || facetState.stale != null
    || facetState.snoozed != null
    || facetState.dueExact != null;
}

export function clearFacets() {
  facetState.priorities.clear();
  facetState.types.clear();
  facetState.due.clear();
  facetState.labels.clear();
  facetState.assignees.clear();
  facetState.projects.clear();
  facetState.energy.clear();
  facetState.sections.clear();
  facetState.hasParent = null;
  facetState.blocked = null;
  facetState.stale = null;
  facetState.snoozed = null;
  facetState.dueExact = null;
}

export function applyDueDayFilter(ymd) {
  clearFacets();
  facetState.dueExact = ymd;
  filtersExpanded = true;
  persistExpanded();
  renderFilterBar();
  applyViews();
}

export function applyDeepLinkFilter(key) {
  clearFacets();
  if (key === 'blocked') {
    facetState.blocked = true;
  } else if (key === 'in-progress' || key === 'todo' || key === 'done') {
    facetState.sections.add(key);
  }
  filtersExpanded = true;
  persistExpanded();
  renderFilterBar();
  applyViews();
}

export function taskPassesFacets(task) {
  if (!hasActiveFacets()) return true;
  const state = getState() || {};
  return taskMatchesFacets(task, facetState, state.tasks);
}

function persistExpanded() {
  try { localStorage.setItem(COLLAPSE_KEY, filtersExpanded ? '1' : '0'); }
  catch { /* ignore */ }
}

function toggleInSet(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function applyViews() {
  if (getApplyViews) getApplyViews()();
  else if (getRenderTasks) getRenderTasks()();
}

function countMatching(predicate) {
  const state = getState() || {};
  let n = 0;
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (predicate(t)) n++;
    }
  }
  return n;
}

function collectEnergies(tasksBySection) {
  const set = new Set();
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.energy) set.add(t.energy);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function absorbKnown(state) {
  for (const l of collectLabels(state.tasks)) knownLabels.add(l);
  for (const e of collectEnergies(state.tasks)) knownEnergies.add(e);
  for (const p of collectProjects(state.tasks, state.meta?.projects)) knownProjects.add(p);
  for (const a of collectAssignees(state.tasks)) knownAssignees.add(a);
}

function activeFacetCount() {
  let n = facetState.priorities.size
    + facetState.types.size
    + facetState.due.size
    + facetState.labels.size
    + facetState.assignees.size
    + facetState.projects.size
    + facetState.energy.size
    + facetState.sections.size;
  if (facetState.hasParent != null) n++;
  if (facetState.blocked != null) n++;
  if (facetState.stale != null) n++;
  if (facetState.snoozed != null) n++;
  if (facetState.dueExact != null) n++;
  return n;
}

function activeSummaryLabels(state) {
  const out = [];
  for (const p of facetState.priorities) out.push(p[0].toUpperCase() + p.slice(1));
  const typeById = new Map((normalizeTicketTypes(state?.ticketTypes) || []).map(t => [t.id, t.name]));
  for (const t of facetState.types) out.push(typeById.get(t) || t);
  for (const d of facetState.due) {
    const map = { overdue: 'Overdue', today: 'Due today', soon: 'Due soon', 'has-due': 'Has due' };
    out.push(map[d] || d);
  }
  const secById = new Map((state?.sections || []).map(s => [s.id, s.name || s.id]));
  for (const s of facetState.sections) out.push(secById.get(s) || s);
  for (const e of facetState.energy) out.push(e);
  for (const l of facetState.labels) out.push(l);
  for (const p of facetState.projects) out.push(p);
  for (const a of facetState.assignees) out.push('@' + a);
  if (facetState.hasParent) out.push('Has parent');
  if (facetState.blocked) out.push('Blocked');
  if (facetState.stale) out.push('Stale');
  if (facetState.snoozed) out.push('Snoozed');
  if (facetState.dueExact) out.push('On ' + facetState.dueExact);
  return out;
}

function closeMenu() {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
  }
  openFieldId = null;
  if (shell) {
    shell.bar.querySelectorAll('.tf-ms-face.open').forEach(el => el.classList.remove('open'));
    shell.bar.querySelectorAll('.tf-ms-trigger[aria-expanded="true"]').forEach(el => {
      el.setAttribute('aria-expanded', 'false');
    });
  }
}

function positionMenu(menu, face) {
  const rect = face.getBoundingClientRect();
  const width = Math.max(rect.width, 160);
  let left = rect.left;
  let top = rect.bottom + 4;
  const maxRight = window.innerWidth - 8;
  if (left + width > maxRight) left = Math.max(8, maxRight - width);
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  if (spaceBelow < 120 && rect.top > spaceBelow) {
    menu.style.maxHeight = Math.min(240, rect.top - 12) + 'px';
    top = rect.top - 4 - Math.min(menu.scrollHeight || 200, rect.top - 12);
  } else {
    menu.style.maxHeight = Math.min(240, Math.max(80, spaceBelow)) + 'px';
  }
  menu.style.position = 'fixed';
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${width}px`;
  menu.dataset.tfMenu = '1';
}

/** After a facet value changes: sync faces + open menu + refresh board (no full bar rebuild). */
function onFacetChanged() {
  const state = getState() || {};
  absorbKnown(state);
  syncHeader(state);
  syncAllFieldFaces(state);
  if (openFieldId) openOrRefreshMenu(openFieldId, state);
  applyViews();
  renderSavedViewsBar();
}

function fieldDefs(state) {
  const types = normalizeTicketTypes(state.ticketTypes);
  const sections = (state.sections || []).filter(s => s.id !== 'archive');
  const showCorporate = !isCorporateUiHidden();

  const labels = [...knownLabels].sort((a, b) => a.localeCompare(b));
  const energies = [...knownEnergies].sort((a, b) => a.localeCompare(b));
  const projects = [...knownProjects].sort((a, b) => a.localeCompare(b));
  const assignees = [...knownAssignees].sort((a, b) => a.localeCompare(b));

  const defs = [
    {
      id: 'priority',
      label: 'Priority',
      selected: facetState.priorities,
      options: ['high', 'medium', 'low'].map(p => ({
        id: p,
        label: p[0].toUpperCase() + p.slice(1),
        count: countMatching(t => (t.priority || 'medium') === p),
      })),
    },
    {
      id: 'type',
      label: 'Type',
      selected: facetState.types,
      options: types.map(tt => ({
        id: tt.id,
        label: tt.name,
        count: countMatching(t => (t.type || 'task') === tt.id),
      })),
    },
    {
      id: 'status',
      label: 'Status',
      selected: facetState.sections,
      options: sections.map(sec => ({
        id: sec.id,
        label: sec.name || sec.id,
        count: countMatching(t => t.section === sec.id),
      })),
    },
    {
      id: 'due',
      label: 'Due',
      selected: facetState.due,
      options: [
        { id: 'overdue', label: 'Overdue', count: countMatching(t => dueUrgency(t.dueDate) === 'overdue') },
        { id: 'today', label: 'Due today', count: countMatching(t => dueUrgency(t.dueDate) === 'today') },
        { id: 'soon', label: 'Due soon', count: countMatching(t => {
          const u = dueUrgency(t.dueDate);
          return u === 'soon' || u === 'today';
        }) },
        { id: 'has-due', label: 'Has due', count: countMatching(t => !!t.dueDate) },
      ],
    },
    {
      id: 'labels',
      label: 'Labels',
      selected: facetState.labels,
      always: true,
      options: labels.map(lab => ({
        id: lab,
        label: lab,
        count: countMatching(t => (t.labels || []).includes(lab)),
      })),
      emptyHint: 'No labels yet',
    },
    {
      id: 'energy',
      label: 'Energy',
      selected: facetState.energy,
      always: true,
      options: energies.map(e => ({
        id: e,
        label: e[0].toUpperCase() + e.slice(1),
        count: countMatching(t => t.energy === e),
      })),
      emptyHint: 'No energy tags yet',
    },
    {
      id: 'project',
      label: 'Project',
      selected: facetState.projects,
      always: true,
      options: projects.map(pid => ({
        id: pid,
        label: pid,
        count: countMatching(t => t.project === pid),
      })),
      emptyHint: 'No projects yet',
    },
  ];

  if (showCorporate) {
    defs.push({
      id: 'assignee',
      label: 'Assignee',
      selected: facetState.assignees,
      always: true,
      options: assignees.map(who => ({
        id: who,
        label: '@' + who,
        count: countMatching(t => t.assignee === who),
      })),
      emptyHint: 'No assignees yet',
    });
  }

  return defs;
}

function paintFace(face, trigger, def) {
  const { options, selected, emptyHint } = def;
  const selectedOpts = options.filter(o => selected.has(o.id));

  face.classList.toggle('active', selected.size > 0);
  face.classList.toggle('open', openFieldId === def.id);
  trigger.setAttribute('aria-expanded', openFieldId === def.id ? 'true' : 'false');
  trigger.classList.toggle('tf-ms-trigger-icon', selectedOpts.length > 0 && selectedOpts.length <= 2);

  // Remove previous chips / placeholder / count (keep chevron + trigger structure)
  face.querySelectorAll('.tf-ms-chips').forEach(el => el.remove());
  trigger.querySelectorAll('.tf-ms-placeholder, .tf-ms-count').forEach(el => el.remove());

  if (selectedOpts.length > 0 && selectedOpts.length <= 2) {
    const chips = document.createElement('div');
    chips.className = 'tf-ms-chips';
    for (const o of selectedOpts) {
      const chip = document.createElement('span');
      chip.className = 'tf-ms-chip';
      const text = document.createElement('span');
      text.className = 'tf-ms-chip-text';
      text.textContent = o.label;
      chip.appendChild(text);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tf-ms-chip-x';
      x.setAttribute('aria-label', `Remove ${o.label}`);
      x.textContent = '\u00d7';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleInSet(selected, o.id);
        onFacetChanged();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    }
    face.insertBefore(chips, trigger);
  } else if (selectedOpts.length > 2) {
    const cnt = document.createElement('span');
    cnt.className = 'tf-ms-count';
    cnt.textContent = `${selectedOpts.length} selected`;
    trigger.insertBefore(cnt, trigger.querySelector('.tf-ms-chevron'));
  } else {
    const ph = document.createElement('span');
    ph.className = 'tf-ms-placeholder';
    ph.textContent = options.length ? 'Any' : (emptyHint || 'Any');
    trigger.insertBefore(ph, trigger.querySelector('.tf-ms-chevron'));
  }
}

function createMultiSelectField(def) {
  const field = document.createElement('div');
  field.className = 'tf-field';
  field.dataset.field = def.id;

  const labelEl = document.createElement('span');
  labelEl.className = 'tf-field-label';
  labelEl.textContent = def.label;
  field.appendChild(labelEl);

  const wrap = document.createElement('div');
  wrap.className = 'tf-ms';

  const face = document.createElement('div');
  face.className = 'tf-ms-face';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'tf-ms-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', def.label);

  const chevron = document.createElement('span');
  chevron.className = 'tf-ms-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.appendChild(chevron);

  const toggleOpen = () => {
    if (openFieldId === def.id) {
      closeMenu();
      paintFace(face, trigger, def);
      return;
    }
    closeMenu();
    openFieldId = def.id;
    paintFace(face, trigger, def);
    openOrRefreshMenu(def.id, getState() || {});
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOpen();
  });
  face.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    toggleOpen();
  });

  face.appendChild(trigger);
  wrap.appendChild(face);
  field.appendChild(wrap);

  field._tf = { def, face, trigger, wrap };
  paintFace(face, trigger, def);
  return field;
}

function openOrRefreshMenu(fieldId, state) {
  const def = fieldDefs(state).find(d => d.id === fieldId);
  const fieldEl = shell?.grid?.querySelector(`[data-field="${fieldId}"]`);
  if (!def || !fieldEl?._tf) {
    closeMenu();
    return;
  }

  const { face, trigger } = fieldEl._tf;
  if (openMenuEl) openMenuEl.remove();

  const menu = document.createElement('div');
  menu.className = 'tf-ms-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-multiselectable', 'true');
  menu.dataset.tfMenu = '1';

  if (!def.options.length) {
    const empty = document.createElement('div');
    empty.className = 'tf-ms-empty';
    empty.textContent = def.emptyHint || 'No values yet';
    menu.appendChild(empty);
  } else {
    for (const opt of def.options) {
      const active = def.selected.has(opt.id);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tf-ms-option' + (active ? ' selected' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', active ? 'true' : 'false');

      const check = document.createElement('span');
      check.className = 'tf-ms-check';
      check.setAttribute('aria-hidden', 'true');
      const optLabel = document.createElement('span');
      optLabel.className = 'tf-ms-option-label';
      optLabel.textContent = opt.label;
      row.appendChild(check);
      row.appendChild(optLabel);
      if (opt.count != null) {
        const c = document.createElement('span');
        c.className = 'tf-ms-option-count';
        c.textContent = String(opt.count);
        row.appendChild(c);
      }
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleInSet(def.selected, opt.id);
        onFacetChanged();
      });
      menu.appendChild(row);
    }

    if (def.selected.size > 0) {
      const clearRow = document.createElement('button');
      clearRow.type = 'button';
      clearRow.className = 'tf-ms-clear';
      clearRow.textContent = 'Clear';
      clearRow.addEventListener('click', (e) => {
        e.stopPropagation();
        def.selected.clear();
        onFacetChanged();
      });
      menu.appendChild(clearRow);
    }
  }

  document.body.appendChild(menu);
  openMenuEl = menu;
  openFieldId = fieldId;
  face.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => positionMenu(menu, face));
}

function syncAllFieldFaces(state) {
  if (!shell?.grid) return;
  const defs = fieldDefs(state);
  const byId = new Map(defs.map(d => [d.id, d]));

  // Ensure field elements exist for each def (Labels etc. always present)
  for (const def of defs) {
    let fieldEl = shell.grid.querySelector(`[data-field="${def.id}"]`);
    if (!fieldEl) {
      fieldEl = createMultiSelectField(def);
      // Insert before flags — flags is sibling of grid, so just append to grid
      shell.grid.appendChild(fieldEl);
    } else {
      fieldEl._tf.def = def;
      paintFace(fieldEl._tf.face, fieldEl._tf.trigger, def);
    }
  }

  // Remove assignee field when corporate UI is hidden
  for (const el of [...shell.grid.querySelectorAll('.tf-field')]) {
    if (!byId.has(el.dataset.field)) el.remove();
  }
}

function syncFlags(state) {
  if (!shell?.flagsGroup) return;
  const specs = [
    {
      key: 'hasParent',
      label: 'Has parent',
      active: facetState.hasParent === true,
      count: countMatching(t => !!t.parentId),
      toggle: () => { facetState.hasParent = facetState.hasParent === true ? null : true; },
    },
    {
      key: 'blocked',
      label: 'Blocked',
      active: facetState.blocked === true,
      count: countMatching(t => isEffectivelyBlocked(t, state.tasks)),
      toggle: () => { facetState.blocked = facetState.blocked === true ? null : true; },
    },
    {
      key: 'stale',
      label: 'Stale',
      active: facetState.stale === true,
      count: countMatching(t => isStale(t, facetState.staleDays)),
      toggle: () => { facetState.stale = facetState.stale === true ? null : true; },
    },
    {
      key: 'snoozed',
      label: 'Snoozed',
      active: facetState.snoozed === true,
      count: countMatching(t => isSnoozed(t)),
      toggle: () => { facetState.snoozed = facetState.snoozed === true ? null : true; },
    },
  ];

  const existing = new Map([...shell.flagsGroup.querySelectorAll('.tf-flag')].map(b => [b.dataset.flag, b]));
  for (const spec of specs) {
    let btn = existing.get(spec.key);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tf-flag';
      btn.dataset.flag = spec.key;
      shell.flagsGroup.appendChild(btn);
    }
    btn.classList.toggle('active', spec.active);
    btn.setAttribute('aria-pressed', spec.active ? 'true' : 'false');
    btn.textContent = '';
    const lab = document.createElement('span');
    lab.className = 'tf-flag-label';
    lab.textContent = spec.label;
    const cnt = document.createElement('span');
    cnt.className = 'tf-flag-count';
    cnt.textContent = String(spec.count);
    btn.appendChild(lab);
    btn.appendChild(cnt);
    btn.onclick = () => { spec.toggle(); onFacetChanged(); };
  }
}

function syncHeader(state) {
  if (!shell) return;
  const active = hasActiveFacets();
  const count = activeFacetCount();

  shell.bar.classList.toggle('is-expanded', filtersExpanded);
  shell.bar.classList.toggle('is-collapsed', !filtersExpanded);
  shell.bar.classList.toggle('has-active', active);
  shell.toggle.setAttribute('aria-expanded', filtersExpanded ? 'true' : 'false');

  if (count) {
    if (!shell.badge.parentNode) {
      shell.toggle.appendChild(shell.badge);
    }
    shell.badge.textContent = String(count);
  } else if (shell.badge.parentNode) {
    shell.badge.remove();
  }

  // Summary chips (collapsed + active)
  shell.summary.textContent = '';
  if (!filtersExpanded && active) {
    const labels = activeSummaryLabels(state);
    for (const text of labels.slice(0, 4)) {
      const chip = document.createElement('span');
      chip.className = 'tf-summary-chip';
      chip.textContent = text;
      shell.summary.appendChild(chip);
    }
    if (labels.length > 4) {
      const more = document.createElement('span');
      more.className = 'tf-summary-more';
      more.textContent = `+${labels.length - 4}`;
      shell.summary.appendChild(more);
    }
    shell.summary.hidden = false;
    shell.spacer.hidden = true;
  } else {
    shell.summary.hidden = true;
    shell.spacer.hidden = false;
  }

  if (facetState.dueExact) {
    shell.dayChip.hidden = false;
    shell.dayChip.textContent = `On ${facetState.dueExact} \u00d7`;
  } else {
    shell.dayChip.hidden = true;
  }

  shell.clearBtn.hidden = !active;
  shell.body.hidden = !filtersExpanded;
}

function ensureShell(bar) {
  if (shell && shell.bar === bar && bar.contains(shell.header)) return shell;

  closeMenu();
  bar.innerHTML = '';
  bar.className = 'tasks-filters' + (filtersExpanded ? ' is-expanded' : ' is-collapsed');
  bar.setAttribute('aria-label', 'Task filters');

  const header = document.createElement('div');
  header.className = 'tf-header';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tf-toggle';
  toggle.setAttribute('aria-expanded', filtersExpanded ? 'true' : 'false');
  const chevron = document.createElement('span');
  chevron.className = 'tf-toggle-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span');
  title.className = 'tf-toggle-title';
  title.textContent = 'Filters';
  const badge = document.createElement('span');
  badge.className = 'tf-active-badge';
  toggle.appendChild(chevron);
  toggle.appendChild(title);
  toggle.addEventListener('click', () => {
    filtersExpanded = !filtersExpanded;
    if (!filtersExpanded) closeMenu();
    persistExpanded();
    syncHeader(getState() || {});
  });

  const summary = document.createElement('div');
  summary.className = 'tf-summary';
  summary.hidden = true;

  const dayChip = document.createElement('button');
  dayChip.type = 'button';
  dayChip.className = 'tf-day-chip';
  dayChip.hidden = true;
  dayChip.title = 'Clear calendar day filter';
  dayChip.addEventListener('click', () => {
    facetState.dueExact = null;
    onFacetChanged();
  });

  const spacer = document.createElement('div');
  spacer.className = 'tf-header-spacer';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'tf-clear-all';
  clearBtn.textContent = 'Clear all';
  clearBtn.hidden = true;
  clearBtn.addEventListener('click', () => {
    clearFacets();
    closeMenu();
    onFacetChanged();
  });

  header.appendChild(toggle);
  header.appendChild(summary);
  header.appendChild(dayChip);
  header.appendChild(spacer);
  header.appendChild(clearBtn);

  const body = document.createElement('div');
  body.className = 'tf-body';
  body.hidden = !filtersExpanded;

  const grid = document.createElement('div');
  grid.className = 'tf-grid';

  const flags = document.createElement('div');
  flags.className = 'tf-flags';
  const flagsLabel = document.createElement('span');
  flagsLabel.className = 'tf-field-label';
  flagsLabel.textContent = 'Flags';
  const flagsGroup = document.createElement('div');
  flagsGroup.className = 'tf-flags-group';
  flags.appendChild(flagsLabel);
  flags.appendChild(flagsGroup);

  body.appendChild(grid);
  body.appendChild(flags);

  bar.appendChild(header);
  bar.appendChild(body);

  shell = {
    bar, header, toggle, badge, summary, dayChip, spacer, clearBtn,
    body, grid, flags, flagsGroup,
  };
  return shell;
}

/**
 * Sync filter UI with current task state.
 * Safe to call often — does not rebuild the shell unless missing.
 */
export function renderFilterBar() {
  const bar = document.getElementById('tasksFilters');
  if (!bar || !getState) return;

  const state = getState();
  facetState.staleDays = (window.dashboardConfig && window.dashboardConfig.staleDays) || 14;
  absorbKnown(state);

  bar.style.display = 'flex';
  ensureShell(bar);
  syncHeader(state);
  syncAllFieldFaces(state);
  syncFlags(state);

  // Keep open menu aligned with fresh options/counts
  if (openFieldId && filtersExpanded) {
    openOrRefreshMenu(openFieldId, state);
  } else if (!filtersExpanded) {
    closeMenu();
  }

  renderSavedViewsBar();
}

function onDocPointerDown(e) {
  if (!openFieldId) return;
  const t = e.target;
  if (t.closest?.('.tf-ms') && shell?.bar?.contains(t.closest('.tf-ms'))) return;
  if (t.closest?.('.tf-ms-menu[data-tf-menu]')) return;
  closeMenu();
  const state = getState() || {};
  syncAllFieldFaces(state);
}

function onDocKeydown(e) {
  if (e.key === 'Escape' && openFieldId) {
    closeMenu();
    syncAllFieldFaces(getState() || {});
  }
}

export function initTaskFilters() {
  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('keydown', onDocKeydown);
  renderFilterBar();
}
