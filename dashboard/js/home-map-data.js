// home-map-data.js — the numbers the Map view and its Work tab read (PRO39), worked out once per refresh.
// Rules live in shared/home-map-stats.js; readiness is the Plan page's (openEpicReadiness); running work is
// home-running-data.js. Everything is cached on the doc object, which home-view.js replaces on every refresh.
//
//   readinessById(ctx)      -> Map(epic id -> epicReadiness row)
//   mapStats(ctx)           -> Map(box id -> stats), the whole project under ROOT ('')
//   boxEpics(ctx, boxId)    -> [{ epic, where }] of a box and everything inside it (null = the whole map)
//   offMap(ctx)             -> open epics that only reached the fallback area, with the rule that would place them
//   epicRun(epicId)         -> 'waiting-you' | 'waiting-ci' | 'working' | null (the most urgent running ticket)
//   pageState(boxId)        -> 'ok' | 'stale' | 'missing' | 'none' when a handbook-pages module is present

import { boxStats, epicsInBox, notOnMap } from '../../shared/home-map-stats.js';
import { openEpicReadiness } from '../../shared/epic-ready.js';
import { getRunning } from './home-running-data.js';

const cache = new WeakMap(); // doc -> { readiness, stats: { key, value }, offMap, boxes: Map }

function slot(ctx) {
  const doc = ctx.doc();
  let c = cache.get(doc);
  if (!c) cache.set(doc, c = { readiness: null, stats: null, offMap: null, boxes: new Map(), config: null });
  if (c.config !== ctx.config() || c.project !== ctx.project()) {
    Object.assign(c, { stats: null, offMap: null, boxes: new Map(), config: ctx.config(), project: ctx.project() });
  }
  return { doc, c };
}

export function readinessById(ctx) {
  const { doc, c } = slot(ctx);
  if (!c.readiness) c.readiness = new Map(openEpicReadiness(doc).map(r => [r.id, r]));
  return c.readiness;
}

export function mapStats(ctx) {
  const { doc, c } = slot(ctx);
  const running = getRunning();
  if (!c.stats || c.stats.running !== running) {
    c.stats = { running, value: boxStats(ctx.config(), doc, readinessById(ctx), running, { project: ctx.project() }) };
  }
  return c.stats.value;
}

export function boxEpics(ctx, boxId) {
  const { doc, c } = slot(ctx);
  const key = boxId || '';
  if (!c.boxes.has(key)) c.boxes.set(key, epicsInBox(ctx.config(), doc, boxId || null, { project: ctx.project() }));
  return c.boxes.get(key);
}

export function offMap(ctx) {
  const { doc, c } = slot(ctx);
  if (!c.offMap) c.offMap = ctx.config() ? notOnMap(ctx.config(), doc, { project: ctx.project() }) : [];
  return c.offMap;
}

const URGENCY = ['waiting-you', 'waiting-ci', 'working'];

export function epicRun(epicId) {
  const items = (getRunning()?.running || []).filter(i => i.epicId === epicId);
  return URGENCY.find(st => items.some(i => i.state === st)) || null;
}

// The handbook-pages feature is optional: its module is loaded once when it exists.
let pages = null;
let pagesTried = false;
const pageListeners = new Set();

/** Load the pages module once (when the config names any page); fn() runs when it arrives. */
export function loadPages(config, fn) {
  if (fn) pageListeners.add(fn);
  const anyPage = (config?.groups || []).some(g => g.page || g.areas?.some(a => a.page || a.parts?.some(p => p.page)));
  if (pagesTried || !anyPage) return () => pageListeners.delete(fn);
  pagesTried = true;
  import('./home-pages-data.js')
    .then((m) => { if (typeof m.pageStateFor === 'function') { pages = m; for (const f of pageListeners) f(); } })
    .catch(() => { pages = null; });
  return () => pageListeners.delete(fn);
}

export function pageState(boxId) {
  try { return pages ? pages.pageStateFor(boxId) : 'none'; } catch { return 'none'; }
}
