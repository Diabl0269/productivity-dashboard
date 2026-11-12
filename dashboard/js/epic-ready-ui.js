// epic-ready-ui.js — Ready / Not ready state, Auto switch and Lane field for epics (PRO61).
// Used by the ticket window (task-detail.js) and the Plan tab (run-plan-view.js); rules in shared/epic-ready.js.

import { epicReadiness, readinessLabel, isAuto, autoPriorityOf, withAutoLabel, autoToggleView, foldReadiness } from '../../shared/epic-ready.js';
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
        autoPriority: t.autoPriority || undefined,
        autoRank: t.autoRank == null ? undefined : t.autoRank,
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
        asks: t.asks || [],
        resolvedAsks: t.resolvedAsks || [],
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
 * Epic block of the ticket window: Ready / Not ready line, Lane field, Auto priority, Auto switch.
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

  // Auto priority: where this epic starts among Auto epics (High, then Normal, then Low).
  const prioField = el('div', 'td-field');
  prioField.appendChild(el('span', 'td-field-label', 'Auto priority'));
  const prioSelect = el('select', 'td-select');
  prioSelect.id = 'tdEpicAutoPriority';
  prioSelect.setAttribute('aria-label', 'Auto priority');
  for (const p of ['high', 'normal', 'low']) {
    const o = el('option', null, p[0].toUpperCase() + p.slice(1));
    o.value = p;
    prioSelect.appendChild(o);
  }
  prioSelect.value = autoPriorityOf(task);
  prioSelect.addEventListener('change', () => {
    task.autoPriority = prioSelect.value === 'normal' ? null : prioSelect.value;
    task.autoRank = null; // a new group: starts at the end of it; drag the row on the Plan page to place it
    commit(`Auto priority set to ${prioSelect.value}`);
    refresh();
  });
  prioField.appendChild(prioSelect);
  wrap.appendChild(prioField);

  const autoLabel = el('label', 'td-epic-auto');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'tdEpicAuto';
  box.checked = isAuto({ labels: task.labels || [] });
  box.addEventListener('change', () => {
    task.labels = withAutoLabel(task.labels, box.checked);
    commit(box.checked ? 'Auto on' : 'Auto off');
    refresh();
  });
  autoLabel.appendChild(box);
  autoLabel.appendChild(el('span', null, 'Auto: run automatically when ready'));
  wrap.appendChild(autoLabel);
  return wrap;
}

const FOLD_KEY = 'runPlanNotReadyOpen';
function readFold() {
  try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; }
}
function writeFold(open) {
  try { localStorage.setItem(FOLD_KEY, open ? '1' : '0'); } catch { /* storage unavailable */ }
}

/**
 * Compact Auto switch for a Plan page card or Ready row: a real checkbox named by the epic id.
 * Flipping it writes the same `auto` label as the epic window checkbox, through `onToggle`.
 * @param {{id: string, ready: boolean, auto: boolean}} r  epicReadiness result
 * @param {(on: boolean) => void} onToggle
 */
export function buildAutoToggle(r, onToggle) {
  const v = autoToggleView(r);
  const label = el('label', 'td-epic-auto rp-auto-toggle');
  label.title = v.title;
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = v.checked;
  box.dataset.autoToggle = r.id;
  box.setAttribute('aria-label', v.ariaLabel);
  box.addEventListener('change', () => onToggle(box.checked));
  label.appendChild(box);
  label.appendChild(el('span', null, v.text));
  return label;
}

/**
 * The Plan tab's "Ready state" block: Ready epics, with Not-ready ones folded under one button.
 * @param {object[]} readiness  plan.readiness
 * @param {(id: string) => HTMLElement} idButton  makes the epic id a button that opens the ticket
 * @param {(r: object, on: boolean, where: string) => void} [onAuto]  writes the Auto label for an epic
 */
export function renderReadyState(readiness, idButton, onAuto) {
  const sec = el('section', 'rp-ready');
  sec.setAttribute('aria-label', 'Ready state of every open epic');
  sec.appendChild(el('h3', 'rp-ready-title', 'Ready state'));
  sec.appendChild(el('p', 'rp-ready-note',
    'An epic runs by itself only when it is Ready and Auto is on for it (the Auto switch here or in its ticket window).'));
  const { ready, notReady, buttonLabel } = foldReadiness(readiness);
  const row = (r) => {
    const li = el('li', `rp-ready-row ${r.ready ? 'rp-ready-yes' : 'rp-ready-no'}`);
    li.dataset.epic = r.id;
    li.appendChild(idButton(r.id));
    li.appendChild(el('span', 'rp-ready-name', r.title));
    li.appendChild(el('span', 'rp-ready-state', r.ready ? 'Ready' : 'Not ready'));
    if (onAuto) li.appendChild(buildAutoToggle(r, on => onAuto(r, on, 'ready')));
    if (!r.ready) li.appendChild(el('span', 'rp-ready-why', r.reasons.join('; ')));
    return li;
  };
  const list = el('ul', 'rp-ready-list');
  ready.forEach(r => list.appendChild(row(r)));
  if (!readiness.length) list.appendChild(el('li', 'rp-ready-row', 'No open epics.'));
  else if (!ready.length) list.appendChild(el('li', 'rp-ready-row', 'No epic is Ready.'));
  sec.appendChild(list);

  if (notReady.length) {
    let open = readFold();
    const btn = el('button', 'rp-btn rp-fold-btn');
    btn.type = 'button';
    const fold = el('div', 'rp-fold');
    fold.id = 'rpNotReadyFold';
    btn.setAttribute('aria-controls', fold.id);
    const inner = el('div', 'rp-fold-inner');
    const nrList = el('ul', 'rp-ready-list');
    notReady.forEach(r => nrList.appendChild(row(r)));
    inner.appendChild(nrList);
    fold.appendChild(inner);
    const apply = () => {
      btn.textContent = `${buttonLabel} ${open ? '▴' : '▾'}`;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.title = open ? 'Hide the Not-ready epics' : 'Show the Not-ready epics';
      fold.classList.toggle('rp-fold-open', open);
    };
    apply();
    // Toggle in place (no redraw) so the height transition runs.
    btn.addEventListener('click', () => { open = !open; writeFold(open); apply(); });
    sec.appendChild(btn);
    sec.appendChild(fold);
  }
  return sec;
}
