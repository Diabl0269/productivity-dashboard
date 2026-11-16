// home-map-keys.js — keys and the tooltip of the Home map (PRO39).
// Keys: the map is one Tab stop (roving tabindex on its boxes); arrows move to the nearest box in that direction
// (by geometry), Enter/Space select (and zoom in), Esc/Backspace zoom out one level, Home goes to the top.
// Tooltip: one at a time, after a short hover or on key focus; it fades in and out (120 ms) and says the numbers in words.

import { nearestBox } from './home-map-layout.js';

const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {HTMLElement} stage
 * @param {{ layout: () => object, focusBox: (id: string) => void, out: () => boolean, top: () => boolean }} h
 */
export function installMapKeys(stage, h) {
  stage.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const hit = e.target.closest?.('.hmm-hit');
    const dir = DIRS[e.key];
    if (dir) {
      if (!hit) return;
      e.preventDefault();
      const next = nearestBox(h.layout()?.boxes || [], hit.dataset.box, dir);
      if (next) h.focusBox(next);
      return;
    }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      if (h.out()) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (e.key === 'Home') {
      if (h.top()) e.preventDefault();
    }
  });
}

/** The map's tooltip, inside `wrap` (position: relative). */
export function makeTip(wrap) {
  const tip = el('div', 'hmm-tip');
  tip.setAttribute('role', 'tooltip');
  tip.id = 'hmmTip';
  tip.dataset.on = 'false';
  wrap.appendChild(tip);
  let timer = 0;
  let showing = null;

  const fill = (info) => {
    tip.textContent = '';
    tip.appendChild(el('div', 'hmm-tip-name', info.name));
    if (info.what) tip.appendChild(el('div', 'hmm-tip-what', info.what));
    const ul = el('ul', 'hmm-tip-list');
    for (const w of info.words || []) ul.appendChild(el('li', '', w));
    tip.appendChild(ul);
    for (const note of info.notes || []) tip.appendChild(el('div', 'hmm-tip-note', note));
  };

  const place = (at) => {
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = at.x + 14;
    let y = at.y + 18;
    if (x + tw > W - 6) x = Math.max(6, at.x - tw - 14);
    if (y + th > H - 6) y = Math.max(6, at.y - th - 12);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  return {
    /** info: { key, name, what, words[], notes[] }; at: { x, y } in wrap coordinates. */
    show(info, at, { delay = 380 } = {}) {
      clearTimeout(timer);
      const go = () => {
        if (showing !== info.key) fill(info);
        showing = info.key;
        place(at);
        tip.dataset.on = 'true';
      };
      if (tip.dataset.on === 'true' || delay <= 0) go();
      else timer = setTimeout(go, delay);
    },
    move(at) { if (tip.dataset.on === 'true') place(at); },
    hide() {
      clearTimeout(timer);
      tip.dataset.on = 'false';
      showing = null;
    },
    get key() { return showing; },
    el: tip,
  };
}
