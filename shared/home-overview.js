/**
 * shared/home-overview.js (PRO129): what the Home Overview shows, as plain data. Pure: no fs, no DOM, no clock
 * (the caller passes `now`). It adds no rule of its own: every number comes from an existing shared function,
 * named per section below, and the selected place narrows each section to the epics it holds.
 *
 *   overviewModel(doc, config, readinessById, running, now, extras?) -> {
 *     place, summary: { text, segments[] }, needsYou, running, agenda, finished, places, notes, health }
 *
 * doc            tasks.json shape ({ meta, sections[].tasks[] })
 * config         the project's normalised home config (shared/home-config.js), or null
 * readinessById  Map of epic id -> epicReadiness row (shared/epic-ready.js openEpicReadiness)
 * running        the /api/home/running answer (shared/running.js computeRunning), or null
 * now            ms
 * extras         { epicIds?: Set|null (home-scope: the selected place's epics, else the project's ids), projectIds? (the
 *                  project's ids, for "Where the work is", which keeps the whole map), placeName? (only
 *                  when a place is selected), noteScope? (only when a place is selected), noteProjects? (Set: the
 *                  project family a free note must be in), nextStart? (computeNextStart's
 *                  answer), where? ({ group, area, part } selected), health? (home-health-data getHealth()),
 *                  rows? (rows per card, default 5) }
 *
 * Every item: { key, id, title, line, kind, at?, target: { view, ticket?, where? } } so the page makes it a link.
 */

import { computeRunPlan } from './run-plan.js';
import { groupAsks, openAsks } from './asks.js';
import { openInterpretations } from './interpretations.js';
import { autoQueueOrder } from './epic-ready.js';
import { formatWhen } from './next-start.js';
import { pendingReviewNotes, FREE_ID } from './review-notes.js';
import { epicIdsForBox } from './home-areas.js';
import { needsYou as sharedNeedsYou } from './home-needs-you.js';

export const OVERVIEW_ROWS = 4; // four lines a card keeps the whole Overview on a laptop screen
export const FINISHED_DAYS = 7;
const DAY = 86400e3;
const CLOSED = new Set(['review', 'done', 'archive']);
const SHIP_MOVES = new Set(['review', 'done']);

function index(doc) {
  const byId = new Map();
  const sectionOf = new Map();
  for (const s of doc?.sections || []) {
    for (const t of s.tasks || []) if (t?.id && !byId.has(t.id)) { byId.set(t.id, t); sectionOf.set(t.id, s.id); }
  }
  return { byId, sectionOf };
}

/** The epic a ticket sits under (itself for an epic), or null. */
function epicOfId(byId, id) {
  const seen = new Set();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    if (cur.type === 'epic') return cur.id;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return null;
}

const ms = v => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : null; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byAtAsc = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function cut(items, rows) { return { items: items.slice(0, rows), more: Math.max(0, items.length - rows) }; }
// "Co-task: " says the ticket waits on you, which the Needs you card already says.
const bare = t => String(t || '').replace(/^co-task:\s*/i, '');

// ===== Needs you: computeRunPlan().review (shared/review.js reviewQueue), groupAsks(openAsks()) and
// openInterpretations(): the Plan page's For you list; plus computeRunPlan().picks at the "pick" stage. =====

function needsYou(doc, keep, rows) {
  const plan = computeRunPlan(doc);
  const items = [];
  for (const r of plan.review || []) {
    if (!keep(r.id)) continue;
    const todo = r.checks.total - r.checks.done;
    const line = todo > 0 ? `${todo} of ${plural(r.checks.total, 'check')} to do`
      : r.notes > 0 ? `${plural(r.notes, 'note')} to file` : 'Shipped: ready for your look';
    items.push({ key: `review-${r.id}`, kind: 'review', id: r.id, title: bare(r.title), line, at: r.enteredAt || '', target: { view: 'lanes', ticket: r.id } });
  }
  for (const c of groupAsks(openAsks(doc))) {
    if (!(c.ids || [c.id]).some(keep)) continue;
    items.push({ key: `ask-${c.id}-${c.key}`, kind: 'question', id: c.id, title: bare(c.title), line: c.text || '', at: c.at || '', target: { view: 'lanes', ticket: c.id } });
  }
  for (const i of openInterpretations(doc)) {
    if (!keep(i.id)) continue;
    items.push({ key: `reading-${i.id}-${i.key}`, kind: 'reading', id: i.id, title: bare(i.title), line: `Is this reading right? ${i.text}`, at: i.at || '', target: { view: 'lanes', ticket: i.id } });
  }
  const n = sharedNeedsYou(doc, keep, { plan });
  // A ticket counted only for checks to tick has no card above; give it one so every counted ticket is listed.
  const listed = new Set(items.map(i => i.id));
  for (const c of n.checkRows) {
    if (listed.has(c.id)) continue;
    listed.add(c.id);
    items.push({ key: `review-${c.id}`, kind: 'review', id: c.id, title: bare(c.title), line: `${c.checks.total - c.checks.done} of ${plural(c.checks.total, 'check')} to do`, at: c.enteredAt || '', target: { view: 'lanes', ticket: c.id } });
  }
  items.sort(byAtAsc);
  const picks = (plan.picks || []).filter(p => p.stage === 'pick' && keep(p.id)).map(p => ({
    key: `pick-${p.id}`, kind: 'pick', id: p.id, title: bare(p.title), line: 'Pick an option on its design board', at: '', target: { view: 'lanes', ticket: p.id },
  }));
  const all = [...items, ...picks];
  // The number is the shared rule (shared/home-needs-you.js), the same in every view; the cards stay one per item.
  return { count: n.count, decisions: n.decisions, reviews: n.reviews, ...cut(all, rows), target: { view: 'lanes', focus: 'for-you' } };
}

// ===== Running now: the running answer (shared/running.js computeRunning), as the strip's panel shows it. =====

// "Running" is live work only (working, waiting on CI, waiting on you), as the Tickets view and the strip count it;
// idle items (a worktree or a recent commit, nothing live) are listed after it and counted apart.
function runningNow(running, epicIds, rows) {
  const all = (running?.running || []).filter(i => !epicIds || epicIds.has(i.epicId || i.id));
  const counts = {};
  for (const i of all) counts[i.state] = (counts[i.state] || 0) + 1;
  const live = all.filter(i => i.state !== 'idle').length;
  const items = all.map(i => ({
    key: `t-${i.id}`, kind: 'running', id: i.id, title: i.title || '', state: i.state, since: i.since || null,
    line: (i.sources || []).join(' + '), epicId: i.epicId || null, target: { view: 'lanes', ticket: i.id },
  }));
  return { count: live, idle: all.length - live, counts, known: !!running, ...cut(items, rows), target: { view: 'lanes', focus: 'running' } };
}

// ===== On the agenda: computeNextStart() (its next epic and time), the Ready epics of openEpicReadiness() in
// autoQueueOrder(), and the day plan's pins (meta.dailyPlan, as computeRunPlan reads them). =====

function nextStartRow(ns, keep, now) {
  if (!ns) return null;
  const n = ns.next;
  if (!n) {
    return { key: 'next-none', kind: 'next', id: null, title: ns.reason === 'autorun is paused' ? 'Autorun is paused' : 'Nothing starts by itself',
      line: ns.reason && ns.reason !== 'autorun is paused' ? ns.reason.charAt(0).toUpperCase() + ns.reason.slice(1) : '', when: null, target: { view: 'lanes', focus: 'auto-queue' } };
  }
  if (!keep(n.epic)) return null;
  const when = Number.isFinite(n.atMs) ? formatWhen(n.atMs, now) : null;
  const line = n.atKind === 'slot' ? 'Starts when a run slot frees'
    : n.atKind === 'reset' ? `Starts about ${when}, once ${n.waitsFor}`
      : when ? `Starts ${when}` : 'Starts at the next check';
  return { key: `next-${n.epic}`, kind: 'next', id: n.epic, title: n.title || '', line, when, atKind: n.atKind, target: { view: 'lanes', ticket: n.epic } };
}

/** { done, total } of the non-epic tickets under an epic (the old day plan's "3/7 done"). */
function progressOf(ix, epicId) {
  if (!ix.kids) {
    ix.kids = new Map();
    for (const t of ix.byId.values()) {
      if (t.type === 'epic') continue;
      const e = epicOfId(ix.byId, t.id);
      if (e) (ix.kids.get(e) || ix.kids.set(e, []).get(e)).push(t);
    }
  }
  const kids = ix.kids.get(epicId) || [];
  return { done: kids.filter(t => t.checked || CLOSED.has(ix.sectionOf.get(t.id))).length, total: kids.length };
}

function agenda(doc, ix, readinessById, running, keep, ns, now, rows) {
  const next = nextStartRow(ns, keep, now);
  const busy = new Set(Object.entries(running?.epics || {}).filter(([, e]) => e.state === 'running').map(([id]) => id));
  const ready = autoQueueOrder([...(readinessById?.values() || [])].filter(r => r.ready && keep(r.id)));
  // Place in the Auto queue counts the next start too (it is first when autorun picks it).
  const autoLine = ready.filter(r => r.auto && !busy.has(r.id)).map(r => r.id);
  const readyRows = ready.filter(r => !busy.has(r.id) && r.id !== next?.id).map(r => {
    const place = autoLine.indexOf(r.id) + 1;
    const line = r.auto ? `${place === 1 ? 'First' : `#${place}`} in the Auto queue${r.priority === 'high' ? ', high priority' : ''}`
      : 'Ready; starts when you run it (Auto is off)';
    return { key: `ready-${r.id}`, kind: 'ready', id: r.id, title: r.title || '', line, target: { view: 'lanes', ticket: r.id } };
  });
  const plan = doc?.meta?.dailyPlan || {};
  const shown = new Set([next?.id, ...readyRows.map(r => r.id)]);
  const pinned = [];
  for (const id of [...(plan.taskIds || []), ...(plan.carriedIds || [])]) {
    const t = ix.byId.get(id);
    if (!t || pinned.some(p => p.id === id) || shown.has(id) || t.checked || CLOSED.has(ix.sectionOf.get(id)) || !keep(id)) continue;
    const p = t.type === 'epic' ? progressOf(ix, id) : null;
    pinned.push({ key: `pin-${id}`, kind: 'pinned', id, title: t.title || '', line: p && p.total ? `${p.done} of ${p.total} done` : '', target: { view: 'lanes', ticket: id } });
  }
  // The card holds `rows` lines: the next start, then Ready epics, keeping one line for a pin when there are pins.
  const room = rows - (next && next.id ? 1 : 0);
  const r = readyRows.slice(0, Math.max(0, room - Math.min(1, pinned.length)));
  const pins = pinned.slice(0, Math.max(0, room - r.length));
  const items = [...r, ...pins];
  const more = readyRows.length - r.length + pinned.length - pins.length;
  return { next, ready: ready.length, readyRows: readyRows.length, pinned: pinned.length, items, more, target: { view: 'lanes', focus: 'ready' } };
}

// ===== Finished lately: tickets in review / done / archive whose last move into review or done (the history,
// as shared/review.js enteredReviewAt reads it), else their result's time, is inside the last 7 days. =====

/** When a closed ticket last shipped or closed (ms), or null when unknown. */
export function closedAtMs(task) {
  const h = Array.isArray(task?.history) ? task.history : [];
  for (let i = h.length - 1; i >= 0; i--) if (h[i] && SHIP_MOVES.has(h[i].to) && ms(h[i].at) !== null) return ms(h[i].at);
  return ms(task?.result?.at);
}

function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function dayLabel(t, now) {
  const start = v => new Date(v).setHours(0, 0, 0, 0);
  const diff = Math.round((start(now) - start(t)) / DAY);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Rows are the epics closed in the window (newest first); only when none closed, the tickets. */
function finished(doc, ix, keep, now, rows) {
  const from = now - FINISHED_DAYS * DAY;
  const all = [];
  for (const s of doc?.sections || []) {
    if (!CLOSED.has(s.id)) continue;
    for (const t of s.tasks || []) {
      if (!t?.id || t.type === 'subtask') continue;
      const at = closedAtMs(t);
      if (at === null || at < from || at > now || !keep(t.id)) continue;
      const epic = t.type === 'epic';
      let line = Array.isArray(t.result?.shipped) ? t.result.shipped[0] || '' : '';
      if (!line && epic) { const p = progressOf(ix, t.id); line = p.total ? `${plural(p.total, 'ticket')} done` : 'Closed'; }
      all.push({ key: `done-${t.id}`, kind: epic ? 'epic' : 'ticket', id: t.id, title: t.title || '', line, atMs: at, day: dayKey(at), target: { view: 'tickets', ticket: t.id } });
    }
  }
  all.sort((a, b) => b.atMs - a.atMs || (a.id < b.id ? -1 : 1));
  const epics = all.filter(i => i.kind === 'epic');
  const { items, more } = cut(epics.length ? epics : all, rows);
  const days = [];
  for (const it of items) {
    let d = days[days.length - 1];
    if (!d || d.day !== it.day) days.push(d = { day: it.day, label: dayLabel(it.atMs, now), items: [] });
    d.items.push(it);
  }
  return { count: all.length, epics: epics.length, tickets: all.length - epics.length, rowsAre: epics.length ? 'epics' : 'tickets', days, items, more, target: { view: 'tickets', focus: 'finished' } };
}

// ===== Where the work is: epicIdsForBox() per area (shared/home-areas.js), open epics = openEpicReadiness() rows,
// running = epics with an item in the running answer. =====

function places(config, doc, readinessById, running, selected, keep) {
  if (!config?.groups?.length) return { groups: [], max: 0 };
  const open = new Set([...(readinessById ? readinessById.keys() : [])].filter(keep));
  const liveEpics = new Set((running?.running || []).filter(i => i.state !== 'idle').map(i => i.epicId).filter(Boolean));
  let max = 0;
  const groups = config.groups.map(g => {
    const areas = (g.areas || []).map(a => {
      const ids = [...epicIdsForBox(config, doc, a.id)].filter(id => open.has(id));
      const live = ids.filter(id => liveEpics.has(id));
      max = Math.max(max, ids.length);
      return { id: a.id, name: a.name || a.id, open: ids.length, running: live.length, selected: selected.has(a.id), target: { view: 'map', where: a.id } };
    });
    return { id: g.id, name: g.name || g.id, open: areas.reduce((n, a) => n + a.open, 0), running: areas.reduce((n, a) => n + a.running, 0), selected: selected.has(g.id), areas, target: { view: 'map', where: g.id } };
  });
  return { groups, max };
}

// ===== Open notes: pendingReviewNotes() (shared/review-notes.js), newest first. =====

// Each row is the note's own words, its ticket the quiet second line; a free note (PRO121) has no ticket
// and stays in when its project is the Home project's family (`projects`, PRO127) and no place is picked or its
// place / lane is inside the picked one (`scope`: { ids, lanes }).
function notes(doc, keep, scope, filtered, projects) {
  const all = [];
  const inScope = n => (!projects || projects.has(n.project))
    && (!filtered || (scope && (scope.ids?.has(n.where) || (n.area && scope.lanes?.has(n.area)))));
  for (const t of pendingReviewNotes(doc)) {
    const free = t.id === FREE_ID;
    if (free ? !inScope(t.notes[0] || {}) : !keep(t.id)) continue;
    for (const n of t.notes) {
      all.push(free
        ? { key: `note-free-${n.n}`, kind: 'free-note', id: FREE_ID, title: n.text || '(image)', line: 'free note', at: n.at || '', target: { inspector: 'notes' } }
        : { key: `note-${t.id}-${n.n}`, kind: 'note', id: t.id, title: n.text || '(image)', line: t.title || '', at: n.at || '', target: { ticket: t.id } });
    }
  }
  all.sort((a, b) => -byAtAsc(a, b));
  const onTickets = all.filter(n => n.id !== FREE_ID);
  return { count: all.length, tickets: new Set(onTickets.map(n => n.id)).size, free: all.length - onTickets.length, items: all.slice(0, 2), more: Math.max(0, all.length - 2), target: { inspector: 'notes' } };
}

// ===== Health: home-health-data's getHealth() when that feature is present; only what is wrong. =====

function health(h) {
  if (!h || typeof h !== 'object') return { lines: [] };
  const lines = [];
  // Only what needs a look, in the strip's words (home-health-data.js healthLine): an automation late, failed or off;
  // a service that is not ok is "down". "unknown" and "checking" are not problems (a job with no status source is
  // unknown by design), so they never light this card.
  const n = v => (Number.isFinite(v) && v > 0 ? v : 0);
  const a = h.automations && typeof h.automations === 'object' ? h.automations : {};
  for (const word of ['failed', 'late', 'off']) {
    if (n(a[word])) lines.push({ key: `automations-${word}`, kind: 'health', text: `${plural(a[word], 'automation')} ${word}`, target: { view: 'how-it-runs', focus: 'automations' } });
  }
  const s = h.services && typeof h.services === 'object' ? h.services : {};
  const down = n(s.failed) + n(s.late) + n(s.off) + n(s.down);
  if (down) lines.push({ key: 'services-down', kind: 'health', text: `${plural(down, 'service')} down`, target: { view: 'how-it-runs', focus: 'services' } });
  for (const [i, p] of (Array.isArray(h.problems) ? h.problems : []).entries()) {
    const text = typeof p === 'string' ? p : p?.text;
    if (text) lines.push({ key: `problem-${i}`, kind: 'health', text, target: { view: 'how-it-runs' } });
  }
  return { lines };
}

// ===== the sentence at the top =====

/** "3 things need you. 5 running, 12 ready. Next start today 14:30." as segments: strings, and numbers that tick. */
export function summaryOf({ place, needs, running, ready, next }) {
  const seg = [];
  if (place) seg.push(`In ${place}: `);
  if (needs) seg.push(needs, needs === 1 ? ' thing needs you. ' : ' things need you. ');
  else seg.push('Nothing needs you. ');
  seg.push(running, ' running, ', ready, ' ready.');
  if (next) {
    if (next.kind === 'next' && next.id === null) seg.push(` ${next.title}.`);
    else if (next.when) seg.push(` Next start ${next.atKind === 'reset' ? 'about ' : ''}${next.when}.`);
    else seg.push(next.atKind === 'slot' ? ' Next start when a run slot frees.' : ' Next start at the next check.');
  }
  return { segments: seg, text: seg.join('') };
}

export function overviewModel(doc, config, readinessById, running, now, extras = {}) {
  const ix = index(doc);
  // The ids that narrow every card (shared/home-scope.js): the selected place's epics, else the project's epics and
  // its tickets under no epic. A ticket is kept when it or a ticket above it is in the set.
  const epicIds = extras.epicIds || null;
  const keeper = (set) => {
    const kept = new Map();
    return (id) => {
      if (!set) return true;
      if (kept.has(id)) return kept.get(id);
      const seen = new Set();
      let ok = false;
      for (let t = ix.byId.get(id); t && !seen.has(t.id); t = t.parentId ? ix.byId.get(t.parentId) : null) {
        seen.add(t.id);
        if (set.has(t.id)) { ok = true; break; }
      }
      kept.set(id, ok);
      return ok;
    };
  };
  const keep = keeper(epicIds);
  // "Where the work is" always shows the whole map, so only the project narrows it, never the place.
  const keepProject = keeper(extras.projectIds || null);
  const rows = extras.rows || OVERVIEW_ROWS;
  const w = extras.where || {};
  const selected = new Set([w.group, w.area, w.part].filter(Boolean));
  const model = {
    place: extras.placeName || null,
    needsYou: needsYou(doc, keep, rows),
    running: runningNow(running, epicIds, rows),
    agenda: agenda(doc, ix, readinessById, running, keep, extras.nextStart, now, rows),
    finished: finished(doc, ix, keep, now, rows),
    places: places(config, doc, readinessById, running, selected, keepProject),
    notes: notes(doc, keep, extras.noteScope, !!extras.noteScope, extras.noteProjects || null),
    health: health(extras.health),
  };
  model.summary = summaryOf({
    place: model.place, needs: model.needsYou.count, running: model.running.count, ready: model.agenda.ready, next: model.agenda.next,
  });
  return model;
}
