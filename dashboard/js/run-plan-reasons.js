// run-plan-reasons.js: the "why is this epic not ready" part of a Plan page card (PRO85).
// One plain line with every ticket id as a button, an expandable "What's missing (N)" list when
// there is more than one reason, and a two-step "Move N backlog tickets to To do" button.
// Reasons come from shared/epic-ready.js (`card.reasons`: {kind, ids, text}); nothing here decides readiness.

import { promoteBacklogTickets } from './task-selection.js';
import { textWithIdButtons } from './run-plan-reason-text.js';

export { textWithIdButtons };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The two-step button: first click asks "Move N to To do? Yes / Cancel", Yes moves them (never a browser dialog). */
function promoteButton(ids, epicId, redraw) {
  const wrap = el('div', 'rp-promote');
  wrap.dataset.promote = epicId;
  const idle = () => {
    wrap.textContent = '';
    const btn = el('button', 'rp-btn rp-promote-btn', `Move ${ids.length} backlog ${ids.length === 1 ? 'ticket' : 'tickets'} to To do`);
    btn.type = 'button';
    btn.title = `Moves ${ids.join(', ')} from backlog to To do`;
    btn.addEventListener('click', ask);
    wrap.appendChild(btn);
  };
  const ask = () => {
    wrap.textContent = '';
    wrap.appendChild(el('span', 'rp-promote-q', `Move ${ids.length} to To do?`));
    const yes = el('button', 'rp-btn rp-btn-primary rp-promote-yes', 'Yes');
    yes.type = 'button';
    yes.addEventListener('click', () => { promoteBacklogTickets(ids); redraw(); });
    const no = el('button', 'rp-btn rp-promote-no', 'Cancel');
    no.type = 'button';
    no.addEventListener('click', () => { idle(); wrap.querySelector('button')?.focus(); });
    wrap.append(yes, no);
    yes.focus();
  };
  idle();
  return wrap;
}

/**
 * The reason block of a Not-ready / backlog card: [line, "What's missing (N)" fold when N > 1, promote button].
 * @param {{id: string, why: string, reasons?: {ids: string[], text: string}[], promoteIds?: string[]}} card
 * @param {(id: string) => HTMLElement} idButton
 * @param {() => void} redraw  redraws the Plan page after tickets move
 */
export function renderReasonBlock(card, idButton, redraw) {
  const out = [];
  const reasons = card.reasons || [];
  const first = reasons[0];
  if (first) {
    const line = el('div', 'rp-why');
    line.appendChild(textWithIdButtons(first.text, first.ids, idButton, ''));
    out.push(line);
  } else out.push(el('div', 'rp-why', card.why));
  if (reasons.length > 1) out.push(missingFold(card, reasons, idButton));
  if ((card.promoteIds || []).length) out.push(promoteButton(card.promoteIds, card.id, redraw));
  return out;
}

const OPEN_KEY = 'runPlanMissingOpen';
const readOpen = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch { return new Set(); } };
const writeOpen = set => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ } };

/** "What's missing (N)": a real button toggles the list (aria-expanded); the height animates like the other Plan folds. */
function missingFold(card, reasons, idButton) {
  const wrap = el('div', 'rp-missing');
  let open = readOpen().has(card.id);
  const btn = el('button', 'rp-btn rp-fold-btn rp-missing-btn');
  btn.type = 'button';
  btn.dataset.missingFold = card.id;
  const fold = el('div', 'rp-fold');
  fold.id = `rpMissing-${card.id}`;
  btn.setAttribute('aria-controls', fold.id);
  const inner = el('div', 'rp-fold-inner');
  const list = el('ul', 'rp-missing-list');
  reasons.forEach(r => {
    const li = el('li');
    li.appendChild(textWithIdButtons(r.text, r.ids, idButton, 'rp-missing-item'));
    list.appendChild(li);
  });
  inner.appendChild(list);
  fold.appendChild(inner);
  const apply = () => {
    btn.textContent = `What's missing (${reasons.length}) ${open ? '▴' : '▾'}`;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    fold.classList.toggle('rp-fold-open', open);
  };
  apply();
  btn.addEventListener('click', () => {
    open = !open;
    const set = readOpen();
    if (open) set.add(card.id); else set.delete(card.id);
    writeOpen(set);
    apply();
  });
  wrap.append(btn, fold);
  return wrap;
}
