// home-overview-view.js — the Home Overview (PRO129), Home's default view: one calm screen that says what needs
// you, what is running, what is next and what just shipped. A sentence on top, then quiet cards in a fixed order
// (Needs you, Running now, On the agenda, Finished lately, Open notes, Health when something is wrong) and the
// "Where the work is" bar list across the bottom. Every row is a link; every section narrows to the selected place.
//
// The numbers come from shared/home-overview.js (pure; each section names the shared function it uses). This file
// only fetches (running work, the next start line, health when that feature is present), paints in place and
// handles keys: Tab moves card to card (each card's heading), arrows move inside a card, Enter follows the link.
//
// Events for sibling features (both harmless when nobody listens):
//   'hm:open' on document, detail { view, focus }: a card asked a view to show one part (e.g. Lanes' For you).
//   'hm:note' on document, detail { where }: "Add a note" asks the note box to open.

import { registerHomeView, setView, selectedBoxId, getHomeConfig } from './home-state.js';
import { getRunning, onRunning, startRunning, refreshRunningIfStale } from './home-running-data.js';
import { selectedEpicIds } from './home-where.js';
import { boxPath } from '../../shared/home-areas.js';
import { openEpicReadiness } from '../../shared/epic-ready.js';
import { overviewModel } from '../../shared/home-overview.js';
import {
  el, tick, reveal, makeCard, rowSpecs, fillRows, setMore, setLead, syncDays, syncPlaces,
} from './home-overview-cards.js';
import { activeMainTab } from './state.js';

const NEXT_START_MS = 30e3;
const instances = new WeakMap(); // view root -> instance
const readinessCache = new WeakMap(); // doc -> Map(epic id -> readiness)

// ===== data the page fetches =====

let nextStart = null;
let nextStartAt = 0;
let nextStartBusy = false;
function refreshNextStart(paint) {
  if (nextStartBusy || Date.now() - nextStartAt < NEXT_START_MS) return;
  nextStartBusy = true;
  fetch('/api/next-start', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then((out) => { if (out && typeof out.line === 'string') { nextStart = out; paint(); } })
    .catch(() => { /* no server: the agenda shows no next start */ })
    .finally(() => { nextStartAt = Date.now(); nextStartBusy = false; });
}

// Health comes from home-health-data.js (another feature). It is imported only once the page has loaded it,
// so a branch without that feature never asks for a file that is not there.
let health = null;
let healthTried = false;
function probeHealth(paint) {
  if (health || healthTried) return;
  const loaded = performance.getEntriesByType?.('resource').some(e => /\/home-health-data\.js(\?|$)/.test(e.name));
  if (!loaded) return;
  healthTried = true;
  import('./home-health-data.js')
    .then((m) => { health = m; m.onHealth?.(() => paint()); paint(); })
    .catch(() => { /* not this branch */ });
}

function readinessOf(doc) {
  let r = readinessCache.get(doc);
  if (!r) readinessCache.set(doc, r = new Map(openEpicReadiness(doc).map(x => [x.id, x])));
  return r;
}

function placeName() {
  const id = selectedBoxId();
  const path = id ? boxPath(getHomeConfig(), id) : [];
  return path.length ? path[path.length - 1].name : '';
}

// ===== following a link =====

function follow(ctx, target) {
  if (!target) return;
  if (target.ticket) { ctx.openTicket(target.ticket); return; }
  if (target.where) ctx.setSelection(target.where);
  if (target.view) setView(target.view);
  document.dispatchEvent(new CustomEvent('hm:open', { detail: { view: target.view, focus: target.focus || null } }));
}

function addNote(ctx, button) {
  document.dispatchEvent(new CustomEvent('hm:note', { detail: { where: selectedBoxId() } }));
  // The note box takes the focus when it is there; when nothing did, say where notes go for now.
  setTimeout(() => {
    if (document.activeElement === button) ctx.toast('The note box is not on this page yet: add a note from a ticket for now');
  }, 120);
}

// ===== build once =====

function build(root, ctx) {
  const inst = { root, ctx, offs: [] };
  const go = t => follow(ctx, t);
  const wrap = el('div', 'hm-ov');
  const top = el('div', 'hm-ov-top');
  inst.summary = el('p', 'hm-ov-summary');
  inst.summary.setAttribute('aria-live', 'polite');
  inst.clear = el('button', 'hm-ov-clear', 'Clear');
  inst.clear.type = 'button';
  inst.clear.dataset.hmKey = 'ov-clear';
  inst.clear.title = 'Show every place again (Esc)';
  inst.clear.hidden = true;
  inst.clear.addEventListener('click', () => ctx.clearSelection());
  top.append(inst.summary, inst.clear);

  const grid = el('div', 'hm-ov-grid');
  const card = (id, title, target, label) => { const c = makeCard({ id, title, target, label, follow: go }); grid.appendChild(c.card); return c; };
  inst.needs = card('needs', 'Needs you', { view: 'lanes', focus: 'for-you' }, 'Open For you in Lanes');
  inst.running = card('running', 'Running now', { view: 'lanes', focus: 'running' }, 'Open the running work in Lanes');
  inst.agenda = card('agenda', 'On the agenda', { view: 'lanes', focus: 'ready' }, 'Open Ready and the Auto queue in Lanes');
  inst.finished = card('finished', 'Finished lately', { view: 'tickets', focus: 'finished' }, 'Open the closed tickets in Tickets');
  inst.notes = card('notes', 'Open notes', { view: 'lanes', focus: 'notes' }, 'Open the notes in Lanes');
  inst.health = card('health', 'Health', { view: 'how-it-runs' }, 'Open How it runs');
  inst.health.card.hidden = true;
  inst.where = card('where', 'Where the work is', { view: 'map' }, 'Open the Map');
  inst.where.card.classList.add('hm-ov-wide');

  inst.addNote = el('button', 'hm-ov-action', 'Add a note');
  inst.addNote.type = 'button';
  inst.addNote.tabIndex = -1;
  inst.addNote.dataset.hmKey = 'ov-add-note';
  inst.addNote.addEventListener('click', () => addNote(ctx, inst.addNote));
  inst.notes.card.appendChild(inst.addNote);
  inst.healthList = el('ul', 'hm-ov-health');
  inst.health.list.replaceWith(inst.healthList);

  wrap.append(top, grid);
  root.appendChild(wrap);
  wrap.addEventListener('keydown', e => keys(inst, e));

  const paint = () => { if (inst.root.isConnected) paintAll(inst); };
  inst.paint = paint;
  inst.offs.push(onRunning(paint));
  ctx.subscribe((e) => { if (e.type === 'selection') paint(); });
  startRunning(() => activeMainTab === 'home');
  return inst;
}

// ===== paint in place =====

function paintAll(inst) {
  const { ctx } = inst;
  const now = Date.now();
  const doc = ctx.doc();
  const epicIds = selectedEpicIds(ctx);
  const running = getRunning();
  probeHealth(inst.paint);
  refreshNextStart(inst.paint);
  const m = overviewModel(doc, ctx.config(), readinessOf(doc), running, now, {
    epicIds, placeName: placeName(), where: ctx.selection(), nextStart, health: health?.getHealth?.() || null,
  });
  paintSummary(inst, m);
  const place = m.place;

  // Needs you
  const n = inst.needs;
  tick(n.count, m.needsYou.count);
  setSub(n, m.needsYou.picks ? `${m.needsYou.forYou} for you, ${m.needsYou.picks} design ${m.needsYou.picks === 1 ? 'pick' : 'picks'}` : '');
  empty(n, m.needsYou.count === 0, place ? `Nothing in ${place} is waiting on you.` : 'Nothing is waiting on you.');
  fillRows(n, rowSpecs(m.needsYou.items, now), ctx);
  setMore(n, m.needsYou.more);

  // Running now
  const r = inst.running;
  tick(r.count, m.running.count);
  const words = { working: 'working', 'waiting-ci': 'waiting on CI', 'waiting-you': 'waiting on you', idle: 'idle' };
  setSub(r, Object.entries(m.running.counts).map(([s, k]) => `${k} ${words[s] || s}`).join(', '));
  empty(r, m.running.count === 0, !m.running.known ? 'Checking what is running...' : place ? `Nothing is running in ${place}.` : 'Nothing is running right now.');
  fillRows(r, rowSpecs(m.running.items, now), ctx);
  setMore(r, m.running.more);

  // On the agenda
  const a = inst.agenda;
  const ag = m.agenda;
  tick(a.count, ag.ready);
  setSub(a, 'ready');
  // Rows wait for the first next-start answer, so the list does not reshuffle a moment after it appears.
  const settled = nextStartAt > 0;
  const nextRow = ag.next && ag.next.id ? [ag.next] : [];
  setLead(a.lead, ag.next && !ag.next.id ? `${ag.next.title}${ag.next.line ? `: ${ag.next.line}` : ''}.` : '');
  empty(a, !settled || (!nextRow.length && !ag.items.length), !settled ? 'Checking what starts next...' : place ? `Nothing in ${place} is Ready to start.` : 'Nothing is Ready to start.');
  fillRows(a, settled ? rowSpecs([...nextRow, ...ag.items], now, { age: () => '' }) : [], ctx);
  setMore(a, settled ? ag.more : 0);

  // Finished lately
  const f = inst.finished;
  tick(f.count, m.finished.rowsAre === 'epics' ? m.finished.epics : m.finished.count);
  const fe = m.finished.epics;
  const ft = m.finished.tickets;
  setSub(f, m.finished.rowsAre === 'epics' ? `${fe === 1 ? 'epic' : 'epics'} in 7 days, and ${ft} ${ft === 1 ? 'ticket' : 'tickets'}` : `${m.finished.count === 1 ? 'ticket' : 'tickets'} in 7 days`);
  empty(f, m.finished.count === 0, place ? `Nothing in ${place} closed in the last 7 days.` : 'Nothing closed in the last 7 days.');
  syncDays(f, m.finished.days, ctx, now);
  setMore(f, m.finished.more, m.finished.rowsAre === 'epics' ? 'more epics' : 'more');

  // Open notes
  const o = inst.notes;
  tick(o.count, m.notes.count);
  setSub(o, m.notes.count ? `on ${m.notes.tickets} ${m.notes.tickets === 1 ? 'ticket' : 'tickets'}, not filed yet` : '');
  empty(o, m.notes.count === 0, 'No notes waiting to be filed.');
  fillRows(o, rowSpecs(m.notes.items, now), ctx);
  setMore(o, m.notes.more);

  // Health (only when something is wrong)
  paintHealth(inst, m.health.lines);

  // Where the work is
  const w = inst.where;
  const total = m.places.groups.reduce((s, g) => s + g.open, 0);
  tick(w.count, total);
  setSub(w, m.places.groups.length ? 'open epics per place; a dot means something runs there' : '');
  empty(w, !m.places.groups.length, 'This project has no map yet.');
  syncPlaces(w, m.places, t => follow(ctx, t));
}

function setSub(part, text) { if (part.sub.textContent !== text) part.sub.textContent = text; }
function empty(part, on, text) {
  if (on && part.empty.textContent !== text) part.empty.textContent = text;
  reveal(part.empty, on);
}

function paintSummary(inst, m) {
  const s = inst.summary;
  const shape = m.summary.segments.map(x => (typeof x === 'number' ? '#' : x)).join('|');
  if (s.dataset.shape !== shape) {
    const had = s.dataset.shape !== undefined;
    s.dataset.shape = shape;
    s.textContent = '';
    for (const x of m.summary.segments) {
      if (typeof x === 'number') { const b = el('b', 'hm-ov-num'); tick(b, x); s.appendChild(b); } else s.appendChild(document.createTextNode(x));
    }
    if (had && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) s.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
  } else {
    const nums = s.querySelectorAll('.hm-ov-num');
    m.summary.segments.filter(x => typeof x === 'number').forEach((x, i) => tick(nums[i], x));
  }
  reveal(inst.clear, !!m.place);
}

function paintHealth(inst, lines) {
  const h = inst.health;
  tick(h.count, lines.length);
  const key = lines.map(l => l.key + l.text).join('|');
  if (inst.healthKey !== key) {
    inst.healthKey = key;
    inst.healthList.textContent = '';
    for (const l of lines) {
      const b = el('button', 'hm-ov-hline', l.text);
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.hmKey = `ov-health-${l.key}`;
      b.addEventListener('click', () => follow(inst.ctx, l.target));
      inst.healthList.appendChild(el('li')).appendChild(b);
    }
  }
  reveal(h.card, lines.length > 0);
}

// ===== keys: arrows move inside a card, Home/End to its ends; Tab is left to the browser (card to card) =====

function stopsOf(card) {
  return [...card.querySelectorAll('button, a[href]')].filter(b => b.offsetParent !== null && !b.closest('.hm-run-leaving') && !b.disabled);
}

function keys(inst, e) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;
  const card = document.activeElement?.closest?.('.hm-ov-card');
  if (!card || !inst.root.contains(card)) return;
  const stops = stopsOf(card);
  const i = stops.indexOf(document.activeElement);
  if (i < 0) return;
  const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? stops.length - 1 : Math.max(0, Math.min(stops.length - 1, i + (fwd ? 1 : -1)));
  e.preventDefault();
  if (j === i) return;
  stops[j].focus();
  stops[j].scrollIntoView({ block: 'nearest' });
}

function update(root, ctx) {
  let inst = instances.get(root);
  if (!inst) { inst = build(root, ctx); instances.set(root, inst); }
  inst.ctx = ctx;
  paintAll(inst);
  refreshRunningIfStale();
}

registerHomeView({
  id: 'overview',
  label: 'Overview',
  key: 1,
  render: update,
  update,
  dispose(root) {
    const inst = instances.get(root);
    if (!inst) return;
    inst.offs.splice(0).forEach(off => off());
    instances.delete(root);
  },
});
