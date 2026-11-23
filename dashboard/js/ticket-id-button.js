// A ticket id as a button that opens the ticket modal (PRO108). Shared by the Plan page,
// the ticket modal's check list and the ask cards. Tasks are looked up through the getter that
// tasks-main registers (via setRunPlanStateGetter), so no caller passes state around.

import { openTaskDetail } from './task-detail.js';

let getState = null;
let onMissing = null;

/** Register the dashboard-state getter and what to do when an id has no ticket. */
export function setTicketLookup(getter, missing) { getState = getter; onMissing = missing; }

/** Open a ticket's detail in place (no navigation); tells the user if the ticket is gone. */
export function openTicket(id) {
  for (const list of Object.values(getState?.()?.tasks || {})) {
    const task = (list || []).find(t => t.taskId === id);
    if (task) { openTaskDetail(task); return; }
  }
  onMissing?.(`Ticket ${id} not found`);
}

/** Is there a ticket with this id on the page? (MP3 or A4 in a check's text are not tickets.) */
export function ticketExists(id) {
  return Object.values(getState?.()?.tasks || {}).some(list => (list || []).some(t => t.taskId === id));
}

const TEXT_ID_RE = /\b[A-Z]{1,4}\d+\b/g; // same shape as shared/running.js ID_RE

/**
 * FRO2246: free text (a check, a question) as a span whose ticket ids are idButtons, so a ticket id named
 * inside a check opens that ticket. Ids with no ticket stay plain text.
 */
export function textWithIds(text, className = null, idClass = 'rp-link rp-text-id') {
  const span = document.createElement('span');
  if (className) span.className = className;
  const s = String(text ?? '');
  let last = 0;
  for (const m of s.matchAll(TEXT_ID_RE)) {
    if (!ticketExists(m[0])) continue;
    if (m.index > last) span.appendChild(document.createTextNode(s.slice(last, m.index)));
    span.appendChild(idButton(m[0], idClass));
    last = m.index + m[0].length;
  }
  if (last < s.length) span.appendChild(document.createTextNode(s.slice(last)));
  return span;
}

/** A ticket id as a button that opens the ticket. */
export function idButton(id, className = 'rp-id rp-link') {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = id;
  btn.type = 'button';
  btn.title = `Open ${id}`;
  btn.setAttribute('aria-label', `Open ticket ${id}`);
  btn.dataset.ticket = id;
  btn.addEventListener('click', () => openTicket(id));
  return btn;
}
