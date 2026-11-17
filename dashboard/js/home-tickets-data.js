// home-tickets-data.js — what the Home Tickets view and inspector tab show (PRO119): the rows (cached until the
// tickets, the map or the running work change), the model of one filter state (counts, shown rows, display
// items), and the view state kept in the address and per project. Rules live in shared/home-ticket-rows.js.

import { openEpicReadiness } from '../../shared/epic-ready.js';
import {
  ticketRows, filterRows, sortRows, groupRows, countByState, STATES,
} from '../../shared/home-ticket-rows.js';
import {
  DEFAULT_TICKET_VIEW, parseTicketParams, ticketParamsString, hasTicketParams, withTicketParams,
} from '../../shared/home-ticket-params.js';
import { getRunning } from './home-running-data.js';
import { selectedEpicIds } from './home-where.js';

// ===== rows =====

let cache = { doc: null, fp: '', config: null, running: '', rows: [], lanes: [], models: [], ms: 0 };

/** A cheap fingerprint of the tickets: changes whenever a ticket moves, is edited, ticked or added. */
function fingerprintOf(doc) {
  const parts = [];
  for (const s of doc.sections || []) {
    for (const t of s.tasks || []) {
      parts.push(`${t.id}|${s.id}|${t.updated || ''}|${t.checked ? 1 : 0}|${t.blocked ? 1 : 0}|${t.checks?.length || 0}|${t.asks?.length || 0}|${t.reviewNotes?.length || 0}|${t.blockedBy?.length || 0}`);
    }
  }
  return parts.join('\n');
}

/** Every ticket's row (see shared/home-ticket-rows.js). Rebuilt only when something it depends on changed. */
export function getRows(ctx) {
  const doc = ctx.doc();
  const config = ctx.config();
  const running = getRunning()?.byTicket || null;
  const runSigOf = () => Object.entries(running || {}).map(([id, r]) => `${id}:${r.state}:${r.pr || ''}`).join(','); // a new answer with the same work is not a change
  if (cache.doc === doc && cache.config === config && cache.runObj === running) return cache.rows; // same snapshot: no work
  const runSig = runSigOf();
  const fp = fingerprintOf(doc);
  if (cache.fp === fp && cache.config === config && cache.running === runSig) { cache.doc = doc; cache.runObj = running; return cache.rows; }
  const t0 = performance.now();
  const readiness = Object.fromEntries(openEpicReadiness(doc).map(r => [r.id, r]));
  const rows = ticketRows(doc, config, readiness, running || {});
  const lanes = [...new Set(rows.map(r => r.lane).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const models = [...new Set(rows.map(r => r.model).filter(Boolean))].sort();
  cache = { doc, runObj: running, fp, config, running: runSig, rows, lanes, models, ms: performance.now() - t0 };
  return rows;
}

/** How long the last full rebuild took, in ms (for measuring). */
export const lastBuildMs = () => cache.ms;

// ===== one filter state -> what to show =====

/**
 * @param {object} ctx
 * @param {object} vs the view state (shared/home-ticket-params.js)
 * @param {{ place?: boolean, folds?: Set<string> }} [opts] place: narrow by the map selection (default true)
 * @returns {{ rows, counts, shown, total, groups, items, lanes, models, placeName }}
 */
export function computeModel(ctx, vs, { place = true, folds = new Set() } = {}) {
  const rows = getRows(ctx);
  const placeSet = place ? selectedEpicIds(ctx) : null;
  const common = { text: vs.text, types: vs.types, lane: vs.lane, model: vs.model, label: vs.label };
  const showDone = vs.showDone || vs.states.includes('done');
  const noState = filterRows(rows, { ...common, place: placeSet, showDone: true });
  const counts = countByState(noState);
  counts.all = showDone ? noState.length : noState.length - counts.done;
  const wanted = vs.states.length ? new Set(vs.states) : null;
  const shown = sortRows(noState.filter(r => (!wanted || wanted.has(r.state)) && (showDone || r.state !== 'done')), vs.sort, vs.dir);
  const total = placeSet ? filterRows(rows, { ...common, states: vs.states, showDone: vs.showDone }).length : shown.length;
  const groups = groupRows(shown, vs.group);
  const items = [];
  for (const g of groups) {
    if (vs.group === 'none') { for (const row of g.rows) items.push({ kind: 'row', key: `r:${row.id}`, row }); continue; }
    const gk = `${vs.group}:${g.key}`;
    const collapsed = folds.has(gk);
    items.push({ kind: 'group', key: `g:${gk}`, foldKey: gk, groupKey: g.key, label: g.label, count: g.rows.length, counts: g.counts, collapsed });
    if (!collapsed) for (const row of g.rows) items.push({ kind: 'row', key: `r:${row.id}`, row });
  }
  return { rows, counts, shown, total, groups, items, lanes: cache.lanes, models: cache.models, all: rows.length };
}

export { STATES };

// ===== view state: address and per-project memory =====

const memory = new Map(); // project -> view state (kept while the page is open)
const KEY = 'home.tickets.v1.';
const slug = project => project || '_';

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage off: still works for this visit */ } }

/** The view state to open with: the address when it names one, else what this project last used, else the default. */
export function loadViewState(project) {
  if (hasTicketParams(window.location.search)) return parseTicketParams(window.location.search);
  if (memory.has(slug(project))) return memory.get(slug(project));
  const stored = safeGet(KEY + slug(project));
  return stored ? parseTicketParams(`?${stored}`) : { ...DEFAULT_TICKET_VIEW };
}

/** Remember the state for this project and write it into the address (replace, never a new history entry). */
export function saveViewState(project, vs) {
  memory.set(slug(project), vs);
  safeSet(KEY + slug(project), ticketParamsString(vs));
  writeUrl(vs);
}

/** Put the state in the address (also used when coming back to the tab and the address lost it). */
export function writeUrl(vs) {
  const target = window.location.pathname + withTicketParams(window.location.search, vs) + window.location.hash;
  if (target !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(window.history.state, '', target);
  }
}
