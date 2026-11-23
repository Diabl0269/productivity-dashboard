/**
 * home.config.json for the Home tab (pure, no fs, no DOM): parse, validate and normalise to schema v1.
 *
 * v1: { version: 1, title, repos[], groups[] (id, name, areas[] (id, name, lanes[], match, projects[],
 * box, page, covers[], parts[] same shape)), cables[], decorations, services[], automations[] }.
 * The older flat shape (groups as an id -> name object, keywordProjects, a top-level areas[] list whose
 * entries name their group) is accepted too and nested under its groups. Every problem comes back as a
 * plain-words line in `errors`; only an unreadable file or an unknown version gives `config: null`.
 * Field rules and the meaning of each key: docs/home-page.md.
 */

import {
  isPlainObject, shown, str, strOrNull, strList, regex, rect, id as checkId, unknownKeys, objList,
} from './home-config-check.js';
import { normAutomations, normServices, normLifecycle } from './home-config-runs.js';
import { normDefaults } from './automation-run.js';

import { applyPages } from './home-pages-config.js';

export const HOME_CONFIG_VERSION = 1;

const TOP_KEYS = ['version', 'title', 'repos', 'groups', 'cables', 'decorations', 'services', 'automations', 'automationDefaults', 'lifecycle', 'fallback', 'pages', 'page'];
const LEGACY_KEYS = ['repos', 'groups', 'keywordProjects', 'areas', 'cables', 'fallback', 'pages', 'page'];
const GROUP_KEYS = ['id', 'name', 'what', 'areas', 'keywordProjects', 'box', 'page', 'covers'];
const BOX_KEYS = ['id', 'name', 'what', 'lanes', 'match', 'projects', 'box', 'page', 'covers', 'parts'];

/** The optional one-line `what` of a group, area or part: { what } when given, else nothing (the shape stays as before). */
function whatOf(raw, where, errors) {
  const v = strOrNull(raw, 'what', where, errors);
  return v === null ? {} : { what: v };
}
const LEGACY_AREA_KEYS = [...BOX_KEYS, 'group'];
const CABLE_KEYS = ['from', 'to', 'path', 'label'];

/** True for the older flat map shape (no version; groups as an object or a top-level areas list). */
export function isLegacyShape(raw) {
  return isPlainObject(raw) && raw.version === undefined
    && (isPlainObject(raw.groups) || Array.isArray(raw.areas) || raw.keywordProjects !== undefined);
}

/** An area or a part: { id, name, lanes, match, projects, box, page, covers, parts }. */
function normBox(raw, where, errors, ctx, { level, known = BOX_KEYS }) {
  if (!isPlainObject(raw)) {
    errors.push(`${where}: should be an object with at least "id" and "name", got ${shown(raw)}; skipped.`);
    return null;
  }
  const boxId = checkId(raw, where, errors);
  if (boxId === null) return null;
  const here = `${ctx.parent}${level} "${boxId}"`;
  if (!claim(ctx, boxId, here, errors)) return null;
  unknownKeys(raw, known, here, errors);
  const out = {
    id: boxId,
    name: nameOf(raw, here, errors, boxId),
    ...whatOf(raw, here, errors),
    lanes: strList(raw, 'lanes', here, errors),
    match: regex(raw, 'match', here, errors),
    projects: strList(raw, 'projects', here, errors),
    box: rect(raw, 'box', here, errors),
    page: strOrNull(raw, 'page', here, errors),
    covers: strList(raw, 'covers', here, errors),
    parts: [],
  };
  const parts = objList(raw, 'parts', here, errors);
  if (level === 'part' && parts.length) {
    errors.push(`${here}: "parts" can only go one level deep (group > area > part); these parts are ignored.`);
  } else {
    const sub = { ...ctx, parent: `${here} > ` };
    out.parts = parts.map((p, i) => normBox(p, `${here} > parts[${i}]`, errors, sub, { level: 'part' }))
      .filter(Boolean);
  }
  return out;
}

function nameOf(raw, here, errors, fallback) {
  if (raw.name === undefined || raw.name === null || raw.name === '') {
    errors.push(`${here}: "name" is missing; the id is shown instead.`);
    return fallback;
  }
  return str(raw, 'name', here, errors, fallback) || fallback;
}

/** Box ids share one namespace (?where= names exactly one box). */
function claim(ctx, boxId, here, errors) {
  if (ctx.ids.has(boxId)) {
    errors.push(`${here}: the id "${boxId}" is already used by ${ctx.ids.get(boxId)}; ids must be unique across groups, areas and parts, so this one is skipped.`);
    return false;
  }
  ctx.ids.set(boxId, here);
  return true;
}

function normGroup(raw, i, errors, ctx, legacyAreas = null) {
  const where = `groups[${i}]`;
  if (!isPlainObject(raw)) {
    errors.push(`${where}: should be an object with "id", "name" and "areas", got ${shown(raw)}; skipped.`);
    return null;
  }
  const gid = checkId(raw, where, errors);
  if (gid === null) return null;
  const here = `group "${gid}"`;
  if (!claim(ctx, gid, here, errors)) return null;
  unknownKeys(raw, GROUP_KEYS, here, errors);
  const kp = raw.keywordProjects;
  const sub = { ...ctx, parent: `${here} > ` };
  const areaList = legacyAreas
    || objList(raw, 'areas', here, errors).map((a, j) => ({ raw: a, label: `areas[${j}]`, legacy: false }));
  return {
    id: gid,
    name: nameOf(raw, here, errors, gid),
    ...whatOf(raw, here, errors),
    keywordProjects: kp === undefined || kp === null ? null : strList(raw, 'keywordProjects', here, errors, { allowNull: true }),
    box: rect(raw, 'box', here, errors),
    page: strOrNull(raw, 'page', here, errors),
    covers: strList(raw, 'covers', here, errors),
    areas: areaList.map(a => normBox(a.raw, `${here} > ${a.label}`, errors, sub, {
      level: 'area', known: a.legacy ? LEGACY_AREA_KEYS : BOX_KEYS,
    })).filter(Boolean),
  };
}

function normCables(raw, errors, ids) {
  return objList(raw, 'cables', '', errors).map((c, i) => {
    const where = `cables[${i}]`;
    if (!isPlainObject(c)) {
      errors.push(`${where}: should be an object with "from" and "to", got ${shown(c)}; skipped.`);
      return null;
    }
    unknownKeys(c, CABLE_KEYS, where, errors);
    for (const end of ['from', 'to']) {
      if (typeof c[end] !== 'string' || !ids.has(c[end])) {
        errors.push(`${where}: "${end}" should name a group, area or part id, got ${shown(c[end])}; skipped.`);
        return null;
      }
    }
    return { from: c.from, to: c.to, path: strOrNull(c, 'path', where, errors), label: strOrNull(c, 'label', where, errors) };
  }).filter(Boolean);
}

/**
 * repos[]: each entry is a text path or { name, path }; anything else is reported and skipped.
 * Paths are resolved later (server/home/repos.js), not here.
 */
function normRepos(raw, errors) {
  const v = raw.repos;
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    errors.push(`the file: "repos" should be a list of paths or { "name", "path" } objects, got ${shown(v)}.`);
    return [];
  }
  const out = [];
  v.forEach((r, i) => {
    const where = `repos[${i}]`;
    if (typeof r === 'string' && r.trim()) { out.push(r); return; }
    if (!isPlainObject(r)) {
      errors.push(`${where}: should be a path or an object with "path" (and optionally "name"), got ${shown(r)}; skipped.`);
      return;
    }
    unknownKeys(r, ['name', 'path'], where, errors);
    if (typeof r.path !== 'string' || !r.path.trim()) {
      errors.push(`${where}: "path" should be text, got ${shown(r.path)}; skipped.`);
      return;
    }
    const entry = { path: r.path };
    if (r.name !== undefined && r.name !== null) {
      if (typeof r.name === 'string' && r.name.trim()) entry.name = r.name;
      else errors.push(`${where}: "name" should be text, got ${shown(r.name)}; the folder name is used.`);
    }
    out.push(entry);
  });
  return out;
}

/** The older flat shape -> groups[] with their areas nested (a list of {raw, label} per group). */
function legacyGroups(raw, errors) {
  unknownKeys(raw, LEGACY_KEYS, '', errors);
  let groupEntries = [];
  if (isPlainObject(raw.groups)) {
    groupEntries = Object.entries(raw.groups).map(([gid, name]) => ({ id: gid, name }));
  } else if (Array.isArray(raw.groups)) {
    groupEntries = raw.groups;
  } else if (raw.groups !== undefined) {
    errors.push(`the file: "groups" should be an object of id -> name, got ${shown(raw.groups)}.`);
  }
  const kp = isPlainObject(raw.keywordProjects) ? raw.keywordProjects : {};
  if (raw.keywordProjects !== undefined && !isPlainObject(raw.keywordProjects)) {
    errors.push(`the file: "keywordProjects" should be an object of group id -> list of projects, got ${shown(raw.keywordProjects)}.`);
  }
  const byGroup = new Map(groupEntries.map(g => [isPlainObject(g) ? g.id : g, []]));
  objList(raw, 'areas', '', errors).forEach((a, j) => {
    if (isPlainObject(a) && byGroup.has(a.group)) byGroup.get(a.group).push({ raw: a, label: `areas[${j}]`, legacy: true });
    else errors.push(`areas[${j}]${isPlainObject(a) && a.id ? ` ("${a.id}")` : ''}: "group" should name one of the groups (${[...byGroup.keys()].join(', ') || 'none defined'}), got ${shown(isPlainObject(a) ? a.group : a)}; skipped.`);
  });
  for (const gid of Object.keys(kp)) {
    if (!byGroup.has(gid)) errors.push(`the file: "keywordProjects" names group "${gid}", which is not in "groups"; ignored.`);
  }
  return groupEntries.map(g => {
    const gObj = isPlainObject(g) ? { ...g } : g;
    if (isPlainObject(gObj) && kp[gObj.id] !== undefined) gObj.keywordProjects = kp[gObj.id];
    return { raw: gObj, areas: isPlainObject(g) ? byGroup.get(g.id) : [] };
  });
}

/**
 * Validate and normalise a parsed home.config.json (v1 or the older flat shape).
 * @param {unknown} raw
 * @returns {{ config: object|null, errors: string[], legacy: boolean }}
 */
export function normalizeHomeConfig(raw) {
  const errors = [];
  if (!isPlainObject(raw)) {
    return { config: null, errors: [`the file: should be a JSON object, got ${shown(raw)}.`], legacy: false };
  }
  const legacy = isLegacyShape(raw);
  if (!legacy && raw.version !== undefined && raw.version !== HOME_CONFIG_VERSION) {
    return {
      config: null,
      errors: [`the file: "version" is ${shown(raw.version)}, but this dashboard reads version ${HOME_CONFIG_VERSION}.`],
      legacy,
    };
  }
  const ctx = { ids: new Map(), parent: '' };
  let groups;
  if (legacy) {
    groups = legacyGroups(raw, errors).map((g, i) => normGroup(g.raw, i, errors, ctx, g.areas));
  } else {
    unknownKeys(raw, TOP_KEYS, '', errors);
    groups = objList(raw, 'groups', '', errors).map((g, i) => normGroup(g, i, errors, ctx));
  }
  const decorations = strOrNull(raw, 'decorations', '', errors);
  const config = {
    version: HOME_CONFIG_VERSION,
    title: str(raw, 'title', '', errors),
    repos: normRepos(raw, errors),
    groups: groups.filter(Boolean),
    cables: normCables(raw, errors, ctx.ids),
    decorations,
    services: legacy ? [] : normServices(raw, errors, ctx.ids),
    automations: legacy ? [] : normAutomations(raw, errors),
    automationDefaults: legacy ? null : normDefaults(raw.automationDefaults, errors),
    lifecycle: null,
    fallback: null,
    legacy,
  };
  if (!legacy) config.lifecycle = normLifecycle(raw, errors, { boxIds: new Set(ctx.ids.keys()), automationIds: new Set(config.automations.map(a => a.id)) });
  const fb = strOrNull(raw, 'fallback', '', errors);
  if (fb !== null) {
    if (config.groups.some(g => g.areas.some(a => a.id === fb))) config.fallback = fb;
    else errors.push(`the file: "fallback" should be the id of an area, got "${fb}"; the last area is used.`);
  }
  applyPages(config, raw, errors);
  return { config, errors, legacy };
}

/**
 * Parse the text of a home.config.json, then normalise it.
 * @param {string} text
 * @returns {{ config: object|null, errors: string[], legacy: boolean }}
 */
export function parseHomeConfig(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { config: null, errors: [`the file is not valid JSON (${e.message}).`], legacy: false };
  }
  return normalizeHomeConfig(raw);
}

/**
 * Where a box id sits: { group, area, part } ids (null below the box's own level), or null.
 * @param {object|null} config normalised config
 * @param {string} boxId
 */
export function findWhere(config, boxId) {
  if (!config || !boxId) return null;
  for (const g of config.groups) {
    if (g.id === boxId) return { group: g.id, area: null, part: null };
    for (const a of g.areas) {
      if (a.id === boxId) return { group: g.id, area: a.id, part: null };
      for (const p of a.parts) {
        if (p.id === boxId) return { group: g.id, area: a.id, part: p.id };
      }
    }
  }
  return null;
}

/** The box (group, area or part object) a where points at, deepest level first, or null. */
export function boxOfWhere(config, where) {
  if (!config || !where) return null;
  const g = config.groups.find(x => x.id === where.group);
  if (!g) return null;
  const a = where.area ? g.areas.find(x => x.id === where.area) : null;
  const p = a && where.part ? a.parts.find(x => x.id === where.part) : null;
  return p || a || g;
}
