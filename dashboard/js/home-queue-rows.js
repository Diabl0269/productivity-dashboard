// home-queue-rows.js — the rows of an Overview queue panel (PRO152): a row is the title and its first fields
// as chips, a Drop button, and (when opened) one input per field. Rows are kept by item id and updated in
// place, so a refresh never rebuilds a row you are on. Rows that arrive grow in, rows that leave collapse,
// rows that move glide to their new place; prefers-reduced-motion switches every animation off.

import { chipsOf } from './home-queue-data.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const DUR = 160;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
const canAnimate = node => !reduced() && node.isConnected && node.offsetParent !== null;

/** A row skeleton for one item. `act` = { drop(id), toggle(id) } is the panel's. */
export function buildRow(item, act) {
  const li = el('li', 'hm-q-row');
  li.dataset.id = item.id;
  li.tabIndex = -1;
  const main = el('div', 'hm-q-main');
  const grip = el('span', 'hm-q-grip');
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = '⋮⋮';
  const title = el('span', 'hm-q-title');
  const chips = el('span', 'hm-q-chips');
  const drop = el('button', 'hm-q-drop', 'Drop');
  drop.type = 'button';
  drop.tabIndex = -1;
  drop.addEventListener('click', (e) => { e.stopPropagation(); act.drop(li.dataset.id); });
  main.append(grip, title, chips, drop);
  li.append(main);
  li._parts = { main, grip, title, chips, drop, editor: null };
  li.addEventListener('click', (e) => { if (!e.target.closest('button, input, .hm-q-editor')) act.toggle(li.dataset.id); });
  return li;
}

/** Bring a row up to date without replacing what has not changed. */
export function fillRow(li, item) {
  const p = li._parts;
  setText(p.title, item.title);
  p.title.title = item.title;
  const chips = chipsOf(item.fields);
  const key = chips.map(c => `${c.key}\u0000${c.value}`).join('\u0001');
  if (p.chipKey !== key) {
    p.chipKey = key;
    p.chips.textContent = '';
    for (const c of chips) {
      const chip = el('span', 'rp-chip rp-chip-later hm-q-chip', c.value);
      chip.title = `${c.key}: ${c.value}`;
      p.chips.appendChild(chip);
    }
  }
  li.setAttribute('aria-label', `${item.title}. Enter edits, Alt+Up and Alt+Down move, Delete drops.`);
  p.drop.setAttribute('aria-label', `Drop ${item.title}`);
  p.drop.title = 'Drop this item (Delete)';
  if (p.editor) syncEditor(li, item);
}

// ===== the inline editor: a title input and one input per field =====

function fieldInput(key, value, label, save, close) {
  const row = el('label', 'hm-q-field');
  row.append(el('span', 'hm-q-key', label));
  const input = el('input', 'hm-q-input');
  input.type = 'text';
  input.value = value;
  input.dataset.key = key;
  input.dataset.saved = value;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (input.value !== input.dataset.saved) save(key, input.value, input); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  row.appendChild(input);
  return row;
}

export function openEditor(li, item, { save, close }) {
  const p = li._parts;
  if (p.editor) return;
  const ed = el('div', 'hm-q-editor');
  ed.addEventListener('keydown', (e) => { if (e.key !== 'Tab') e.stopPropagation(); });
  ed.save = save;
  ed.closeIt = close;
  ed.append(fieldInput('title', item.title, 'title', save, close));
  for (const f of item.fields) ed.append(fieldInput(f.key, f.value, f.key, save, close));
  const done = el('button', 'hm-q-done', 'Done');
  done.type = 'button';
  done.addEventListener('click', () => close());
  ed.append(done);
  p.editor = ed;
  li.appendChild(ed);
  li.setAttribute('aria-expanded', 'true');
  li.classList.add('hm-q-open');
  if (canAnimate(li)) {
    const h = ed.getBoundingClientRect().height;
    ed.style.overflow = 'hidden';
    ed.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: DUR, easing: 'ease-out' }).onfinish = () => { ed.style.overflow = ''; };
  }
  ed.querySelector('input')?.focus({ preventScroll: true });
}

export function closeEditor(li, then) {
  const p = li._parts;
  const ed = p.editor;
  if (!ed) { then?.(); return; }
  p.editor = null;
  li.removeAttribute('aria-expanded');
  li.classList.remove('hm-q-open');
  const finish = () => { ed.remove(); then?.(); };
  if (!canAnimate(li)) { finish(); return; }
  ed.style.overflow = 'hidden';
  ed.animate([{ height: `${ed.getBoundingClientRect().height}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 140, easing: 'ease' }).onfinish = finish;
}

/** A refresh updates inputs you are not typing in, and adds inputs for new fields. */
function syncEditor(li, item) {
  const ed = li._parts.editor;
  const inputs = new Map([...ed.querySelectorAll('input')].map(i => [i.dataset.key, i]));
  const want = [['title', item.title], ...item.fields.map(f => [f.key, f.value])];
  for (const [k, v] of want) {
    const i = inputs.get(k);
    if (!i) {
      const done = ed.querySelector('.hm-q-done');
      ed.insertBefore(fieldInput(k, v, k, ed.save, ed.closeIt), done);
    } else if (i.dataset.saved !== v) {
      i.dataset.saved = v;
      if (document.activeElement !== i) i.value = v;
    }
  }
}

/** A quiet flash on an input that was just saved. */
export function flashSaved(input) {
  input.dataset.saved = input.value;
  if (!reduced()) input.animate([{ boxShadow: '0 0 0 2px var(--accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 600, easing: 'ease-out' });
}

// ===== keeping the list in step with the items =====

const live = li => !li.classList.contains('hm-q-leaving');
const firstLive = list => [...list.children].find(live) || null;
const nextLive = (li) => { let n = li.nextElementSibling; while (n && !live(n)) n = n.nextElementSibling; return n; };

/** Make `list` show exactly `items` (in order). `rows` is the Map the panel keeps (id -> li). Returns the Map. */
export function syncItems(list, rows, items, act) {
  const animate = canAnimate(list);
  const before = new Map();
  if (animate) for (const [id, li] of rows) if (live(li)) before.set(id, li.getBoundingClientRect().top);
  const wanted = new Set(items.map(i => i.id));
  for (const [id, li] of [...rows]) {
    if (wanted.has(id)) continue;
    rows.delete(id);
    leave(li);
  }
  const fresh = [];
  const ordered = items.map((item) => {
    let li = rows.get(item.id);
    if (!li) { li = buildRow(item, act); rows.set(item.id, li); fresh.push(li); }
    fillRow(li, item);
    return li;
  });
  let prev = null;
  for (const li of ordered) {
    const want = prev ? nextLive(prev) : firstLive(list);
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  if (!animate) return;
  for (const li of ordered) {
    if (fresh.includes(li)) { enter(li); continue; }
    const was = before.get(li.dataset.id);
    const dy = was === undefined ? 0 : was - li.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: DUR, easing: 'ease-out' });
  }
}

function enter(li) {
  if (!canAnimate(li)) return;
  const h = li.getBoundingClientRect().height;
  li.style.overflow = 'hidden';
  li.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: DUR, easing: 'ease-out' }).onfinish = () => { li.style.overflow = ''; };
}

function leave(li) {
  li.classList.add('hm-q-leaving');
  li.removeAttribute('tabindex');
  const done = () => li.remove();
  if (!canAnimate(li)) { done(); return; }
  li.style.overflow = 'hidden';
  li.animate([{ height: `${li.getBoundingClientRect().height}px`, opacity: 1 }, { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' }], { duration: DUR, easing: 'ease', fill: 'forwards' }).onfinish = done;
}
