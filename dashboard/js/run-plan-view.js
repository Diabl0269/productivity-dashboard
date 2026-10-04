// run-plan-view.js — "Run plan" tab: pinned epics as lanes (rows); see shared/run-plan.js

import { computeRunPlan } from '../../shared/run-plan.js';
import { claudeCodeSessionUrl } from '../../shared/claude-deeplink.js';
import { openTaskDetail } from './task-detail.js';

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
        // Review queue inputs (shared/review.js reads these).
        reviewOf: t.reviewOf || undefined,
        result: t.result || undefined,
        checks: t.checks || [],
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

const STATE_LABEL = { ready: 'Ready now', partial: 'Partly ready', later: 'Later', pick: 'Your pick' };

/** Open a ticket's detail in place (no navigation); toasts if the ticket is gone. */
function openTicket(id) {
  const state = getState?.();
  for (const list of Object.values(state?.tasks || {})) {
    const task = (list || []).find(t => t.taskId === id);
    if (task) { openTaskDetail(task); return; }
  }
  showToast(`Ticket ${id} not found`);
}

/** A ticket id as a button that opens the ticket. */
function idButton(id, className = 'rp-id rp-link') {
  const btn = el('button', className, id);
  btn.type = 'button';
  btn.title = `Open ${id}`;
  btn.setAttribute('aria-label', `Open ticket ${id}`);
  btn.addEventListener('click', () => openTicket(id));
  return btn;
}

/** The ticket (dashboard shape) with this id, or null. */
function findTicket(id) {
  for (const list of Object.values(getState?.()?.tasks || {})) {
    const task = (list || []).find(t => t.taskId === id);
    if (task) return task;
  }
  return null;
}

/** "From review of <id>" note, or null when the ticket has none. */
function reviewOfNote(reviewOf, className = 'rp-review-of') {
  if (!reviewOf) return null;
  const note = el('div', className, 'From review of ');
  note.appendChild(idButton(reviewOf, 'rp-link rp-review-id'));
  return note;
}

const SHIPPED_MAX = 120;
function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "3 Oct" style short date from an ISO timestamp (empty when unparseable). */
function shortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "Ready for review" block above the lanes: shipped tickets waiting for Tal's look, oldest first. */
function renderReview(review) {
  const block = el('section', 'rp-review');
  block.setAttribute('aria-label', 'Ready for review');
  block.appendChild(el('h2', 'rp-review-title', 'Ready for review'));
  if (!review.length) {
    block.appendChild(el('p', 'rp-review-empty', 'Nothing waiting for review.'));
    return block;
  }
  const list = el('ol', 'rp-review-list');
  for (const item of review) {
    const li = el('li', 'rp-review-item');
    const row = el('div', 'rp-row');
    row.appendChild(idButton(item.id));
    const since = shortDate(item.enteredAt);
    if (since) row.appendChild(el('span', 'rp-review-since', `since ${since}`));
    row.appendChild(el('span', 'rp-chip rp-chip-review', `${item.checks.done}/${item.checks.total} checked`));
    li.appendChild(row);
    li.appendChild(el('div', 'rp-title', item.title));
    const shipped = item.result?.shipped?.[0];
    if (shipped) li.appendChild(el('div', 'rp-why', truncate(shipped, SHIPPED_MAX)));
    const from = reviewOfNote(item.reviewOf);
    if (from) li.appendChild(from);
    for (const fu of item.followUps) {
      const line = el('div', 'rp-review-of', 'Follow-up: ');
      line.appendChild(idButton(fu.id, 'rp-link rp-review-id'));
      line.appendChild(document.createTextNode(` (${fu.section})`));
      li.appendChild(line);
    }
    list.appendChild(li);
  }
  block.appendChild(list);
  return block;
}

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
  const pick = card.model ? ` (pick ${card.model} in the model menu)` : '';
  showToast(folder ? `Opening Claude: ${card.command}${pick}` : `Opening Claude${pick} (set claudeSessionFolder in config.json to pick the folder)`);
}

function renderCard(card, phase) {
  const key = `${card.id}:${phase}`;
  const article = el('article', `rp-card rp-${card.state}`);
  article.setAttribute('aria-label', `${card.id} ${card.title}`);

  const row = el('div', 'rp-row');
  const coTasks = card.id === 'co-tasks';
  row.appendChild(card.state === 'pick' || card.isPrompt ? el('span', 'rp-id', coTasks ? 'Co-tasks' : 'Design') : idButton(card.id));
  const running = card.inProgress && (card.state === 'ready' || card.state === 'partial');
  row.appendChild(running
    ? el('span', 'rp-chip rp-chip-running', 'In progress')
    : el('span', `rp-chip rp-chip-${card.state}`, coTasks ? 'Your to-do' : (STATE_LABEL[card.state] || card.state)));
  article.appendChild(row);

  article.appendChild(el('div', 'rp-title', card.isRest ? `${card.title} (rest)` : card.title));
  const n = card.openTickets;
  article.appendChild(el('div', 'rp-items', `${n} open ${n === 1 ? 'ticket' : 'tickets'}`));
  const fromReview = reviewOfNote(findTicket(card.id)?.reviewOf);
  if (fromReview) article.appendChild(fromReview);
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
    // Start names the model to pick: the desktop app's link can't set it.
    toggle.textContent = !state && card.model ? `Start · ${card.model}` : TOGGLE_LABEL[state];
    toggle.title = card.model ? `Opens Claude with ${card.command}; pick ${card.model} in the model menu` : '';
    toggle.setAttribute('aria-pressed', state ? 'true' : 'false');
    toggle.setAttribute('aria-label', `${card.id} ${card.title}: ${state || 'not started'}${card.model ? `, model ${card.model}` : ''}. Activate to change`);
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

/** Cards sharing a step stack in one column; arrows sit between columns only. */
function appendCards(parent, cards, phase) {
  const steps = [...new Set(cards.map(c => c.step ?? 0))].sort((x, y) => x - y);
  steps.forEach((step, i) => {
    if (i > 0) {
      const arrow = el('span', 'rp-arrow', '→');
      arrow.setAttribute('aria-hidden', 'true');
      parent.appendChild(arrow);
    }
    const col = el('div', 'rp-col');
    cards.filter(c => (c.step ?? 0) === step).forEach(c => col.appendChild(renderCard(c, phase)));
    parent.appendChild(col);
  });
}

/** Words for the divider, as DOM: "after <epics> and your pick(s) <ids>". Ids are buttons. */
function renderDivider(waitsOn) {
  const { picks = [], epics = [] } = waitsOn || {};
  const divider = el('div', 'rp-picks');
  const label = el('div', 'rp-picks-label');
  if (!picks.length && !epics.length) {
    label.textContent = 'later';
    divider.appendChild(label);
    return divider;
  }
  const pickWord = picks.length > 1 ? 'your picks' : 'your pick';
  label.textContent = picks.length && !epics.length ? `after ${pickWord}` : 'after';
  divider.appendChild(label);
  const group = (ids, text) => {
    if (text) divider.appendChild(el('div', 'rp-picks-label', text));
    const stack = el('div', 'rp-picks-ids');
    ids.forEach(id => stack.appendChild(idButton(id, 'rp-link rp-picks-id')));
    divider.appendChild(stack);
  };
  if (epics.length) group(epics);
  if (picks.length) group(picks, epics.length ? `and ${pickWord}` : '');
  return divider;
}

function renderLane(lane, index) {
  const track = el('section', 'rp-track');
  track.setAttribute('aria-label', `Lane ${lane.name}`);
  const colorIdx = lane.lane === 'design' ? 'pick' : (index % LANE_COLORS) + 1;
  track.style.setProperty('--c', `var(--rp-c${colorIdx})`);

  const head = el('div', 'rp-head');
  head.appendChild(el('h3', 'rp-name', lane.name));
  head.appendChild(el('div', 'rp-note', lane.needsBuild ? 'Needs an app build' : 'No app build'));
  if (lane.lane !== 'design') {
    const epics = new Set([...lane.now, ...lane.later].map(c => c.id)).size;
    const open = [...lane.now, ...lane.later].reduce((n, c) => n + (c.openTickets || 0), 0);
    head.appendChild(el('div', 'rp-note rp-count',
      `${epics} ${epics === 1 ? 'epic' : 'epics'} · ${open} open ${open === 1 ? 'ticket' : 'tickets'}`));
  }
  if (lane.lane === 'unassigned') {
    head.appendChild(el('div', 'rp-note rp-hint', 'Give each a lane: ch tasks update <id> --lane <slug>'));
  }
  track.appendChild(head);

  const row = el('div', 'rp-lane');
  row.tabIndex = 0;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', `${lane.name} cards, in order`);
  appendCards(row, lane.now, 'now');
  if (lane.later.length) {
    row.appendChild(renderDivider(lane.waitsOn));
    appendCards(row, lane.later, 'later');
  }
  track.appendChild(row);
  return track;
}

/** Pinned epics that are finished: each id opens it, with the unpin command. */
function renderDoneNote(ids) {
  const note = el('p', 'rp-done-note', 'Done, still pinned: ');
  ids.forEach((id, i) => {
    if (i > 0) note.appendChild(document.createTextNode(', '));
    note.appendChild(idButton(id, 'rp-link rp-review-id'));
  });
  note.appendChild(document.createTextNode(` (unpin with ch tasks plan --unpin ${ids[0]})`));
  return note;
}

function renderRules(plan) {
  const rules = el('div', 'rp-rules');
  const pill = (bold, rest) => {
    const p = el('span', 'rp-rule');
    if (bold) p.appendChild(el('b', null, bold));
    p.appendChild(document.createTextNode(rest));
    rules.appendChild(p);
  };
  pill('Lanes run side by side', '; cards in a lane run left to right, cards stacked in one column can run at the same time');
  pill(`At most ${plan.machineCap} app builds at once`, ` (${plan.appStartCount} could start now)`);
  pill('Partly ready', ' = run it now, it stops at the design picks; run the same command again after your picks');
  return rules;
}

function renderLegend() {
  const legend = el('div', 'rp-legend');
  for (const [cls, text] of [['running', 'In progress'], ['ready', 'Ready now'], ['partial', 'Partly ready'], ['later', 'Later'], ['pick', 'Your picks and co-tasks']]) {
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

  root.appendChild(renderReview(plan.review || []));
  if (plan.lanes.length === 0) {
    root.appendChild(el('p', 'rp-empty', 'No pinned epics. Pin one with ch tasks plan --pin <id>'));
    return;
  }
  root.appendChild(renderRules(plan));
  root.appendChild(renderLegend());
  const tracks = el('div', 'rp-tracks');
  plan.lanes.forEach((lane, i) => tracks.appendChild(renderLane(lane, i)));
  root.appendChild(tracks);
  if (plan.doneEpics.length) root.appendChild(renderDoneNote(plan.doneEpics));
}

/** Re-render when tasks change (called from renderTasks); only if the tab is showing. */
export function refreshRunPlanView() {
  const panel = document.getElementById('runPlanPanel');
  if (panel?.classList.contains('active')) renderRunPlanView();
}
