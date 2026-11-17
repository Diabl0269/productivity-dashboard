// home-map-draw.js — draws one level of the Home map (PRO39) from home-map-layout.js, and keeps its numbers
// current in place: a refresh only changes text and colours, never a box's place or size.
//
//   buildLayer(layout, config, handlers) -> refs { el, layout, boxes: Map(id -> box refs), hits: [] }
//   paintLayer(refs, ctx, selectedId)    -> counts, running dots, stale marks, page marks, epic lines, selection
//   statsWords(stats), shortLabel(...)    -> the numbers in words (tooltip, screen reader)

import { GAP, LINE as EPIC_LINE, chainOf } from './home-map-layout.js';
import { mapStats, boxEpics, readinessById, epicRun, pageState } from './home-map-data.js';

const SVG = 'http://www.w3.org/2000/svg';
const RUN_ORDER = [['waitingYou', 'you'], ['waitingCi', 'ci'], ['working', 'working']];
const RUN_WORDS = { working: 'being worked on', ci: 'waiting on CI', you: 'waiting on you' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const runTotal = s => s.running.working + s.running.waitingCi + s.running.waitingYou;
const runState = s => (RUN_ORDER.find(([k]) => s.running[k] > 0) || [null, ''])[1];

/** The numbers of one box as short sentences (the tooltip says these). */
export function statsWords(s) {
  if (!s) return [];
  const out = [];
  if (!s.openEpics) out.push('No open epics.');
  else {
    const extra = [s.ready && `${s.ready} ready to run`, s.auto && `${s.auto} on Auto`].filter(Boolean);
    out.push(`${plural(s.openEpics, 'open epic')}${extra.length ? `: ${extra.join(', ')}` : ''}.`);
  }
  const run = RUN_ORDER.filter(([k]) => s.running[k] > 0).map(([k, w]) => `${s.running[k]} ${RUN_WORDS[w]}`);
  out.push(run.length ? `Running now: ${run.join(', ')} (tickets).` : 'Nothing running now.');
  if (s.stale) out.push(`${plural(s.stale, 'epic')} in progress but untouched for over a week.`);
  if (s.idle) out.push(`${plural(s.idle, 'epic')} in progress with nothing running.`);
  if (s.review) out.push(`${plural(s.review, 'ticket')} waiting for your review.`);
  out.push(`${plural(s.tickets.open, 'open ticket')}, ${s.tickets.done} done.`);
  return out;
}

/** "Timeline, 3 open epics, 1 running, 2 ready" (+ how to go in) for screen readers. */
export function shortLabel(name, s, kids, kidWord) {
  const parts = [name];
  if (s) {
    parts.push(plural(s.openEpics, 'open epic'));
    const run = runTotal(s);
    if (run) parts.push(`${run} running`);
    if (s.ready) parts.push(`${s.ready} ready`);
    if (s.review) parts.push(`${s.review} to review`);
    if (s.stale) parts.push(`${s.stale} stale`);
  }
  let text = parts.join(', ');
  if (kids) text += `. ${plural(kids, kidWord)} inside, Enter zooms in`;
  return text;
}

const KID_WORD = { system: 'area', group: 'part', area: '' };

function bookIcon() {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="M2.5 3.2c1.8-.6 3.6-.5 5.5.6v9.2c-1.9-1.1-3.7-1.2-5.5-.6zM13.5 3.2c-1.8-.6-3.6-.5-5.5.6v9.2c1.9-1.1 3.7-1.2 5.5-.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>';
  return s;
}

function px(node, r, origin = { x: 0, y: 0 }) {
  node.style.left = `${r.x - origin.x}px`;
  node.style.top = `${r.y - origin.y}px`;
  node.style.width = `${r.w}px`;
  node.style.height = `${r.h}px`;
}

function buildBox(b, kind, handlers) {
  const box = el('div', `hmm-box hmm-k-${kind}${kind === 'area' || !b.kids ? ' hmm-leaf' : ''}${b.box.rest ? ' hmm-rest' : ''}`);
  box.dataset.id = b.id;
  px(box, b.rect);
  const hit = el('button', 'hmm-hit');
  hit.type = 'button';
  hit.tabIndex = -1;
  hit.dataset.box = b.id;
  hit.dataset.hmKey = `map-${b.id}`;
  hit.addEventListener('click', () => handlers.pick(b.id, b.rect));
  const head = el('div', 'hmm-head');
  const name = el('span', 'hmm-name', b.box.name);
  const book = el('span', 'hmm-book');
  book.appendChild(bookIcon());
  book.hidden = true;
  const run = el('span', 'hmm-run');
  run.append(el('i', 'hmm-dot'), el('span', 'hmm-run-n'));
  head.append(name, book, run);
  box.append(hit, head);
  const refs = { el: box, hit, name, book, run, runN: run.lastChild, b, minis: new Map(), stats: null, what: null, lines: null };
  if (b.showWhat) box.appendChild(refs.what = el('div', 'hmm-what', b.box.what));
  box.appendChild(refs.stats = el('div', 'hmm-stats'));
  for (const m of b.minis) {
    const mini = el('button', `hmm-mini${m.rect.h >= 40 ? ' hmm-mini-tall' : ''}`);
    mini.type = 'button';
    mini.tabIndex = -1;
    mini.dataset.box = m.id;
    px(mini, m.rect, b.rect);
    const mName = el('span', 'hmm-mini-name', m.box.name);
    const dot = el('i', 'hmm-dot');
    const n = el('span', 'hmm-mini-n');
    mini.append(dot, mName, n); // dot = running state, number = open epics (a number by the dot would read as "running")
    mini.addEventListener('pointerdown', e => e.preventDefault()); // keep the key focus on the map's own stop
    mini.addEventListener('click', (e) => { e.stopPropagation(); handlers.pick(m.id, m.rect); });
    refs.minis.set(m.id, { el: mini, dot, n, m });
  }
  for (const r of refs.minis.values()) box.appendChild(r.el);
  if (b.more) {
    const more = el('span', 'hmm-more', `+${b.more} more`);
    px(more, b.moreRect, b.rect);
    box.appendChild(more);
  }
  // A leaf lists its open epics in its body; a box with minis, in the room left under them (layout's `lines`).
  if (b.lines && b.lines.h >= EPIC_LINE) {
    refs.lines = el('ul', `hmm-epics${b.minis.length ? ' hmm-epics-under' : ''}`);
    px(refs.lines, b.lines, b.rect);
    refs.lineCount = Math.floor(b.lines.h / EPIC_LINE);
    box.appendChild(refs.lines);
  }
  return refs;
}

/** Cables between two boxes of this level that sit side by side: a short bridge across the gap. */
function drawCables(layer, layout, config) {
  const depth = { system: 0, group: 1, area: 2 }[layout.kind];
  const byId = new Map(layout.boxes.map(b => [b.id, b]));
  const visible = (id) => {
    const c = chainOf(config, id);
    return c.length > depth && (layout.zoom === null || c.some(x => x.id === layout.zoom)) ? c[depth].id : null;
  };
  const pairs = new Map();
  const talks = new Map(); // box id -> Set of names it connects to at this level
  for (const cable of config?.cables || []) {
    const a = visible(cable.from);
    const b = visible(cable.to);
    if (!a || !b || a === b || !byId.has(a) || !byId.has(b)) continue;
    const key = [a, b].sort().join('|');
    if (!pairs.has(key)) pairs.set(key, { a, b, labels: [] });
    const names = [chainOf(config, cable.from).pop()?.name, chainOf(config, cable.to).pop()?.name];
    pairs.get(key).labels.push(`${names[0]} → ${names[1]}${cable.label ? ` (${cable.label})` : ''}`);
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!talks.has(x)) talks.set(x, new Set());
      talks.get(x).add(byId.get(y).box.name);
    }
  }
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'hmm-cables');
  svg.setAttribute('width', layout.W);
  svg.setAttribute('height', layout.H);
  svg.setAttribute('aria-hidden', 'true');
  for (const { a, b, labels } of pairs.values()) {
    const ra = byId.get(a).rect;
    const rb = byId.get(b).rect;
    const [l, r] = ra.x <= rb.x ? [ra, rb] : [rb, ra];
    const [t, d] = ra.y <= rb.y ? [ra, rb] : [rb, ra];
    const hOverlap = Math.min(t.x + t.w, d.x + d.w) - Math.max(t.x, d.x);
    const vOverlap = Math.min(l.y + l.h, r.y + r.h) - Math.max(l.y, r.y);
    let line = null;
    if (r.x - (l.x + l.w) >= 0 && r.x - (l.x + l.w) <= GAP + 2 && vOverlap >= 24) {
      const y = Math.round(Math.max(l.y, r.y) + vOverlap / 2);
      line = [l.x + l.w - 4, y, r.x + 4, y];
    } else if (d.y - (t.y + t.h) >= 0 && d.y - (t.y + t.h) <= GAP + 2 && hOverlap >= 24) {
      const x = Math.round(Math.max(t.x, d.x) + hOverlap / 2);
      line = [x, t.y + t.h - 4, x, d.y + 4];
    }
    if (!line) continue; // not side by side: said in the tooltip instead of a line across other boxes
    const g = document.createElementNS(SVG, 'g');
    const path = document.createElementNS(SVG, 'line');
    path.setAttribute('x1', line[0]); path.setAttribute('y1', line[1]);
    path.setAttribute('x2', line[2]); path.setAttribute('y2', line[3]);
    g.appendChild(path);
    for (const [cx, cy] of [[line[0], line[1]], [line[2], line[3]]]) {
      const c = document.createElementNS(SVG, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 3);
      g.appendChild(c);
    }
    g.dataset.labels = labels.join('\n');
    svg.appendChild(g);
  }
  layer.appendChild(svg);
  return talks;
}

export function buildLayer(layout, config, handlers) {
  const layer = el('div', 'hmm-layer');
  layer.dataset.kind = layout.kind;
  const talks = drawCables(layer, layout, config);
  const boxes = new Map();
  for (const b of layout.boxes) {
    const refs = buildBox(b, layout.kind, handlers);
    refs.talks = [...(talks.get(b.id) || [])];
    boxes.set(b.id, refs);
    layer.appendChild(refs.el);
  }
  return { el: layer, layout, boxes };
}

function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }

function statsRow(s) {
  if (!s.openEpics && !s.review) return '<span class="hmm-s hmm-quiet">No open work</span>';
  const bits = [`<span class="hmm-s"><b>${s.openEpics}</b> open</span>`];
  if (s.ready) bits.push(`<span class="hmm-s hmm-s-ready"><b>${s.ready}</b> ready</span>`);
  if (s.review) bits.push(`<span class="hmm-s hmm-s-review"><b>${s.review}</b> to review</span>`);
  if (s.stale) bits.push(`<span class="hmm-s hmm-s-stale"><b>${s.stale}</b> stale</span>`);
  else if (s.idle) bits.push(`<span class="hmm-s hmm-s-idle"><b>${s.idle}</b> idle</span>`);
  return bits.join('');
}

function paintDot(dot, s) {
  const st = runState(s);
  if (dot.dataset.state !== st) dot.dataset.state = st;
}

const RANK = { 'waiting-you': 0, 'waiting-ci': 1, working: 2 };

function paintLines(refs, ctx, ready) {
  const list = boxEpics(ctx, refs.b.id).filter(({ epic }) => ['inbox', 'backlog', 'todo', 'in-progress'].includes(epic.status));
  const rows = list.map(({ epic }) => ({ epic, run: epicRun(epic.id), ready: !!ready.get(epic.id)?.ready }))
    .sort((a, b) => (RANK[a.run] ?? 3) - (RANK[b.run] ?? 3) || Number(b.ready) - Number(a.ready)
      || Number(b.epic.status === 'in-progress') - Number(a.epic.status === 'in-progress'));
  const cap = refs.lineCount;
  // Room for one line: the most urgent epic (the box's own count says how many). More room: "+N more" last.
  const shown = rows.length > cap ? rows.slice(0, cap > 1 ? cap - 1 : cap) : rows;
  const html = shown.map(r => `<li class="hmm-line"><i class="hmm-dot" data-state="${r.run ? { 'waiting-you': 'you', 'waiting-ci': 'ci', working: 'working' }[r.run] : r.ready ? 'ready' : ''}"></i><span class="hmm-line-id">${esc(r.epic.id)}</span><span class="hmm-line-t"></span></li>`);
  if (rows.length > shown.length && cap > 1) html.push(`<li class="hmm-line hmm-quiet">+${rows.length - shown.length} more open</li>`);
  const sig = `${html.join('')}|${shown.map(r => r.epic.title).join('|')}`;
  if (refs.linesSig === sig) return;
  refs.linesSig = sig;
  refs.lines.innerHTML = html.join('');
  [...refs.lines.querySelectorAll('.hmm-line-t')].forEach((t, i) => { t.textContent = shown[i].epic.title || ''; });
}

export function paintLayer(refs, ctx, selectedId) {
  const stats = mapStats(ctx);
  const ready = readinessById(ctx);
  const kidWord = KID_WORD[refs.layout.kind];
  for (const [id, r] of refs.boxes) {
    const s = stats.get(id);
    if (!s) continue;
    const html = statsRow(s);
    if (r.statsHtml !== html) { r.statsHtml = html; r.stats.innerHTML = html; }
    paintDot(r.run.firstChild, s);
    const run = runTotal(s);
    r.run.classList.toggle('hmm-on', run > 0);
    setText(r.runN, run ? String(run) : '');
    const label = shortLabel(r.b.box.name, s, refs.layout.kind === 'area' ? 0 : r.b.kids, kidWord);
    if (r.hit.getAttribute('aria-label') !== label) r.hit.setAttribute('aria-label', label);
    r.words = statsWords(s);
    const page = pageState(id);
    r.book.hidden = page !== 'ok' && page !== 'stale';
    r.book.classList.toggle('hmm-book-stale', page === 'stale');
    r.book.title = '';
    r.page = page;
    r.el.classList.toggle('hmm-sel', id === selectedId);
    r.hit.setAttribute('aria-pressed', id === selectedId ? 'true' : 'false');
    for (const [mid, m] of r.minis) {
      const ms = stats.get(mid);
      if (!ms) continue;
      paintDot(m.dot, ms);
      setText(m.n, ms.openEpics ? String(ms.openEpics) : '');
      m.el.classList.toggle('hmm-sel', mid === selectedId);
      m.el.setAttribute('aria-label', shortLabel(m.m.box.name, ms, 0, ''));
      m.words = statsWords(ms);
    }
    if (r.lines) paintLines(r, ctx, ready);
  }
}
