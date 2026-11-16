/**
 * shared/running.js (PRO117): which tickets have live work right now. Pure: no fs, no child_process.
 *
 *   computeRunning(doc, inputs, opts) -> { running, loose, epics, byTicket }
 *
 * inputs = {
 *   sessions: [{ id, file, mtime, startedAt?, ticketIds[], project? }],   live Claude Code sessions
 *   branches: [{ repo, branch, via: 'worktree'|'recent commit', lastCommitAt? }],
 *   autorun:  { at, intervalMin, liveEpics[] } | null,                    the dispatcher's tick
 *   prs:      { [branchOrUrl]: { url, state, checks: 'pending'|'passing'|'failing'|null } },
 *   now,                                                                   ms
 * }
 * opts = { liveSessionMinutes: 20, recentCommitHours: 6, staleDays: 7, project? }
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

export function computeRunning(doc, inputs = {}, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const now = toMs(inputs.now) ?? Date.now();
  const all = [];
  for (const s of doc?.sections || []) for (const t of s.tasks || []) all.push({ ...t, status: s.id });
  const byId = new Map(all.map(t => [t.id, t]));
  const children = new Map();
  for (const t of all) if (t.parentId) (children.get(t.parentId) || children.set(t.parentId, []).get(t.parentId)).push(t);
  const inProject = t => !o.project || t.project === o.project;
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

  for (const s of inputs.sessions || []) {
    const m = toMs(s.mtime);
    if (m === null || now - m > o.liveSessionMinutes * 60e3) continue;
    for (const id of s.ticketIds || []) add(String(id).toUpperCase(), 'session', { since: toMs(s.startedAt) });
  }
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
  }

  return { running: items, loose: items.filter(i => i.epicId === null), epics, byTicket };
}
