// task-create.js — Modal to create a new task with all parameters.

import { markChanged } from './tasks-io.js';
import { todayStr } from './tasks-parser.js';
import { showStatus } from './state.js';
import {
  normalizeTicketTypes,
  DEFAULT_TICKET_TYPE_ID,
  getTicketType,
  parentCandidates,
  resolveTaskColor,
  inheritedTaskColor,
  inheritColorLabel,
  makeColorControls,
  isHexColor,
  escapeHtml,
} from './ticket-types.js';
import { parseEstimate, appendHistory, computeNextTaskId, normalizeJiraKey, markCorporateUi, isCorporateUiHidden } from './task-fields.js';
import { memoryState } from './memory-renderer.js';
import {
  mountFieldLayoutSections,
} from './task-field-layout.js';

const PRIORITIES = ['low', 'medium', 'high'];

let getState = null;
let getRenderTasks = null;

/** Draft form state while the modal is open. */
let draft = null;

export function setTaskCreateCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

export function isTaskCreateOpen() {
  const overlay = document.getElementById('taskCreateOverlay');
  return overlay && overlay.classList.contains('visible');
}

/**
 * Open the create-task modal.
 * @param {string} [sectionId] Prefill status from the column that was clicked.
 */
export function openCreateTaskModal(sectionId) {
  const overlay = document.getElementById('taskCreateOverlay');
  if (!overlay || !getState) return;

  const state = getState();
  const sections = state.sections || [];
  const defaultSection = sectionId
    || state.quickAddSection
    || sections.find(s => s.id === 'todo')?.id
    || sections[0]?.id
    || 'todo';

  draft = {
    title: '',
    description: '',
    priority: 'medium',
    section: defaultSection,
    type: DEFAULT_TICKET_TYPE_ID,
    parentId: null,
    color: null,
    dueDate: null,
    startDate: null,
    jiraKey: '',
    issueUrl: '',
    project: '',
    energy: null,
    snoozeUntil: null,
    blocked: false,
    waitingOn: '',
    labels: [],
    links: [],
    assignee: '',
    estimate: '',
    recurrenceFreq: '',
    recurrenceInterval: 1,
  };

  const nextId = computeNextTaskId(state);
  const idEl = document.getElementById('tcTaskId');
  if (idEl) idEl.textContent = nextId;

  const titleInput = document.getElementById('tcTitle');
  if (titleInput) {
    titleInput.value = '';
    titleInput.classList.remove('tc-title-error');
  }

  buildForm();

  overlay.hidden = false;
  void overlay.offsetWidth;
  overlay.classList.add('visible');

  requestAnimationFrame(() => {
    titleInput?.focus();
  });
}

function closeCreateTaskModal() {
  const overlay = document.getElementById('taskCreateOverlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.hidden = true;
  draft = null;
}

function onLayoutChange() {
  buildForm();
}

function buildForm() {
  const body = document.getElementById('tcBody');
  if (!body || !draft) return;
  body.innerHTML = '';

  mountFieldLayoutSections(body, {
    factories: getFieldFactories(),
    onLayoutChange,
    markShell: (fieldId, shell) => {
      if (fieldId === 'jiraKey' || fieldId === 'assignee') markCorporateUi(shell);
    },
  });
}

function getFieldFactories() {
  return {
    priority: buildPriorityField,
    status: buildStatusField,
    due: buildDueField,
    start: buildStartField,
    jiraKey: buildJiraKeyField,
    issueUrl: buildIssueUrlField,
    project: buildProjectField,
    energy: buildEnergyField,
    snoozeUntil: buildSnoozeField,
    type: buildTypeField,
    color: buildColorField,
    parent: buildParentField,
    blocked: buildBlockedField,
    waitingOn: buildWaitingOnField,
    assignee: buildAssigneeField,
    estimate: buildEstimateField,
    recurrence: buildRecurrenceField,
    labels: buildLabelsField,
    links: buildLinksField,
    description: buildDescriptionField,
  };
}

function buildPriorityField() {
  const field = document.createElement('div');
  field.className = 'td-field';
  const pl = document.createElement('span');
  pl.className = 'td-field-label';
  pl.textContent = 'Priority';
  const seg = document.createElement('div');
  seg.className = 'td-priority';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Priority');
  PRIORITIES.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'td-priority-btn' + (p === draft.priority ? ' active' : '');
    btn.setAttribute('data-priority', p);
    const dot = document.createElement('span');
    dot.className = 'td-priority-dot priority-' + p;
    dot.setAttribute('aria-hidden', 'true');
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(p[0].toUpperCase() + p.slice(1)));
    btn.addEventListener('click', () => {
      draft.priority = p;
      seg.querySelectorAll('.td-priority-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.priority === p));
    });
    seg.appendChild(btn);
  });
  field.appendChild(pl);
  field.appendChild(seg);
  return field;
}

function buildStatusField() {
  const state = getState() || {};
  const field = document.createElement('div');
  field.className = 'td-field';
  const sl = document.createElement('span');
  sl.className = 'td-field-label';
  sl.textContent = 'Status';
  const select = document.createElement('select');
  select.className = 'td-select';
  select.setAttribute('aria-label', 'Status');
  (state.sections || []).forEach(sec => {
    const opt = document.createElement('option');
    opt.value = sec.id;
    opt.textContent = sec.name;
    if (sec.id === draft.section) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    draft.section = select.value;
  });
  field.appendChild(sl);
  field.appendChild(select);
  return field;
}

function buildDueField() {
  const field = document.createElement('div');
  field.className = 'td-field';
  const dl = document.createElement('span');
  dl.className = 'td-field-label';
  dl.textContent = 'Due';
  const dueInput = document.createElement('input');
  dueInput.type = 'date';
  dueInput.className = 'td-select td-date-input';
  dueInput.value = draft.dueDate || '';
  dueInput.setAttribute('aria-label', 'Due date');
  dueInput.addEventListener('change', () => {
    draft.dueDate = dueInput.value || null;
  });
  field.appendChild(dl);
  field.appendChild(dueInput);
  return field;
}

function buildStartField() {
  const field = document.createElement('div');
  field.className = 'td-field';
  const startLbl = document.createElement('span');
  startLbl.className = 'td-field-label';
  startLbl.textContent = 'Start';
  const startInput = document.createElement('input');
  startInput.type = 'date';
  startInput.className = 'td-select td-date-input';
  startInput.value = draft.startDate || '';
  startInput.setAttribute('aria-label', 'Start date');
  startInput.addEventListener('change', () => {
    draft.startDate = startInput.value || null;
  });
  field.appendChild(startLbl);
  field.appendChild(startInput);
  return field;
}

function buildJiraKeyField() {
  const field = document.createElement('div');
  field.className = 'td-field';
  markCorporateUi(field);
  const jl = document.createElement('span');
  jl.className = 'td-field-label';
  jl.textContent = 'Jira key';
  const jiraInput = document.createElement('input');
  jiraInput.type = 'text';
  jiraInput.className = 'td-text-input';
  jiraInput.placeholder = 'PROJECT-123';
  jiraInput.value = draft.jiraKey || '';
  jiraInput.spellcheck = false;
  jiraInput.addEventListener('input', () => { draft.jiraKey = jiraInput.value; });
  field.appendChild(jl);
  field.appendChild(jiraInput);
  return field;
}

function buildIssueUrlField() {
  const field = document.createElement('div');
  field.className = 'td-field td-field-block';
  const il = document.createElement('span');
  il.className = 'td-field-label';
  il.textContent = 'Issue URL';
  const issueInput = document.createElement('input');
  issueInput.type = 'url';
  issueInput.className = 'td-text-input';
  issueInput.placeholder = 'https://github.com/.../issues/1';
  issueInput.value = draft.issueUrl || '';
  issueInput.spellcheck = false;
  issueInput.addEventListener('input', () => { draft.issueUrl = issueInput.value; });
  field.appendChild(il);
  field.appendChild(issueInput);
  return field;
}

function buildProjectField() {
  const field = document.createElement('div');
  field.className = 'td-field';
  const pl2 = document.createElement('span');
  pl2.className = 'td-field-label';
  pl2.textContent = 'Project';
  const projectInput = document.createElement('input');
  projectInput.type = 'text';
  projectInput.className = 'td-text-input';
  projectInput.placeholder = 'my-app';
  projectInput.setAttribute('list', 'tcProjectList');
  projectInput.value = draft.project || '';
  projectInput.addEventListener('input', () => { draft.project = projectInput.value; });
  let projectDatalist = document.getElementById('tcProjectList');
  if (!projectDatalist) {
    projectDatalist = document.createElement('datalist');
    projectDatalist.id = 'tcProjectList';
    document.body.appendChild(projectDatalist);
  }
  const metaProjects = (getState()?.meta?.projects) || [];
  projectDatalist.innerHTML = metaProjects
    .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`)
    .join('');
  field.appendChild(pl2);
  field.appendChild(projectInput);
  return field;
}

function buildEnergyField() {
  const field = document.createElement('div');
  field.className = 'td-field';
  const el = document.createElement('span');
  el.className = 'td-field-label';
  el.textContent = 'Energy';
  const energySelect = document.createElement('select');
  energySelect.className = 'td-select';
  [['', '—'], ['deep', 'Deep'], ['shallow', 'Shallow'], ['errands', 'Errands'], ['creative', 'Creative']].forEach(([v, label]) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = label;
    if ((draft.energy || '') === v) opt.selected = true;
    energySelect.appendChild(opt);
  });
  energySelect.addEventListener('change', () => { draft.energy = energySelect.value || null; });
  field.appendChild(el);
  field.appendChild(energySelect);
  return field;
}

function buildSnoozeField() {
  const field = document.createElement('div');
  field.className = 'td-field';
  const snl = document.createElement('span');
  snl.className = 'td-field-label';
  snl.textContent = 'Snooze until';
  const snoozeInput = document.createElement('input');
  snoozeInput.type = 'date';
  snoozeInput.className = 'td-date-input';
  snoozeInput.value = draft.snoozeUntil || '';
  snoozeInput.addEventListener('change', () => { draft.snoozeUntil = snoozeInput.value || null; });
  field.appendChild(snl);
  field.appendChild(snoozeInput);
  return field;
}

function buildTypeField() {
  const state = getState() || {};
  const types = normalizeTicketTypes(state.ticketTypes);
  const field = document.createElement('div');
  field.className = 'td-field';
  const tl = document.createElement('span');
  tl.className = 'td-field-label';
  tl.textContent = 'Type';
  const typeSelect = document.createElement('select');
  typeSelect.className = 'td-select';
  typeSelect.setAttribute('aria-label', 'Ticket type');
  types.forEach(tt => {
    const opt = document.createElement('option');
    opt.value = tt.id;
    opt.textContent = tt.name;
    if (tt.id === draft.type) opt.selected = true;
    typeSelect.appendChild(opt);
  });

  typeSelect.addEventListener('change', () => {
    draft.type = typeSelect.value;
    const stillValid = parentCandidates(types, state.tasks, draft.type, null)
      .some(p => p.taskId === draft.parentId);
    if (draft.parentId && !stillValid) draft.parentId = null;
    buildForm();
  });

  field.appendChild(tl);
  field.appendChild(typeSelect);
  return field;
}

function buildColorField() {
  const state = getState() || {};
  const types = normalizeTicketTypes(state.ticketTypes);
  const field = document.createElement('div');
  field.className = 'td-field td-field-color-override td-field-block';
  const label = document.createElement('span');
  label.className = 'td-field-label';
  label.textContent = 'Color';
  const { swatch, override } = makeColorControls({
    color: resolveTaskColor(draft, types, state.tasks),
    customColor: isHexColor(draft.color) ? draft.color : null,
    inheritedColor: inheritedTaskColor(draft, types, state.tasks),
    inheritFrom: inheritColorLabel(draft, types, state.tasks),
    hasParent: !!draft.parentId,
    onChange: (hex) => {
      draft.color = hex;
    },
  });
  const colorRow = document.createElement('div');
  colorRow.className = 'td-color-row';
  colorRow.appendChild(swatch);
  colorRow.appendChild(override);
  field.appendChild(label);
  field.appendChild(colorRow);
  return field;
}

function buildParentField() {
  const state = getState() || {};
  const types = normalizeTicketTypes(state.ticketTypes);
  const field = document.createElement('div');
  field.className = 'td-field';
  const pl = document.createElement('span');
  pl.className = 'td-field-label';
  pl.textContent = 'Parent';
  const parentSelect = document.createElement('select');
  parentSelect.className = 'td-select';
  parentSelect.setAttribute('aria-label', 'Parent ticket');

  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— None —';
  parentSelect.appendChild(none);

  const candidates = parentCandidates(types, state.tasks, draft.type, null);
  candidates.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.taskId;
    const pType = getTicketType(types, p.type);
    opt.textContent = `${p.taskId} · ${p.title} (${pType.name})`;
    if (p.taskId === draft.parentId) opt.selected = true;
    parentSelect.appendChild(opt);
  });

  parentSelect.disabled = candidates.length === 0;
  parentSelect.addEventListener('change', () => {
    draft.parentId = parentSelect.value || null;
    buildForm();
  });

  field.appendChild(pl);
  field.appendChild(parentSelect);
  return field;
}

function buildBlockedField() {
  const field = document.createElement('div');
  field.className = 'td-field';
  const bl = document.createElement('span');
  bl.className = 'td-field-label';
  bl.textContent = 'Blocked';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'td-toggle-btn' + (draft.blocked ? ' active' : '');
  toggle.setAttribute('aria-pressed', draft.blocked ? 'true' : 'false');
  toggle.textContent = draft.blocked ? 'Yes' : 'No';
  toggle.addEventListener('click', () => {
    draft.blocked = !draft.blocked;
    toggle.classList.toggle('active', draft.blocked);
    toggle.setAttribute('aria-pressed', draft.blocked ? 'true' : 'false');
    toggle.textContent = draft.blocked ? 'Yes' : 'No';
  });
  field.appendChild(bl);
  field.appendChild(toggle);
  return field;
}

function buildWaitingOnField() {
  const field = document.createElement('div');
  field.className = 'td-field td-field-block';
  const wl = document.createElement('span');
  wl.className = 'td-field-label';
  wl.textContent = 'Waiting on';
  const waitInput = document.createElement('input');
  waitInput.type = 'text';
  waitInput.className = 'td-text-input';
  waitInput.placeholder = 'Person, team, or thing…';
  waitInput.value = draft.waitingOn || '';
  waitInput.addEventListener('input', () => {
    draft.waitingOn = waitInput.value;
  });
  field.appendChild(wl);
  field.appendChild(waitInput);
  return field;
}

function peopleDatalistOptions() {
  const slugs = [];
  const people = memoryState?.memoryData?.memoryDirs?.people;
  if (Array.isArray(people)) {
    people.forEach(f => {
      const slug = (f.name || '').replace(/\.md$/i, '');
      if (slug) slugs.push(slug);
    });
  }
  return slugs.sort((a, b) => a.localeCompare(b));
}

function buildAssigneeField() {
  if (isCorporateUiHidden()) return null;
  const field = document.createElement('div');
  field.className = 'td-field td-field-block';
  markCorporateUi(field);
  const al = document.createElement('span');
  al.className = 'td-field-label';
  al.textContent = 'Assignee';
  const assigneeInput = document.createElement('input');
  assigneeInput.type = 'text';
  assigneeInput.className = 'td-text-input';
  assigneeInput.placeholder = 'Name or slug…';
  assigneeInput.value = draft.assignee || '';
  assigneeInput.setAttribute('list', 'tcAssigneePeopleList');
  const peopleList = document.createElement('datalist');
  peopleList.id = 'tcAssigneePeopleList';
  peopleDatalistOptions().forEach(slug => {
    const opt = document.createElement('option');
    opt.value = slug;
    peopleList.appendChild(opt);
  });
  assigneeInput.addEventListener('input', () => { draft.assignee = assigneeInput.value; });
  field.appendChild(al);
  field.appendChild(assigneeInput);
  field.appendChild(peopleList);
  return field;
}

function buildEstimateField() {
  const field = document.createElement('div');
  field.className = 'td-field';
  const el = document.createElement('span');
  el.className = 'td-field-label';
  el.textContent = 'Estimate';
  const estInput = document.createElement('input');
  estInput.type = 'text';
  estInput.className = 'td-text-input';
  estInput.placeholder = 'e.g. 30m, 2h, 1d';
  estInput.value = draft.estimate || '';
  estInput.addEventListener('input', () => { draft.estimate = estInput.value; });
  field.appendChild(el);
  field.appendChild(estInput);
  return field;
}

function buildRecurrenceField() {
  const field = document.createElement('div');
  field.className = 'td-field td-field-block td-recurrence-field';
  const row = document.createElement('div');
  row.className = 'td-recurrence-row';

  const freqWrap = document.createElement('div');
  freqWrap.className = 'td-recurrence-freq';
  const fl = document.createElement('span');
  fl.className = 'td-field-label';
  fl.textContent = 'Repeat';
  const freqSelect = document.createElement('select');
  freqSelect.className = 'td-select';
  [
    ['', 'None'],
    ['daily', 'Daily'],
    ['weekly', 'Weekly'],
    ['monthly', 'Monthly'],
  ].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if ((draft.recurrenceFreq || '') === val) opt.selected = true;
    freqSelect.appendChild(opt);
  });
  freqWrap.appendChild(fl);
  freqWrap.appendChild(freqSelect);

  const intervalWrap = document.createElement('div');
  intervalWrap.className = 'td-recurrence-interval';
  const il = document.createElement('span');
  il.className = 'td-field-label';
  il.textContent = 'Every';
  const intervalInput = document.createElement('input');
  intervalInput.type = 'number';
  intervalInput.min = '1';
  intervalInput.max = '365';
  intervalInput.className = 'td-text-input';
  intervalInput.style.width = '4rem';
  intervalInput.value = String(draft.recurrenceInterval || 1);
  intervalInput.disabled = !draft.recurrenceFreq;
  intervalWrap.appendChild(il);
  intervalWrap.appendChild(intervalInput);

  freqSelect.addEventListener('change', () => {
    draft.recurrenceFreq = freqSelect.value;
    intervalInput.disabled = !draft.recurrenceFreq;
  });
  intervalInput.addEventListener('input', () => {
    draft.recurrenceInterval = Math.max(1, parseInt(intervalInput.value, 10) || 1);
  });

  row.appendChild(freqWrap);
  row.appendChild(intervalWrap);
  field.appendChild(row);
  return field;
}

function buildLabelsField() {
  const wrap = document.createElement('div');
  wrap.className = 'td-chip-list';
  const header = document.createElement('div');
  header.className = 'td-field-label';
  header.textContent = 'Labels';
  wrap.appendChild(header);

  (draft.labels || []).forEach((lab, idx) => {
    const chip = document.createElement('span');
    chip.className = 'td-chip';
    chip.innerHTML = `${escapeHtml(lab)}<button type="button" class="td-chip-remove" aria-label="Remove label">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      draft.labels.splice(idx, 1);
      buildForm();
    });
    wrap.appendChild(chip);
  });
  const labelAdd = document.createElement('div');
  labelAdd.className = 'td-inline-add';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'td-text-input';
  labelInput.placeholder = 'Add label…';
  const labelBtn = document.createElement('button');
  labelBtn.type = 'button';
  labelBtn.className = 'td-add-subtask';
  labelBtn.textContent = '+ Add';
  const addLabel = () => {
    const v = labelInput.value.trim();
    if (!v) return;
    if (!draft.labels.includes(v)) draft.labels.push(v);
    buildForm();
  };
  labelBtn.addEventListener('click', addLabel);
  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addLabel(); }
  });
  labelAdd.appendChild(labelInput);
  labelAdd.appendChild(labelBtn);
  wrap.appendChild(labelAdd);
  return wrap;
}

function buildLinksField() {
  const wrap = document.createElement('div');
  wrap.className = 'td-links-list';
  const header = document.createElement('div');
  header.className = 'td-field-label';
  header.textContent = 'Links';
  wrap.appendChild(header);

  (draft.links || []).forEach((link, idx) => {
    const row = document.createElement('div');
    row.className = 'td-link-row';
    const span = document.createElement('span');
    span.textContent = link.label ? `${link.label} — ${link.url}` : link.url;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'td-chip-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      draft.links.splice(idx, 1);
      buildForm();
    });
    row.appendChild(span);
    row.appendChild(remove);
    wrap.appendChild(row);
  });
  const linkAdd = document.createElement('div');
  linkAdd.className = 'td-inline-add td-link-add';
  const linkLabel = document.createElement('input');
  linkLabel.type = 'text';
  linkLabel.className = 'td-text-input';
  linkLabel.placeholder = 'Label (optional)';
  const linkUrl = document.createElement('input');
  linkUrl.type = 'url';
  linkUrl.className = 'td-text-input';
  linkUrl.placeholder = 'https://…';
  const linkBtn = document.createElement('button');
  linkBtn.type = 'button';
  linkBtn.className = 'td-add-subtask';
  linkBtn.textContent = '+ Link';
  const addLink = () => {
    const url = linkUrl.value.trim();
    if (!url) return;
    const row = { url };
    const lab = linkLabel.value.trim();
    if (lab) row.label = lab;
    draft.links.push(row);
    buildForm();
  };
  linkBtn.addEventListener('click', addLink);
  linkUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addLink(); }
  });
  linkAdd.appendChild(linkLabel);
  linkAdd.appendChild(linkUrl);
  linkAdd.appendChild(linkBtn);
  wrap.appendChild(linkAdd);
  return wrap;
}

function buildDescriptionField() {
  const wrap = document.createElement('div');
  wrap.className = 'td-field-block';
  const header = document.createElement('div');
  header.className = 'td-field-label';
  header.textContent = 'Description';
  wrap.appendChild(header);

  const textarea = document.createElement('textarea');
  textarea.className = 'td-notes-textarea';
  textarea.placeholder = 'Optional description — context, links, details…';
  textarea.value = draft.description || '';
  textarea.setAttribute('aria-label', 'Description');

  textarea.addEventListener('input', () => {
    draft.description = textarea.value;
  });

  wrap.appendChild(textarea);
  return wrap;
}

function submitCreate() {
  if (!draft || !getState) return;

  const titleInput = document.getElementById('tcTitle');
  const title = (titleInput?.value || '').trim();
  if (!title) {
    titleInput?.classList.add('tc-title-error');
    titleInput?.focus();
    showStatus('Title is required');
    return;
  }

  const state = getState();
  const { sections, tasks } = state;
  const sectionId = draft.section || 'todo';
  if (!tasks[sectionId]) tasks[sectionId] = [];

  const taskId = computeNextTaskId(state);
  const estimateMinutes = draft.estimate ? parseEstimate(draft.estimate) : null;
  if (draft.estimate && estimateMinutes == null) {
    showStatus('Invalid estimate — try 30m, 2h, or 1d');
    return;
  }

  let jiraKey = null;
  if ((draft.jiraKey || '').trim()) {
    const key = normalizeJiraKey(draft.jiraKey);
    if (key === undefined) {
      showStatus('Invalid Jira key — use format PROJECT-123');
      return;
    }
    jiraKey = key;
  }

  let recurrence = null;
  if (draft.recurrenceFreq) {
    recurrence = {
      freq: draft.recurrenceFreq,
      interval: Math.max(1, parseInt(draft.recurrenceInterval, 10) || 1),
    };
  }

  const task = {
    id: Date.now() + Math.random(),
    title,
    description: (draft.description || '').trim(),
    checked: false,
    subtasks: [],
    section: sectionId,
    created: todayStr(),
    updated: null,
    priority: draft.priority || 'medium',
    type: draft.type || DEFAULT_TICKET_TYPE_ID,
    parentId: draft.parentId || null,
    color: draft.color || null,
    dueDate: draft.dueDate || null,
    startDate: draft.startDate || null,
    jiraKey,
    issueUrl: (draft.issueUrl || '').trim() || null,
    project: (draft.project || '').trim() || null,
    energy: draft.energy || null,
    snoozeUntil: draft.snoozeUntil || null,
    blocked: !!draft.blocked,
    waitingOn: (draft.waitingOn || '').trim() || null,
    labels: Array.isArray(draft.labels) ? [...draft.labels] : [],
    links: Array.isArray(draft.links) ? draft.links.map(l => ({ ...l })) : [],
    blockedBy: [],
    assignee: (draft.assignee || '').trim() || null,
    estimateMinutes: estimateMinutes || null,
    loggedMinutes: null,
    timeEntries: [],
    decisions: [],
    recurrence,
    notes: [],
    history: [],
    taskId,
  };
  appendHistory(task, { event: 'created', to: sectionId });

  tasks[sectionId].push(task);
  markChanged();
  getRenderTasks && getRenderTasks()();
  closeCreateTaskModal();
  showStatus(`Created ${taskId}`);
}

export function initTaskCreate() {
  const overlay = document.getElementById('taskCreateOverlay');
  const closeBtn = document.getElementById('tcClose');
  const cancelBtn = document.getElementById('tcCancel');
  const createBtn = document.getElementById('tcCreate');
  const titleInput = document.getElementById('tcTitle');

  if (closeBtn) closeBtn.addEventListener('click', closeCreateTaskModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeCreateTaskModal);
  if (createBtn) createBtn.addEventListener('click', submitCreate);

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeCreateTaskModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (!isTaskCreateOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCreateTaskModal();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitCreate();
    }
  });

  if (titleInput) {
    titleInput.addEventListener('input', () => {
      titleInput.classList.remove('tc-title-error');
      if (draft) draft.title = titleInput.value;
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitCreate();
      }
    });
  }

  window.__getCreateDraftSnapshot = () => {
    if (!draft || !isTaskCreateOpen()) return null;
    const titleEl = document.getElementById('tcTitle');
    return {
      ...draft,
      title: titleEl ? titleEl.value : draft.title,
      labels: [...(draft.labels || [])],
      links: (draft.links || []).map(l => ({ ...l })),
    };
  };
}

/**
 * Apply a saved template onto the open create draft and rebuild the form.
 * @param {object} tplDraft
 */
export function applyTemplateToDraft(tplDraft) {
  if (!draft || !tplDraft || typeof tplDraft !== 'object') return;
  const keys = [
    'title', 'description', 'priority', 'section', 'type', 'parentId', 'color',
    'dueDate', 'startDate', 'jiraKey', 'blocked', 'waitingOn', 'assignee',
    'estimate', 'recurrenceFreq', 'recurrenceInterval',
  ];
  for (const k of keys) {
    if (tplDraft[k] !== undefined) draft[k] = tplDraft[k];
  }
  if (Array.isArray(tplDraft.labels)) draft.labels = [...tplDraft.labels];
  if (Array.isArray(tplDraft.links)) draft.links = tplDraft.links.map(l => ({ ...l }));
  const titleInput = document.getElementById('tcTitle');
  if (titleInput && draft.title) titleInput.value = draft.title;
  buildForm();
}
