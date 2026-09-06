/**
 * Task ID helpers — shared by dashboard (ESM) and CLI (Node ESM).
 *
 * Format: {PREFIX}{number} where PREFIX is 1–6 uppercase letters/digits (default "T").
 * Examples: T1, APP42, MYA3
 */

export const DEFAULT_TASK_PREFIX = 'T';

/** Prefix slug: 1–6 uppercase alphanumerics, must start with a letter. */
export const PREFIX_RE = /^[A-Z][A-Z0-9]{0,5}$/;

/** Full task id: prefix + positive integer suffix. */
export const TASK_ID_RE = /^[A-Z][A-Z0-9]{0,5}\d+$/;

/**
 * Derive a default ticket prefix from a project slug (e.g. "my-app" → "MYA").
 * @param {string} slug
 * @returns {string}
 */
export function derivePrefixFromSlug(slug) {
  const compact = String(slug || '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
  if (!compact) return 'PR';
  return compact.slice(0, 3);
}

/**
 * Normalize a user-supplied prefix; null when invalid/empty.
 * @param {string} value
 * @returns {string|null}
 */
export function normalizePrefix(value) {
  if (value == null || value === '') return null;
  const v = String(value).trim().toUpperCase();
  return PREFIX_RE.test(v) ? v : null;
}

/**
 * Effective prefix for a project meta row.
 * Walks parentId chain when metaProjects is provided — child inherits parent's prefix
 * unless the child sets an explicit prefix.
 * @param {{ id?: string, prefix?: string, parentId?: string }} project
 * @param {Array<{ id?: string, prefix?: string, parentId?: string }>} [metaProjects]
 * @returns {string}
 */
export function projectPrefix(project, metaProjects = null) {
  if (!project) return DEFAULT_TASK_PREFIX;
  if (!metaProjects?.length) {
    const custom = normalizePrefix(project.prefix);
    if (custom) return custom;
    return derivePrefixFromSlug(project.id || '');
  }
  const byId = new Map(metaProjects.map(p => [p.id, p]));
  const seen = new Set();
  let current = project;
  while (current) {
    if (current.id) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
    }
    const custom = normalizePrefix(current.prefix);
    if (custom) return custom;
    if (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId);
      continue;
    }
    return derivePrefixFromSlug(current.id || project.id || '');
  }
  return derivePrefixFromSlug(project.id || '');
}

/**
 * Collect all known prefixes from meta.projects (+ default T).
 * @param {Array<{ id?: string, prefix?: string }>} [metaProjects]
 * @returns {string[]}
 */
export function collectKnownPrefixes(metaProjects = []) {
  const set = new Set([DEFAULT_TASK_PREFIX]);
  for (const p of metaProjects || []) {
    set.add(projectPrefix(p, metaProjects));
  }
  return [...set].sort((a, b) => b.length - a.length);
}

/**
 * Known prefixes from meta.projects plus any task.project slugs (orphan projects).
 * @param {Array} metaProjects
 * @param {Array<{ project?: string }>} [tasks]
 */
export function collectKnownPrefixesWithTasks(metaProjects = [], tasks = []) {
  const set = new Set(collectKnownPrefixes(metaProjects));
  for (const t of tasks || []) {
    const pid = t.project;
    if (!pid) continue;
    const proj = (metaProjects || []).find(p => p.id === pid) || { id: pid };
    set.add(projectPrefix(proj, metaProjects));
  }
  return [...set].sort((a, b) => b.length - a.length);
}

/**
 * Parse a task id into { prefix, num } using known prefixes (longest match first).
 * @param {string} id
 * @param {string[]} [knownPrefixes]
 * @returns {{ prefix: string, num: number }|null}
 */
export function parseTaskId(id, knownPrefixes = [DEFAULT_TASK_PREFIX]) {
  if (typeof id !== 'string' || !id) return null;
  const sorted = [...new Set(knownPrefixes)].sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (!id.startsWith(prefix)) continue;
    const rest = id.slice(prefix.length);
    if (/^\d+$/.test(rest)) {
      const num = parseInt(rest, 10);
      if (num > 0) return { prefix, num };
    }
  }
  return null;
}

/** @param {string} id @param {string[]} [knownPrefixes] */
export function isValidTaskId(id, knownPrefixes) {
  return !!parseTaskId(id, knownPrefixes);
}

/**
 * Scan flat task rows (each with `.id` string) for max numeric suffix per prefix.
 * @param {Array<{ id?: string }>} tasks
 * @param {string} prefix
 * @param {string[]} knownPrefixes
 * @returns {number}
 */
export function maxTaskNumForPrefix(tasks, prefix, knownPrefixes) {
  let max = 0;
  for (const t of tasks || []) {
    const parsed = parseTaskId(t.id, knownPrefixes);
    if (parsed?.prefix === prefix) max = Math.max(max, parsed.num);
  }
  return max;
}

/**
 * Next task id for a project (or global T-prefix when projectId is null).
 * @param {Array<{ id?: string }>} flatTasks — all tasks with string `.id`
 * @param {string|null} projectId
 * @param {Array<{ id?: string, prefix?: string }>} [metaProjects]
 * @returns {string}
 */
export function nextTaskId(flatTasks, projectId, metaProjects = []) {
  const known = collectKnownPrefixes(metaProjects);
  let prefix = DEFAULT_TASK_PREFIX;
  if (projectId) {
    const proj = (metaProjects || []).find(p => p.id === projectId);
    prefix = proj ? projectPrefix(proj, metaProjects) : derivePrefixFromSlug(projectId);
    if (!known.includes(prefix)) known.push(prefix);
    known.sort((a, b) => b.length - a.length);
  }
  const max = maxTaskNumForPrefix(flatTasks, prefix, known);
  return `${prefix}${max + 1}`;
}

/**
 * Flatten dashboard in-memory tasks (sections map) to { id: taskId } rows.
 * @param {object} tasksBySection
 * @returns {Array<{ id: string }>}
 */
export function flattenDashboardTaskIds(tasksBySection) {
  const out = [];
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.taskId) out.push({ id: t.taskId });
    }
  }
  return out;
}

/**
 * Next task id from dashboard state shape.
 * @param {{ tasks?: object, meta?: { projects?: object[] } }} state
 * @param {string|null} [projectId]
 * @returns {string}
 */
export function nextTaskIdFromState(state, projectId = null) {
  const flat = flattenDashboardTaskIds(state?.tasks);
  const metaProjects = state?.meta?.projects || [];
  return nextTaskId(flat, projectId, metaProjects);
}
