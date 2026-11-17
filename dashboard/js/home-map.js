// home-map.js — the Home page's Map view (PRO39): the project drawn as boxes you zoom into, from the whole system
// (groups, each showing its areas) to a group's areas (each showing its parts) to an area's parts. Every box shows
// its open epics, ready count, a running dot, stale work and review-waiting tickets; the inspector's Work tab lists
// the selected box's epics. The map follows the page's one selection (ctx.selection, ?where=): selecting a box with
// children zooms into it, Esc/Backspace zooms out a level, Home goes to the top.
//
// Files: home-map-layout.js (where boxes go, pure), home-map-draw.js (one level's DOM), home-map-zoom.js (the move),
// home-map-keys.js (keys, tooltip), home-map-data.js (numbers), home-map-offmap.js ("Not on the map"),
// home-map-work.js (inspector tab). Styles: styles/home-map.css.

import { registerHomeView } from './home-state.js';
import { layoutLevel, zoomFor, chainOf, rectsFor } from './home-map-layout.js';
import { buildLayer, paintLayer } from './home-map-draw.js';
import { swapLayers, settle } from './home-map-zoom.js';
import { installMapKeys, makeTip } from './home-map-keys.js';
import { makeOffMap } from './home-map-offmap.js';
import { loadPages, mapStats } from './home-map-data.js';
import { restKey, restArea } from '../../shared/home-map-stats.js';
import { onRunning, startRunning } from './home-running-data.js';
import { activeMainTab } from './state.js';
import './home-map-work.js';

const instances = new WeakMap(); // view root -> instance

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const selectedId = ctx => { const w = ctx.selection(); return w.part || w.area || w.group || null; };
const KIDS = { system: 'areas', group: 'parts', area: '' };

/** a is above b in the tree (null is above everything). */
function above(config, a, b) {
  if (a === b || b === null) return false;
  return a === null || chainOf(config, b).some(x => x.id === a);
}

function legend() {
  const row = el('div', 'hmm-legend');
  row.setAttribute('aria-hidden', 'true');
  for (const [state, text] of [['working', 'working'], ['ci', 'waiting on CI'], ['you', 'waiting on you'], ['ready', 'ready to run']]) {
    const item = el('span', 'hmm-legend-item');
    const dot = el('i', 'hmm-dot');
    dot.dataset.state = state;
    item.append(dot, text);
    row.appendChild(item);
  }
  row.appendChild(el('span', 'hmm-legend-item hmm-legend-keys', 'Click or Enter zooms in · Esc zooms out · arrows move'));
  return row;
}

function build(root, ctx) {
  const inst = { root, ctx, zoom: undefined, layout: null, refs: null, tabStop: null, offs: [] };
  const config = ctx.config();
  const view = el('div', 'hmm');
  root.appendChild(view);
  inst.view = view;
  if (!config || !(config.groups || []).length) {
    const card = el('section', 'hm-card');
    card.appendChild(el('h2', 'hm-card-title', 'Map'));
    card.appendChild(el('p', 'hm-card-text', !ctx.home() ? 'Loading the map...'
      : config ? 'This project\'s map has no groups yet: add "groups" to its home.config.json.' : 'This project has no map yet.'));
    view.appendChild(card);
    return inst;
  }

  const bar = el('div', 'hmm-bar');
  const crumbs = el('nav', 'hmm-crumbs');
  crumbs.setAttribute('aria-label', 'Map level');
  const live = el('span', 'hm-sr');
  live.setAttribute('aria-live', 'polite');
  const offSlot = el('div', 'hmm-offslot');
  bar.append(crumbs, live, offSlot);
  const wrap = el('div', 'hmm-wrap');
  const stage = el('div', 'hmm-stage');
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', 'Map of the project');
  wrap.appendChild(stage);
  view.append(bar, wrap, legend());
  Object.assign(inst, { crumbs, live, wrap, stage, tip: makeTip(wrap), offMap: makeOffMap(offSlot, ctx) });

  const handlers = {
    pick: (id) => {
      inst.tip.hide();
      if (restArea(id)) { // the area's own epics: the area stays the selection
        if (selectedId(ctx) !== restArea(id)) ctx.setSelection(restArea(id));
        focusBox(inst, id);
        return;
      }
      if (id === selectedId(ctx)) { focusBox(inst, id); return; }
      ctx.setSelection(id);
    },
  };
  inst.handlers = handlers;

  installMapKeys(stage, {
    layout: () => inst.layout,
    focusBox: id => focusBox(inst, id),
    out: () => zoomOut(inst),
    top: () => { if (inst.zoom === null && !selectedId(ctx)) return false; ctx.clearSelection(); return true; },
  });
  stage.addEventListener('click', (e) => {
    if (e.target.closest('.hmm-hit, .hmm-mini')) return;
    const sel = selectedId(ctx);
    if (sel && sel !== inst.zoom) { if (inst.zoom) ctx.setSelection(inst.zoom); else ctx.clearSelection(); }
  });
  wireTip(inst);

  const offSel = ctx.subscribe((e) => { if (e.type === 'selection') follow(inst); });
  inst.offs.push(offSel, onRunning(() => paint(inst)), loadPages(config, () => paint(inst)));
  const centre = root.closest('.hm-centre');
  inst.ro = new ResizeObserver(() => resize(inst));
  inst.ro.observe(wrap);
  if (centre) inst.ro.observe(centre);
  startRunning(() => activeMainTab === 'home');
  resize(inst);
  return inst;
}

/** Fit the stage to the space under it, then lay the level out again when its size changed. */
function resize(inst) {
  const { wrap, stage, root } = inst;
  if (!wrap || !wrap.isConnected) return;
  const centre = root.closest('.hm-centre');
  const legendH = inst.view.querySelector('.hmm-legend')?.offsetHeight || 0;
  if (centre) {
    const bottom = centre.getBoundingClientRect().bottom - parseFloat(getComputedStyle(centre).paddingBottom || '0');
    const h = Math.max(380, Math.floor(bottom - wrap.getBoundingClientRect().top - legendH - 12));
    if (Math.abs(wrap.offsetHeight - h) > 1) wrap.style.height = `${h}px`;
  }
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  if (!W || !H) return;
  if (inst.layout && inst.layout.W === W && inst.layout.H === H && inst.zoom !== undefined) return;
  draw(inst, zoomFor(inst.ctx.config(), selectedId(inst.ctx)), null);
}

/** Draw the level of `zoom`; `move` is { dir, anchor } for an animated change, null to swap in place. */
function draw(inst, zoom, move) {
  const { stage, ctx } = inst;
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  if (!W || !H) return;
  const hadFocus = stage.contains(document.activeElement);
  const focusedId = hadFocus ? document.activeElement.closest?.('.hmm-hit')?.dataset.box : null;
  settle(stage);
  const old = inst.refs;
  const layout = layoutLevel(ctx.config(), zoom, W, H, { rest: restBox(inst, zoom) });
  const refs = buildLayer(layout, ctx.config(), inst.handlers);
  stage.appendChild(refs.el);
  inst.refs = refs;
  inst.layout = layout;
  const levelChanged = inst.zoom !== zoom;
  inst.zoom = zoom;
  paint(inst);
  if (old) {
    if (move) swapLayers(stage, old.el, refs.el, move.dir, move.anchor, W, H);
    else old.el.remove();
  }
  const ids = layout.boxes.map(b => b.id);
  const sel = selectedId(ctx);
  let stop = move?.stop || (ids.includes(focusedId) ? focusedId : null) || (ids.includes(inst.tabStop) && !levelChanged ? inst.tabStop : null);
  if (!ids.includes(stop)) stop = ids.includes(sel) ? sel : ids[0];
  setTabStop(inst, stop);
  if (hadFocus && stop) { // focus kept across a zoom is not a key move: no tooltip for it
    inst.quietFocus = true;
    refs.boxes.get(stop)?.hit.focus({ preventScroll: true });
    inst.quietFocus = false;
  }
  paintCrumbs(inst);
  if (levelChanged) {
    const where = zoom ? chainOf(ctx.config(), zoom).pop()?.name : 'System';
    inst.live.textContent = `${where}: ${ids.length} ${KIDS[layout.kind] || 'parts'}`.trim();
  }
}

/** An area with parts whose own epics (on none of its parts) are open or running gets one more box for them. */
function restBox(inst, zoom) {
  const s = zoom ? mapStats(inst.ctx).get(restKey(zoom)) : null;
  if (!s || !(s.openEpics || s.review || s.running.working || s.running.waitingCi || s.running.waitingYou)) return null;
  const area = chainOf(inst.ctx.config(), zoom).pop();
  return { id: restKey(zoom), name: 'Whole area', what: `Epics placed on ${area.name} itself, on none of its parts.` };
}

function setTabStop(inst, id) {
  inst.tabStop = id;
  for (const [bid, r] of inst.refs?.boxes || []) r.hit.tabIndex = bid === id ? 0 : -1;
}

function focusBox(inst, id) {
  const r = inst.refs?.boxes.get(id);
  if (!r) return;
  setTabStop(inst, id);
  r.hit.focus({ preventScroll: true });
}

/** The selection changed (here, in another view, the inspector or the URL): zoom when its level changed. */
function follow(inst) {
  const { ctx } = inst;
  if (!inst.stage) return;
  const config = ctx.config();
  const next = zoomFor(config, selectedId(ctx));
  if (next === inst.zoom || inst.zoom === undefined) {
    paint(inst);
    const sel = selectedId(ctx);
    if (inst.refs?.boxes.has(sel)) setTabStop(inst, sel);
    paintCrumbs(inst);
    return;
  }
  inst.tip.hide();
  const prev = inst.zoom;
  let move = { dir: 'fade', anchor: null };
  const anchorIn = (layout, id) => {
    const rects = rectsFor(layout);
    const hit = chainOf(config, id).reverse().find(b => rects.has(b.id));
    return hit ? rects.get(hit.id) : null;
  };
  if (above(config, prev, next)) {
    move = { dir: 'in', anchor: anchorIn(inst.layout, next) };
  } else if (above(config, next, prev)) {
    const W = inst.stage.clientWidth;
    const H = inst.stage.clientHeight;
    const target = layoutLevel(config, next, W, H);
    const rects = rectsFor(target);
    const back = chainOf(config, prev).reverse().find(b => rects.has(b.id) && target.boxes.some(x => x.id === b.id));
    move = { dir: 'out', anchor: anchorIn(target, prev), stop: back?.id };
  }
  draw(inst, next, move);
}

function zoomOut(inst) {
  const { ctx } = inst;
  if (inst.zoom === null || inst.zoom === undefined) return false;
  const chain = chainOf(ctx.config(), inst.zoom);
  const parent = chain.length > 1 ? chain[chain.length - 2].id : null;
  if (parent) ctx.setSelection(parent); else ctx.clearSelection();
  return true;
}

function paint(inst) {
  if (!inst.refs) return;
  try {
    paintLayer(inst.refs, inst.ctx, selectedId(inst.ctx));
    inst.offMap?.paint();
  } catch (e) {
    console.error('Map: painting the numbers failed', e);
  }
}

function crumb(inst, id, name, current) {
  const b = el('button', 'hmm-crumb', name);
  b.type = 'button';
  b.dataset.hmKey = `crumb-${id || 'system'}`;
  if (current) b.setAttribute('aria-current', 'location');
  b.addEventListener('click', () => {
    const { ctx } = inst;
    if (!id) ctx.clearSelection(); else ctx.setSelection(id);
  });
  return b;
}

function paintCrumbs(inst) {
  const { ctx, crumbs } = inst;
  const config = ctx.config();
  const path = inst.zoom ? chainOf(config, inst.zoom) : [];
  const sel = selectedId(ctx);
  const leaf = sel && sel !== inst.zoom ? chainOf(config, sel).pop() : null;
  const items = [[null, 'System'], ...path.map(b => [b.id, b.name]), ...(leaf ? [[leaf.id, leaf.name]] : [])];
  const sig = items.map(i => i[0]).join('>');
  if (crumbs.dataset.sig === sig) return;
  const had = crumbs.contains(document.activeElement) ? document.activeElement.dataset.hmKey : null;
  const before = crumbs.dataset.sig ? crumbs.dataset.sig.split('>') : [];
  crumbs.dataset.sig = sig;
  crumbs.textContent = '';
  items.forEach(([id, name], i) => {
    if (i) crumbs.appendChild(el('span', 'hmm-sep', '›')).setAttribute('aria-hidden', 'true');
    const b = crumb(inst, id, name, i === items.length - 1);
    if (leaf && id === leaf.id) b.classList.add('hmm-crumb-leaf');
    if (before[i] !== (id || '')) b.classList.add('hmm-crumb-new');
    crumbs.appendChild(b);
  });
  if (had) crumbs.querySelector(`[data-hm-key="${had}"]`)?.focus({ preventScroll: true });
}

function tipInfo(inst, target) {
  const id = target.dataset.box;
  for (const r of inst.refs?.boxes.values() || []) {
    if (r.b.id === id) {
      const notes = [];
      if (r.talks?.length) notes.push(`Connects to ${r.talks.join(', ')}.`);
      if (r.page === 'ok') notes.push('Has a handbook page.');
      if (r.page === 'stale') notes.push('Its handbook page is out of date.');
      if (inst.layout.kind !== 'area' && r.b.kids) notes.push(`${r.b.kids} ${KIDS[inst.layout.kind]} inside: click to zoom in.`);
      return { key: id, name: r.b.box.name, what: r.b.box.what, words: r.words, notes };
    }
    const m = r.minis.get(id);
    if (m) return { key: id, name: m.m.box.name, what: m.m.box.what, words: m.words, notes: [`In ${r.b.box.name}: click to go straight there.`] };
  }
  return null;
}

function wireTip(inst) {
  const { stage, wrap, tip } = inst;
  const at = (e) => { const r = wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  stage.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('.hmm-mini, .hmm-hit');
    if (!t) { tip.hide(); return; }
    const info = tipInfo(inst, t);
    if (info) tip.show(info, at(e));
  });
  stage.addEventListener('pointermove', e => tip.move(at(e)));
  stage.addEventListener('pointerleave', () => tip.hide());
  stage.addEventListener('pointerdown', () => tip.hide());
  stage.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('.hmm-hit');
    if (!t || inst.quietFocus || !t.matches(':focus-visible')) return;
    const info = tipInfo(inst, t);
    const r = inst.refs.boxes.get(t.dataset.box)?.b.rect;
    if (info && r) tip.show(info, { x: r.x + Math.min(r.w, 220) - 10, y: r.y + Math.min(r.h, 70) - 14 }, { delay: 250 });
  });
  stage.addEventListener('focusout', () => tip.hide());
}

function render(root, ctx) {
  dispose(root);
  const inst = build(root, ctx);
  instances.set(root, inst);
}

function update(root, ctx) {
  const inst = instances.get(root);
  if (!inst || inst.ctx !== ctx) { root.textContent = ''; render(root, ctx); return; }
  paint(inst);
}

function dispose(root) {
  const inst = instances.get(root);
  if (!inst) return;
  instances.delete(root);
  inst.offs.forEach(off => off?.());
  inst.ro?.disconnect();
  inst.offMap?.dispose();
  if (inst.stage) settle(inst.stage);
}

registerHomeView({ id: 'map', label: 'Map', key: 2, render, update, dispose });
