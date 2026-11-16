// home-help.js — the `?` sheet: every key on the Home page, drawn from the one table in
// shared/home-keymap.js (built-in keys, one per view, and the `keys` of registered commands).
// Same overlay style as the palette; Esc, a click outside or `?` again closes it with the reverse fade.

import { homeViews, homeCommands } from './home-state.js';
import { keyTable, groupKeyRows, formatChord } from '../../shared/home-keymap.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
let layer = null;
let panel = null;
let open = false;
let prevFocus = null;
let listenersOn = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function isHelpOpen() { return open; }

function fill() {
  panel.textContent = '';
  const head = el('div', 'hm-help-head');
  head.append(el('h2', 'hm-help-title', 'Keys on this page'), el('span', 'hm-muted', 'Esc closes'));
  panel.appendChild(head);
  const body = el('div', 'hm-help-body');
  for (const { group, rows } of groupKeyRows(keyTable({ views: homeViews(), commands: homeCommands() }))) {
    const sec = el('section', 'hm-help-group');
    sec.appendChild(el('h3', 'hm-insp-sub', group));
    const dl = el('dl', 'hm-help-list');
    for (const r of rows) {
      const dt = el('dt', 'hm-help-keys');
      r.keys.forEach((k, i) => {
        if (i) dt.appendChild(document.createTextNode(' '));
        dt.appendChild(el('kbd', 'hm-key', formatChord(k, mac)));
      });
      dl.append(dt, el('dd', 'hm-help-what', r.label));
    }
    sec.appendChild(dl);
    body.appendChild(sec);
  }
  panel.appendChild(body);
}

function build() {
  layer = el('div', 'hm-pal-layer hm-help-layer');
  layer.dataset.open = 'false';
  layer.inert = true;
  const scrim = el('div', 'hm-pal-scrim');
  panel = el('div', 'hm-pal hm-help');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Keys on this page');
  panel.tabIndex = -1;
  layer.append(scrim, panel);
  document.body.appendChild(layer);
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); closeHelp(); });
  if (!listenersOn) {
    listenersOn = true;
    // Capture phase: Esc closes the sheet before anything else on the page sees it.
    document.addEventListener('keydown', (e) => {
      if (!open) return;
      if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); closeHelp(); }
      else if (e.key === 'Tab') { e.preventDefault(); panel.focus(); } // the sheet has no controls: keep the focus inside it
    }, true);
  }
}

export function openHelp() {
  if (open) return;
  if (!layer) build();
  fill();
  prevFocus = document.activeElement;
  open = true;
  layer.inert = false;
  layer.dataset.open = 'true';
  panel.focus({ preventScroll: true });
}

export function closeHelp({ focus = true } = {}) {
  if (!open) return;
  open = false;
  layer.dataset.open = 'false';
  layer.inert = true;
  const back = prevFocus;
  prevFocus = null;
  if (focus && back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
}
