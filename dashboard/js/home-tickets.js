// home-tickets.js — the Home "Tickets" view (key 4) and the inspector's "Tickets" tab (PRO119): every ticket
// of every place in one table, with its state (running, needs you, in review, ready, waiting, later, done).
// Rules: shared/home-ticket-rows.js. Data and view state: home-tickets-data.js. Parts: home-tickets-bar.js
// (filters), home-tickets-table.js (the windowed table), home-tickets-row.js (rows), home-tickets-inspector.js.
//
// Keys inside the table: up/down/PageUp/PageDown/Home/End move the row cursor, Enter opens the ticket, `e`
// shows the row's place on the map, `p` opens its PR, `o` its epic; Enter or left/right fold a group.
// `/` jumps to the filter box from anywhere in Home's Tickets view; Esc in the box clears it, then leaves it.

import { registerHomeView } from './home-state.js';
import { onRunning } from './home-running-data.js';
import { boxOfWhere } from '../../shared/home-config.js';
import { STATES } from '../../shared/home-ticket-rows.js';
import { defaultDir, ticketParamsString, hasTicketParams } from '../../shared/home-ticket-params.js';
import { computeModel, loadViewState, saveViewState, writeUrl } from './home-tickets-data.js';
import { createBar } from './home-tickets-bar.js';
import { createTable } from './home-tickets-table.js';
import { placeBoxId, el, setText } from './home-tickets-row.js';
import { isTaskDetailOpen } from './task-detail.js';
import { isTaskCreateOpen } from './task-create.js';
import './home-tickets-inspector.js';

const isTyping = (n) => !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
const somethingOnTop = () => isTaskDetailOpen() || isTaskCreateOpen() || !!document.querySelector('dialog[open], .modal-overlay.visible, .modal.visible');
const filtersOn = vs => !!(vs.text || vs.states.length || vs.types.length || vs.lane || vs.model || vs.label);

function toggled(list, value) { return list.includes(value) ? list.filter(x => x !== value) : [...list, value]; }

function render(root, ctx) {
  const inst = {
    ctx, root, vs: loadViewState(ctx.project()), folds: new Set(), model: null, timer: 0, unsubs: [], on: null,
  };
  root._ht = inst;
  root.classList.add('ht-view');

  const bar = createBar({
    onChange: apply,
    onClearPlace: () => ctx.clearSelection(),
    onClearFilters: () => apply({ text: '', states: [], types: [], lane: '', model: '', label: '' }),
    onLeave: () => inst.table.el.focus({ preventScroll: true }),
  });
  const table = createTable(ctx, {
    onSort: key => apply({ sort: key, dir: inst.vs.sort === key ? (inst.vs.dir === 'asc' ? 'desc' : 'asc') : defaultDir(key) }),
    onCursor: paintFoot,
    onToggle: item => { inst.folds.has(item.foldKey) ? inst.folds.delete(item.foldKey) : inst.folds.add(item.foldKey); refresh({ anim: 'move' }); },
    onOpen: row => ctx.openTicket(row.id),
    onPlace: (row) => {
      const box = placeBoxId(row);
      if (box) ctx.setSelection(box); else ctx.toast(`${row.id} has no place on the map`);
    },
    onEpic: row => (row.epicId && row.epicId !== row.id ? ctx.openTicket(row.epicId) : ctx.toast(`${row.id} has no epic above it`)),
    onPr: row => (row.prUrl ? window.open(row.prUrl, '_blank', 'noopener,noreferrer') : ctx.toast(`${row.id} has no pull request`)),
  });
  table.el.dataset.hmKey = 'ht-grid';
  const empty = el('div', 'ht-empty');
  empty.hidden = true;
  const foot = el('div', 'ht-foot');
  const footId = el('span', 'ht-foot-id');
  const footWhy = el('span', 'ht-foot-why');
  const footKeys = el('span', 'ht-foot-keys', 'Up/Down move  Enter open  e show its place  p open PR  o open epic  / filter');
  foot.append(footId, footWhy, footKeys);
  const wrap = el('div', 'ht-wrap');
  wrap.append(table.el, empty);
  root.append(bar.el, wrap, foot);
  Object.assign(inst, { bar, table, empty, footId, footWhy });

  function paintFoot(item) {
    if (!item) { setText(footId, ''); setText(footWhy, ''); return; }
    if (item.kind === 'group') {
      setText(footId, item.label);
      setText(footWhy, `${item.count} ${item.count === 1 ? 'ticket' : 'tickets'}. Enter ${item.collapsed ? 'opens' : 'folds'} the group.`);
    } else {
      setText(footId, item.row.id);
      setText(footWhy, item.row.stateWhy);
    }
  }

  function apply(patch) {
    const vs = { ...inst.vs };
    for (const k of ['text', 'group', 'lane', 'model', 'label', 'sort', 'dir', 'states', 'types']) if (k in patch) vs[k] = patch[k];
    if (patch.toggleState) vs.states = STATES.filter(s => toggled(vs.states, patch.toggleState).includes(s));
    if (patch.toggleType) vs.types = ['epic', 'task', 'subtask'].filter(s => toggled(vs.types, patch.toggleType).includes(s));
    if (patch.toggleDone) vs.showDone = !vs.showDone;
    inst.vs = vs;
    persistSoon();
    refresh({ anim: 'move', reset: true });
  }

  function persistSoon() {
    clearTimeout(inst.timer);
    inst.timer = setTimeout(() => saveViewState(ctx.project(), inst.vs), 250);
  }

  function refresh({ anim = 'none', reset = false } = {}) {
    if (!root.isConnected) return;
    const model = computeModel(ctx, inst.vs, { folds: inst.folds });
    inst.model = model;
    const w = ctx.selection();
    const box = ctx.config() ? boxOfWhere(ctx.config(), w) : null;
    const placeName = box && (w.group || w.area || w.part) ? box.name : '';
    bar.paint(inst.vs, model, { placeName, filtersOn: filtersOn(inst.vs) });
    table.paintSort(inst.vs.sort, inst.vs.dir);
    table.setItems(model.items, { anim, reset });
    paintEmpty(model, placeName);
  }

  function paintEmpty(model, placeName) {
    const none = model.items.length === 0;
    let text = '';
    if (none) {
      if (model.all === 0) text = 'There are no tickets yet.';
      else if (placeName && !filtersOn(inst.vs)) text = `Nothing in ${placeName} yet: no epic of this project belongs to that place.`;
      else if (placeName) text = `No ticket in ${placeName} matches these filters.`;
      else text = 'No ticket matches these filters.';
    }
    empty.hidden = !none;
    setText(empty, text);
  }

  inst.refresh = refresh;
  inst.apply = apply;
  inst.unsubs.push(ctx.subscribe((e) => {
    if (e.type === 'selection') refresh({ anim: 'move', reset: true });
    else if (e.type === 'project') { inst.vs = loadViewState(ctx.project()); inst.folds.clear(); refresh({ reset: true }); }
    else if (e.type === 'config') refresh();
  }));
  inst.unsubs.push(onRunning(() => refresh()));

  inst.onKey = (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    if (!root.isConnected || root.classList.contains('hm-leave') || !document.getElementById('homePanel')?.classList.contains('active')) return;
    if (isTyping(e.target) || somethingOnTop()) return;
    e.preventDefault();
    bar.focusSearch();
  };
  document.addEventListener('keydown', inst.onKey);

  writeUrlIfNeeded(inst.vs);
  refresh({ reset: true });
}

function writeUrlIfNeeded(vs) {
  if (ticketParamsString(vs) && !hasTicketParams(window.location.search)) writeUrl(vs);
}

function update(root, ctx) {
  const inst = root._ht;
  if (!inst) { root.textContent = ''; render(root, ctx); return; }
  inst.ctx = ctx;
  writeUrlIfNeeded(inst.vs); // coming back to the tab: the address lost the filters
  inst.refresh();
}

function dispose(root) {
  const inst = root._ht;
  if (!inst) return;
  clearTimeout(inst.timer);
  saveViewState(inst.ctx.project(), inst.vs);
  document.removeEventListener('keydown', inst.onKey);
  inst.unsubs.forEach(off => off());
  inst.table.destroy();
  root._ht = null;
}

registerHomeView({ id: 'tickets', label: 'Tickets', key: 4, render, update, dispose });
