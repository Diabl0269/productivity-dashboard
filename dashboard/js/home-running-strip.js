// home-running-strip.js — the "Running now" item of Home's lower strip (PRO117). Replaces the placeholder
// with id 'running'. Shows what is running in plain words (counts per state, narrowed to the selected place:
// "Timeline: 2 of 9"); click or Enter opens a panel that grows up from the strip with every item.
// Esc, a click elsewhere or the same button again closes it the same way back.
// Data: home-running-data.js (15 s poll). The panel is built once; refreshes only update it in place.

import { registerStripItem, getHomeConfig, selectedBoxId } from './home-state.js';
import { getRunning, onRunning, startRunning, refreshRunning } from './home-running-data.js';
import { selectedEpicIds, ticketInSelection } from './home-where.js';
import { boxPath } from '../../shared/home-areas.js';
import { syncRows, howLong } from './home-running-rows.js';
import { activeMainTab } from './state.js';

const STATES = ['working', 'waiting-ci', 'waiting-you', 'idle'];
const COUNT_WORDS = { working: 'working', 'waiting-ci': 'waiting on CI', 'waiting-you': 'waiting on you', idle: 'idle' };
const DOT = { working: 'running', 'waiting-ci': 'partial', 'waiting-you': 'pick', idle: 'later' };
const instances = new WeakMap(); // item root -> instance
let teardown = null; // removes the page-level listeners of the newest instance

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function placeName(ctx) {
  const id = selectedBoxId();
  const path = id ? boxPath(getHomeConfig(), id) : [];
  return path.length ? path[path.length - 1].name : '';
}

/** What the selection leaves of the answer: { all, shown, epics: [{id, state, lastTouched}] }. */
function narrow(ctx) {
  const data = getRunning();
  const all = data?.running || [];
  const shown = all.filter(i => ticketInSelection(ctx, i));
  const ids = selectedEpicIds(ctx);
  const epics = Object.entries(data?.epics || {})
    .filter(([id, e]) => (e.state === 'idle' || e.state === 'stale') && (!ids || ids.has(id)))
    .map(([id, e]) => ({ id, ...e }));
  return { data, all, shown, epics };
}

function titleOf(ctx, id) {
  for (const s of ctx.doc().sections || []) for (const t of s.tasks || []) if (t.id === id) return t.title || '';
  return '';
}

function paintSummary(inst, ctx) {
  const { data, all, shown } = narrow(ctx);
  const name = placeName(ctx);
  const s = inst.summary;
  s.textContent = '';
  if (!data) { s.appendChild(el('span', 'hm-muted', 'Checking...')); return; }
  // "x of y" counts live work only (not idle), the rule of every Home view and of `ch tasks running`.
  const live = list => list.filter(i => i.state !== 'idle').length;
  if (name) s.appendChild(el('span', 'hm-run-scope', `${name}: ${live(shown)} of ${live(all)} running`));
  const counts = STATES.map(st => [st, shown.filter(i => i.state === st).length]).filter(([, n]) => n > 0);
  if (!counts.length) {
    s.appendChild(el('span', 'hm-muted', name ? 'nothing running here' : 'Nothing running'));
    return;
  }
  for (const [st, n] of counts) {
    const c = el('span', 'hm-run-count');
    c.append(el('i', `rp-dot rp-dot-${DOT[st]}`), `${n} ${COUNT_WORDS[st]}`);
    s.appendChild(c);
  }
}

function specsFor(ctx) {
  const { shown, epics } = narrow(ctx);
  const now = Date.now();
  const items = shown.map(i => ({
    key: `t-${i.id}`, id: i.id, title: i.title, state: i.state, age: howLong(i.since, now),
    ageTitle: i.since ? `Since ${new Date(i.since).toLocaleString()}` : '', source: (i.sources || []).join(' + '),
    pr: i.pr, epicId: i.epicId, epicTitle: i.epicId ? titleOf(ctx, i.epicId) : '', noEpicText: 'no epic',
  }));
  const quiet = epics
    .sort((a, b) => (a.state === b.state ? a.id.localeCompare(b.id) : a.state === 'idle' ? -1 : 1))
    .map(e => ({
      key: `e-${e.id}`, id: e.id, title: titleOf(ctx, e.id), state: e.state, age: e.lastTouched ? howLong(e.lastTouched, now) : '',
      ageTitle: e.lastTouched ? `Last touched ${e.lastTouched}` : '', source: e.lastTouched ? 'since last touched' : 'never touched',
    }));
  return { items, quiet };
}

function paintPanel(inst, ctx) {
  const { items, quiet } = specsFor(ctx);
  const { data } = narrow(ctx);
  syncRows(inst.list, inst.rows, items, ctx);
  syncRows(inst.quietList, inst.quietRows, quiet, ctx);
  const name = placeName(ctx);
  inst.empty.hidden = !data || items.length > 0;
  inst.empty.textContent = name
    ? `Nothing is running in ${name}. Press Esc to look at everything.`
    : 'Nothing is running right now. A session, worktree or recent commit that names a ticket shows up here within a minute.';
  inst.quietHead.hidden = quiet.length === 0;
  inst.scope.textContent = name ? `Showing ${name} only` : 'Showing everything';
  const warnings = data?.warnings || [];
  inst.warn.hidden = warnings.length === 0;
  inst.warn.textContent = warnings.join(' ');
  inst.warn.title = warnings.join('\n');
  inst.updated.textContent = data?.at ? `Updated ${new Date(data.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '';
}

function place(inst) {
  const strip = inst.root.closest('.hm-strip');
  if (!strip) return;
  const r = strip.getBoundingClientRect();
  const left = Math.round(r.left + 12);
  inst.panel.style.left = `${left}px`;
  inst.panel.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
  inst.panel.style.width = `${Math.min(1000, window.innerWidth - left - 16)}px`;
}

function setOpen(inst, open, { focus = true } = {}) {
  if (inst.open === open) return;
  inst.open = open;
  inst.trigger.setAttribute('aria-expanded', String(open));
  inst.panel.dataset.open = String(open);
  inst.panel.inert = !open;
  if (open) {
    place(inst);
    if (focus) (inst.panel.querySelector('.hm-run-row:not(.hm-run-leaving) button, .hm-run-row:not(.hm-run-leaving) a') || inst.panel).focus({ preventScroll: true });
  } else if (focus || inst.panel.contains(document.activeElement)) {
    inst.trigger.focus({ preventScroll: true });
  }
}

/** Arrow Up/Down move between rows (same column), Home/End to the first and last row. */
function rowKeys(inst, e) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const here = document.activeElement?.closest?.('.hm-run-row');
  if (!here) return;
  const rows = [...inst.panel.querySelectorAll('.hm-run-row:not(.hm-run-leaving)')];
  const stops = (r) => [...r.querySelectorAll('button, a[href]')];
  const col = Math.max(0, stops(here).indexOf(document.activeElement));
  const i = rows.indexOf(here);
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)));
  const s = stops(rows[j]);
  if (!s.length) return;
  e.preventDefault();
  s[Math.min(col, s.length - 1)].focus();
  rows[j].scrollIntoView({ block: 'nearest' });
}

function build(root, ctx) {
  const inst = { root, open: false, rows: new Map(), quietRows: new Map() };
  const trigger = el('button', 'hm-run-trigger');
  trigger.type = 'button';
  trigger.dataset.hmKey = 'run-trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'hmRunPanel');
  inst.summary = el('span', 'hm-run-summary');
  trigger.append(el('span', 'hm-strip-label', 'Running now'), inst.summary, el('span', 'hm-run-caret'));
  trigger.querySelector('.hm-run-caret').setAttribute('aria-hidden', 'true');
  inst.trigger = trigger;

  const panel = el('div', 'hm-run-panel');
  panel.id = 'hmRunPanel';
  panel.tabIndex = -1;
  panel.dataset.open = 'false';
  panel.inert = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Running now');
  const head = el('div', 'hm-run-head');
  inst.scope = el('span', 'hm-run-headscope');
  inst.updated = el('span', 'hm-run-updated');
  const refresh = el('button', 'hm-run-refresh', 'Refresh');
  refresh.type = 'button';
  refresh.addEventListener('click', () => refreshRunning());
  head.append(el('h3', 'hm-run-title-h', 'Running now'), inst.scope, el('span', 'hm-run-spacer'), inst.updated, refresh);
  inst.warn = el('p', 'hm-run-warn');
  inst.empty = el('p', 'hm-muted hm-run-empty');
  inst.list = el('ul', 'hm-run-list');
  inst.list.tabIndex = -1;
  inst.quietHead = el('h4', 'hm-insp-sub hm-run-sub', 'Epics in progress with nothing running');
  inst.quietList = el('ul', 'hm-run-list');
  inst.quietList.tabIndex = -1;
  const body = el('div', 'hm-run-body');
  body.append(inst.warn, inst.empty, inst.list, inst.quietHead, inst.quietList);
  panel.append(head, body);
  panel.addEventListener('keydown', (e) => rowKeys(inst, e));
  inst.panel = panel;
  root.append(trigger, panel);

  trigger.addEventListener('click', () => setOpen(inst, !inst.open, { focus: false }));
  // Page-level listeners belong to one instance: building a new one (the strip was rebuilt) removes the old ones.
  teardown?.();
  const ac = new AbortController();
  const { signal } = ac;
  // Esc closes the topmost thing: this panel, before the page's own Esc (which clears the selected place).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !inst.open) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(inst, false);
  }, { capture: true, signal });
  document.addEventListener('pointerdown', (e) => {
    if (inst.open && !panel.contains(e.target) && !trigger.contains(e.target)) setOpen(inst, false, { focus: false });
  }, { capture: true, signal });
  window.addEventListener('resize', () => { if (inst.open) place(inst); }, { signal });

  const paint = () => { paintSummary(inst, ctx); paintPanel(inst, ctx); if (inst.open) place(inst); };
  inst.paint = paint;
  const offs = [onRunning(paint), ctx.subscribe(e => { if (e.type === 'selection') paint(); })];
  teardown = () => { ac.abort(); offs.forEach(off => off()); teardown = null; };
  startRunning(() => activeMainTab === 'home');
  return inst;
}

function update(root, ctx) {
  let inst = instances.get(root);
  if (!inst) { inst = build(root, ctx); instances.set(root, inst); }
  inst.paint();
}

registerStripItem({
  id: 'running',
  render: update,
  update,
});
