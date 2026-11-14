// asks-strip.js — decisions for Tal (PRO73, PRO86): one card per question, shown in the Plan page's
// "For you" list next to the epics to review (run-plan-view.js mixes them, oldest first), in the
// Overview widget, and as the count in the tab title, favicon and Plan tab.
// Cards come from shared/asks.js (own asks, older Left questions, tickets whose waitingOn names Tal),
// only while the work is open; the same question on several tickets is one card. A card shows the
// ticket title, the question, its media (the review card's evidence renderer), the option buttons,
// Park, a Details fold and Dismiss. An answer changes the ticket in the dashboard state and saves
// through commitReviewChange: decision + waitingOn cleared, Park moves it to backlog, an answer on a
// done ticket becomes a review note that the Plan page files as a follow-up (setAskFiler).

import { openAsks, groupAsks, resolveAsk, closeMergedAsks, tickLinkedChecks } from '../../shared/asks.js';
import { stateToDoc } from './epic-ready-ui.js';
import { openTaskDetail, commitReviewChange } from './task-detail.js';
import { moveTask } from './tasks-board.js';
import { todayStr } from './tasks-parser.js';
import { openProjectButton, playVideoButton, audioPlayer, evidenceUrl, showEvidenceToast } from './check-evidence.js';

// The text box that is open per surface: { handle, mode: 'answer' | 'park' }; drafts survive re-renders.
const typing = new Map(); // surface ('plan' | 'overview') -> { handle, mode }
const drafts = new Map();
// Open Details folds (card handles), so a re-render keeps them open.
const detailsOpen = new Set();
// Merge-ask PR links already asked of the server this page load.
const prChecked = new Set();
// Files a done ticket's answer note as a follow-up (set by the Plan page; see run-plan-view.js).
let filer = null;

/** The Plan page hands in its File review path: filer(ticketId) files that ticket's new notes. */
export function setAskFiler(fn) { filer = fn; }

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

/** The dashboard ticket with this id and its section id, or null. */
function findTicket(state, id) {
  for (const [section, list] of Object.entries(state?.tasks || {})) {
    const task = (list || []).find(t => t.taskId === id);
    if (task) return { task, section };
  }
  return null;
}

/** Every decision card in the dashboard state (shared/asks.js openAsks + groupAsks). */
export function asksFromState(state) {
  if (!state?.tasks) return [];
  return groupAsks(openAsks(stateToDoc(state)));
}

const handleOf = (card) => card.members.map(m => `${m.id}#${m.key}`).join('+');

/** Apply one answer to every ticket on the card, then park / file / save. */
function applyAnswer(state, card, action, reply, redraw) {
  const touched = [];
  const park = [];
  const file = [];
  for (const m of card.members) {
    const found = findTicket(state, m.id);
    if (!found) continue;
    try {
      const r = resolveAsk(found.task, m.key, { action, reply, section: found.section, options: card.options });
      // PRO90: an answer / done ticks the checks the question links (dismiss and park do not).
      if (action === 'answer' || action === 'done') {
        for (const t of tickLinkedChecks(id => findTicket(state, id)?.task, r, { now: new Date().toISOString() })) {
          const owner = findTicket(state, t.id)?.task;
          if (owner && !touched.includes(owner)) touched.push(owner);
        }
      }
      if (r.park) park.push(found.task);
      if (r.file) file.push(m.id);
    } catch (e) {
      showEvidenceToast(e.message);
      continue;
    }
    found.task.updated = todayStr();
    touched.push(found.task);
  }
  if (!touched.length) return;
  const handle = handleOf(card);
  drafts.delete(handle);
  detailsOpen.delete(handle);
  for (const [surface, t] of typing) if (t.handle === handle) typing.delete(surface);
  park.forEach(t => moveTask(t.id, 'backlog', -1, { skipRender: true }));
  touched.forEach(t => commitReviewChange(t));
  if (file.length) {
    if (filer) file.forEach(id => filer(id));
    else showEvidenceToast('Answer saved as a review note on the done ticket: File review on the Plan page files it');
  }
  const what = action === 'park' ? 'Parked: moved to backlog' : action === 'dismiss' ? 'Dismissed' : file.length ? 'Answered: filed as a follow-up' : 'Answered: decision saved';
  showEvidenceToast(`${what} (${card.ids.join(', ')})`);
  redraw?.();
}

/** Inline text box (a free answer, or why it is parked): Enter saves, Shift+Enter adds a line, Escape closes. */
function textBox(state, card, mode, redraw, surface) {
  const handle = handleOf(card);
  const wrap = el('div', 'rp-ask-answer');
  const box = el('textarea', 'rp-ask-input');
  box.rows = 2;
  box.placeholder = mode === 'park'
    ? 'Why park it? (optional) Enter parks it, Escape cancels'
    : 'Your answer. Enter saves, Shift+Enter for a new line';
  box.setAttribute('aria-label', `${mode === 'park' ? 'Reason to park' : 'Answer to'} ${card.ids.join(', ')}: ${card.text}`);
  box.value = drafts.get(handle) || '';
  box.addEventListener('input', () => drafts.set(handle, box.value));
  const save = () => {
    if (mode === 'answer' && !box.value.trim()) { box.focus(); return; }
    applyAnswer(state, card, mode, box.value, redraw);
  };
  const cancel = () => { typing.delete(surface); redraw?.(); };
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  const actions = el('div', 'rp-actions');
  actions.appendChild(button(mode === 'park' ? 'Park it' : 'Save answer', 'rp-btn rp-btn-primary', save));
  actions.appendChild(button('Cancel', 'rp-btn', cancel));
  wrap.appendChild(box);
  wrap.appendChild(actions);
  requestAnimationFrame(() => { if (box.isConnected) box.focus(); });
  return wrap;
}

/** The card's video / sound / screenshot / project, with the review card's evidence controls. */
function mediaBlock(card) {
  const m = card.media;
  if (!m) return null;
  const wrap = el('div', 'rp-ask-media');
  const label = `${card.ids[0]} decision`;
  const row = el('div', 'rp-actions');
  wrap.appendChild(row);
  if (m.project) row.appendChild(openProjectButton(m.project));
  if (m.video) row.appendChild(playVideoButton({ video: m.video }, 1, wrap, label));
  if (!row.childNodes.length) row.remove();
  if (m.image) {
    const a = el('a', 'rp-ask-image-link');
    a.href = evidenceUrl(m.image);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = `Open ${m.image} full size`;
    const img = el('img', 'rp-ask-image');
    img.src = evidenceUrl(m.image);
    img.alt = `Screenshot for ${label}`;
    img.loading = 'lazy';
    a.appendChild(img);
    wrap.appendChild(a);
  }
  if (m.audio) wrap.appendChild(audioPlayer({ audio: m.audio }, 1, label));
  return wrap;
}

/** PRO90: the checks this question also settles ("Also settles: <check>"), with their video / project when they have one. */
function settlesBlock(state, card) {
  if (!card.checkRefs?.length) return null;
  const wrap = el('ul', 'rp-ask-settles');
  for (const ref of card.checkRefs) {
    const check = (findTicket(state, ref.id)?.task.checks || []).find(c => c.text === ref.text);
    const item = el('li', 'rp-ask-settle');
    item.appendChild(el('span', 'rp-check-muted', 'Also settles: '));
    item.appendChild(el('span', null, ref.text));
    if (check?.project) { item.appendChild(document.createTextNode(' ')); item.appendChild(openProjectButton(check.project)); }
    if (check?.video) { item.appendChild(document.createTextNode(' ')); item.appendChild(playVideoButton(check, 1, item, `${ref.id} check`)); }
    wrap.appendChild(item);
  }
  return wrap;
}

/** The Details fold (rp-fold, animated): the ticket description, for a card with no details of its own. */
function detailsFold(state, card) {
  if (card.details) return { button: null, fold: null }; // PRO91: the ask's own details show inline, not behind a fold
  const text = findTicket(state, card.ids[0])?.task.description || '';
  if (!text.trim()) return { button: null, fold: null };
  const handle = handleOf(card);
  let open = detailsOpen.has(handle);
  const btn = el('button', 'rp-btn rp-fold-btn');
  btn.type = 'button';
  const fold = el('div', 'rp-fold');
  fold.id = `rpAskDetails-${handle.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  btn.setAttribute('aria-controls', fold.id);
  const inner = el('div', 'rp-fold-inner');
  inner.appendChild(el('div', 'rp-ask-details', text.trim()));
  fold.appendChild(inner);
  const apply = () => {
    btn.textContent = `Details ${open ? '▴' : '▾'}`;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    fold.classList.toggle('rp-fold-open', open);
  };
  apply();
  btn.addEventListener('click', () => {
    open = !open;
    if (open) detailsOpen.add(handle); else detailsOpen.delete(handle);
    apply();
  });
  return { button: btn, fold };
}

/**
 * One decision card as an <li> for a review-style list: id(s), ticket title, question, media,
 * option buttons + Park (+ a free answer), Details fold, Dismiss.
 */
export function renderAskCard(state, card, redraw, surface = 'plan') {
  const handle = handleOf(card);
  const t = typing.get(surface);
  const mode = t && t.handle === handle ? t.mode : null;
  const li = el('li', 'rp-review-item rp-ask' + (mode ? ' rp-open' : ''));
  li.dataset.ask = handle;
  const head = el('div', 'rp-row');
  for (const id of card.ids) {
    const b = button(id, 'rp-id rp-link', () => { const f = findTicket(state, id); if (f) openTaskDetail(f.task); }, `Open ${id}`);
    b.dataset.ticket = id;
    b.setAttribute('aria-label', `Open ticket ${id}`);
    head.appendChild(b);
  }
  head.appendChild(el('span', 'rp-chip rp-ask-kind', card.kind === 'merge' ? 'Merge' : 'Decision'));
  if (card.by) head.appendChild(el('span', 'rp-chip rp-ask-by', `by ${shortDate(card.by)}`));
  const since = card.at ? shortDate(card.at) : '';
  if (since) head.appendChild(el('span', 'rp-review-since', `since ${since}`));
  li.appendChild(head);
  const titles = [...new Set(card.members.map(m => m.title).filter(Boolean))];
  li.appendChild(el('div', 'rp-ask-ticket', titles.join(' / ')));
  li.appendChild(el('div', 'rp-title rp-ask-q', card.text));
  if (card.details) li.appendChild(el('div', 'rp-ask-details rp-ask-details-inline', card.details.trim()));
  const settles = settlesBlock(state, card);
  if (settles) li.appendChild(settles);
  const media = mediaBlock(card);
  if (media) li.appendChild(media);
  if (card.mergePr) {
    const a = el('a', 'rp-canvas-link', 'Open PR ↗');
    a.href = card.mergePr;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.appendChild(a);
  }
  const { button: detailsBtn, fold } = detailsFold(state, card);
  if (mode) {
    li.appendChild(textBox(state, card, mode, redraw, surface));
  } else {
    const actions = el('div', 'rp-actions rp-ask-options');
    const startTyping = (m) => () => { typing.set(surface, { handle, mode: m }); redraw?.(); };
    for (const o of card.options || []) {
      const rec = card.recommend === o.key;
      const b = button(`${o.key}: ${o.text}${rec ? ' (recommended)' : ''}`, `rp-btn${rec ? ' rp-btn-primary' : ''} rp-ask-option`,
        () => applyAnswer(state, card, 'answer', o.key, redraw), `Pick ${o.key}: saved on the ticket as the decision`);
      b.dataset.option = o.key;
      actions.appendChild(b);
    }
    if (card.kind === 'merge') {
      actions.appendChild(button('Merged', 'rp-btn rp-btn-primary', () => applyAnswer(state, card, 'done', '', redraw), 'You merged it: close the ask and note it on the ticket'));
    }
    const hasButtons = (card.options || []).length > 0 || card.kind === 'merge';
    actions.appendChild(button(hasButtons ? 'Other answer' : 'Answer', hasButtons ? 'rp-btn' : 'rp-btn rp-btn-primary',
      startTyping('answer'), 'Write an answer; it is saved on the ticket as a decision'));
    actions.appendChild(button('Park', 'rp-btn', startTyping('park'), 'Not now: move the ticket to backlog with the reason'));
    if (detailsBtn) actions.appendChild(detailsBtn);
    actions.appendChild(button('Dismiss', 'rp-btn', () => applyAnswer(state, card, 'dismiss', '', redraw),
      'No longer relevant: close the ask without a decision'));
    li.appendChild(actions);
  }
  if (fold) li.appendChild(fold);
  return li;
}

/**
 * A merge ask closes itself once its PR merges: ask the dashboard server (gh, read-only) once per
 * link per page load and resolve merged ones through the normal save. Silent when the server or gh
 * cannot answer.
 */
export function checkMergedPrs(state, cards, redraw) {
  if (typeof fetch !== 'function' || location.protocol === 'file:') return;
  for (const card of cards) {
    for (const row of card.members) {
      if (!row.mergePr || prChecked.has(row.mergePr)) continue;
      prChecked.add(row.mergePr);
      fetch(`/api/pr-state?url=${encodeURIComponent(row.mergePr)}`)
        .then(r => (r.ok ? r.json() : null))
        .then((res) => {
          if (res?.state !== 'MERGED') return;
          const found = findTicket(state, row.id);
          if (!found) return;
          const closed = closeMergedAsks(found.task, url => (url === row.mergePr ? { state: 'MERGED' } : {}));
          if (closed.length) { commitReviewChange(found.task); redraw?.(); }
        })
        .catch(() => {});
    }
  }
}

/** The Overview widget's list of decision cards, or null when nothing waits. */
export function renderAsksStrip(state, { redraw } = {}) {
  const cards = asksFromState(state);
  updateAsksBadge(cards.length);
  checkMergedPrs(state, cards, redraw);
  if (!cards.length) return null;
  const block = el('section', 'rp-asks rp-asks-bare');
  block.setAttribute('aria-label', `Decisions for you (${cards.length})`);
  const list = el('ol', 'rp-review-list rp-asks-list');
  cards.forEach(card => list.appendChild(renderAskCard(state, card, redraw, 'overview')));
  block.appendChild(list);
  return block;
}

/** Fill the Overview widget and the badges (called on every tasks render). */
export function refreshAsks(state) {
  const host = document.getElementById('asksOverview');
  if (!host) { updateAsksBadge(asksFromState(state).length); return; }
  const redraw = () => refreshAsks(state);
  host.textContent = '';
  const strip = renderAsksStrip(state, { redraw });
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
      tab.setAttribute('aria-label', n ? `Plan, ${n} decision${n === 1 ? '' : 's'} for you` : 'Plan');
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
