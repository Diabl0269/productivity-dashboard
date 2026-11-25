// run-plan-lanes.js — the lanes of the Plan page (and Home's Lanes view): rules and legend pills, each
// lane with its cards in order, the "after ..." divider, the design-lane drawer, the Later fold and the
// "Done, still pinned" note. Takes the page's ctx (run-plan-page.js): the open drawer lives on ctx.ui.

import { claudeCodeSessionUrl } from '../../shared/claude-deeplink.js';
import { totalsLine } from '../../shared/run-plan.js';
import { readAiProvider, readDefaultFolder, launchWithProvider } from './claude-launch.js';
import { idButton } from './ticket-id-button.js';
import { buildAutoToggle } from './epic-ready-ui.js';
import { renderLaterFold } from './run-plan-later.js';
import { renderReasonBlock, promoteButton, textWithIdButtons } from './run-plan-reasons.js';
import { el, plainTitle, truncate, threadAnchor, reviewOfNote, copyText, refinePrompt } from './run-plan-util.js';

const STATE_LABEL = { backlog: 'In backlog', ready: 'Ready now', partial: 'Partly ready', later: 'Later', notready: 'Not ready', pick: 'Your pick' };
const LANE_COLORS = 4; // --rp-c1..4; the design lane uses the pick colour
const PROGRESS_KEY = 'runPlanProgress';

// ----- Start -> Started -> Done progress, kept in localStorage (best effort; shared by every page) -----
function readProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; }
}
function writeProgress(map) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(map)); } catch { /* storage unavailable */ }
}
const NEXT = { '': 'started', started: 'done', done: '' };
const TOGGLE_LABEL = { '': 'Start', started: 'Started', done: 'Done' };

/** Start: open the configured AI provider (Claude Desktop or Antigravity CLI) with this card's command. */
function openClaudeSession(ctx, card) {
  const provider = readAiProvider();
  const folder = window.dashboardConfig?.claudeSessionFolder || readDefaultFolder();
  if (provider === 'gemini') {
    if (!launchWithProvider({ aiProvider: 'gemini', prompt: card.command, folder })) return;
    const pick = card.model ? ` (orchestrator: ${card.model})` : '';
    ctx.toast(folder ? `Opening Antigravity: ${card.command}${pick}` : `Opening Antigravity${pick} (set claudeSessionFolder in config.json to pick the folder)`);
    return;
  }
  const url = claudeCodeSessionUrl(card.command, folder);
  if (!url) return;
  window.location.assign(url);
  const pick = card.model ? ` (pick ${card.model} in the model menu)` : '';
  ctx.toast(folder ? `Opening Claude: ${card.command}${pick}` : `Opening Claude${pick} (set claudeSessionFolder in config.json to pick the folder)`);
}

function renderCard(ctx, card, phase) {
  const key = `${card.id}:${phase}`;
  const article = el('article', `rp-card rp-${card.state}`);
  article.setAttribute('aria-label', `${card.id} ${card.title}`);
  if (!card.ticketIds) article.dataset.ticket = card.id;

  const row = el('div', 'rp-row');
  const coTasks = card.id === 'co-tasks';
  row.appendChild(card.state === 'pick' || card.isPrompt ? el('span', 'rp-id', coTasks ? 'Co-tasks' : 'Design') : idButton(card.id));
  const running = card.inProgress && (card.state === 'ready' || card.state === 'partial');
  row.appendChild(running
    ? el('span', 'rp-chip rp-chip-running', 'In progress')
    : el('span', `rp-chip rp-chip-${card.state}`, coTasks ? 'Your to-do' : (STATE_LABEL[card.state] || card.state)));
  if (card.state === 'later' && card.ready) {
    row.appendChild(el('span', 'rp-chip rp-chip-ready', card.auto ? 'Ready · Auto' : 'Ready'));
  }
  if (card.unrefined) row.appendChild(el('span', 'rp-chip rp-chip-unrefined', 'Not refined'));
  if (card.model) row.appendChild(el('span', 'rp-chip rp-chip-model', `Orchestrator: ${card.model}`));
  article.appendChild(row);

  article.appendChild(el('div', 'rp-title', card.isRest ? `${card.title} (rest)` : card.title));
  const n = card.openTickets;
  const countText = `${n} open ${n === 1 ? 'ticket' : 'tickets'}`;
  if (card.ticketIds) {
    const open = ctx.ui.openDrawer === card.id;
    const count = el('button', 'rp-btn rp-count-btn', `${countText} ${open ? '▴' : '▾'}`);
    count.type = 'button';
    count.setAttribute('aria-expanded', open ? 'true' : 'false');
    count.title = open ? 'Hide the ticket list' : 'Show these tickets';
    count.addEventListener('click', () => {
      ctx.ui.openDrawer = ctx.ui.openDrawer === card.id ? null : card.id;
      ctx.redraw();
    });
    article.appendChild(count);
    const ids = el('div', 'rp-ids');
    card.ticketIds.forEach(id => ids.appendChild(idButton(id, 'rp-link rp-chip-id')));
    article.appendChild(ids);
  } else {
    article.appendChild(el('div', 'rp-items', countText));
    if (card.state !== 'pick' && !card.isPrompt) {
      const cost = el('div', 'rp-items rp-cost');
      cost.dataset.estEpic = card.id;
      cost.hidden = true;
      article.appendChild(cost);
    }
  }
  const fromReview = reviewOfNote(ctx.findTicket(card.id)?.reviewOf);
  if (fromReview) article.appendChild(fromReview);
  if (card.state === 'notready' && card.reasons?.length) {
    renderReasonBlock(card, id => idButton(id, 'rp-link rp-chip-id'), ctx.redraw, ctx.folds).forEach(n => article.appendChild(n));
  } else if (card.stuckBlockers?.length) {
    // PRO151: Ready · Auto, but what it waits on will not start by itself: amber line, ids as buttons, the same Move to To do button.
    const line = el('div', 'rp-why rp-why-warn');
    line.dataset.stuckBlockers = card.stuckBlockers.join(',');
    line.appendChild(textWithIdButtons(card.why, card.stuckBlockers, id => idButton(id, 'rp-link rp-chip-id'), ''));
    article.appendChild(line);
    if ((card.promoteIds || []).length) article.appendChild(promoteButton(card.promoteIds, card.id, ctx.redraw));
  } else if (card.why && !(card.ticketIds && /^(Picks|Co-tasks): /.test(card.why))) article.appendChild(el('div', 'rp-why', card.why));

  const actions = el('div', 'rp-actions');
  const autoR = !card.ticketIds && card.state !== 'pick' && !card.isPrompt ? ctx.readinessById.get(card.id) : null;
  if (autoR) actions.appendChild(buildAutoToggle(autoR, on => ctx.setEpicAuto(autoR, on, 'lane')));
  if (card.command) {
    const copy = el('button', 'rp-btn rp-cmd', card.isPrompt ? 'Copy prompt' : card.command);
    copy.type = 'button';
    copy.title = card.command;
    copy.setAttribute('aria-label', card.isPrompt ? 'Copy the design prompt' : `Copy command ${card.command}`);
    copy.addEventListener('click', async () => {
      const ok = await copyText(card.command);
      ctx.toast(ok ? (card.isPrompt ? 'Copied the design prompt' : `Copied: ${card.command}`) : `Copy blocked: ${card.command}`);
    });
    actions.appendChild(copy);
  }
  if (card.unrefined) {
    const prompt = refinePrompt(card);
    const refine = el('button', 'rp-btn rp-refine', 'Copy refine prompt');
    refine.type = 'button';
    refine.title = prompt;
    refine.setAttribute('aria-label', `Copy the refine prompt for ${card.id}`);
    refine.addEventListener('click', async () => {
      const ok = await copyText(prompt);
      ctx.toast(ok ? `Copied the refine prompt for ${card.id}` : `Copy blocked: ${prompt}`);
    });
    actions.appendChild(refine);
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
    if (prev === '' && state === 'started') openClaudeSession(ctx, card);
    const map = readProgress();
    if (state) map[key] = state; else delete map[key];
    writeProgress(map);
    apply();
  });
  apply();
  actions.appendChild(toggle);
  const thread = card.ticketIds ? null : threadAnchor(ctx.findTicket(card.id));
  if (thread) actions.appendChild(thread);
  article.appendChild(actions);
  return article;
}

/** Cards sharing a step stack in one column; arrows sit between columns only. */
function appendCards(ctx, parent, cards, phase) {
  const steps = [...new Set(cards.map(c => c.step ?? 0))].sort((x, y) => x - y);
  steps.forEach((step, i) => {
    if (i > 0) {
      const arrow = el('span', 'rp-arrow', '→');
      arrow.setAttribute('aria-hidden', 'true');
      parent.appendChild(arrow);
    }
    const col = el('div', 'rp-col');
    cards.filter(c => (c.step ?? 0) === step).forEach(c => col.appendChild(renderCard(ctx, c, phase)));
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

const STAGE_LABEL = { draw: 'Canvas to draw', pick: 'Waiting for your pick', publish: 'Pick made, publish it', todo: 'Your to-do' };

/** Ticket list under the design lane: id, title, epic it belongs to, and its canvas once linked. */
function renderDrawer(ctx, card, picks) {
  const drawer = el('div', 'rp-drawer');
  drawer.setAttribute('role', 'region');
  drawer.setAttribute('aria-label', `${card.title}: tickets`);
  drawer.appendChild(el('div', 'rp-drawer-title', card.title));
  const list = el('ul', 'rp-drawer-list');
  const rows = card.ticketIds.map(id => picks.find(p => p.id === id)).filter(Boolean);
  for (const p of rows) {
    const li = el('li', 'rp-drawer-row');
    li.dataset.ticket = p.id;
    li.appendChild(idButton(p.id));
    li.appendChild(el('span', 'rp-drawer-name', plainTitle(p.title)));
    const epic = el('span', 'rp-drawer-epic');
    if (p.epic) {
      epic.appendChild(document.createTextNode('in '));
      epic.appendChild(idButton(p.epic, 'rp-link rp-review-id'));
      epic.appendChild(document.createTextNode(` ${truncate(ctx.findTicket(p.epic)?.title || '', 48)}`));
    }
    li.appendChild(epic);
    li.appendChild(el('span', `rp-chip rp-chip-${p.stage === 'todo' ? 'pick' : 'later'}`, STAGE_LABEL[p.stage] || p.stage));
    if (p.canvas) {
      const a = el('a', 'rp-canvas-link', 'Open canvas ↗');
      a.href = p.canvas.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
    } else if (p.stage !== 'todo') {
      li.appendChild(el('span', 'rp-no-canvas', 'No canvas yet'));
    }
    list.appendChild(li);
  }
  drawer.appendChild(list);
  return drawer;
}

/** One lane: head (name, build note, counts, epic ids), its cards in order, the Later fold, the drawer. */
export function renderLane(ctx, lane, index, picks) {
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
      `${epics} ${epics === 1 ? 'epic' : 'epics'} · ${open} open ${open === 1 ? 'ticket' : 'tickets'}${lane.laterEpics?.length ? ` · ${lane.laterEpics.length} later` : ''}`));
  }
  if (lane.lane !== 'design') {
    const epicIds = [...new Set([...lane.now, ...lane.later].map(c => c.id))];
    const wrap = el('div', 'rp-lane-epics');
    epicIds.forEach(id => wrap.appendChild(idButton(id, 'rp-link rp-chip-id')));
    head.appendChild(wrap);
  }
  if (lane.lane === 'unassigned') {
    head.appendChild(el('div', 'rp-note rp-hint', 'Give each a lane: ch tasks update <id> --lane <slug>'));
  }
  track.appendChild(head);

  const row = el('div', 'rp-lane');
  row.tabIndex = 0;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', `${lane.name} cards, in order`);
  appendCards(ctx, row, lane.now, 'now');
  if (lane.later.length) {
    row.appendChild(renderDivider(lane.waitsOn));
    appendCards(ctx, row, lane.later, 'later');
  }
  const body = el('div', 'rp-lane-body');
  body.appendChild(row);
  const laterFold = renderLaterFold(lane, id => idButton(id), ctx.redraw, ctx.folds);
  if (laterFold) body.appendChild(laterFold);
  track.appendChild(body);
  const openCard = lane.lane === 'design' && lane.now.find(c => c.ticketIds && c.id === ctx.ui.openDrawer);
  if (openCard) track.appendChild(renderDrawer(ctx, openCard, picks));
  return track;
}

/** Pinned epics that are finished: each id opens it, with the unpin command. */
export function renderDoneNote(ids) {
  const note = el('p', 'rp-done-note', 'Done, still pinned: ');
  ids.forEach((id, i) => {
    if (i > 0) note.appendChild(document.createTextNode(', '));
    note.appendChild(idButton(id, 'rp-link rp-review-id'));
  });
  note.appendChild(document.createTextNode(` (unpin with ch tasks plan --unpin ${ids[0]})`));
  return note;
}

export function renderRules(plan) {
  const rules = el('div', 'rp-rules');
  const pill = (bold, rest) => {
    const p = el('span', 'rp-rule');
    if (bold) p.appendChild(el('b', null, bold));
    p.appendChild(document.createTextNode(rest));
    rules.appendChild(p);
  };
  pill('Epics in one lane run in order; lanes run side by side', '. Cards in a lane run left to right, cards stacked in one column can run at the same time');
  pill(`At most ${plan.machineCap} app builds at once`, ` (${plan.appStartCount} could start now)`);
  pill('Partly ready', ' = run it now, it stops at the design picks; run the same command again after your picks');
  return rules;
}

export function renderLegend() {
  const legend = el('div', 'rp-legend');
  for (const [cls, text] of [['running', 'In progress'], ['ready', 'Ready now'], ['partial', 'Partly ready'], ['later', 'Later'], ['notready', 'Not ready'], ['pick', 'Your picks and co-tasks']]) {
    const item = el('span');
    item.appendChild(el('span', `rp-dot rp-dot-${cls}`));
    item.appendChild(document.createTextNode(text));
    legend.appendChild(item);
  }
  return legend;
}

/** PRO84: the line saying whether every open epic is on the page. */
export function renderTotals(totals) {
  const t = totalsLine(totals);
  const line = el('p', t.ok ? 'rp-totals' : 'rp-totals rp-totals-warn', t.text);
  line.dataset.totals = t.ok ? 'ok' : 'missing';
  return line;
}

/** Every lane as one .rp-tracks block; a lane's colour comes from `lane.index` when set (its place in the whole plan). */
export function renderTracks(ctx, lanes, picks) {
  const tracks = el('div', 'rp-tracks');
  lanes.forEach((lane, i) => tracks.appendChild(renderLane(ctx, lane, lane.index ?? i, picks || [])));
  return tracks;
}
