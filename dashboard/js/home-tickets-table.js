// home-tickets-table.js — the windowed ticket table of the Home Tickets view (PRO119).
// Every row has the same height, so only the rows near the viewport exist in the DOM (about 40 of 3,000).
// Rows are keyed and reused: a data poll or scroll moves nothing that did not change. Rows that stay glide
// to their new place, rows that arrive fade in, rows that leave fade out (120-160 ms; none with reduced
// motion). One tab stop for the whole table: arrows move a row cursor (aria-activedescendant).

import { ROW_H, el, buildRow, fillRow, buildGroup, fillGroup } from './home-tickets-row.js';

const HEAD_H = 32;
const OVERSCAN = 8;
const DUR = 150;
const EASE = 'cubic-bezier(0.22, 0.6, 0.36, 1)';
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const COLUMNS = [
  { key: 'id', label: 'ID', cls: 'ht-id' },
  { key: 'title', label: 'Title', cls: 'ht-title' },
  { key: 'state', label: 'State', cls: 'ht-state' },
  { key: 'place', label: 'Place', cls: 'ht-place' },
  { key: 'epic', label: 'Epic', cls: 'ht-epic' },
  { key: 'lane', label: 'Lane', cls: 'ht-lane' },
  { key: 'model', label: 'Model', cls: 'ht-model' },
  { key: 'updated', label: 'Updated', cls: 'ht-upd' },
  { key: null, label: 'Notes, checks, PR', cls: 'ht-marks', hidden: true },
];

/**
 * @param {object} ctx the view's ctx
 * @param {{ onSort(key), onCursor(item|null), onToggle(item), onOpen(row), onPlace(row), onEpic(row), onPr(row) }} on
 */
export function createTable(ctx, on) {
  const scroll = el('div', 'ht-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'grid');
  scroll.setAttribute('aria-label', 'Tickets');
  const head = el('div', 'ht-head');
  head.setAttribute('role', 'row');
  const heads = new Map();
  for (const c of COLUMNS) {
    const cell = el('div', `ht-c ${c.cls} ht-hc`);
    cell.setAttribute('role', 'columnheader');
    if (c.key) {
      const b = el('button', 'ht-sort', c.label);
      b.type = 'button';
      b.dataset.hmKey = `sort-${c.key}`;
      b.addEventListener('click', () => on.onSort(c.key));
      b.append(el('span', 'ht-sort-arrow'));
      cell.appendChild(b);
      heads.set(c.key, cell);
    } else {
      cell.appendChild(el('span', 'hm-sr', c.label));
    }
    head.appendChild(cell);
  }
  const body = el('div', 'ht-body');
  body.setAttribute('role', 'rowgroup');
  scroll.append(head, body);

  let items = [];
  let keyIndex = new Map();
  const els = new Map(); // item key -> element in the window
  let cursorKey = null;
  let frame = 0;

  const itemKey = it => it.key;

  function paintSort(key, dir) {
    for (const [k, cell] of heads) {
      const on_ = k === key;
      if (on_) cell.setAttribute('aria-sort', dir === 'desc' ? 'descending' : 'ascending'); else cell.removeAttribute('aria-sort');
    }
  }

  function range() {
    const first = Math.max(0, Math.floor((scroll.scrollTop - HEAD_H) / ROW_H) - OVERSCAN);
    const last = Math.min(items.length, Math.ceil((scroll.scrollTop + scroll.clientHeight) / ROW_H) + OVERSCAN);
    return [first, Math.max(first, last)];
  }

  function paintCursor() {
    for (const [k, node] of els) node.classList.toggle('ht-cursor', k === cursorKey);
    const node = cursorKey && els.get(cursorKey);
    if (node) scroll.setAttribute('aria-activedescendant', node.id); else scroll.removeAttribute('aria-activedescendant');
  }

  function make(item) {
    const node = item.kind === 'group' ? buildGroup(item.key) : buildRow(item.row.id, ctx);
    node.dataset.key = item.key;
    node.setAttribute('aria-level', item.kind === 'group' ? '1' : '2');
    return node;
  }

  function fill(node, item) {
    if (item.kind === 'group') fillGroup(node, item); else fillRow(node, item.row, ctx);
  }

  /** Make the DOM show the rows of the current window. anim: 'none' | 'move' (glide, fade in, fade out). */
  function layout(anim = 'none') {
    const animate = anim === 'move' && !reduced() && scroll.isConnected && scroll.offsetParent !== null;
    const [a, b] = range();
    const want = new Map();
    for (let i = a; i < b; i++) want.set(itemKey(items[i]), i);
    const before = new Map();
    if (animate) for (const [k, node] of els) before.set(k, parseFloat(node.style.top) || 0);

    for (const [k, node] of [...els]) {
      if (want.has(k)) continue;
      els.delete(k);
      if (animate) {
        node.inert = true;
        node.setAttribute('aria-hidden', 'true');
        node.id += '-gone';
        node.style.pointerEvents = 'none';
        const anim_ = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR, easing: 'ease', fill: 'forwards' });
        anim_.onfinish = () => node.remove();
        setTimeout(() => node.remove(), DUR + 150);
      } else node.remove();
    }
    for (const [k, i] of want) {
      const item = items[i];
      let node = els.get(k);
      const fresh = !node;
      if (fresh) { node = make(item); els.set(k, node); body.appendChild(node); }
      fill(node, item);
      node.setAttribute('aria-rowindex', String(i + 2));
      const top = i * ROW_H;
      if (node._top !== top) { node.style.top = `${top}px`; node._top = top; }
      if (animate) {
        if (fresh) node.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: DUR, easing: EASE });
        else if (before.has(k) && Math.abs(before.get(k) - top) > 1) {
          node.animate([{ transform: `translateY(${before.get(k) - top}px)` }, { transform: 'none' }], { duration: DUR, easing: EASE });
        }
      }
    }
    paintCursor();
  }

  function onScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; layout('none'); });
  }
  scroll.addEventListener('scroll', onScroll, { passive: true });
  const resize = new ResizeObserver(() => layout('none'));
  resize.observe(scroll);

  function indexOfKey(key) { return key == null ? -1 : (keyIndex.get(key) ?? -1); }

  function reveal(index) {
    const y = index * ROW_H;
    const viewTop = scroll.scrollTop;
    const viewBottom = scroll.scrollTop + scroll.clientHeight - HEAD_H;
    if (y < viewTop) scroll.scrollTop = y;
    else if (y + ROW_H > viewBottom) scroll.scrollTop = y + ROW_H - (scroll.clientHeight - HEAD_H);
  }

  function setCursor(key, { scrollTo = true } = {}) {
    const i = indexOfKey(key);
    if (i < 0) { cursorKey = null; paintCursor(); on.onCursor(null); return; }
    cursorKey = key;
    if (scrollTo) reveal(i);
    layout('none');
    on.onCursor(items[i]);
  }

  /**
   * Show these items. opts.anim 'move' animates the change; opts.reset goes back to the top (a new filter or
   * sort); otherwise the scroll position is left exactly where it is (a data poll never moves it).
   */
  function setItems(next, { anim = 'none', reset = false } = {}) {
    items = next;
    keyIndex = new Map(items.map((it, i) => [it.key, i]));
    body.style.height = `${items.length * ROW_H}px`;
    scroll.setAttribute('aria-rowcount', String(items.length + 1));
    if (reset) scroll.scrollTop = 0;
    if (cursorKey && !keyIndex.has(cursorKey)) cursorKey = null;
    if (!cursorKey) {
      const firstRow = items.findIndex(it => it.kind === 'row');
      cursorKey = items.length ? items[firstRow >= 0 ? firstRow : 0].key : null;
    }
    layout(anim);
    on.onCursor(cursorKey ? items[indexOfKey(cursorKey)] : null);
  }

  function move(delta) {
    if (!items.length) return;
    const i = indexOfKey(cursorKey);
    const next = Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i) + delta));
    setCursor(items[next].key);
  }

  scroll.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const item = items[indexOfKey(cursorKey)];
    const page = Math.max(1, Math.floor((scroll.clientHeight - HEAD_H) / ROW_H) - 1);
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': move(1); break;
      case 'ArrowUp': move(-1); break;
      case 'PageDown': move(page); break;
      case 'PageUp': move(-page); break;
      case 'Home': setCursor(items[0]?.key); break;
      case 'End': setCursor(items[items.length - 1]?.key); break;
      case 'Enter':
      case ' ':
        if (item?.kind === 'group') on.onToggle(item); else if (item && e.key === 'Enter') on.onOpen(item.row); else handled = false;
        break;
      case 'ArrowRight': if (item?.kind === 'group' && item.collapsed) on.onToggle(item); else handled = false; break;
      case 'ArrowLeft': if (item?.kind === 'group' && !item.collapsed) on.onToggle(item); else handled = false; break;
      case 'e': if (item?.kind === 'row') on.onPlace(item.row); else handled = false; break;
      case 'p': if (item?.kind === 'row') on.onPr(item.row); else handled = false; break;
      case 'o': if (item?.kind === 'row') on.onEpic(item.row); else handled = false; break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  body.addEventListener('click', (e) => {
    const node = e.target.closest('.ht-row');
    if (!node || !node.dataset.key) return;
    setCursor(node.dataset.key, { scrollTo: false });
    scroll.focus({ preventScroll: true });
    const item = items[indexOfKey(node.dataset.key)];
    if (item?.kind === 'group') on.onToggle(item);
  });

  return {
    el: scroll,
    setItems,
    paintSort,
    setCursor,
    cursor: () => items[indexOfKey(cursorKey)] || null,
    itemCount: () => items.length,
    windowSize: () => els.size,
    destroy() { resize.disconnect(); if (frame) cancelAnimationFrame(frame); },
  };
}
