// run-plan-later.js — the "Later (N)" fold at the end of a Plan page lane (PRO82).
// Holds the open epics that cannot start yet (backlog, a "later" bucket, not ready), each with
// one plain line saying why and what would make it ready. Cards come from shared/run-plan.js
// (`lane.laterEpics`); nothing here can start them.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const KEY = 'runPlanLaterOpen';
const readOpen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); }
};
const writeOpen = (set) => {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ }
};

/** One compact Later card: id (opens the ticket), state chip, title, ONE reason line. */
function laterCard(card, idButton) {
  const article = el('article', `rp-card rp-later-card rp-${card.state}`);
  article.setAttribute('aria-label', `${card.id} ${card.title}`);
  article.dataset.laterEpic = card.id;
  const row = el('div', 'rp-row');
  row.appendChild(idButton(card.id));
  row.appendChild(el('span', `rp-chip rp-chip-${card.state}`, card.state === 'backlog' ? 'In backlog' : 'Not ready'));
  article.appendChild(row);
  article.appendChild(el('div', 'rp-title', card.title));
  article.appendChild(el('div', 'rp-why', card.why));
  return article;
}

/**
 * The fold for one lane, or null when the lane has no Later epics. A real button (Tab, Space,
 * Return) toggles it with aria-expanded; the height animates like the Not-ready fold above.
 * @param {{lane: string, laterEpics?: object[]}} lane  a computeRunPlan lane
 * @param {(id: string) => HTMLElement} idButton  makes the epic id a button that opens the ticket
 */
export function renderLaterFold(lane, idButton) {
  const cards = lane.laterEpics || [];
  if (!cards.length) return null;
  const wrap = el('div', 'rp-later');
  let open = readOpen().has(lane.lane);
  const btn = el('button', 'rp-btn rp-fold-btn rp-later-btn');
  btn.type = 'button';
  btn.dataset.laterFold = lane.lane;
  const fold = el('div', 'rp-fold');
  fold.id = `rpLater-${lane.lane}`;
  btn.setAttribute('aria-controls', fold.id);
  const inner = el('div', 'rp-fold-inner');
  const list = el('div', 'rp-later-list');
  cards.forEach(c => list.appendChild(laterCard(c, idButton)));
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
    const set = readOpen();
    if (open) set.add(lane.lane); else set.delete(lane.lane);
    writeOpen(set);
    apply();
  });
  wrap.appendChild(btn);
  wrap.appendChild(fold);
  return wrap;
}
