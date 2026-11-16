// home-overview-cards.js — the parts of the Home Overview (PRO129): a quiet card shell, rows, the day groups of
// "Finished lately", the "Where the work is" bar list and numbers that tick. Everything is built once and then
// updated in place, so a refresh never moves a card or takes the focus away. Rows are the Running now panel's
// rows (home-running-rows.js syncRows): same id button, chip and glide in and out.

import { syncRows, howLong } from './home-running-rows.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

/** Show a number; a change counts up or down to it (about 300 ms) instead of jumping. */
export function tick(node, value) {
  const to = Number(value) || 0;
  const from = node._v;
  node._v = to;
  cancelAnimationFrame(node._raf || 0);
  if (from === undefined || from === to || reduced() || !node.isConnected) { setText(node, String(to)); return; }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 300);
    setText(node, String(Math.round(from + (to - from) * (1 - (1 - k) ** 3))));
    if (k < 1) node._raf = requestAnimationFrame(step);
  };
  node._raf = requestAnimationFrame(step);
}

/** Show or hide a node with a short fade (hidden only once the fade ends). */
export function reveal(node, on) {
  if (!node.hidden === on && node.dataset.leaving !== 'true') return;
  if (on) {
    node.hidden = false;
    node.dataset.leaving = 'false';
    if (!reduced() && node.isConnected) node.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'ease-out' });
    return;
  }
  if (node.hidden) return;
  if (reduced() || !node.isConnected || node.offsetParent === null) { node.hidden = true; return; }
  node.dataset.leaving = 'true';
  const a = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease' });
  a.onfinish = () => { if (node.dataset.leaving === 'true') { node.hidden = true; node.dataset.leaving = 'false'; } };
}

/**
 * A card: heading button (the card's one Tab stop; opens its view) with a ticking count, an optional plain
 * line, the rows, an empty text and "and N more". `follow(target)` is what a click on any link does.
 */
export function makeCard({ id, title, follow, target, label }) {
  const card = el('section', 'hm-ov-card');
  card.dataset.card = id;
  const head = el('div', 'hm-ov-head');
  const btn = el('button', 'hm-ov-title');
  btn.type = 'button';
  btn.dataset.hmKey = `ov-head-${id}`;
  const count = el('span', 'hm-ov-count');
  btn.append(el('span', 'hm-ov-name', title), count);
  btn.title = label || `Open ${title}`;
  btn.addEventListener('click', () => follow(card._target || target));
  const sub = el('span', 'hm-ov-sub');
  head.append(btn, sub);
  card.setAttribute('aria-label', title);
  const lead = el('p', 'hm-ov-lead');
  lead.hidden = true;
  const empty = el('p', 'hm-ov-empty');
  empty.hidden = true;
  const list = el('ul', 'hm-run-list hm-ov-list');
  list.tabIndex = -1;
  const more = el('button', 'hm-ov-more');
  more.type = 'button';
  more.tabIndex = -1;
  more.hidden = true;
  more.dataset.hmKey = `ov-more-${id}`;
  more.addEventListener('click', () => follow(card._target || target));
  card.append(head, lead, empty, list, more);
  list.addEventListener('click', (e) => {
    if (e.target.closest('button, a')) return;
    e.target.closest('.hm-run-row')?.querySelector('button[data-ticket]')?.click();
  });
  return { card, btn, count, sub, lead, empty, list, more, rows: new Map() };
}

const KIND_WORD = { review: 'Review', question: 'Question', reading: 'Reading', pick: 'Pick', next: 'Next', ready: 'Ready', pinned: 'Pinned' };

/** Model items -> the running rows' specs (the line goes in the source slot; the age slot holds "how long"). */
export function rowSpecs(items, now, { age } = {}) {
  return items.map(i => ({
    key: i.key, id: i.id, title: i.title, state: i.state || KIND_WORD[i.kind] || '',
    age: age ? age(i) : (i.since ? howLong(i.since, now) : i.at ? howLong(i.at, now) : ''),
    ageTitle: i.since ? `Since ${new Date(i.since).toLocaleString()}` : i.at ? `Waiting since ${new Date(i.at).toLocaleString()}` : '',
    source: i.line || '', kind: i.kind,
  }));
}

/** Rows in place; buttons inside stay out of the Tab order (arrows reach them), and each row knows its kind. */
export function fillRows(part, specs, ctx) {
  syncRows(part.list, part.rows, specs, ctx);
  for (const s of specs) {
    const li = part.rows.get(s.key);
    if (!li) continue;
    if (li.dataset.kind !== s.kind) li.dataset.kind = s.kind || '';
    li.classList.add('hm-ov-row');
    const src = li.querySelector('.hm-run-source');
    if (src && src.title !== s.source) src.title = s.source;
  }
  for (const b of part.list.querySelectorAll('button, a')) if (b.tabIndex !== -1) b.tabIndex = -1;
}

/** "and 4 more" under a card (hidden at 0). */
export function setMore(part, n, words = 'more') {
  setText(part.more, `and ${n} ${words}`);
  reveal(part.more, n > 0);
}

export function setLead(node, text) {
  if (text) setText(node, text); // an emptied line fades out with its last words
  reveal(node, !!text);
}

// ===== Finished lately: one small block per day, rows inside =====

export function syncDays(part, days, ctx, now) {
  if (!part.days) {
    part.days = new Map();
    part.dayBox = el('div', 'hm-ov-days');
    part.list.replaceWith(part.dayBox);
  }
  const wanted = new Set(days.map(d => d.day));
  for (const [day, b] of [...part.days]) {
    if (wanted.has(day)) continue;
    part.days.delete(day);
    if (b.box.contains(document.activeElement)) part.btn.focus({ preventScroll: true });
    if (reduced()) b.box.remove();
    else b.box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).onfinish = () => b.box.remove();
  }
  let prev = null;
  for (const d of days) {
    let b = part.days.get(d.day);
    if (!b) {
      b = { box: el('div', 'hm-ov-day'), head: el('h4', 'hm-ov-dayhead'), list: el('ul', 'hm-run-list hm-ov-list'), rows: new Map() };
      b.list.tabIndex = -1;
      b.box.append(b.head, b.list);
      b.list.addEventListener('click', (e) => {
        if (e.target.closest('button, a')) return;
        e.target.closest('.hm-run-row')?.querySelector('button[data-ticket]')?.click();
      });
      part.days.set(d.day, b);
    }
    setText(b.head, d.label);
    const next = prev ? prev.box.nextElementSibling : part.dayBox.firstElementChild;
    if (next !== b.box) part.dayBox.insertBefore(b.box, next);
    fillRows(b, rowSpecs(d.items, now, { age: () => '' }), ctx);
    prev = b;
  }
}

// ===== Where the work is: one column per group, a bar per area =====

function placeButton(cls, onClick) {
  const b = el('button', cls);
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('click', onClick);
  return b;
}

/** Build (once per map) and update the bar list. */
export function syncPlaces(part, places, follow) {
  if (!part.placeBox) {
    part.placeBox = el('div', 'hm-ov-places');
    part.list.replaceWith(part.placeBox);
    part.placeEls = new Map();
  }
  const max = Math.max(1, places.max);
  for (const g of places.groups) {
    let ge = part.placeEls.get(g.id);
    if (!ge) {
      ge = { col: el('div', 'hm-ov-group'), areas: new Map() };
      ge.btn = placeButton('hm-ov-gbtn', () => follow(ge.target));
      ge.btn.dataset.hmKey = `ov-place-${g.id}`;
      ge.name = el('span', 'hm-ov-gname');
      ge.count = el('span', 'hm-ov-gcount');
      ge.btn.append(ge.name, ge.count);
      ge.list = el('ul', 'hm-ov-bars');
      ge.col.append(ge.btn, ge.list);
      part.placeBox.appendChild(ge.col);
      part.placeEls.set(g.id, ge);
    }
    ge.target = g.target;
    setText(ge.name, g.name);
    tick(ge.count, g.open);
    ge.btn.title = `${g.name}: ${g.open} open ${g.open === 1 ? 'epic' : 'epics'}${g.running ? `, ${g.running} running` : ''}. Open on the map`;
    ge.col.classList.toggle('hm-ov-on', g.selected);
    for (const a of g.areas) {
      let ae = ge.areas.get(a.id);
      if (!ae) {
        ae = { li: el('li') };
        ae.btn = placeButton('hm-ov-area', () => follow(ae.target));
        ae.btn.dataset.hmKey = `ov-place-${a.id}`;
        ae.name = el('span', 'hm-ov-aname');
        ae.track = el('span', 'hm-ov-track');
        ae.bar = el('span', 'hm-ov-bar');
        ae.track.appendChild(ae.bar);
        ae.count = el('span', 'hm-ov-acount');
        ae.dot = el('i', 'rp-dot rp-dot-running hm-ov-dot');
        ae.btn.append(ae.name, ae.track, ae.count, ae.dot);
        ae.li.appendChild(ae.btn);
        ge.list.appendChild(ae.li);
        ge.areas.set(a.id, ae);
      }
      ae.target = a.target;
      setText(ae.name, a.name);
      tick(ae.count, a.open);
      ae.bar.style.width = `${Math.round((a.open / max) * 100)}%`;
      ae.dot.style.opacity = a.running ? '1' : '0';
      ae.btn.title = `${a.name}: ${a.open} open ${a.open === 1 ? 'epic' : 'epics'}${a.running ? `, ${a.running} running` : ''}. Open on the map`;
      ae.btn.classList.toggle('hm-ov-on', a.selected);
      if (a.selected) ae.btn.setAttribute('aria-current', 'true'); else ae.btn.removeAttribute('aria-current');
    }
  }
}
