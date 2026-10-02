// run-plan-view.js — "Run plan" tab: pinned epics as parallel lanes (see shared/run-plan.js)

import { computeRunPlan } from '../../shared/run-plan.js';

let getState = null;

export function setRunPlanStateGetter(fn) { getState = fn; }

/** Adapt the dashboard in-memory shape (taskId, per-section arrays) to the tasks.json doc shape. */
function toDoc(state) {
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function badgeFor(epic) {
  if (epic.state === 'waiting') return { cls: 'waiting', text: `Waiting on ${epic.waitingOn.join(', ')}` };
  if (epic.state === 'partial') return { cls: 'partial', text: 'Partly ready – waiting on a design pick' };
  return { cls: 'ready', text: 'Ready' };
}

function renderTicket(t) {
  const li = el('li', 'rp-ticket' + (t.isPick ? ' rp-pick' : ''));
  li.appendChild(el('span', 'rp-ticket-id', t.id));
  li.appendChild(el('span', 'rp-ticket-title', t.title));
  if (t.isPick) li.appendChild(el('span', 'rp-pick-tag', 'Pick'));
  if (t.blockedBy.length) li.appendChild(el('span', 'rp-ticket-blocked', `blocked by ${t.blockedBy.join(', ')}`));
  return li;
}

function renderEpic(epic) {
  const card = el('article', `rp-epic rp-${epic.state}`);
  card.setAttribute('aria-label', `Epic ${epic.id}: ${epic.title}`);

  const head = el('div', 'rp-epic-head');
  head.appendChild(el('span', 'rp-epic-id', epic.id));
  head.appendChild(el('span', 'rp-epic-title', epic.title));
  card.appendChild(head);

  const badge = badgeFor(epic);
  card.appendChild(el('span', `rp-badge rp-badge-${badge.cls}`, badge.text));

  if (epic.tickets.length) {
    const ol = el('ol', 'rp-tickets');
    epic.tickets.forEach(t => ol.appendChild(renderTicket(t)));
    card.appendChild(ol);
  } else {
    card.appendChild(el('p', 'rp-empty-tickets', 'No open tickets'));
  }

  const btn = el('button', 'rp-copy', 'Copy command');
  btn.type = 'button';
  btn.setAttribute('aria-label', `Copy command ${epic.command}`);
  btn.title = epic.command;
  btn.addEventListener('click', async () => {
    const ok = await copyText(epic.command);
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy command'; }, 1500);
  });
  card.appendChild(btn);
  return card;
}

export function renderRunPlanView() {
  const root = document.getElementById('runPlanMain');
  if (!root) return;
  root.textContent = '';
  const state = getState?.();
  if (!state?.tasks) {
    root.appendChild(el('p', 'rp-empty', 'Load tasks to see the run plan.'));
    return;
  }
  const plan = computeRunPlan(toDoc(state));

  root.appendChild(el('p', 'rp-note',
    `Machine cap: run at most ${plan.machineCap} agentsynth epics at once. ${plan.readyCount} launchable now.`));

  if (plan.lanes.length === 0) {
    root.appendChild(el('p', 'rp-empty', 'No pinned epics. Pin one with ch tasks plan --pin <id>'));
  } else {
    const grid = el('div', 'rp-lanes');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Run plan lanes');
    grid.tabIndex = 0;
    for (const lane of plan.lanes) {
      const col = el('section', 'rp-lane');
      col.setAttribute('aria-label', `Lane ${lane.lane}`);
      col.appendChild(el('h3', 'rp-lane-title', lane.lane));
      lane.epics.forEach(e => col.appendChild(renderEpic(e)));
      grid.appendChild(col);
    }
    root.appendChild(grid);
  }

  if (plan.doneEpics.length) {
    root.appendChild(el('p', 'rp-done', `Done: ${plan.doneEpics.join(', ')}`));
  }
}

/** Re-render when tasks change (called from renderTasks); only if the tab is showing. */
export function refreshRunPlanView() {
  const panel = document.getElementById('runPlanPanel');
  if (panel?.classList.contains('active')) renderRunPlanView();
}
