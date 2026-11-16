// home-map-offmap.js — the Map's quiet "Not on the map" chip (PRO39): open epics no area claims (they sit in the
// fallback area), with the rule that would place each. The chip opens a small panel that grows out of it; Esc,
// a click elsewhere or the chip again closes it back. Hidden while every open epic has a place.

import { offMap } from './home-map-data.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function makeOffMap(slot, ctx) {
  const chip = el('button', 'hmm-off');
  chip.type = 'button';
  chip.dataset.hmKey = 'map-offmap';
  chip.setAttribute('aria-haspopup', 'true');
  chip.setAttribute('aria-expanded', 'false');
  chip.setAttribute('aria-controls', 'hmmOffPanel');
  chip.hidden = true;
  const panel = el('div', 'hmm-off-panel');
  panel.id = 'hmmOffPanel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Open epics not on the map');
  panel.tabIndex = -1;
  panel.dataset.open = 'false';
  panel.inert = true;
  const intro = el('p', 'hmm-off-intro');
  const list = el('ul', 'hmm-off-list');
  panel.append(intro, list);
  slot.append(chip, panel);
  let open = false;
  let sig = '';

  const setOpen = (on, { focus = true } = {}) => {
    if (open === on) return;
    open = on;
    chip.setAttribute('aria-expanded', String(on));
    panel.dataset.open = String(on);
    panel.inert = !on;
    if (on && focus) (panel.querySelector('button') || panel).focus({ preventScroll: true });
    else if (!on && (focus || panel.contains(document.activeElement))) chip.focus({ preventScroll: true });
  };
  chip.addEventListener('click', () => setOpen(!open, { focus: false }));
  const ac = new AbortController();
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  }, { capture: true, signal: ac.signal });
  document.addEventListener('pointerdown', (e) => {
    if (open && !panel.contains(e.target) && !chip.contains(e.target)) setOpen(false, { focus: false });
  }, { capture: true, signal: ac.signal });

  const paint = () => {
    const items = offMap(ctx);
    const fallback = items.length ? /sits in "([^"]+)"/.exec(items[0].why)?.[1] : '';
    const next = items.map(e => `${e.id}:${e.title}:${e.fix}`).join('|');
    chip.hidden = items.length === 0;
    chip.textContent = items.length === 1 ? '1 epic not on the map' : `${items.length} epics not on the map`;
    chip.title = '';
    if (!items.length && open) setOpen(false, { focus: false });
    if (next === sig) return;
    sig = next;
    intro.textContent = `No area's lanes, title pattern or projects fit these open epics, so they are counted in ${fallback ? `"${fallback}"` : 'the last area'}. Each line says what would give it its own place (in the project's home.config.json).`;
    list.textContent = '';
    for (const e of items) {
      const li = el('li', 'hmm-off-row');
      const top = el('div', 'hmm-off-top');
      top.append(ctx.idButton(e.id), el('span', 'hmm-off-title', e.title));
      li.append(top, el('div', 'hmm-off-fix', e.fix));
      list.appendChild(li);
    }
  };

  return { paint, dispose: () => ac.abort() };
}
