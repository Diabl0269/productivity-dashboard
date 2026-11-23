/**
 * shared/lifecycle.js (PRO122): the life of a note and a ticket as data, for the Home "How it runs"
 * view. Pure: no fs, no DOM. Each stage counts what sits at that step right now from the sources the
 * rest of the tracker already uses:
 *
 *   note      open review notes (pendingReviewNotes, free notes included)        you
 *   filed     tickets filed from notes in the last 7 days                       session
 *   ready     Ready epics, and how many are on Auto (openEpicReadiness)         script
 *   running   tickets with live work, by state (live running data)              session
 *   asks      questions waiting for you (openAsks + groupAsks, as the Plan)     you      (a side step of running)
 *   review    shipped work waiting for your checks (computeRunPlan().review)    you
 *   done      tickets done in the last 7 days (column history)                  tracker
 *
 * stage = { id, label, who, what, count(doc, live, scope) -> number|null, detail(...) -> string,
 *           items(...) -> rows }. `live` is the running answer ({ running: [{ id, state, ... }] }) or
 * null when unknown (count is then null). `scope` = { epicIds: Set|null, now }: with a set, only
 * work inside those epics counts (the place selected on the map).
 * A project's home.config.json may relabel or hide stages and link each one to the job or skill that does it
 * (`job` = an automation id, `skill` = the skill file, `page` = a handbook page): applyLifecycleConfig(stages, config.lifecycle).
 * Each arrow carries a one-line `travels` text (what moves along it), and a "waits on" arrow runs from the
 * questions back to the running sessions that wait for you (AGE199).
 */

import { pendingReviewNotes } from './review-notes.js';
import { openEpicReadiness } from './epic-ready.js';
import { computeRunPlan } from './run-plan.js';
import { openAsks, groupAsks } from './asks.js';

const DAY_MS = 86400e3;
export const RECENT_DAYS = 7;
export const LIFECYCLE_STAGE_IDS = ['note', 'filed', 'ready', 'running', 'asks', 'review', 'done'];

/** Who acts at a step: legend order, plain words. */
export const WHO = [
  { id: 'you', label: 'You' },
  { id: 'session', label: 'A Claude session' },
  { id: 'script', label: 'A script or scheduled job (no AI)' },
  { id: 'tracker', label: 'The tracker' },
];

export const RUNNING_STATES = [
  { id: 'working', label: 'working' },
  { id: 'waiting-ci', label: 'waiting for CI' },
  { id: 'waiting-you', label: 'waiting for you' },
  { id: 'idle', label: 'idle' },
];

/** The main path, the side step and the loop back, by stage id. */
export const LIFECYCLE_PATH = ['note', 'filed', 'ready', 'running', 'review', 'done'];
export const LIFECYCLE_SIDE = { id: 'asks', attach: 'running', label: 'asks you' };
export const LIFECYCLE_LOOP = { from: 'review', to: 'note', label: 'A note on shipped work sends it round again' };
/** The side step's way back: the sessions that wait for an answer (AGE199). */
export const LIFECYCLE_WAIT = { from: 'asks', to: 'running', label: 'waits on' };

/** What travels along each arrow, one short line (shown on hover), by `from>to`. */
export const EDGE_TRAVELS = Object.freeze({
  'note>filed': 'Your note: its text and the ticket it was written on.',
  'filed>ready': 'A ticket with a plain-words description, inside its epic.',
  'ready>running': 'The next ticket of an epic that is Ready and on Auto.',
  'running>review': 'A pull request, its CI result and a card of checks.',
  'review>done': 'Your ticked checks: the last tick closes the ticket.',
  'running>asks': 'A question a session cannot answer alone.',
  'asks>running': 'Your answer; the session carries on from it.',
  'review>note': 'A note you write on shipped work; it starts the loop again.',
});

/** The keys of a stage entry in the config that link it to what does the work. */
export const STAGE_LINK_KEYS = ['job', 'skill', 'page'];

// ===== indexing =====

const docCache = new WeakMap();
function index(doc) {
  if (doc && docCache.has(doc)) return docCache.get(doc);
  const byId = new Map();
  const sectionOf = new Map();
  for (const s of doc?.sections || []) {
    for (const t of s.tasks || []) {
      if (t?.id && !byId.has(t.id)) { byId.set(t.id, t); sectionOf.set(t.id, s.id); }
    }
  }
  const ix = { byId, sectionOf };
  if (doc && typeof doc === 'object') docCache.set(doc, ix);
  return ix;
}

/** The epic a ticket belongs to (itself when it is one), or null. */
function epicIdOf(ix, id) {
  const seen = new Set();
  let t = ix.byId.get(id);
  while (t && !seen.has(t.id)) {
    if (t.type === 'epic') return t.id;
    seen.add(t.id);
    t = t.parentId ? ix.byId.get(t.parentId) : null;
  }
  return null;
}

/** True when a ticket counts inside the scope's selected place (always true without a place). */
function inScope(ix, id, scope) {
  const set = scope?.epicIds;
  if (!set) return true;
  if (set.has(id)) return true; // a ticket under no epic that the project's scope names (shared/home-scope.js)
  const e = epicIdOf(ix, id);
  return !!e && set.has(e);
}

const nowOf = scope => (Number.isFinite(scope?.now) ? scope.now : Date.now());
const toMs = v => { const n = Date.parse(v); return Number.isFinite(n) ? n : null; };
const ticketRow = (ix, id, extra = {}) => {
  const t = ix.byId.get(id) || {};
  return { kind: 'ticket', id, title: t.title || '', section: ix.sectionOf.get(id) || null, type: t.type || null, ...extra };
};

// ===== the sources =====

function notes(doc, scope) {
  const ix = index(doc);
  const out = [];
  for (const t of pendingReviewNotes(doc)) {
    if (!inScope(ix, t.id, scope)) continue;
    for (const n of t.notes) out.push({ kind: 'note', id: t.id, handle: `${t.id}#${n.n}`, text: n.text || '', noteKind: n.kind || 'fix', at: n.at || null, ticketTitle: t.title || '' });
  }
  return out;
}

function filed(doc, scope) {
  const ix = index(doc);
  const since = nowOf(scope) - RECENT_DAYS * DAY_MS;
  const seen = new Map();
  for (const t of ix.byId.values()) {
    for (const n of t.reviewNotes || []) {
      if (!n || n.state !== 'filed' || !n.filed || seen.has(n.filed)) continue;
      const target = ix.byId.get(n.filed);
      if (!target) continue;
      const created = toMs(target.created) ?? toMs(n.at);
      if (created === null || created < since || !inScope(ix, target.id, scope)) continue;
      seen.set(n.filed, ticketRow(ix, n.filed, { from: `${t.id}#${n.n}` }));
    }
  }
  return [...seen.values()];
}

function ready(doc, scope) {
  const ix = index(doc);
  return openEpicReadiness(doc).filter(r => r.ready && inScope(ix, r.id, scope))
    .map(r => ticketRow(ix, r.id, { auto: !!r.auto, chip: r.auto ? 'Auto' : null }));
}

function running(doc, live, scope) {
  if (!live || !Array.isArray(live.running)) return null;
  const ix = index(doc);
  return live.running.filter(r => r && r.id && inScope(ix, r.id, scope))
    .map(r => ticketRow(ix, r.id, { title: r.title || ix.byId.get(r.id)?.title || '', state: r.state || 'working', chip: (RUNNING_STATES.find(s => s.id === r.state) || RUNNING_STATES[0]).label }));
}

function asks(doc, scope) {
  const ix = index(doc);
  return groupAsks(openAsks(doc)).filter(c => (c.ids || [c.id]).some(id => inScope(ix, id, scope)))
    .map(c => ticketRow(ix, c.id, { title: c.title || ix.byId.get(c.id)?.title || '', question: c.text || '', also: (c.ids || []).filter(id => id !== c.id) }));
}

function review(doc, scope) {
  const ix = index(doc);
  return (computeRunPlan(doc).review || []).filter(r => inScope(ix, r.id, scope))
    .map(r => ticketRow(ix, r.id, { title: r.title || '', checks: r.checks || null, notes: r.notes || 0 }));
}

const FINISHED = new Set(['done', 'archive']);
function done(doc, scope) {
  const ix = index(doc);
  const since = nowOf(scope) - RECENT_DAYS * DAY_MS;
  const out = [];
  for (const [id, t] of ix.byId) {
    if (!FINISHED.has(ix.sectionOf.get(id)) || t.type === 'epic' || !inScope(ix, id, scope)) continue;
    const moves = (t.history || []).filter(h => h && h.event === 'moved' && FINISHED.has(h.to)).map(h => toMs(h.at)).filter(n => n !== null);
    const at = moves.length ? Math.max(...moves) : toMs(t.updated);
    if (at !== null && at >= since) out.push({ ...ticketRow(ix, id), at: new Date(at).toISOString() });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const countOf = (stage, rows) => (stage.countOf ? stage.countOf(rows) : rows.length);

// ===== the stages =====

export const DEFAULT_STAGES = Object.freeze([
  {
    id: 'note', label: 'Note written', who: 'you',
    what: 'You write a note on shipped work or a ticket while you look at it.',
    source: 'Open review notes that no run has filed yet: the same list as "ch tasks notes".',
    items: (doc, live, scope) => notes(doc, scope),
    detail: (doc, live, scope) => { const n = new Set(notes(doc, scope).map(x => x.id)).size; return n ? `on ${plural(n, 'ticket')}` : 'none open'; },
  },
  {
    id: 'filed', label: 'Filed and explained', who: 'session',
    what: 'A notes run turns each note into a ticket and explains it in plain words.',
    source: `Tickets made from a note in the last ${RECENT_DAYS} days.`,
    items: (doc, live, scope) => filed(doc, scope),
    detail: () => `last ${RECENT_DAYS} days`,
  },
  {
    id: 'ready', label: 'Ready to start', who: 'script',
    what: 'An epic with nothing waiting on you is Ready; the ones on Auto start by themselves.',
    source: 'Open epics that are Ready, as "ch tasks ready" lists them.',
    items: (doc, live, scope) => ready(doc, scope),
    detail: (doc, live, scope) => `${ready(doc, scope).filter(r => r.auto).length} on Auto`,
  },
  {
    id: 'running', label: 'Being built', who: 'session',
    what: 'A session builds, tests and proves the work in its own copy, then opens a PR.',
    source: 'Tickets with a live session, a worktree, a recent commit or an autorun run right now ("ch tasks running").',
    items: (doc, live, scope) => running(doc, live, scope),
    countOf: rows => rows.filter(r => r.state !== 'idle').length,
    detail: (doc, live, scope) => {
      const rows = running(doc, live, scope);
      if (!rows) return 'running data unavailable';
      // The count is live work only (shared/home-overview.js, the strip, Tickets); idle work is named here.
      const parts = RUNNING_STATES.map(s => [rows.filter(r => r.state === s.id).length, s.label]).filter(([n]) => n);
      return parts.length ? parts.map(([n, l]) => `${n} ${l}`).join(' · ') : 'nothing running';
    },
  },
  {
    id: 'asks', label: 'Questions for you', who: 'you',
    what: 'A session needs your answer before that work can go on.',
    source: 'Question cards waiting for you, the same cards as on the Plan page.',
    items: (doc, live, scope) => asks(doc, scope),
    detail: (doc, live, scope) => (asks(doc, scope).length ? 'on the Plan page' : 'none open'),
  },
  {
    id: 'review', label: 'Waiting for your checks', who: 'you',
    what: 'Shipped work comes back with checks for you to try and tick.',
    source: 'Tickets in Ready for review, oldest first, as on the Plan page.',
    items: (doc, live, scope) => review(doc, scope),
    detail: (doc, live, scope) => { const n = review(doc, scope).filter(r => r.notes).length; return n ? `${n} with open notes` : 'oldest first'; },
  },
  {
    id: 'done', label: 'Done', who: 'tracker',
    what: 'Your last tick moves the ticket to Done, unless a note on it is still open.',
    source: `Tickets (not epics) moved to Done in the last ${RECENT_DAYS} days.`,
    items: (doc, live, scope) => done(doc, scope),
    detail: () => `last ${RECENT_DAYS} days`,
  },
].map(s => Object.freeze({
  ...s,
  count: (doc, live, scope) => { const rows = s.items(doc, live, scope); return rows === null ? null : countOf(s, rows); },
})));

/**
 * The stages a project shows: the defaults with the config's labels, minus hidden ones.
 * @param {object[]} [stages] DEFAULT_STAGES
 * @param {{ stages: Array<{ id, label?, hide? }> }|null} [overrides] config.lifecycle
 */
export function applyLifecycleConfig(stages = DEFAULT_STAGES, overrides = null) {
  const by = new Map((overrides?.stages || []).map(o => [o.id, o]));
  return stages.filter(s => !by.get(s.id)?.hide).map((s) => {
    const o = by.get(s.id);
    if (!o) return s;
    const links = {};
    for (const k of STAGE_LINK_KEYS) if (typeof o[k] === 'string' && o[k]) links[k] = o[k];
    return o.label || Object.keys(links).length ? { ...s, ...(o.label ? { label: o.label } : {}), ...links } : s;
  });
}

/** Ids of the running sessions that wait for you (state "waiting-you"); [] when the running data is unknown. */
export function waitingSessionIds(live) {
  return Array.isArray(live?.running) ? live.running.filter(r => r && r.id && r.state === 'waiting-you').map(r => r.id) : [];
}

const travelsOf = (from, to) => EDGE_TRAVELS[`${from}>${to}`] || '';

/**
 * The arrows between the shown stages: the main path in order (a hidden stage is skipped, so its
 * neighbours join), the side step to the stage it hangs off, the "waits on" arrow from the questions
 * back to the running sessions that wait for an answer (`ids`, from the live running data), and the loop back.
 * @param {object[]} [stages]
 * @param {{ running: object[] }|null} [live] the running answer (home-running-data.js getRunning())
 * @returns {Array<{ from, to, kind: 'flow'|'side'|'wait'|'loop', label?, travels: string, ids?: string[] }>}
 */
export function lifecycleEdges(stages = DEFAULT_STAGES, live = null) {
  const shown = new Set(stages.map(s => s.id));
  const path = LIFECYCLE_PATH.filter(id => shown.has(id));
  const edges = [];
  for (let i = 1; i < path.length; i++) edges.push({ from: path[i - 1], to: path[i], kind: 'flow', travels: travelsOf(path[i - 1], path[i]) });
  if (shown.has(LIFECYCLE_SIDE.id) && shown.has(LIFECYCLE_SIDE.attach)) {
    edges.push({ from: LIFECYCLE_SIDE.attach, to: LIFECYCLE_SIDE.id, kind: 'side', label: LIFECYCLE_SIDE.label, travels: travelsOf(LIFECYCLE_SIDE.attach, LIFECYCLE_SIDE.id) });
    edges.push({ ...LIFECYCLE_WAIT, kind: 'wait', travels: travelsOf(LIFECYCLE_WAIT.from, LIFECYCLE_WAIT.to), ids: waitingSessionIds(live) });
  }
  if (shown.has(LIFECYCLE_LOOP.from) && shown.has(LIFECYCLE_LOOP.to)) edges.push({ ...LIFECYCLE_LOOP, kind: 'loop', travels: travelsOf(LIFECYCLE_LOOP.from, LIFECYCLE_LOOP.to) });
  return edges;
}

/** Every shown stage's count, detail line and items in one pass: { [id]: { count, detail, items } }. */
export function lifecycleSnapshot(doc, live = null, scope = {}, stages = DEFAULT_STAGES) {
  const out = {};
  for (const s of stages) {
    const items = s.items(doc, live, scope);
    out[s.id] = { count: items === null ? null : countOf(s, items), detail: s.detail(doc, live, scope), items: items || [] };
  }
  return out;
}
