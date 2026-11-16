// run-plan-hover.js — hover / focus preview of a ticket id and the same-ticket highlight, delegated and
// installed once per render root (the Plan page's and Home's Lanes view's). One tooltip on the page.

import { el, findTicketIn, sectionNameOf, plainTitle, noticeLine, truncate } from './run-plan-util.js';

let previewEl = null;

export function hidePreview() { if (previewEl) previewEl.hidden = true; }

function showPreview(btn, state) {
  const id = btn.dataset.ticket;
  const task = findTicketIn(state, id);
  if (!task) return;
  if (!previewEl) {
    previewEl = el('div', 'rp-preview');
    previewEl.setAttribute('role', 'tooltip');
    document.body.appendChild(previewEl);
  }
  previewEl.textContent = '';
  const head = el('div', 'rp-preview-head');
  head.appendChild(el('b', null, id));
  const sec = sectionNameOf(state, id);
  if (sec) head.appendChild(el('span', 'rp-preview-sec', sec));
  previewEl.appendChild(head);
  previewEl.appendChild(el('div', 'rp-preview-title', plainTitle(task.title)));
  const epic = task.parentId ? findTicketIn(state, task.parentId) : null;
  if (epic) previewEl.appendChild(el('div', 'rp-preview-line', `In ${task.parentId}: ${truncate(epic.title || '', 70)}`));
  const notice = noticeLine(task);
  if (notice) previewEl.appendChild(el('div', 'rp-preview-line', notice));
  const canvas = (task.links || []).find(l => /design canvas/i.test(l.label || ''));
  previewEl.appendChild(el('div', 'rp-preview-line', canvas ? 'Canvas linked' : (task.links?.length ? `${task.links.length} link${task.links.length > 1 ? 's' : ''}` : '')));
  previewEl.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = previewEl.offsetWidth;
  const h = previewEl.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const top = r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
  previewEl.style.left = `${left}px`;
  previewEl.style.top = `${top}px`;
}

function highlight(root, id, on) {
  root.querySelectorAll('[data-ticket]').forEach(n => {
    if (n.dataset.ticket === id) n.classList.toggle('rp-hl', on);
  });
}

/** Install the delegated listeners on `root` once; `getState()` gives the tasks to preview. */
export function installHover(root, getState) {
  if (root.dataset.rpHover) return;
  root.dataset.rpHover = '1';
  const target = e => e.target.closest?.('[data-ticket]');
  const enter = e => {
    const t = target(e);
    if (!t) return;
    highlight(root, t.dataset.ticket, true);
    if (t.tagName === 'BUTTON') showPreview(t, getState?.());
  };
  const leave = e => {
    const t = target(e);
    if (!t) return;
    highlight(root, t.dataset.ticket, false);
    hidePreview();
  };
  root.addEventListener('mouseover', enter);
  root.addEventListener('mouseout', leave);
  root.addEventListener('focusin', enter);
  root.addEventListener('focusout', leave);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hidePreview(); });
}
