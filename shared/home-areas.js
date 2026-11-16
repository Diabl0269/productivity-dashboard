/**
 * shared/home-areas.js (PRO117): which place of a project's map an epic belongs to. Pure: no fs, no DOM.
 * Works on the normalised home config (shared/home-config.js: groups > areas > parts).
 *
 * Rules, first one wins (ported from a handbook-map prototype's areaFor, so its answers stay the same):
 *  1. lanes: an area whose `lanes` hold the epic's lane;
 *  2. title: an area whose `match` pattern (any case) fits the title, only when the epic's project is one the
 *     area's group lists in `keywordProjects` (`null` in that list = epics with no project; a group without
 *     the key allows every project);
 *  3. projects: an area whose `projects` hold the epic's project;
 *  4. the fallback area: the config's `fallback` (an area id), else the last area.
 * Areas are tried in map order (groups in order, areas in order). Inside the chosen area a part is picked the
 * same way (its own lanes, then its own `match`), else the epic sits in the area itself (`part: null`).
 *
 *   boxForEpic(config, epic)               -> { group, area, part|null, matchedBy: 'lane'|'title'|'project'|'fallback' }
 *   epicIdsForBox(config, doc, boxId)      -> Set of epic ids (open and closed) in a group, area or part, parts included
 *   lanesForBox(config, boxId)             -> lanes of a box and everything inside it
 *   boxPath(config, boxId)                 -> [{ id, name, level: 'group'|'area'|'part' }] from the group down
 *   childBoxes(config, boxId|null)         -> the boxes one level down (groups for null)
 *   unmatchedEpics(config, doc)            -> open epics that fell to the fallback: [{ id, title, lane, project, why }]
 */

const OPEN_SECTIONS = new Set(['inbox', 'backlog', 'todo', 'in-progress', 'review']);
const compiled = new WeakMap(); // config -> Map(box id -> RegExp|null)

function regexOf(config, box) {
  let map = compiled.get(config);
  if (!map) compiled.set(config, map = new Map());
  if (!map.has(box.id)) {
    let re = null;
    try { re = box.match ? new RegExp(box.match, 'i') : null; } catch { re = null; }
    map.set(box.id, re);
  }
  return map.get(box.id);
}

/** Every area in map order, with the group it sits in. */
function flatAreas(config) {
  const out = [];
  for (const group of config?.groups || []) for (const area of group.areas || []) out.push({ group, area });
  return out;
}

function projectAllowed(group, project) {
  const list = group.keywordProjects;
  return !Array.isArray(list) || list.includes(project ?? null);
}

function titleHits(config, group, box, epic) {
  const re = regexOf(config, box);
  return !!re && re.test(String(epic.title ?? '')) && projectAllowed(group, epic.project);
}

function fallbackArea(config) {
  const areas = flatAreas(config);
  if (!areas.length) return null;
  return areas.find(a => a.area.id === config.fallback) || areas[areas.length - 1];
}

export function boxForEpic(config, epic) {
  const areas = flatAreas(config);
  const lane = epic?.lane;
  let hit = null;
  let matchedBy = 'fallback';
  const pick = (kind, test) => {
    const found = areas.find(test);
    if (found) { hit = found; matchedBy = kind; }
    return !!found;
  };
  if (!(lane && pick('lane', a => a.area.lanes?.includes(lane)))
    && !pick('title', a => titleHits(config, a.group, a.area, epic || {}))
    && !pick('project', a => epic?.project != null && a.area.projects?.includes(epic.project))) {
    hit = fallbackArea(config);
  }
  if (!hit) return { group: null, area: null, part: null, matchedBy: 'fallback' };
  const part = (hit.area.parts || []).find(p => (lane && p.lanes?.includes(lane)) || titleHits(config, hit.group, p, epic || {}));
  return { group: hit.group.id, area: hit.area.id, part: part ? part.id : null, matchedBy };
}

function epicsOf(doc) {
  const out = [];
  for (const s of doc?.sections || []) for (const t of s.tasks || []) if (t.type === 'epic') out.push({ ...t, status: s.id });
  return out;
}

export function epicIdsForBox(config, doc, boxId) {
  const ids = new Set();
  if (!boxId) return ids;
  for (const e of epicsOf(doc)) {
    const b = boxForEpic(config, e);
    if (b.group === boxId || b.area === boxId || b.part === boxId) ids.add(e.id);
  }
  return ids;
}

/** The box object for an id with its ancestors: [group, area?, part?] (empty when unknown). */
function chain(config, boxId) {
  for (const g of config?.groups || []) {
    if (g.id === boxId) return [g];
    for (const a of g.areas || []) {
      if (a.id === boxId) return [g, a];
      for (const p of a.parts || []) if (p.id === boxId) return [g, a, p];
    }
  }
  return [];
}

function descendants(box) {
  return [box, ...(box.areas || []).flatMap(descendants), ...(box.parts || []).flatMap(descendants)];
}

export function lanesForBox(config, boxId) {
  const c = chain(config, boxId);
  if (!c.length) return [];
  return [...new Set(descendants(c[c.length - 1]).flatMap(b => b.lanes || []))];
}

export function boxPath(config, boxId) {
  return chain(config, boxId).map((b, i) => ({ id: b.id, name: b.name, level: ['group', 'area', 'part'][i] }));
}

export function childBoxes(config, boxId) {
  if (!boxId) return [...(config?.groups || [])];
  const c = chain(config, boxId);
  const box = c[c.length - 1];
  return box ? [...(box.areas || box.parts || [])] : [];
}

export function unmatchedEpics(config, doc) {
  const fb = fallbackArea(config);
  const out = [];
  for (const e of epicsOf(doc)) {
    if (!OPEN_SECTIONS.has(e.status)) continue;
    if (boxForEpic(config, e).matchedBy !== 'fallback') continue;
    out.push({
      id: e.id, title: e.title || '', lane: e.lane || null, project: e.project || null,
      why: `No lane, title pattern or project of any area fits it, so it sits in ${fb ? `"${fb.area.name}"` : 'no area'}.`,
    });
  }
  return out;
}
