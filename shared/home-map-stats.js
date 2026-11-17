/**
 * shared/home-map-stats.js (PRO39): the numbers every box of the Home map shows. Pure: no fs, no DOM.
 *
 *   mapScope(config, doc, { project })          -> (epic) => true when the epic is on this project's map
 *   placedEpics(config, doc, { project })       -> [{ epic (with status), where: boxForEpic(...) }] in doc order
 *   boxStats(config, doc, readinessById, running, { project })
 *        -> Map(boxId -> { openEpics, ready, auto, running: { working, waitingCi, waitingYou }, idle, stale,
 *                          review, tickets: { open, done } }); the whole project is under the key ROOT ('')
 *   epicsInBox(config, doc, boxId|null, { project }) -> placed epics of a box (and everything inside it); null = all
 *   restKey(areaId)                             -> key of an area's own epics (on the area, on none of its parts):
 *        boxStats and epicsInBox answer for it, and the map draws it as one more box at the area level
 *   notOnMap(config, doc, { project })          -> unmatchedEpics (shared/home-areas.js) on this map, each with `fix`
 *
 * Which box an epic sits in is boxForEpic (shared/home-areas.js), the rule behind epicIdsForBox: each epic is placed
 * once and counted in its group, its area and its part. Readiness is the Plan page's (openEpicReadiness in
 * shared/epic-ready.js, passed in as a Map by id). Running is the /api/home/running answer (shared/running.js).
 *
 * The project's map holds an epic when the epic's project is the selected project or one of its sub-projects
 * (meta.projects parentId), or when an area claims it by lane, title or project. Epics of other projects that would
 * only reach the fallback area belong to another map and are left out. With no project every epic is on the map.
 */

import { boxForEpic, unmatchedEpics } from './home-areas.js';

export const ROOT = '';
/** The stats key of an area's own epics (placed on the area, on none of its parts); only areas with parts have one. */
export const restKey = areaId => `${areaId}#rest`;
export const restArea = id => (typeof id === 'string' && id.endsWith('#rest') ? id.slice(0, -5) : null);
const OPEN = new Set(['inbox', 'backlog', 'todo', 'in-progress']);
const FINISHED = new Set(['done', 'review', 'archive']);

function allTasks(doc) {
  const out = [];
  for (const s of doc?.sections || []) for (const t of s.tasks || []) if (t && t.id) out.push({ task: t, status: s.id });
  return out;
}

/** The project and every project below it (meta.projects parentId), or null for "no project chosen". */
export function projectFamily(doc, project) {
  if (!project) return null;
  const projects = doc?.meta?.projects || [];
  const family = new Set([project]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of projects) {
      if (p && p.parentId && family.has(p.parentId) && !family.has(p.id)) { family.add(p.id); grew = true; }
    }
  }
  return family;
}

export function mapScope(config, doc, { project = null } = {}) {
  const family = projectFamily(doc, project);
  // PRO127: a title word claims another project's epic only when the group lists the projects its words may
  // claim (`keywordProjects`); otherwise a loose word ("label", "proof") pulls in unrelated projects' epics.
  const listsKeywordProjects = new Set((config?.groups || []).filter(g => Array.isArray(g.keywordProjects)).map(g => g.id));
  return (epic, where = boxForEpic(config, epic)) => {
    if (!where.area) return false;
    if (!family) return true;
    if (family.has(epic.project)) return true;
    if (where.matchedBy === 'title') return listsKeywordProjects.has(where.group);
    return where.matchedBy !== 'fallback';
  };
}

export function placedEpics(config, doc, opts = {}) {
  const inScope = mapScope(config, doc, opts);
  const out = [];
  for (const { task, status } of allTasks(doc)) {
    if (task.type !== 'epic') continue;
    const epic = { ...task, status };
    const where = boxForEpic(config, epic);
    if (inScope(epic, where)) out.push({ epic, where });
  }
  return out;
}

function blank() {
  return {
    openEpics: 0, ready: 0, auto: 0, running: { working: 0, waitingCi: 0, waitingYou: 0 },
    idle: 0, stale: 0, review: 0, tickets: { open: 0, done: 0 },
  };
}

const RUN_KEY = { working: 'working', 'waiting-ci': 'waitingCi', 'waiting-you': 'waitingYou' };

export function boxStats(config, doc, readinessById, running, opts = {}) {
  const stats = new Map([[ROOT, blank()]]);
  for (const g of config?.groups || []) {
    stats.set(g.id, blank());
    for (const a of g.areas || []) {
      stats.set(a.id, blank());
      if ((a.parts || []).length) stats.set(restKey(a.id), blank());
      for (const p of a.parts || []) stats.set(p.id, blank());
    }
  }
  const placed = placedEpics(config, doc, opts);
  const boxesOf = new Map(); // epic id -> the stat records it adds to
  for (const { epic, where } of placed) {
    const rest = where.area && !where.part ? restKey(where.area) : null;
    boxesOf.set(epic.id, [ROOT, where.group, where.area, where.part, rest].filter(id => id !== null && stats.has(id)).map(id => stats.get(id)));
  }
  const add = (epicId, fn) => { for (const s of boxesOf.get(epicId) || []) fn(s); };

  const ready = readinessById instanceof Map ? readinessById : new Map();
  for (const { epic } of placed) {
    if (!OPEN.has(epic.status)) continue;
    const r = ready.get(epic.id);
    add(epic.id, s => {
      s.openEpics += 1;
      if (r?.ready) s.ready += 1;
      if (r?.auto) s.auto += 1;
    });
    const st = running?.epics?.[epic.id]?.state;
    if (st === 'idle' || st === 'stale') add(epic.id, s => { s[st] += 1; });
  }
  for (const item of running?.running || []) {
    const key = RUN_KEY[item.state];
    if (key && item.epicId) add(item.epicId, s => { s.running[key] += 1; });
  }

  // Tickets: each counts in the box of its nearest epic (an epic in review counts as review-waiting too).
  const byId = new Map(allTasks(doc).map(x => [x.task.id, x]));
  const epicOf = (task) => {
    const seen = new Set();
    let cur = task;
    while (cur && !seen.has(cur.id)) {
      if (cur.type === 'epic') return cur.id;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId)?.task : null;
    }
    return null;
  };
  for (const { task, status } of byId.values()) {
    const epicId = epicOf(task);
    if (!epicId || !boxesOf.has(epicId)) continue;
    if (status === 'review') add(epicId, s => { s.review += 1; });
    if (task.type === 'epic') continue;
    const open = OPEN.has(status) && !task.checked;
    if (open || FINISHED.has(status) || task.checked) add(epicId, s => { s.tickets[open ? 'open' : 'done'] += 1; });
  }
  return stats;
}

export function epicsInBox(config, doc, boxId, opts = {}) {
  const placed = placedEpics(config, doc, opts);
  if (!boxId) return placed;
  const area = restArea(boxId);
  if (area) return placed.filter(({ where }) => where.area === area && !where.part);
  return placed.filter(({ where }) => where.group === boxId || where.area === boxId || where.part === boxId);
}

/** What would place an epic: its lane, else its project, else a title pattern. */
function fixFor(e) {
  if (e.lane) return `Add the lane "${e.lane}" to an area's "lanes".`;
  if (e.project) return `Add the project "${e.project}" to an area's "projects", or a word of its title to an area's "match".`;
  return 'Give it a lane, or add a word of its title to an area\'s "match".';
}

export function notOnMap(config, doc, opts = {}) {
  const family = projectFamily(doc, opts.project);
  return unmatchedEpics(config, doc)
    .filter(e => !family || family.has(e.project))
    .map(e => ({ ...e, fix: fixFor(e) }));
}
