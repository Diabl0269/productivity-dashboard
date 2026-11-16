// home-palette.js — the command palette (PRO125). Replaces the top bar's search and palette
// placeholders with one field-looking button ("Search or jump… ⌘K"). Cmd/Ctrl+K (or `/`) opens a
// centred panel that grows from that button; Esc, a click outside or the same key again closes it
// the same way back, and focus returns where it was. Sources are in home-palette-sources.js, the
// fuzzy match in shared/palette-match.js, the ? sheet in home-help.js, the g/[/]/u keys in home-nav-keys.js.
// Listeners are page-level, installed once (an AbortController ends them if this module is reloaded).

import { registerTopBarItem } from './home-state.js';
import { setCommandCtx } from './home-commands.js';
import { rank, splitByRanges } from '../../shared/palette-match.js';
import { formatChord } from '../../shared/home-keymap.js';
import {
  GROUPS, placeItems, ticketItems, viewItems, commandItems, loadRecents, rememberRecent, markRecents,
} from './home-palette-sources.js';
import { somethingOnTop } from './home-keys.js';
import { installNavKeys } from './home-nav-keys.js';
import { openHelp, isHelpOpen } from './home-help.js';
import { activeMainTab } from './state.js';

const MAX_ROWS = 50;
const LIMITS = { Places: 12, Tickets: 20, Views: 6, Commands: 8 };
const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const st = { open: false, ctx: null, trigger: null, layer: null, panel: null, input: null, list: null, status: null, items: [], flat: [], active: 0, query: '', prevFocus: null };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ===== results =====

function allItems() {
  const items = [...placeItems(st.ctx), ...ticketItems(st.ctx), ...viewItems(), ...commandItems(st.ctx, { openHelp })];
  return markRecents(items, loadRecents());
}

/** [{ group, rows: [{ item, ranges, idRanges }] }] for the query, at most MAX_ROWS rows in all. */
function compute(query) {
  const q = query.trim();
  const by = new Map(GROUPS.map(g => [g, []]));
  for (const it of st.items) by.get(it.group)?.push(it);
  let sections;
  if (!q) {
    const recents = loadRecents();
    const byKey = new Map(st.items.map(i => [i.key, i]));
    const recent = recents.map(k => byKey.get(k)).filter(Boolean).map(item => ({ item, ranges: [], idRanges: [] }));
    const cmds = (by.get('Commands') || []).slice(0, 10).map(item => ({ item, ranges: [], idRanges: [] }));
    sections = [{ group: 'Recent', rows: recent }, { group: 'Commands', rows: cmds }];
  } else {
    sections = GROUPS.map((group) => {
      const ranked = rank(q, by.get(group), { limit: LIMITS[group] });
      return { group, best: ranked[0]?.score ?? -Infinity, rows: ranked };
    }).sort((a, b) => b.best - a.best);
  }
  let left = MAX_ROWS;
  const out = [];
  for (const s of sections) {
    if (!s.rows.length || left <= 0) continue;
    const rows = s.rows.slice(0, left);
    left -= rows.length;
    out.push({ group: s.group, rows });
  }
  return out;
}

// ===== drawing =====

function marked(text, ranges, className) {
  const span = el('span', className);
  for (const p of splitByRanges(text, ranges)) {
    if (p.hit) span.appendChild(el('mark', 'hm-pal-hit', p.text));
    else span.appendChild(document.createTextNode(p.text));
  }
  return span;
}

function render() {
  const sections = compute(st.query);
  st.flat = [];
  st.sections = sections;
  st.list.textContent = '';
  for (const s of sections) {
    const head = el('div', 'hm-pal-head', s.group);
    head.setAttribute('role', 'presentation');
    st.list.appendChild(head);
    s.start = st.flat.length;
    for (const r of s.rows) {
      const i = st.flat.length;
      st.flat.push(r);
      const row = el('div', 'hm-pal-row');
      row.id = `hmPalOpt${i}`;
      row.setAttribute('role', 'option');
      row.dataset.i = String(i);
      const main = el('span', 'hm-pal-main');
      if (r.item.id) main.appendChild(marked(r.item.id, r.idRanges, 'rp-chip rp-chip-id hm-pal-id'));
      main.appendChild(marked(r.item.title, r.ranges, 'hm-pal-title'));
      row.append(main, el('span', 'hm-pal-hint', r.item.hint || ''));
      st.list.appendChild(row);
    }
  }
  if (!st.flat.length) {
    st.list.appendChild(el('p', 'hm-pal-empty', st.query.trim() ? `Nothing matches "${st.query.trim()}". Try a ticket id or the name of a place.` : 'Nothing to show yet. Type to search.'));
  }
  st.active = Math.min(st.active, Math.max(0, st.flat.length - 1));
  paintActive(false);
  st.status.textContent = st.flat.length ? `${st.flat.length} result${st.flat.length === 1 ? '' : 's'}` : 'No results';
}

function paintActive(scroll = true) {
  for (const row of st.list.querySelectorAll('.hm-pal-row')) {
    const on = Number(row.dataset.i) === st.active;
    row.setAttribute('aria-selected', String(on));
    row.classList.toggle('active', on);
    if (on && scroll) row.scrollIntoView({ block: 'nearest' });
  }
  const row = st.list.querySelector(`#hmPalOpt${st.active}`);
  if (row) st.input.setAttribute('aria-activedescendant', row.id);
  else st.input.removeAttribute('aria-activedescendant');
  const r = st.flat[st.active];
  st.foot.classList.toggle('hm-pal-foot-place', !!r && r.item.key.startsWith('place:'));
}

function moveGroup(dir) {
  const starts = (st.sections || []).filter(s => s.rows.length).map(s => s.start);
  if (!starts.length) return;
  let cur = 0;
  starts.forEach((s, i) => { if (s <= st.active) cur = i; });
  st.active = starts[(cur + dir + starts.length) % starts.length];
  paintActive();
}

function choose(i, mods) {
  const r = st.flat[i];
  if (!r) return;
  rememberRecent(r.item.key);
  close();
  try { r.item.run(mods); } catch (e) { console.error('Palette: command failed', e); st.ctx?.toast(`That did not work: ${e.message}`); }
}

// ===== the panel =====

function build() {
  const layer = el('div', 'hm-pal-layer');
  layer.dataset.open = 'false';
  layer.inert = true;
  const scrim = el('div', 'hm-pal-scrim');
  const panel = el('div', 'hm-pal');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Search or jump');
  const row = el('div', 'hm-pal-field');
  const input = el('input', 'hm-pal-input');
  input.type = 'text';
  input.placeholder = 'Search places, tickets, views and commands';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'hmPalList');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-label', 'Search or jump');
  input.autocomplete = 'off';
  input.spellcheck = false;
  row.appendChild(input);
  const list = el('div', 'hm-pal-list');
  list.id = 'hmPalList';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Results');
  const status = el('div', 'hm-sr');
  status.setAttribute('aria-live', 'polite');
  const foot = el('div', 'hm-pal-foot');
  const hint = (keys, text, cls) => { const s = el('span', cls || ''); s.append(el('kbd', 'hm-key', keys), ` ${text}`); return s; };
  foot.append(hint('↑↓', 'move'), hint('Tab', 'next group'), hint('↵', 'choose'),
    hint(formatChord('Mod+Enter', mac), 'on a place: open in Map', 'hm-pal-foot-map'), hint('Esc', 'close'));
  panel.append(row, list, status, foot);
  layer.append(scrim, panel);
  document.body.appendChild(layer);
  Object.assign(st, { layer, panel, input, list, status, foot });

  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); }); // focus goes back to where it was
  input.addEventListener('input', () => { st.query = input.value; st.active = 0; render(); });
  input.addEventListener('keydown', onInputKey);
  list.addEventListener('pointerdown', e => e.preventDefault()); // keep the focus in the field
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.hm-pal-row');
    if (row) choose(Number(row.dataset.i), { meta: e.metaKey || e.ctrlKey });
  });
  list.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.hm-pal-row');
    if (row && Number(row.dataset.i) !== st.active) { st.active = Number(row.dataset.i); paintActive(false); }
  });
}

function onInputKey(e) {
  const n = st.flat.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (n) { st.active = (st.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; paintActive(); }
  } else if (e.key === 'Tab') {
    e.preventDefault();
    moveGroup(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(st.active, { meta: e.metaKey || e.ctrlKey });
  }
}

/** Point the grow animation at the button: the panel's transform origin is the button's centre. */
function aimAtTrigger() {
  const t = st.trigger?.getBoundingClientRect();
  const p = st.panel.getBoundingClientRect();
  if (t && t.width && p.width) {
    st.panel.style.setProperty('--pal-ox', `${Math.round(t.left + t.width / 2 - p.left)}px`);
    st.panel.style.setProperty('--pal-oy', `${Math.round(t.top + t.height / 2 - p.top)}px`);
  }
}

export function isPaletteOpen() { return st.open; }

export function openPalette() {
  if (st.open || !st.ctx || isHelpOpen()) return;
  if (!st.layer) build();
  st.prevFocus = document.activeElement;
  st.open = true;
  st.items = allItems();
  st.query = '';
  st.active = 0;
  st.input.value = '';
  render();
  st.layer.inert = false;
  aimAtTrigger();
  st.layer.dataset.open = 'true';
  st.trigger?.setAttribute('aria-expanded', 'true');
  st.input.focus({ preventScroll: true });
}

export function closePalette(opts) { close(opts); }

function close({ focus = true } = {}) {
  if (!st.open) return;
  st.open = false;
  aimAtTrigger();
  st.layer.dataset.open = 'false';
  st.layer.inert = true;
  st.trigger?.setAttribute('aria-expanded', 'false');
  const back = st.prevFocus;
  st.prevFocus = null;
  if (!focus) return;
  const target = back && back.isConnected && back !== document.body ? back : st.trigger;
  target?.focus?.({ preventScroll: true });
}

// ===== the top bar button =====

function buildTrigger(root) {
  const b = el('button', 'hm-pal-trigger');
  b.type = 'button';
  b.dataset.hmKey = 'palette-trigger';
  b.title = `Search or jump (${formatChord('Mod+K', mac)})`;
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', String(st.open));
  b.setAttribute('aria-keyshortcuts', 'Meta+K Control+K');
  b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  b.append(el('span', 'hm-pal-trigger-text', 'Search or jump…'), el('kbd', 'hm-key', formatChord('Mod+K', mac)));
  b.addEventListener('click', () => (st.open ? close() : openPalette()));
  root.appendChild(b);
  st.trigger = b;
}

registerTopBarItem({
  id: 'search',
  slot: 'search',
  render(root, ctx) { st.ctx = ctx; setCommandCtx(ctx); buildTrigger(root); },
  update(root, ctx) { st.ctx = ctx; setCommandCtx(ctx); if (!root.firstChild) buildTrigger(root); },
});
// The one button lives in the search slot; this keeps the palette slot's placeholder away.
registerTopBarItem({ id: 'palette', slot: 'palette', render() {}, update() {} });

// ===== page keys =====

let teardown = null;
function install() {
  teardown?.();
  const ac = new AbortController();
  const { signal } = ac;
  // Capture phase: Esc closes the palette before the page's own Esc (which clears the selected place).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.open) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      if (st.open) { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (activeMainTab !== 'home' || somethingOnTop() || isHelpOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      openPalette();
    }
  }, { capture: true, signal });
  window.addEventListener('resize', () => { if (st.open) aimAtTrigger(); }, { signal });
  installNavKeys({ openPalette, openHelp, isPaletteOpen, signal, isShowing: () => activeMainTab === 'home' });
  teardown = () => { ac.abort(); teardown = null; };
}
install();
