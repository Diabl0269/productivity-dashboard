// checks-view.js — PRO143 "Checks" tab: every ticket with a check only Tal can tick, as the same rows the
// Plan page's For you list uses (renderReviewList). Data: shared/open-checks.js. Decision cards do not show here.

import { openCheckTickets, checksPageCounts } from '../../shared/open-checks.js';
import { openTicket } from './ticket-id-button.js';
import { stateToDoc } from './epic-ready-ui.js';
import { createPlanCtx, preparePlan } from './run-plan-page.js';
import { renderReviewList } from './run-plan-review.js';
import { el, makeToast } from './run-plan-util.js';

const KEY = 'checks.hideFinished';
const LEAVE_MS = 200;

let getState = null;
let pending = false; // a leaving row is animating out; the render follows it
const seen = new Set(); // rows already opened once, so the user's own collapse sticks
const toast = makeToast('checksToast');

const page = createPlanCtx({
  getState: () => getState?.(),
  toast,
  openTicket,
  redraw: () => redrawChecks(),
  surface: 'checks',
  keyPrefix: 'checks-',
  idPrefix: 'checks-',
});

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage off: still works for this visit */ } }

const hideFinished = () => safeGet(KEY) !== 'false';
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function setChecksStateGetter(fn) { getState = fn; }

function buildSwitch(on, onToggle) {
  const sw = el('button', 'ht-switch ck-switch');
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', on ? 'true' : 'false');
  sw.id = 'checksHideFinished';
  sw.append(el('span', 'ht-switch-track'), el('span', 'ht-switch-label', 'Hide finished'));
  sw.querySelector('.ht-switch-track').appendChild(el('span', 'ht-switch-knob'));
  sw.addEventListener('click', onToggle);
  return sw;
}

/** ArrowDown / ArrowUp / Home / End move between tickets' "n/m checked" buttons. */
function installListKeys(list) {
  list.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    if (!e.target.closest?.('.rp-chip-toggle, .rp-id')) return;
    const lis = [...list.querySelectorAll(':scope > li')];
    const at = lis.indexOf(e.target.closest('li'));
    if (at < 0) return;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? lis.length - 1 : at + (e.key === 'ArrowDown' ? 1 : -1);
    const target = lis[next]?.querySelector('.rp-chip-toggle');
    e.preventDefault();
    if (target) target.focus();
  });
}

function markRows(list, rows, previous) {
  const lis = [...list.querySelectorAll(':scope > li')];
  rows.forEach((row, i) => {
    const li = lis[i];
    if (!li) return;
    li.dataset.ckId = row.id;
    if (row.finished) {
      li.classList.add('ck-finished');
      li.querySelector('.rp-row')?.appendChild(el('span', 'rp-chip ck-finished-chip', 'All ticked, waits for the notes run'));
    }
    if (previous.size && !previous.has(row.id) && !reducedMotion()) {
      li.classList.add('ck-entering');
      void li.offsetHeight;
      requestAnimationFrame(() => li.classList.remove('ck-entering'));
    }
  });
}

export function renderChecksView(opts = {}) {
  const root = document.getElementById('checksMain');
  if (!root) return;
  const previous = new Set([...root.querySelectorAll('li[data-ck-id]')].map(li => li.dataset.ckId));
  root.textContent = '';
  const state = getState?.();
  if (!state?.tasks) {
    root.appendChild(el('p', 'rp-empty', 'Load tasks to see the checks.'));
    return;
  }
  preparePlan(page, root, state);
  const hide = hideFinished();
  const rows = openCheckTickets(page.doc, { hideAllTicked: hide });
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    page.ui.openReview.add(row.id);
  }
  const counts = checksPageCounts(rows);
  const heading = el('h2', 'ck-title', `Checks (${counts.tickets})`);
  heading.title = `${counts.open} check${counts.open === 1 ? '' : 's'} still to tick`;
  root.appendChild(heading);
  root.appendChild(el('p', 'ck-hint', 'Tickets with a check only you can tick. Finished ones wait for the next notes run.'));
  const bar = el('div', 'ck-toolbar');
  bar.appendChild(buildSwitch(hide, () => {
    safeSet(KEY, hide ? 'false' : 'true');
    redrawChecks({ focusSwitch: true });
  }));
  root.appendChild(bar);
  if (!rows.length) {
    let text = 'No open checks. Everything you were asked to look at is ticked.';
    if (hide) {
      const hidden = openCheckTickets(page.doc, { hideAllTicked: false }).filter(r => r.finished).length;
      if (hidden) text += ` ${hidden} finished hidden.`;
    }
    root.appendChild(el('p', 'rp-empty ck-empty', text));
  } else {
    const list = renderReviewList(page, rows, [], []);
    installListKeys(list);
    root.appendChild(list);
    markRows(list, rows, previous);
  }
  if (opts.focusSwitch) root.querySelector('.ck-switch')?.focus();
}

/** A redraw after a tick or tasks change: rows about to disappear fade out first, then the page renders. */
function redrawChecks(opts = {}) {
  if (pending) return;
  const root = document.getElementById('checksMain');
  const state = getState?.();
  if (!root || !state?.tasks) { renderChecksView(opts); return; }
  const next = new Set(openCheckTickets(stateToDoc(state), { hideAllTicked: hideFinished() }).map(r => r.id));
  const leavers = [...root.querySelectorAll('li[data-ck-id]')].filter(li => !next.has(li.dataset.ckId));
  if (!leavers.length || reducedMotion()) { renderChecksView(opts); return; }
  pending = true;
  let timer = null;
  const finish = () => {
    if (!pending) return;
    pending = false;
    clearTimeout(timer);
    renderChecksView(opts);
  };
  for (const li of leavers) {
    li.style.maxHeight = `${li.offsetHeight}px`;
    void li.offsetHeight;
    li.classList.add('ck-leaving');
  }
  leavers[0].addEventListener('transitionend', finish, { once: true });
  timer = setTimeout(finish, LEAVE_MS);
}

/** Re-render when tasks change (called from renderTasks); only if the tab is showing. */
export function refreshChecksView() {
  const panel = document.getElementById('checksPanel');
  if (panel?.classList.contains('active')) redrawChecks();
}
