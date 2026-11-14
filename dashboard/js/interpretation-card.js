// interpretation-card.js — "Interpretation:" lines a run left (PRO96), shown in the Plan page's "For you"
// list as a card: the ticket, the reading, and two buttons. OK resolves it silently; "Not this" opens a text
// box and saves the correction as a review note on the ticket (the newest note, so `ch tasks get` shows it and
// the next session builds to it). Never a gate: the ticket stays runnable whether or not the card is answered.
// Rules and storage: shared/interpretations.js. Saves through commitReviewChange like the decision cards.

import { openInterpretations, resolveInterpretation } from '../../shared/interpretations.js';
import { stateToDoc } from './epic-ready-ui.js';
import { openTaskDetail, commitReviewChange } from './task-detail.js';
import { todayStr } from './tasks-parser.js';
import { showEvidenceToast } from './check-evidence.js';

const typing = new Set(); // card handles with the "Not this" box open
const drafts = new Map();

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

function findTicket(state, id) {
  for (const list of Object.values(state?.tasks || {})) {
    const task = (list || []).find(t => t.taskId === id);
    if (task) return task;
  }
  return null;
}

/** Open interpretation cards in the dashboard state, oldest first. */
export function interpretationsFromState(state) {
  return state?.tasks ? openInterpretations(stateToDoc(state)) : [];
}

function answer(state, card, action, reply, redraw) {
  const task = findTicket(state, card.id);
  if (!task) return;
  try {
    resolveInterpretation(task, card.text, { action, reply });
  } catch (e) { showEvidenceToast(e.message); return; }
  task.updated = todayStr();
  drafts.delete(`${card.id}#${card.key}`);
  typing.delete(`${card.id}#${card.key}`);
  commitReviewChange(task);
  showEvidenceToast(action === 'ok' ? `OK (${card.id})` : `Correction saved as a note on ${card.id}`);
  redraw?.();
}

/** One interpretation card as an <li> for the For you list. */
export function renderInterpretationCard(state, card, redraw) {
  const handle = `${card.id}#${card.key}`;
  const open = typing.has(handle);
  const li = el('li', 'rp-review-item rp-ask rp-interp' + (open ? ' rp-open' : ''));
  li.dataset.interpretation = handle;
  const head = el('div', 'rp-row');
  const idBtn = button(card.id, 'rp-id rp-link', () => { const t = findTicket(state, card.id); if (t) openTaskDetail(t); }, `Open ${card.id}`);
  idBtn.dataset.ticket = card.id;
  idBtn.setAttribute('aria-label', `Open ticket ${card.id}`);
  head.appendChild(idBtn);
  head.appendChild(el('span', 'rp-chip rp-ask-kind', 'Interpretation'));
  li.appendChild(head);
  li.appendChild(el('div', 'rp-ask-ticket', card.title));
  const q = el('div', 'rp-title rp-ask-q');
  q.appendChild(el('span', 'rp-check-muted', 'The run read it as: '));
  q.appendChild(el('span', null, card.text));
  li.appendChild(q);
  li.appendChild(el('div', 'rp-ask-details rp-ask-details-inline', 'Work goes ahead on this reading. Only correct it if it is wrong.'));
  if (open) {
    const wrap = el('div', 'rp-ask-answer');
    const box = el('textarea', 'rp-ask-input');
    box.rows = 2;
    box.placeholder = 'What it should be instead. Enter saves, Shift+Enter for a new line, Escape cancels';
    box.setAttribute('aria-label', `Correction for ${card.id}: ${card.text}`);
    box.value = drafts.get(handle) || '';
    box.addEventListener('input', () => drafts.set(handle, box.value));
    const save = () => { if (!box.value.trim()) { box.focus(); return; } answer(state, card, 'not-this', box.value, redraw); };
    const cancel = () => { typing.delete(handle); redraw?.(); };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    const actions = el('div', 'rp-actions');
    actions.appendChild(button('Save correction', 'rp-btn rp-btn-primary', save));
    actions.appendChild(button('Cancel', 'rp-btn', cancel));
    wrap.appendChild(box);
    wrap.appendChild(actions);
    li.appendChild(wrap);
    requestAnimationFrame(() => { if (box.isConnected) box.focus(); });
  } else {
    const actions = el('div', 'rp-actions rp-ask-options');
    const ok = button('OK', 'rp-btn rp-btn-primary', () => answer(state, card, 'ok', '', redraw), 'Fine as read: resolves the card, nothing else changes');
    ok.dataset.interpret = 'ok';
    const no = button('Not this', 'rp-btn', () => { typing.add(handle); redraw?.(); }, 'Wrong reading: write the correction; it becomes the newest note on the ticket');
    no.dataset.interpret = 'not-this';
    actions.appendChild(ok);
    actions.appendChild(no);
    li.appendChild(actions);
  }
  return li;
}
