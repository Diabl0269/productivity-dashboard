// hide-finished-switch.js — PRO150: the "Hide finished" switch, one setting (localStorage `checks.hideFinished`,
// default on) shown on the Checks tab heading and on the Plan page's For you heading, with a count beside it.

import { openCheckTickets } from '../../shared/open-checks.js';
import { reviewQueue, hiddenAsFinished } from '../../shared/review.js';
import { el } from './run-plan-util.js';

export const HIDE_FINISHED_KEY = 'checks.hideFinished';

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage off: still works for this visit */ } }

export const hideFinished = () => safeGet(HIDE_FINISHED_KEY) !== 'false';
export const setHideFinished = on => safeSet(HIDE_FINISHED_KEY, on ? 'true' : 'false');

/**
 * Finished tickets (every check ticked) as a number, whatever the switch says. AGE240: pass the For you
 * list's ask cards to count what that list hides: a review ticket with an unsent note or a decision card
 * is not finished there.
 */
export function finishedCount(doc, asks) {
  const rows = openCheckTickets(doc, { hideAllTicked: false }).filter(r => r.finished);
  if (!asks) return rows.length;
  const review = new Map(reviewQueue(doc).map(r => [r.id, r]));
  return rows.filter(r => !review.has(r.id) || hiddenAsFinished(review.get(r.id), asks)).length;
}

/** "3 finished hidden" / "3 finished shown"; '' when there are none. */
export function finishedCountText(n, on) {
  return n ? `${n} finished ${on ? 'hidden' : 'shown'}` : '';
}

export function buildSwitch(on, onToggle, id = 'checksHideFinished', title = '') {
  const sw = el('button', 'ht-switch ck-switch');
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', on ? 'true' : 'false');
  sw.id = id;
  if (title) sw.title = title;
  sw.append(el('span', 'ht-switch-track'), el('span', 'ht-switch-label', 'Hide finished'));
  sw.querySelector('.ht-switch-track').appendChild(el('span', 'ht-switch-knob'));
  sw.addEventListener('click', onToggle);
  return sw;
}

/** The switch and its count as one right-aligned group for a heading line. */
export function switchGroup(sw, n, on) {
  const group = el('div', 'ck-switch-group');
  const count = el('span', 'ck-switch-count', finishedCountText(n, on));
  count.setAttribute('aria-live', 'polite');
  group.append(count, sw);
  return group;
}
