// run-plan-view.js — "Run plan" tab: pinned epics as lanes (rows); see shared/run-plan.js

import { computeRunPlan } from '../../shared/run-plan.js';
import { claudeCodeSessionUrl } from '../../shared/claude-deeplink.js';

let getState = null;
let toastTimer = null;

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
        project: t.project || undefined,
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

const STATE_LABEL = { ready: 'Ready now', partial: 'Partly ready', later: 'Later', pick: 'Your pick' };
const LANE_COLORS = 4; // --rp-c1..4; the design lane uses the pick colour
const PROGRESS_KEY = 'runPlanProgress';

// ----- Start -> Started -> Done progress, kept in localStorage (best effort) -----
function readProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; }
}
function writeProgress(map) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(map)); } catch { /* storage unavailable */ }
}
const NEXT = { '': 'started', started: 'done', done: '' };
const TOGGLE_LABEL = { '': 'Start', started: 'Started', done: 'Done' };

function showToast(message) {
  let toast = document.getElementById('runPlanToast');
  if (!toast) {
    toast = el('div', 'rp-toast');
    toast.id = 'runPlanToast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
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

/** Start: open the Claude desktop app on a new Code session with this card's command typed in. */
function openClaudeSession(card) {
  const folder = window.dashboardConfig?.claudeSessionFolder;
  const url = claudeCodeSessionUrl(card.command, folder);
  if (!url) return;
  window.location.assign(url);
  showToast(folder ? `Opening Claude: ${card.command}` : 'Opening Claude (set claudeSessionFolder in config.json to pick the folder)');
}

function renderCard(card, phase) {
  const key = `${card.id}:${phase}`;
  const article = el('article', `rp-card rp-${card.state}`);
  article.setAttribute('aria-label', `${card.id} ${card.title}`);

  const row = el('div', 'rp-row');
  row.appendChild(el('span', 'rp-id', card.state === 'pick' || card.isPrompt ? 'Design' : card.id));
  row.appendChild(el('span', `rp-chip rp-chip-${card.state}`, STATE_LABEL[card.state] || card.state));
  article.appendChild(row);

  article.appendChild(el('div', 'rp-title', card.isRest ? `${card.title} (rest)` : card.title));
  const n = card.openTickets;
  article.appendChild(el('div', 'rp-items', `${n} open ${n === 1 ? 'ticket' : 'tickets'}`));
  if (card.why) article.appendChild(el('div', 'rp-why', card.why));

  const actions = el('div', 'rp-actions');
  if (card.command) {
    const copy = el('button', 'rp-btn rp-cmd', card.isPrompt ? 'Copy prompt' : card.command);
    copy.type = 'button';
    copy.title = card.command;
    copy.setAttribute('aria-label', card.isPrompt ? 'Copy the design prompt' : `Copy command ${card.command}`);
    copy.addEventListener('click', async () => {
      const ok = await copyText(card.command);
      showToast(ok ? (card.isPrompt ? 'Copied the design prompt' : `Copied: ${card.command}`) : `Copy blocked: ${card.command}`);
    });
    actions.appendChild(copy);
  }
  const progress = readProgress();
  let state = progress[key] || '';
  const toggle = el('button', 'rp-btn rp-toggle', TOGGLE_LABEL[state]);
  toggle.type = 'button';
  const apply = () => {
    toggle.textContent = TOGGLE_LABEL[state];
    toggle.setAttribute('aria-pressed', state ? 'true' : 'false');
    toggle.setAttribute('aria-label', `${card.id} ${card.title}: ${state || 'not started'}. Activate to change`);
    article.classList.toggle('rp-done', state === 'done');
  };
  toggle.addEventListener('click', () => {
    const prev = state;
    state = NEXT[state];
    if (prev === '' && state === 'started') openClaudeSession(card);
    const map = readProgress();
    if (state) map[key] = state; else delete map[key];
    writeProgress(map);
    apply();
  });
  apply();
  actions.appendChild(toggle);
  article.appendChild(actions);
  return article;
}

function appendCards(parent, cards, phase) {
  cards.forEach((card, i) => {
    if (i > 0) {
      const arrow = el('span', 'rp-arrow', '→');
      arrow.setAttribute('aria-hidden', 'true');
      parent.appendChild(arrow);
    }
    parent.appendChild(renderCard(card, phase));
  });
}

function renderLane(lane, index) {
  const track = el('section', 'rp-track');
  track.setAttribute('aria-label', `Lane ${lane.name}`);
  const colorIdx = lane.lane === 'design' ? 'pick' : (index % LANE_COLORS) + 1;
  track.style.setProperty('--c', `var(--rp-c${colorIdx})`);

  const head = el('div', 'rp-head');
  head.appendChild(el('h3', 'rp-name', lane.name));
  head.appendChild(el('div', 'rp-note', lane.needsBuild ? 'Needs an app build' : 'No app build'));
  track.appendChild(head);

  const row = el('div', 'rp-lane');
  row.tabIndex = 0;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', `${lane.name} cards, in order`);
  appendCards(row, lane.now, 'now');
  if (lane.later.length) {
    const divider = el('div', 'rp-picks');
    divider.appendChild(el('div', null, 'after your picks'));
    row.appendChild(divider);
    appendCards(row, lane.later, 'later');
  }
  track.appendChild(row);
  return track;
}

function renderRules(plan) {
  const rules = el('div', 'rp-rules');
  const pill = (bold, rest) => {
    const p = el('span', 'rp-rule');
    if (bold) p.appendChild(el('b', null, bold));
    p.appendChild(document.createTextNode(rest));
    rules.appendChild(p);
  };
  pill('Lanes run side by side', '; cards in a lane run one after another');
  pill(`At most ${plan.machineCap} app lanes at once`, ` (this plan has ${plan.appLaneCount}); lanes without an app build are not counted`);
  pill('Partly ready', ' = run it now, it stops at the design picks; run the same command again after your picks');
  return rules;
}

function renderLegend() {
  const legend = el('div', 'rp-legend');
  for (const [cls, text] of [['ready', 'Ready now'], ['partial', 'Partly ready'], ['later', 'Later'], ['pick', 'Your design picks']]) {
    const item = el('span');
    item.appendChild(el('span', `rp-dot rp-dot-${cls}`));
    item.appendChild(document.createTextNode(text));
    legend.appendChild(item);
  }
  return legend;
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

  if (plan.lanes.length === 0) {
    root.appendChild(el('p', 'rp-empty', 'No pinned epics. Pin one with ch tasks plan --pin <id>'));
    return;
  }
  root.appendChild(renderRules(plan));
  root.appendChild(renderLegend());
  const tracks = el('div', 'rp-tracks');
  plan.lanes.forEach((lane, i) => tracks.appendChild(renderLane(lane, i)));
  root.appendChild(tracks);
  if (plan.doneEpics.length) root.appendChild(el('p', 'rp-done-note', `Done: ${plan.doneEpics.join(', ')}`));
}

/** Re-render when tasks change (called from renderTasks); only if the tab is showing. */
export function refreshRunPlanView() {
  const panel = document.getElementById('runPlanPanel');
  if (panel?.classList.contains('active')) renderRunPlanView();
}
