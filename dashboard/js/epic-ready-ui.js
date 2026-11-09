// epic-ready-ui.js — Ready / Not ready state, Auto switch and Lane field for epics (PRO61).
// Used by the ticket window (task-detail.js) and the Plan tab (run-plan-view.js); rules in shared/epic-ready.js.

import { epicReadiness, readinessLabel, AUTO_LABEL, isAuto } from '../../shared/epic-ready.js';
import { buildEpicLaneInput } from './task-create.js';

/** Adapt the dashboard in-memory shape (taskId, per-section arrays) to the tasks.json doc shape. */
export function stateToDoc(state) {
  if (!state.meta) state.meta = {};
  return {
    meta: state.meta,
    sections: (state.sections || []).map(sec => ({
      id: sec.id,
      tasks: (state.tasks?.[sec.id] || []).filter(t => t.taskId).map(t => ({
        id: t.taskId,
        title: t.title,
        checked: !!t.checked,
        type: t.type,
        parentId: t.parentId,
        blockedBy: t.blockedBy || [],
        labels: t.labels || [],
        lane: t.lane || undefined,
        project: t.project || undefined,
        // Readiness inputs (shared/epic-ready.js).
        description: t.description || '',
        blocked: !!t.blocked,
        // Review queue inputs (shared/review.js reads these).
        links: t.links || [],
        waitingOn: t.waitingOn || undefined,
        decisions: t.decisions || [],
        reviewOf: t.reviewOf || undefined,
        result: t.result || undefined,
        checks: t.checks || [],
        reviewNotes: t.reviewNotes || [],
        history: t.history || [],
        created: t.created || undefined,
        updated: t.updated || undefined,
      })),
    })),
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const LANE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Epic block of the ticket window: Ready / Not ready line, Lane field, Auto switch.
 * @param {object} task    dashboard-shaped epic
 * @param {{ state: object, commit: (note: string) => void, refresh: () => void }} ctx
 */
export function buildEpicPlanPanel(task, { state, commit, refresh }) {
  const wrap = el('div', 'td-field td-field-block td-epic-plan');
  wrap.appendChild(el('span', 'td-field-label', 'Plan'));

  const doc = stateToDoc(state);
  const docEpic = doc.sections.flatMap(s => s.tasks).find(t => t.id === task.taskId);
  if (docEpic) {
    const r = epicReadiness(doc, docEpic);
    const line = el('p', `td-epic-ready ${r.ready ? 'td-epic-ready-yes' : 'td-epic-ready-no'}`, readinessLabel(r));
    line.dataset.ready = r.ready ? 'true' : 'false';
    wrap.appendChild(line);
  }

  const laneField = buildEpicLaneInput(state, {
    id: 'tdEpicLane',
    listId: 'tdEpicLaneList',
    label: 'Lane',
    value: task.lane || '',
    onInput: () => {},
  });
  const input = laneField.querySelector('input');
  const save = () => {
    const v = input.value.trim().toLowerCase();
    if (v === (task.lane || '')) { input.classList.remove('tc-title-error'); return; }
    if (v && !LANE_SLUG.test(v)) {
      input.classList.add('tc-title-error');
      input.title = 'Lowercase letters, digits and hyphens, like canvas or mod-lanes';
      return;
    }
    input.classList.remove('tc-title-error');
    task.lane = v || null;
    commit(v ? `Lane set to ${v}` : 'Lane cleared');
    refresh();
  };
  input.addEventListener('change', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  wrap.appendChild(laneField);

  const autoLabel = el('label', 'td-epic-auto');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'tdEpicAuto';
  box.checked = isAuto({ labels: task.labels || [] });
  box.addEventListener('change', () => {
    if (!Array.isArray(task.labels)) task.labels = [];
    const has = task.labels.some(l => String(l).trim().toLowerCase() === AUTO_LABEL);
    if (box.checked && !has) task.labels.push(AUTO_LABEL);
    if (!box.checked) task.labels = task.labels.filter(l => String(l).trim().toLowerCase() !== AUTO_LABEL);
    commit(box.checked ? 'Auto on' : 'Auto off');
    refresh();
  });
  autoLabel.appendChild(box);
  autoLabel.appendChild(el('span', null, 'Auto: run automatically when ready'));
  wrap.appendChild(autoLabel);
  return wrap;
}

/**
 * The Plan tab's "Ready state" block: every open epic as Ready / Ready · Auto / Not ready: reason.
 * @param {object[]} readiness  plan.readiness
 * @param {(id: string) => HTMLElement} idButton  makes the epic id a button that opens the ticket
 */
export function renderReadyState(readiness, idButton) {
  const sec = el('section', 'rp-ready');
  sec.setAttribute('aria-label', 'Ready state of every open epic');
  sec.appendChild(el('h3', 'rp-ready-title', 'Ready state'));
  sec.appendChild(el('p', 'rp-ready-note',
    'An epic runs by itself only when it is Ready and Auto is on for it (the Auto box in its ticket window).'));
  const list = el('ul', 'rp-ready-list');
  for (const r of readiness) {
    const li = el('li', `rp-ready-row ${r.ready ? 'rp-ready-yes' : 'rp-ready-no'}`);
    li.dataset.epic = r.id;
    li.appendChild(idButton(r.id));
    li.appendChild(el('span', 'rp-ready-name', r.title));
    li.appendChild(el('span', 'rp-ready-state', r.ready ? 'Ready' : 'Not ready'));
    if (r.auto) li.appendChild(el('span', 'rp-ready-auto', 'Auto'));
    if (!r.ready) li.appendChild(el('span', 'rp-ready-why', r.reasons.join('; ')));
    list.appendChild(li);
  }
  if (!readiness.length) list.appendChild(el('li', 'rp-ready-row', 'No open epics.'));
  sec.appendChild(list);
  return sec;
}
