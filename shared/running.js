/**
 * shared/running.js (PRO117): which tickets have live work right now. Pure: no fs, no child_process.
 *
 *   computeRunning(doc, inputs, opts) -> { running, loose, epics, byTicket }
 *
 * inputs = {
 *   sessions: [{ id, file, mtime, startedAt?, ticketIds[], mentionedIds?[], archived?, title?, subagentOf?, project? }],
 *             Claude Code sessions. `ticketIds` are the tickets the session WORKS ON (its /ship-task argument, its name,
 *             its branch or worktree); `mentionedIds` are ids its prompt merely names and never count (AGE200, bug kind
 *             count-from-mentions). `archived` is true/false from the desktop app's session file, null when unknown
 *             ("unsure": still counted, flagged). An archived session is never live. A subagent (`subagentOf`) counts
 *             with its parent session.
 *   branches: [{ repo, branch, via: 'worktree'|'recent commit', lastCommitAt? }],
 *   autorun:  { at, intervalMin, liveEpics[] } | null,                    the dispatcher's tick
 *   prs:      { [branchOrUrl]: { url, state, checks: 'pending'|'passing'|'failing'|null } },
 *   now,                                                                   ms
 * }
 * opts = { liveSessionMinutes: 20, recentCommitHours: 6, staleDays: 7, project?, scope? (home-scope.js projectScope; wins over project) }
 *
 * Rules (ported from a handbook-map prototype):
 *  - ticket ids are found with ID_RE in branch names and session prompts (the caller extracts the session ids
 *    with extractTicketIds); only tickets in inbox/backlog/todo/in-progress count (a ticket in review is
 *    finished work, not running work);
 *  - running work attaches to the ticket's open epic (the ticket itself when it is an epic), or goes to
 *    `loose` when there is none;
 *  - an open epic in in-progress with nothing running is `stale` when no column move or creation of it or a
 *    child is newer than staleDays, else `idle`.
 * Per running ticket: state waiting-you > waiting-ci > working > idle, `since`, `sources`, `pr`.
 * `running` lists every running ticket (loose ones too, with epicId null); `loose` is the subset with no open epic.
 */
import { openAsks } from './asks.js';
import { epicReadiness, plainReasonLine } from './epic-ready.js';

export const DEFAULT_OPTS = { liveSessionMinutes: 20, recentCommitHours: 6, staleDays: 7 };
export const ID_RE = /\b[A-Z]{1,4}\d+\b/g;
export const RUNNABLE_SECTIONS = new Set(['inbox', 'backlog', 'todo', 'in-progress']);
const OPEN_SECTIONS = new Set(['inbox', 'backlog', 'todo', 'in-progress', 'review']);
const SOURCE_ORDER = ['session', 'autorun', 'worktree', 'recent commit'];
const STATE_RANK = { 'waiting-you': 0, 'waiting-ci': 1, working: 2, idle: 3 };
const DAY_MS = 86400e3;

/** Ticket ids named in free text (a branch name or a prompt), upper-cased, in order, unique. */
export function extractTicketIds(text) {
  return [...new Set(String(text ?? '').toUpperCase().match(ID_RE) || [])];
}

const toMs = v => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
const iso = ms => (ms === null ? null : new Date(ms).toISOString());

/** Column moves (not text edits) and the creation date of a ticket, as date strings. */
function touchStamps(t) {
  return [...(t.history || []).filter(h => h.event === 'moved' && h.at).map(h => String(h.at).slice(0, 10)), t.created || ''];
}

function lastMoveToInProgress(t) {
  const moves = (t.history || []).filter(h => h.event === 'moved' && h.to === 'in-progress');
  return moves.length ? moves[moves.length - 1].at : null;
}

/** Why an item with only a worktree or a recent commit is idle, in plain words. */
function idleWhyOf(t, e) {
  const how = e.sources.has('worktree') ? 'a worktree' : 'a recent commit';
  if (t.status === 'in-progress') return `Idle: only ${how} names it and no session is working on it; start a session or move it back to To do`;
  return `Idle: only ${how} names it, but it is still in ${t.status === 'todo' ? 'To do' : t.status}; no session is working on it`;
}

/** What an in-progress epic with nothing running needs, from the Plan page's readiness: `idleWhy`, `promoteIds`, `auto`. */
function idleEpic(doc, epic) {
  let r = null;
  try { r = epicReadiness(doc, epic); } catch { /* an unreadable epic gets the plain fallback */ }
  if (!r) return { idleWhy: 'Idle: nothing is running on it', promoteIds: [], ready: null, auto: false };
  const text = r.ready ? 'a ticket is ready, but nothing is running on it: turn on Auto to start it' : plainReasonLine(r).replace(/^Not ready:\s*/i, '');
  return { idleWhy: `Idle: ${text.charAt(0).toLowerCase()}${text.slice(1)}`, promoteIds: r.promotable || [], ready: !!r.ready, auto: !!r.auto };
}

export function computeRunning(doc, inputs = {}, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const now = toMs(inputs.now) ?? Date.now();
  const all = [];
  for (const s of doc?.sections || []) for (const t of s.tasks || []) all.push({ ...t, status: s.id });
  const byId = new Map(all.map(t => [t.id, t]));
  const children = new Map();
  for (const t of all) if (t.parentId) (children.get(t.parentId) || children.set(t.parentId, []).get(t.parentId)).push(t);
  // A project counts with its sub-projects (meta.projects parentId), as the Home page shows them together.
  const family = new Set(o.project ? [o.project] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of doc?.meta?.projects || []) if (p?.parentId && family.has(p.parentId) && !family.has(p.id)) { family.add(p.id); grew = true; }
  }
  // `scope` (shared/home-scope.js projectScope) is the Home page's rule; without it, the project family only.
  const inProject = t => (o.scope ? o.scope.hasId(t.id) : !o.project || family.has(t.project));
  const epicOf = t => {
    const seen = new Set();
    let c = t;
    while (c && c.type !== 'epic' && c.parentId && !seen.has(c.id)) { seen.add(c.id); c = byId.get(c.parentId); }
    return c && c.type === 'epic' ? c : null;
  };
  const openEpicOf = t => { const e = epicOf(t); return e && OPEN_SECTIONS.has(e.status) ? e : null; };

  // Tickets with an open ask for the user (own asks, legacy questions, waitingOn naming the user).
  const askIds = new Set(openAsks(doc).map(a => a.id));

  // ---- evidence per ticket ----
  const ev = new Map(); // id -> { sources:Set, since:[ms], repo, branch }
  const add = (id, source, { since = null, repo, branch } = {}) => {
    const t = byId.get(id);
    if (!t || !RUNNABLE_SECTIONS.has(t.status) || !inProject(t)) return;
    const e = ev.get(id) || ev.set(id, { sources: new Set(), since: [], repo: null, branch: null }).get(id);
    e.sources.add(source);
    if (since !== null) e.since.push(since);
    if (repo && !e.repo) { e.repo = repo; e.branch = branch || null; }
  };

  // ---- sessions: one per conversation (a subagent belongs to its parent), live = recent transcript and not archived ----
  const fam = new Map(); // session id -> { id, title, since, unsure, ids:Set, mentioned:Set }
  for (const s of inputs.sessions || []) {
    const m = toMs(s.mtime);
    if (m === null || now - m > o.liveSessionMinutes * 60e3) continue;
    if (s.archived === true) continue;
    const key = s.subagentOf || s.id;
    const f = fam.get(key) || fam.set(key, { id: key, title: '', since: null, unsure: false, ids: new Set(), mentioned: new Set() }).get(key);
    if (s.archived !== false) f.unsure = true;
    if (!s.subagentOf && s.title) f.title = s.title;
    const st = toMs(s.startedAt);
    if (st !== null && !s.subagentOf && (f.since === null || st < f.since)) f.since = st;
    for (const id of s.ticketIds || []) f.ids.add(String(id).toUpperCase());
    for (const id of s.mentionedIds || []) f.mentioned.add(String(id).toUpperCase());
  }
  const sessions = [];
  const mentioned = {};
  const sessionsOf = new Map(); // ticket id -> [session id]
  for (const f of fam.values()) {
    const counted = [];
    for (const id of f.ids) {
      if (!byId.get(id) || !RUNNABLE_SECTIONS.has(byId.get(id).status) || !inProject(byId.get(id))) continue;
      add(id, 'session', { since: f.since });
      counted.push(id);
      (sessionsOf.get(id) || sessionsOf.set(id, []).get(id)).push(f.id);
    }
    let named = false; // a session that only names tickets of the scope is still a session you see there; its tickets do not count
    for (const id of f.mentioned) {
      if (f.ids.has(id) || !byId.has(id)) continue;
      (mentioned[id] || (mentioned[id] = [])).push(f.id);
      if (inProject(byId.get(id))) named = true;
    }
    // Unscoped, every live session counts; scoped, those that work on or name a ticket of the scope.
    if ((!o.scope && !o.project) || counted.length || named) sessions.push({ id: f.id, title: f.title, since: iso(f.since), unsure: f.unsure, ticketIds: counted });
  }
  sessions.sort((a, b) => String(a.since || '~').localeCompare(String(b.since || '~')) || a.id.localeCompare(b.id));
  for (const b of inputs.branches || []) {
    const last = toMs(b.lastCommitAt);
    if (b.via === 'recent commit' && (last === null || now - last > o.recentCommitHours * 3600e3)) continue;
    for (const id of extractTicketIds(b.branch)) {
      add(id, b.via === 'worktree' ? 'worktree' : 'recent commit', { since: last, repo: b.repo, branch: b.branch });
    }
  }
  for (const id of inputs.autorun?.liveEpics || []) add(String(id).toUpperCase(), 'autorun');

  const byTicket = {};
  const items = [];
  for (const [id, e] of ev) {
    const t = byId.get(id);
    const epic = openEpicOf(t);
    const pr = (e.branch && inputs.prs?.[e.branch]) || null;
    const waitingYou = askIds.has(id) || (epic !== null && askIds.has(epic.id));
    const live = e.sources.has('session') || e.sources.has('autorun');
    const state = waitingYou ? 'waiting-you' : pr?.checks === 'pending' ? 'waiting-ci' : live ? 'working' : 'idle';
    const rec = { state, since: iso(e.since.length ? Math.min(...e.since) : null), sources: SOURCE_ORDER.filter(s => e.sources.has(s)) };
    if (pr?.url) rec.pr = pr.url;
    if (e.repo) { rec.repo = e.repo; rec.branch = e.branch; }
    if (sessionsOf.has(id)) rec.sessionIds = sessionsOf.get(id);
    if (state === 'idle') rec.idleWhy = idleWhyOf(t, e);
    byTicket[id] = rec;
    items.push({ id, title: t.title || '', section: t.status, epicId: epic ? epic.id : null, ...rec });
  }
  items.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || String(a.since || '~').localeCompare(String(b.since || '~')) || a.id.localeCompare(b.id));

  // ---- epics ----
  const epics = {};
  for (const e of all.filter(t => t.type === 'epic' && OPEN_SECTIONS.has(t.status) && inProject(t))) {
    const mine = items.filter(i => i.epicId === e.id);
    const stamps = [e, ...(children.get(e.id) || [])].flatMap(touchStamps).sort();
    const touched = stamps.length ? stamps[stamps.length - 1] || null : null;
    let state = null;
    if (mine.length) state = 'running';
    else if (e.status === 'in-progress') {
      const touchedMs = touched ? Date.parse(touched) : NaN;
      state = Number.isFinite(touchedMs) && (now - touchedMs) / DAY_MS > o.staleDays ? 'stale' : 'idle';
    }
    epics[e.id] = { state, running: mine.map(i => i.id), lastTouched: touched, inProgressSince: lastMoveToInProgress(e) };
    if (state === 'idle' || state === 'stale') Object.assign(epics[e.id], idleEpic(doc, e));
  }

  return { running: items, loose: items.filter(i => i.epicId === null), epics, byTicket, sessions, mentioned };
}
