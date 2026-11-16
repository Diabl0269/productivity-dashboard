// run-plan-view.js — "Plan" tab: review, Auto queue, Ready state, then in-progress, Ready and pinned epics as lanes (rows); see shared/run-plan.js
// The renderers live in run-plan-review.js, run-plan-notes-bar.js, run-plan-lanes.js and run-plan-hover.js,
// shared with Home's Lanes view (home-lanes.js); this file composes them for the Plan tab with its own ctx.

import { fillEpicEstimates } from './ticket-cost-ui.js';
import { setTicketLookup, openTicket } from './ticket-id-button.js';
import { renderNextStartLine } from './next-start-line.js';
import { createPlanCtx, preparePlan, renderPlanAutoQueue, renderPlanReady, restoreAutoFocus } from './run-plan-page.js';
import { renderReview } from './run-plan-review.js';
import { renderRules, renderLegend, renderTotals, renderTracks, renderDoneNote } from './run-plan-lanes.js';
import { installHover, hidePreview } from './run-plan-hover.js';
import { el, makeToast } from './run-plan-util.js';

let getState = null;
const showToast = makeToast('runPlanToast');

// The Plan tab's own page state (open cards, folds, pending focus): see run-plan-page.js.
const page = createPlanCtx({
  getState: () => getState?.(),
  toast: showToast,
  openTicket,
  redraw: () => renderRunPlanView(),
});

export function setRunPlanStateGetter(fn) { getState = fn; setTicketLookup(fn, showToast); }

export function renderRunPlanView() {
  const root = document.getElementById('runPlanMain');
  if (!root) return;
  root.textContent = '';
  installHover(root, () => getState?.());
  hidePreview();
  const state = getState?.();
  if (!state?.tasks) {
    root.appendChild(el('p', 'rp-empty', 'Load tasks to see the plan.'));
    return;
  }
  const { plan, asks, interps } = preparePlan(page, root, state);
  root.appendChild(renderReview(page, plan.review || [], plan.openChecks || [], asks, interps));
  root.appendChild(renderNextStartLine());
  root.appendChild(renderPlanAutoQueue(page, plan.readiness || []));
  root.appendChild(renderPlanReady(page, plan.readiness || []));
  if (plan.lanes.length === 0) {
    root.appendChild(el('p', 'rp-empty', 'No epic is in progress or Ready, and none is pinned.'));
    return;
  }
  root.appendChild(renderRules(plan));
  root.appendChild(renderLegend());
  if (plan.totals) root.appendChild(renderTotals(plan.totals));
  root.appendChild(renderTracks(page, plan.lanes, plan.picks));
  if (plan.doneEpics.length) root.appendChild(renderDoneNote(plan.doneEpics));
  fillEpicEstimates(root);
  restoreAutoFocus(page, root);
}

/** Re-render when tasks change (called from renderTasks); only if the tab is showing. */
export function refreshRunPlanView() {
  const panel = document.getElementById('runPlanPanel');
  if (panel?.classList.contains('active')) renderRunPlanView();
}
