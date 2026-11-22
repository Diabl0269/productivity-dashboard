// run-plan-later.js — the "Later (N)" fold at the end of a Plan page lane (PRO82).
// Holds the open epics that cannot start yet (backlog, a "later" bucket, not ready), each with
// one plain line saying why and what would make it ready. Cards come from shared/run-plan.js
// (`lane.laterEpics`); nothing here can start them.

import { copyText, refinePrompt } from './run-plan-util.js';
import { renderReasonBlock } from './run-plan-reasons.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const KEY = 'runPlanLaterOpen';
const readOpen = (key = KEY) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
};
const writeOpen = (set, key = KEY) => {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* storage unavailable */ }
};

/** One compact Later card: id (opens the ticket), state chip, title, ONE reason line. */
function laterCard(card, idButton, redraw, folds) {
  const article = el('article', `rp-card rp-later-card rp-${card.state}`);
  article.setAttribute('aria-label', `${card.id} ${card.title}`);
  article.dataset.laterEpic = card.id;
  const row = el('div', 'rp-row');
  row.appendChild(idButton(card.id));
  row.appendChild(el('span', `rp-chip rp-chip-${card.state}`, card.state === 'backlog' ? 'In backlog' : 'Not ready'));
  if (card.unrefined) row.appendChild(el('span', 'rp-chip rp-chip-unrefined', 'Not refined'));
  article.appendChild(row);
  article.appendChild(el('div', 'rp-title', card.title));
  renderReasonBlock(card, idButton, redraw, folds).forEach(n => article.appendChild(n));
  if (card.unrefined) {
    const prompt = refinePrompt(card);
    const refine = el('button', 'rp-btn rp-refine', 'Copy refine prompt');
    refine.type = 'button';
    refine.title = prompt;
    refine.setAttribute('aria-label', `Copy the refine prompt for ${card.id}`);
    refine.addEventListener('click', async () => {
      const ok = await copyText(prompt);
      refine.textContent = ok ? 'Copied' : 'Copy blocked';
    });
    const actions = el('div', 'rp-actions');
    actions.appendChild(refine);
    article.appendChild(actions);
  }
  return article;
}

/**
 * The fold for one lane, or null when the lane has no Later epics. A real button (Tab, Space,
 * Return) toggles it with aria-expanded; the height animates like the Not-ready fold above.
 * @param {{lane: string, laterEpics?: object[]}} lane  a computeRunPlan lane
 * @param {(id: string) => HTMLElement} idButton  makes the epic id a button that opens the ticket
 * @param {() => void} [redraw]  redraws the Plan page after backlog tickets move (PRO85)
 * @param {{keyPrefix?: string, idPrefix?: string}} [folds]  this page's fold key and id prefixes (Plan: none)
 */
export function renderLaterFold(lane, idButton, redraw = () => {}, folds = {}) {
  const cards = lane.laterEpics || [];
  if (!cards.length) return null;
  const wrap = el('div', 'rp-later');
  const key = (folds.keyPrefix || '') + KEY;
  let open = readOpen(key).has(lane.lane);
  const btn = el('button', 'rp-btn rp-fold-btn rp-later-btn');
  btn.type = 'button';
  btn.dataset.laterFold = lane.lane;
  const fold = el('div', 'rp-fold');
  fold.id = `${folds.idPrefix || ''}rpLater-${lane.lane}`;
  btn.setAttribute('aria-controls', fold.id);
  const inner = el('div', 'rp-fold-inner');
  const list = el('div', 'rp-later-list');
  cards.forEach(c => list.appendChild(laterCard(c, idButton, redraw, folds)));
  inner.appendChild(list);
  fold.appendChild(inner);
  const apply = () => {
    btn.textContent = `Later (${cards.length}) ${open ? '▴' : '▾'}`;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.title = open ? 'Hide the epics that cannot start yet' : 'Show the epics that cannot start yet';
    fold.classList.toggle('rp-fold-open', open);
  };
  apply();
  // Toggle in place (no redraw) so the height transition runs.
  btn.addEventListener('click', () => {
    open = !open;
    const set = readOpen(key);
    if (open) set.add(lane.lane); else set.delete(lane.lane);
    writeOpen(set, key);
    apply();
  });
  wrap.appendChild(btn);
  wrap.appendChild(fold);
  return wrap;
}
