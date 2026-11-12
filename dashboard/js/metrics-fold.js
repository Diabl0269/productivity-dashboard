// metrics-fold.js — "Show all (N)" for a long Metrics table (PRO87): the first rows stay visible, the
// rest sit in an animated fold, same pattern as the Later fold on the Plan page (run-plan-later.js):
// a real button toggles it (Tab, Space, Return) with aria-expanded and the height animates.
// The open state lives in this module, so a redraw of the page keeps the fold as the reader left it.

const openFolds = new Set();

/**
 * @param {string} key  stable id for the fold (kept across redraws)
 * @param {Node} head  the always-visible part (the first rows)
 * @param {Node} rest  the folded part (the remaining rows)
 * @param {number} total  how many rows there are in all (shown on the button)
 * @param {Function} el  the page's element helper
 */
export function foldMore(key, head, rest, total, el) {
  const wrap = el('div', 'mc-fold');
  const btn = el('button', 'rp-btn rp-fold-btn mc-fold-btn');
  btn.type = 'button';
  btn.dataset.fold = key;
  const fold = el('div', 'rp-fold');
  fold.id = `mcFold-${key}`;
  btn.setAttribute('aria-controls', fold.id);
  const inner = el('div', 'rp-fold-inner');
  inner.appendChild(rest);
  fold.appendChild(inner);
  const apply = () => {
    const open = openFolds.has(key);
    btn.textContent = open ? 'Show fewer ▴' : `Show all (${total}) ▾`;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    fold.classList.toggle('rp-fold-open', open);
  };
  apply();
  // Toggle in place (no redraw) so the height transition runs.
  btn.addEventListener('click', () => {
    if (openFolds.has(key)) openFolds.delete(key); else openFolds.add(key);
    apply();
  });
  wrap.appendChild(head);
  wrap.appendChild(fold);
  wrap.appendChild(btn);
  return wrap;
}
