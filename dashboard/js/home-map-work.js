// home-map-work.js — the inspector's Work tab (PRO39): the open epics of the selected place (or the whole map),
// running ones first with their state chip, then Ready, then the ones waiting (with the Plan page's reason), then
// a "Done recently" fold. Each epic row unfolds to its open tickets. Rows are kept between redraws and matched by
// id, so a refresh or a new selection glides them to their new places instead of rebuilding the list.
// Chips and ids are the Plan page's (rp-chip, idButton); readiness is openEpicReadiness, as on the Plan page.

import { registerInspectorTab, getHomeConfig } from './home-state.js';
import { onRunning, getRunning } from './home-running-data.js';
import { boxEpics, mapStats, readinessById, epicRun } from './home-map-data.js';
import { statsWords } from './home-map-draw.js';
import { chainOf } from './home-map-layout.js';
import { plainReasonLine } from '../../shared/epic-ready.js';
import { ROOT } from '../../shared/home-map-stats.js';

const OPEN = new Set(['inbox', 'backlog', 'todo', 'in-progress']);
const RUN_CHIP = { working: ['rp-chip-running', 'Working'], 'waiting-ci': ['rp-chip-partial', 'Waiting on CI'], 'waiting-you': ['rp-chip-review', 'Waiting on you'] };
const RUN_RANK = { 'waiting-you': 0, 'waiting-ci': 1, working: 2 };
const SECTION_WORDS = { inbox: 'Inbox', backlog: 'Backlog', todo: 'To do', 'in-progress': 'In progress' };
const DONE_DAYS = 30;
const DUR = 160;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const instances = new WeakMap(); // ctx -> instance

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

const kidsCache = new WeakMap(); // doc -> Map(parent id -> [{ task, status }])
function childrenOf(doc) {
  let m = kidsCache.get(doc);
  if (m) return m;
  m = new Map();
  for (const s of doc.sections || []) {
    for (const t of s.tasks || []) {
      if (!t.parentId) continue;
      if (!m.has(t.parentId)) m.set(t.parentId, []);
      m.get(t.parentId).push({ task: t, status: s.id });
    }
  }
  kidsCache.set(doc, m);
  return m;
}

/** Open tickets under an epic (any depth, nested epics left to their own row). */
function openTickets(doc, epicId) {
  const kids = childrenOf(doc);
  const out = [];
  const walk = (id, seen = new Set()) => {
    for (const k of kids.get(id) || []) {
      if (seen.has(k.task.id) || k.task.type === 'epic') continue;
      seen.add(k.task.id);
      if (OPEN.has(k.status) && !k.task.checked) out.push(k);
      walk(k.task.id, seen);
    }
  };
  walk(epicId);
  return out;
}

function doneAt(epic) {
  const moves = (epic.history || []).filter(h => h.event === 'moved' && h.to === 'done' && h.at);
  return String(moves.length ? moves[moves.length - 1].at : epic.updated || '').slice(0, 10);
}

function create(ctx) {
  const root = el('div', 'hmw');
  const title = el('h3', 'hm-insp-title');
  const sum = el('p', 'hmw-sum');
  const list = el('ul', 'hmw-list');
  const doneBtn = el('button', 'hmw-fold');
  doneBtn.type = 'button';
  doneBtn.dataset.hmKey = 'work-done';
  doneBtn.setAttribute('aria-controls', 'hmwDone');
  const done = el('ul', 'hmw-list hmw-done');
  done.id = 'hmwDone';
  root.append(title, sum, list, doneBtn, done);
  const inst = { ctx, root, title, sum, list, done, doneBtn, rows: new Map(), doneRows: new Map(), open: new Set(), showDone: false, showWaiting: null };
  doneBtn.addEventListener('click', () => { inst.showDone = !inst.showDone; sync(inst); });
  const off = onRunning(() => { if (root.isConnected) sync(inst); else off(); });
  return inst;
}

function header(key, text, count, inst, foldable) {
  return { key, header: true, text, count, foldable, inst };
}

/** The ordered rows for the place: headers and epics. */
function specsFor(inst) {
  const { ctx } = inst;
  const w = ctx.selection();
  const boxId = w.part || w.area || w.group || null;
  const ready = readinessById(ctx);
  const placed = boxEpics(ctx, boxId);
  const open = placed.filter(p => OPEN.has(p.epic.status)).map(p => ({ ...p, r: ready.get(p.epic.id), run: epicRun(p.epic.id) }));
  const running = open.filter(e => e.run).sort((a, b) => RUN_RANK[a.run] - RUN_RANK[b.run] || a.epic.id.localeCompare(b.epic.id, undefined, { numeric: true }));
  const readyRows = open.filter(e => !e.run && e.r?.ready);
  const waiting = open.filter(e => !e.run && !e.r?.ready)
    .sort((a, b) => Number(b.epic.status === 'in-progress') - Number(a.epic.status === 'in-progress'));
  if (inst.showWaiting === null || inst.boxId !== boxId) inst.showWaiting = waiting.length <= 12;
  inst.boxId = boxId;
  const out = [];
  const group = (key, text, rows, foldable = false, shown = true) => {
    if (!rows.length) return;
    out.push(header(key, text, rows.length, inst, foldable));
    if (shown) for (const e of rows) out.push({ key: `e-${e.epic.id}`, e });
  };
  group('h-running', 'Running now', running);
  group('h-ready', 'Ready', readyRows);
  group('h-waiting', 'Waiting', waiting, waiting.length > 12, inst.showWaiting);
  const cutoff = new Date(Date.now() - DONE_DAYS * 86400e3).toISOString().slice(0, 10);
  const doneRows = placed.filter(p => p.epic.status === 'done' && doneAt(p.epic) >= cutoff)
    .sort((a, b) => doneAt(b.epic).localeCompare(doneAt(a.epic))).slice(0, 12)
    .map(p => ({ key: `d-${p.epic.id}`, e: { ...p, done: doneAt(p.epic) } }));
  return { boxId, out, doneRows, openCount: open.length };
}

function buildHeader(spec) {
  const li = el('li', 'hmw-head');
  li.dataset.hmKey = `work-${spec.key}`;
  if (spec.foldable) {
    const b = el('button', 'hmw-head-btn');
    b.type = 'button';
    b.dataset.hmKey = `work-btn-${spec.key}`;
    b.addEventListener('click', () => { spec.inst.showWaiting = !spec.inst.showWaiting; sync(spec.inst); });
    li.appendChild(b);
    li._label = b;
  } else {
    li._label = li;
  }
  return li;
}

function fillHeader(li, spec) {
  const fold = spec.foldable ? ` ${spec.inst.showWaiting ? '▴' : '▾'}` : '';
  setText(li._label, `${spec.text} · ${spec.count}${fold}`);
  if (spec.foldable) li._label.setAttribute('aria-expanded', String(!!spec.inst.showWaiting));
}

function buildRow(spec, inst) {
  const id = spec.e.epic.id;
  const li = el('li', 'hmw-row');
  li.dataset.hmKey = `work-${spec.key}`;
  const line = el('div', 'hmw-line');
  const caret = el('button', 'hmw-caret');
  caret.type = 'button';
  caret.dataset.hmKey = `work-caret-${spec.key}`;
  caret.setAttribute('aria-controls', `hmwKids-${id}`);
  caret.addEventListener('click', () => {
    if (inst.open.has(id)) inst.open.delete(id); else inst.open.add(id);
    sync(inst);
  });
  const idBtn = inst.ctx.idButton(id);
  idBtn.dataset.hmKey = `work-id-${spec.key}`;
  const title = el('span', 'hmw-title');
  line.append(caret, idBtn, title);
  const meta = el('div', 'hmw-meta');
  const chips = el('span', 'hmw-chips');
  const why = el('span', 'hmw-why');
  const live = el('span', 'hmw-live');
  meta.append(chips, why, live);
  const kids = el('div', 'hmw-kids');
  kids.id = `hmwKids-${id}`;
  const kidsInner = el('ul', 'hmw-kids-list');
  kids.appendChild(kidsInner);
  li.append(line, meta, kids);
  li._p = { caret, title, chips, why, live, kids, kidsInner, sig: '' };
  return li;
}

function fillRow(li, spec, inst) {
  const { e } = spec;
  const p = li._p;
  const id = e.epic.id;
  setText(p.title, e.epic.title || '');
  p.title.title = e.epic.title || '';
  const chips = [];
  if (e.done) chips.push(['rp-chip rp-chip-later', `Done ${e.done.slice(5)}`]);
  else {
    if (e.run) chips.push([`rp-chip ${RUN_CHIP[e.run][0]}`, RUN_CHIP[e.run][1]]);
    chips.push(e.r?.ready ? ['rp-chip rp-chip-ready', e.r.auto ? 'Ready · Auto' : 'Ready'] : ['rp-chip rp-chip-notready', 'Not ready']);
  }
  const chipSig = chips.map(c => c.join(':')).join('|');
  if (p.chipSig !== chipSig) {
    p.chipSig = chipSig;
    p.chips.textContent = '';
    for (const [cls, text] of chips) p.chips.appendChild(el('span', cls, text));
  }
  const reason = !e.done && e.r && !e.r.ready ? plainReasonLine(e.r) : '';
  setText(p.why, reason);
  p.why.title = reason;
  p.why.hidden = !reason;
  // The running tickets inside this epic, or why it is idle (AGE200): the area card says what is going on in it.
  const answer = getRunning();
  const doing = e.done ? [] : (answer?.running || []).filter(i => i.epicId === id && i.state !== 'idle');
  const idleWhy = !e.done && !doing.length ? answer?.epics?.[id]?.idleWhy || '' : '';
  const liveText = doing.length ? `Running: ${doing.map(i => `${i.id} ${i.title || ''}`.trim()).join(', ')}` : idleWhy;
  setText(p.live, liveText);
  p.live.title = liveText;
  p.live.hidden = !liveText;
  const tickets = e.done ? [] : openTickets(inst.ctx.doc(), id);
  const isOpen = inst.open.has(id) && tickets.length > 0;
  p.caret.disabled = tickets.length === 0;
  p.caret.setAttribute('aria-expanded', String(isOpen));
  p.caret.setAttribute('aria-label', tickets.length ? `${isOpen ? 'Hide' : 'Show'} the ${tickets.length} open tickets of ${id}` : `${id} has no open tickets`);
  p.caret.title = '';
  li.classList.toggle('hmw-open', isOpen);
  const sig = isOpen ? tickets.map(t => `${t.task.id}:${t.status}:${t.task.title}`).join('|') : '';
  if (sig !== p.sig) {
    p.sig = sig;
    p.kidsInner.textContent = '';
    for (const t of isOpen ? tickets : []) {
      const k = el('li', 'hmw-kid');
      const b = inst.ctx.idButton(t.task.id);
      b.dataset.hmKey = `work-kid-${t.task.id}`;
      k.append(b, el('span', 'hmw-kid-title', t.task.title || ''), el('span', 'hmw-kid-sec', SECTION_WORDS[t.status] || t.status));
      p.kidsInner.appendChild(k);
    }
  }
}

/** Show exactly `specs` in `list` (keyed), gliding rows that move, fading rows in and out. */
function syncList(list, rows, specs, inst) {
  const animate = !reduced() && list.isConnected && list.offsetParent !== null;
  const before = new Map();
  if (animate) for (const [k, li] of rows) before.set(k, li.getBoundingClientRect().top);
  const wanted = new Set(specs.map(s => s.key));
  for (const [k, li] of [...rows]) {
    if (wanted.has(k)) continue;
    rows.delete(k);
    if (li.contains(document.activeElement)) list.closest('.hm-insp-body')?.focus({ preventScroll: true });
    if (!animate) { li.remove(); continue; }
    li.inert = true;
    li.classList.add('hmw-leaving');
    li.animate([{ opacity: 1 }, { opacity: 0, height: '0px', marginTop: '0px', marginBottom: '0px' }], { duration: DUR, easing: 'ease', fill: 'forwards' }).onfinish = () => li.remove();
  }
  let prev = null;
  for (const spec of specs) {
    let li = rows.get(spec.key);
    const fresh = !li;
    if (fresh) { li = spec.header ? buildHeader(spec) : buildRow(spec, inst); rows.set(spec.key, li); }
    if (spec.header) fillHeader(li, spec); else fillRow(li, spec, inst);
    let next = prev ? prev.nextElementSibling : list.firstElementChild;
    while (next && next.classList.contains('hmw-leaving')) next = next.nextElementSibling;
    if (next !== li) {
      const focused = li.contains(document.activeElement) ? document.activeElement : null;
      list.insertBefore(li, next);
      focused?.focus({ preventScroll: true });
    }
    if (fresh && animate) li.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: DUR, easing: 'cubic-bezier(0.22, 0.6, 0.36, 1)' });
    prev = li;
  }
  if (!animate) return;
  for (const [k, li] of rows) {
    if (!before.has(k)) continue;
    const dy = before.get(k) - li.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: DUR, easing: 'cubic-bezier(0.22, 0.6, 0.36, 1)' });
  }
}

function sync(inst) {
  const { ctx } = inst;
  const config = getHomeConfig();
  if (!config) return;
  const { boxId, out, doneRows, openCount } = specsFor(inst);
  const name = boxId ? chainOf(config, boxId).pop()?.name : (config.title || 'Everything');
  setText(inst.title, name || 'Everything');
  const s = mapStats(ctx).get(boxId || ROOT);
  setText(inst.sum, s ? statsWords(s).slice(0, 2).join(' ') : '');
  syncList(inst.list, inst.rows, out, inst);
  if (!openCount && !inst.list.querySelector('.hmw-empty')) {
    inst.list.appendChild(el('li', 'hmw-empty hm-muted', boxId ? 'No open epics here.' : 'No open epics on this map.'));
  } else if (openCount) inst.list.querySelector('.hmw-empty')?.remove();
  inst.doneBtn.hidden = doneRows.length === 0;
  setText(inst.doneBtn, `Done recently · ${doneRows.length} ${inst.showDone ? '▴' : '▾'}`);
  inst.doneBtn.setAttribute('aria-expanded', String(inst.showDone));
  syncList(inst.done, inst.doneRows, inst.showDone ? doneRows : [], inst);
}

function render(root, ctx) {
  if (!ctx.config()) {
    root.appendChild(el('p', 'hm-muted', ctx.home() ? 'This project has no map yet.' : 'Loading the map...'));
    return;
  }
  let inst = instances.get(ctx);
  if (!inst) instances.set(ctx, inst = create(ctx));
  root.appendChild(inst.root);
  sync(inst);
}

registerInspectorTab({ id: 'work', label: 'Work', render });
