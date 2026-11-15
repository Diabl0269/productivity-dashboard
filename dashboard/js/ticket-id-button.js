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
