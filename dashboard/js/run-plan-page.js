// run-plan-page.js — one page's plan context (ctx) and the pieces both the Plan tab (run-plan-view.js)
// and Home's Lanes view (home-lanes.js) compose: the data step (toDoc -> computeRunPlan, asks, badge),
// the Auto queue and Ready blocks wired to this page's save and focus, and focus return after an Auto flip.
//
// ctx: { root, doc, readinessById, redraw, toast, openTicket, findTicket, getState, surface, scopes,
//        folds: { keyPrefix, idPrefix }, ui: { openReview, filingOpen, notesListOpen, openCompactNote,
//        openDrawer, pendingAutoFocus }, setEpicAuto }
// Each page makes its own ctx, so open cards, folds and pending focus never leak between pages.

import { computeRunPlan } from '../../shared/run-plan.js';
import { withAutoLabel } from '../../shared/epic-ready.js';
import { idButton } from './ticket-id-button.js';
import { commitReviewChange } from './task-detail.js';
import { stateToDoc as toDoc, renderReadyState } from './epic-ready-ui.js';
import { renderAutoQueue } from './auto-queue-ui.js';
import { asksFromState, checkMergedPrs, updateAsksBadge, setAskFiler } from './asks-strip.js';
import { interpretationsFromState } from './interpretation-card.js';
import { markChanged } from './tasks-io.js';
import { showStatus } from './state.js';
import { fileNotesOf } from './run-plan-notes-bar.js';
import { findTicketIn } from './run-plan-util.js';

/**
 * A page's plan context.
 * @param {{ getState: () => object, toast: (m: string) => void, openTicket: (id: string) => void,
 *           redraw?: () => void, surface?: string, keyPrefix?: string, idPrefix?: string,
 *           scopes?: { ready?: string, lane?: string } }} opts
 *   keyPrefix / idPrefix keep this page's fold state (localStorage) and fold element ids apart from
 *   another page's; the Plan tab passes none, so its keys and ids are the historic ones.
 */
export function createPlanCtx(opts) {
  const ctx = {
    getState: opts.getState,
    toast: opts.toast,
    openTicket: opts.openTicket,
    redraw: opts.redraw || (() => {}),
    surface: opts.surface || 'plan',
    scopes: { ready: '.rp-ready', lane: '.rp-tracks', ...(opts.scopes || {}) },
    folds: { keyPrefix: opts.keyPrefix || '', idPrefix: opts.idPrefix || '' },
    root: null,
    doc: null,
    readinessById: new Map(),
    ui: { openReview: new Set(), filingOpen: false, notesListOpen: false, openCompactNote: new Set(), openDrawer: null, pendingAutoFocus: null },
    findTicket: id => findTicketIn(ctx.getState?.(), id),
    setEpicAuto: (r, on, where) => setEpicAuto(ctx, r, on, where),
  };
  return ctx;
}

/**
 * The data step of a draw: doc and plan for this page, the decision cards (with the badge and the
 * merged-PR check), the interpretation cards. Sets ctx.root, ctx.doc and ctx.readinessById.
 */
export function preparePlan(ctx, root, state) {
  ctx.root = root;
  ctx.doc = toDoc(state);
  const plan = computeRunPlan(ctx.doc);
  setAskFiler(id => fileNotesOf(ctx, id)); // here, not at import time: the modules import each other
  const asks = asksFromState(state);
  updateAsksBadge(asks.length);
  checkMergedPrs(state, asks, ctx.redraw);
  ctx.readinessById = new Map((plan.readiness || []).map(r => [r.id, r]));
  return { plan, asks, interps: interpretationsFromState(state) };
}

/** Flip an epic's Auto label through the normal save; the redraw updates the queue and any open epic window. */
function setEpicAuto(ctx, r, on, where) {
  const task = ctx.findTicket(r.id);
  if (!task) { ctx.toast(`Ticket ${r.id} not found`); return; }
  task.labels = withAutoLabel(task.labels, on);
  ctx.ui.pendingAutoFocus = { id: r.id, where };
  showStatus(`${r.id}: Auto ${on ? 'on' : 'off'}`);
  commitReviewChange(task);
}

/** Write a queue move: set autoPriority / autoRank on each changed epic ('normal' = no field), save and redraw. */
function applyQueueChanges(ctx, changes, note) {
  const tasks = changes.map(c => ({ c, task: ctx.findTicket(c.id) })).filter(x => x.task);
  ctx.ui.queueNote = note; // a redraw that comes later (Home redraws after the save) still says it
  tasks.forEach(({ c, task }, i) => {
    task.autoPriority = c.priority === 'normal' ? null : c.priority;
    task.autoRank = c.autoRank;
    if (i < tasks.length - 1) markChanged(task);
    else commitReviewChange(task);
  });
  showStatus(note);
  const live = (ctx.root || document).querySelector('.rp-aq-live');
  if (live) live.textContent = note;
}

const chipId = id => idButton(id, 'rp-link rp-chip-id');

/**
 * The Auto queue block. `shows(id)` (optional) narrows the rows shown; moves are still made in
 * the whole queue so the epics left out keep their places.
 */
export function renderPlanAutoQueue(ctx, readiness, shows) {
  const sec = renderAutoQueue(readiness, {
    idButton: chipId,
    openTicket: ctx.openTicket,
    redraw: ctx.redraw,
    apply: (changes, note) => applyQueueChanges(ctx, changes, note),
    shows,
  });
  const live = sec.querySelector('.rp-aq-live');
  if (live && ctx.ui.queueNote) live.textContent = ctx.ui.queueNote;
  ctx.ui.queueNote = null;
  return sec;
}

/** The Ready state block (Ready epics, Not-ready ones folded), with this page's fold key and id. */
export function renderPlanReady(ctx, readiness) {
  return renderReadyState(readiness, chipId, ctx.setEpicAuto, ctx.folds);
}

/** After a switch redraws the page, put focus back on the same switch (same place on the page). */
export function restoreAutoFocus(ctx, root) {
  if (!ctx.ui.pendingAutoFocus) return;
  const { id, where } = ctx.ui.pendingAutoFocus;
  ctx.ui.pendingAutoFocus = null;
  const scope = where === 'ready' ? ctx.scopes.ready : ctx.scopes.lane;
  root.querySelector(`${scope} [data-auto-toggle="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}
