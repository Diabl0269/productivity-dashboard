/**
 * Project meta helpers — nested projects, prefix inheritance, tree building.
 * Shared by dashboard (ESM) and CLI (Node ESM).
 */

import { derivePrefixFromSlug, normalizePrefix, projectPrefix } from './task-ids.js';

/**
 * @param {Array<{ id?: string }>} metaProjects
 * @param {string} id
 */
export function getProjectById(metaProjects, id) {
  return (metaProjects || []).find(p => p.id === id) || null;
}

/**
 * Walk parentId chain; true if `ancestorId` is an ancestor of `descendantId`.
 */
export function isProjectAncestor(metaProjects, ancestorId, descendantId) {
  if (!ancestorId || !descendantId || ancestorId === descendantId) return false;
  const byId = new Map((metaProjects || []).map(p => [p.id, p]));
  const seen = new Set();
  let cur = byId.get(descendantId);
  while (cur?.parentId) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    if (cur.parentId === ancestorId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
}

/** True if setting parentId on childId would create a cycle. */
export function wouldCreateProjectCycle(metaProjects, childId, parentId) {
  if (!parentId) return false;
  if (parentId === childId) return true;
  return isProjectAncestor(metaProjects, childId, parentId);
}

/**
 * Build nested tree from flat meta.projects.
 * @returns {{ roots: object[], byId: Map<string, object> }}
 */
export function buildProjectTree(metaProjects = []) {
  const byId = new Map();
  for (const p of metaProjects || []) {
    byId.set(p.id, { ...p, children: [] });
  }
  const roots = [];
  for (const p of metaProjects || []) {
    const node = byId.get(p.id);
    if (!node) continue;
    const pid = p.parentId;
    if (pid && byId.has(pid) && pid !== p.id) {
      byId.get(pid).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortFn = (a, b) => (a.name || a.id).localeCompare(b.name || b.id);
  roots.sort(sortFn);
  for (const node of byId.values()) node.children.sort(sortFn);
  return { roots, byId };
}

/** Flat list in tree order (depth-first). */
export function projectsInTreeOrder(metaProjects = []) {
  const { roots } = buildProjectTree(metaProjects);
  const out = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push({ ...n, depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/**
 * Effective ticket prefix for a project (explicit prefix or inherited from parent).
 * @param {{ id?: string, prefix?: string, parentId?: string }} project
 * @param {Array<{ id?: string, prefix?: string, parentId?: string }>} [metaProjects]
 */
export function effectiveProjectPrefix(project, metaProjects = []) {
  return projectPrefix(project, metaProjects);
}

/**
 * True when two projects share an effective prefix but are not in a parent-child line.
 */
export function projectPrefixConflicts(a, b, metaProjects = []) {
  const effA = effectiveProjectPrefix(a, metaProjects);
  const effB = effectiveProjectPrefix(b, metaProjects);
  if (effA !== effB) return false;
  return !isProjectAncestor(metaProjects, a.id, b.id)
    && !isProjectAncestor(metaProjects, b.id, a.id);
}

/**
 * Normalize a project meta row from JSON.
 * @param {object} p
 * @returns {object}
 */
export function normalizeProjectRow(p) {
  const row = {
    id: String(p.id).trim(),
    name: String(p.name || p.id).trim() || String(p.id).trim(),
  };
  if (typeof p.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(p.color)) row.color = p.color;
  const prefix = normalizePrefix(p.prefix);
  if (prefix) row.prefix = prefix;
  if (typeof p.parentId === 'string' && p.parentId.trim()) {
    row.parentId = p.parentId.trim();
  }
  return row;
}

/**
 * Collect project ids referenced by tasks but missing from meta.
 * @param {object} tasksBySection
 * @param {Array<{ id: string }>} metaProjects
 */
export function orphanProjectIds(tasksBySection, metaProjects = []) {
  const ids = new Set((metaProjects || []).map(p => p.id));
  const orphans = new Set();
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.project && !ids.has(t.project)) orphans.add(t.project);
    }
  }
  return [...orphans].sort();
}

/**
 * Merge meta projects with orphan slugs from tasks.
 */
export function mergedProjectList(tasksBySection, metaProjects = []) {
  const fromMeta = (metaProjects || []).map(p => ({
    id: p.id,
    name: p.name || p.id,
    color: p.color || null,
    prefix: p.prefix || null,
    parentId: p.parentId || null,
  }));
  const ids = new Set(fromMeta.map(p => p.id));
  for (const id of orphanProjectIds(tasksBySection, metaProjects)) {
    if (!ids.has(id)) {
      fromMeta.push({ id, name: id, color: null, prefix: null, parentId: null });
      ids.add(id);
    }
  }
  return fromMeta;
}
