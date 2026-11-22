// run-plan-util.js — small helpers the Plan page's modules share (run-plan-review, -notes-bar, -lanes,
// -hover, -page). No module state: everything a page owns lives on its ctx (run-plan-page.js).

import { threadLink } from '../../shared/run-plan.js';
import { idButton } from './ticket-id-button.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The ticket (dashboard shape) with this id in `state`, or null. */
export function findTicketIn(state, id) {
  for (const list of Object.values(state?.tasks || {})) {
    const task = (list || []).find(t => t.taskId === id);
    if (task) return task;
  }
  return null;
}

/** Section name a ticket sits in, or ''. */
export function sectionNameOf(state, id) {
  for (const [secId, list] of Object.entries(state?.tasks || {})) {
    if ((list || []).some(t => t.taskId === id)) return (state.sections || []).find(s => s.id === secId)?.title || secId;
  }
  return '';
}

/** "Co-task: pick the layout" -> "Pick the layout". */
export function plainTitle(title) {
  const t = String(title || '').replace(/^\s*co-task\s*:\s*/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const SHIPPED_MAX = 120;
export function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** First "What you'll notice" sentence of a ticket's description, else its first line. */
export function noticeLine(task) {
  const text = String(task?.description || '');
  const m = /What you'll notice:\*{0,2}\s*([^\n]+)/i.exec(text);
  const line = m ? m[1] : text.split('\n').find(l => l.trim() && !l.startsWith('#')) || '';
  const clean = line.replace(/\*\*/g, '').trim();
  return truncate(clean.charAt(0).toUpperCase() + clean.slice(1), 170);
}

/** "3 Oct" style short date from an ISO timestamp (empty when unparseable). */
export function shortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "Open thread" link to the Claude thread working on a ticket, or null when none is linked. */
export function threadAnchor(task) {
  const link = threadLink(task);
  if (!link) return null;
  const a = el('a', 'rp-canvas-link rp-thread-link', 'Open thread ↗');
  a.href = link.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = 'Open the Claude thread working on this ticket';
  return a;
}

/** "From review of <id>" note, or null when the ticket has none. */
export function reviewOfNote(reviewOf, className = 'rp-review-of') {
  if (!reviewOf) return null;
  const note = el('div', className, 'From review of ');
  note.appendChild(idButton(reviewOf, 'rp-link rp-review-id'));
  return note;
}

export async function copyText(text) {
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

/** A toast function bound to one element id (created on demand); each page passes its own id. */
export function makeToast(id) {
  let timer = null;
  return (message) => {
    let toast = document.getElementById(id);
    if (!toast) {
      toast = el('div', 'rp-toast');
      toast.id = id;
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('show'), 1600);
  };
}

/** PRO144: the prompt that refines a File-review stub epic. */
export function refinePrompt(card) {
  return `Refine epic ${card.id} (${card.title}): rewrite its stub description into a real In plain words section from its child tickets, then run /ship-task ${card.id}`;
}
