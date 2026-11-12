// asks-strip.js — "Asks for you (N)": every question a session left for Tal (PRO73), on the Plan page
// above Ready for review and as an Overview widget, plus the count in the tab title, favicon and Plan tab.
// Rows come from shared/asks.js (new asks and older Left / needs-tal lines). Answer / Done / Dismiss
// change the ticket in the dashboard state and save through commitReviewChange, the same path as a
// ticked review check (markChanged -> autosave -> /api/save, three-way merged on a conflict).

import { openAsks, resolveAsk, closeMergedAsks } from '../../shared/asks.js';
import { stateToDoc } from './epic-ready-ui.js';
import { openTaskDetail, commitReviewChange } from './task-detail.js';

// The answer box that is open ("<id>#<key>") and its drafts survive re-renders.
const answering = new Map(); // surface ('plan' | 'overview') -> "<id>#<key>"
const drafts = new Map();
// Merge-ask PR links already asked of the server this page load.
const prChecked = new Set();

const KIND_LABEL = { ask: 'Question', merge: 'Merge', question: 'Question', taste: 'To judge' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(text, className, onClick, title) {
  const b = el('button', className, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function shortDate(value) {
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The dashboard ticket with this id, or null. */
function findTicket(state, id) {
  for (const list of Object.values(state?.tasks || {})) {
    const task = (list || []).find(t => t.taskId === id);
    if (task) return task;
  }
  return null;
}

/** Every open ask in the dashboard state (see shared/asks.js openAsks). */
export function asksFromState(state) {
  if (!state?.tasks) return [];
  return openAsks(stateToDoc(state));
}

/** Resolve one ask on its ticket and save. Returns true when it changed. */
function resolveRow(state, row, action, reply, redraw) {
  const task = findTicket(state, row.id);
  if (!task) return false;
  try {
    resolveAsk(task, row.key, { action, reply });
  } catch (e) {
    window.alert?.(e.message);
    return false;
  }
  const handle = `${row.id}#${row.key}`;
  drafts.delete(handle);
  for (const [surface, h] of answering) if (h === handle) answering.delete(surface);
  commitReviewChange(task);
  redraw?.();
  return true;
}

/** Inline answer box: Enter saves, Shift+Enter adds a line, Escape closes. */
function answerBox(state, row, redraw, surface) {
  const handle = `${row.id}#${row.key}`;
  const wrap = el('div', 'rp-ask-answer');
  const box = el('textarea', 'rp-ask-input');
  box.rows = 2;
  box.placeholder = 'Your answer. Enter saves, Shift+Enter for a new line';
  box.setAttribute('aria-label', `Answer to ${row.id}: ${row.text}`);
  box.value = drafts.get(handle) || '';
  box.addEventListener('input', () => drafts.set(handle, box.value));
  const save = () => {
    if (!box.value.trim()) { box.focus(); return; }
    resolveRow(state, row, 'answer', box.value, redraw);
  };
  const cancel = () => { answering.delete(surface); redraw?.(); };
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  const actions = el('div', 'rp-actions');
  actions.appendChild(button('Save answer', 'rp-btn rp-btn-primary', save));
  actions.appendChild(button('Cancel', 'rp-btn', cancel));
  wrap.appendChild(box);
  wrap.appendChild(actions);
  requestAnimationFrame(() => { if (box.isConnected) box.focus(); });
  return wrap;
}

function askRow(state, row, redraw, surface) {
  const handle = `${row.id}#${row.key}`;
  const open = answering.get(surface) === handle;
  const li = el('li', 'rp-review-item rp-ask' + (open ? ' rp-open' : ''));
  li.dataset.ask = handle;
  const head = el('div', 'rp-row');
  const id = button(row.id, 'rp-id rp-link', () => {
    const task = findTicket(state, row.id);
    if (task) openTaskDetail(task);
  }, `Open ${row.id}`);
  id.dataset.ticket = row.id;
  id.setAttribute('aria-label', `Open ticket ${row.id}`);
  head.appendChild(id);
  head.appendChild(el('span', `rp-chip rp-ask-kind rp-ask-${row.kind}`, KIND_LABEL[row.kind] || 'Question'));
  if (row.by) head.appendChild(el('span', 'rp-chip rp-ask-by', `by ${shortDate(row.by)}`));
  const since = row.at ? shortDate(row.at) : '';
  if (since) head.appendChild(el('span', 'rp-review-since', `since ${since}`));
  li.appendChild(head);
  li.appendChild(el('div', 'rp-title', row.text));
  if (row.lines?.length) {
    const list = el('ul', 'rp-ask-lines');
    row.lines.forEach(line => list.appendChild(el('li', null, line.replace(/^\s*(?:[A-Za-z]{1,8}\d+:\s*)?needs-tal\s*:\s*/i, ''))));
    li.appendChild(list);
  }
  if (row.mergePr) {
    const a = el('a', 'rp-canvas-link', 'Open PR ↗');
    a.href = row.mergePr;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.appendChild(a);
  }
  li.appendChild(el('div', 'rp-why', row.title));
  if (open) {
    li.appendChild(answerBox(state, row, redraw, surface));
  } else {
    const actions = el('div', 'rp-actions');
    actions.appendChild(button('Answer', 'rp-btn rp-btn-primary', () => { answering.set(surface, handle); redraw?.(); },
      'Write an answer; it is saved on the ticket as a decision'));
    actions.appendChild(button('Done', 'rp-btn', () => resolveRow(state, row, 'done', '', redraw),
      row.kind === 'merge' ? 'You merged it: close the ask and note it on the ticket' : 'Handled: close the ask and note it on the ticket'));
    actions.appendChild(button('Dismiss', 'rp-btn', () => resolveRow(state, row, 'dismiss', '', redraw),
      'No longer relevant: close the ask without a decision'));
    li.appendChild(actions);
  }
  return li;
}

/**
 * A merge ask closes itself once its PR merges: ask the dashboard server (gh, read-only) once per
 * link per page load and resolve merged ones through the normal save. Silent when the server or gh
 * cannot answer.
 */
function checkMergedPrs(state, rows, redraw) {
  if (typeof fetch !== 'function' || location.protocol === 'file:') return;
  for (const row of rows) {
    if (!row.mergePr || prChecked.has(row.mergePr)) continue;
    prChecked.add(row.mergePr);
    fetch(`/api/pr-state?url=${encodeURIComponent(row.mergePr)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((res) => {
        if (res?.state !== 'MERGED') return;
        const task = findTicket(state, row.id);
        if (!task) return;
        const closed = closeMergedAsks(task, url => (url === row.mergePr ? { state: 'MERGED' } : {}));
        if (closed.length) { commitReviewChange(task); redraw?.(); }
      })
      .catch(() => {});
  }
}

/**
 * The strip: a review-style block with one row per ask, or null when nothing waits.
 * `heading` false drops the title (the Overview widget has its own).
 */
export function renderAsksStrip(state, { redraw, heading = true } = {}) {
  const rows = asksFromState(state);
  updateAsksBadge(rows.length);
  checkMergedPrs(state, rows, redraw);
  if (!rows.length) return null;
  const block = el('section', heading ? 'rp-review rp-asks' : 'rp-asks rp-asks-bare');
  block.setAttribute('aria-label', `Asks for you (${rows.length})`);
  if (heading) block.appendChild(el('h2', 'rp-review-title', `Asks for you (${rows.length})`));
  const list = el('ol', 'rp-review-list rp-asks-list');
  const surface = heading ? 'plan' : 'overview';
  rows.forEach(row => list.appendChild(askRow(state, row, redraw, surface)));
  block.appendChild(list);
  return block;
}

/** Fill the Overview widget and the badges (called on every tasks render). */
export function refreshAsks(state) {
  const host = document.getElementById('asksOverview');
  if (!host) { updateAsksBadge(asksFromState(state).length); return; }
  const redraw = () => refreshAsks(state);
  host.textContent = '';
  const strip = renderAsksStrip(state, { redraw, heading: false });
  host.appendChild(strip || el('div', 'workload-empty', 'Nothing waits on you.'));
}

// ----- Badges: tab title "(N) ...", favicon dot with N, Plan tab count, installed-app badge -----
let baseTitle = null;
let baseIcon = null;
let shownCount = -1;

/** Show `n` on the tab title, favicon, Plan tab and app badge (0 clears them). */
export function updateAsksBadge(n) {
  if (typeof document === 'undefined' || n === shownCount) return;
  shownCount = n;
  if (baseTitle === null) baseTitle = document.title.replace(/^\(\d+\)\s*/, '');
  document.title = n ? `(${n}) ${baseTitle}` : baseTitle;
  const tab = document.getElementById('runPlanTabBtn');
  if (tab) {
    let badge = tab.querySelector('.rp-tab-badge');
    if (n && !badge) { badge = el('span', 'rp-tab-badge'); tab.appendChild(badge); }
    if (badge) {
      badge.textContent = n ? String(n) : '';
      badge.hidden = !n;
      tab.setAttribute('aria-label', n ? `Plan, ${n} ask${n === 1 ? '' : 's'} for you` : 'Plan');
    }
  }
  try {
    if (n) navigator.setAppBadge?.(n)?.catch?.(() => {}); else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* not supported */ }
  drawFavicon(n);
}

function drawFavicon(n) {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return;
  if (baseIcon === null) baseIcon = link.href;
  if (!n) { link.href = baseIcon; return; }
  const img = new Image();
  img.onload = () => {
    if (shownCount !== n) return;
    try {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const r = 19;
      ctx.fillStyle = '#d92d20';
      ctx.beginPath();
      ctx.arc(size - r, r, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${n > 9 ? 22 : 28}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n > 99 ? '99+' : String(n), size - r, r + 1);
      link.href = canvas.toDataURL('image/png');
    } catch { /* canvas unavailable: title still shows the count */ }
  };
  img.src = baseIcon;
}
