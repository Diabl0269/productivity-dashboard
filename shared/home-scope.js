/**
 * shared/home-scope.js (PRO127): the ONE rule for which tickets belong to the Home project, used by every Home
 * view, strip item, the running answer and `ch tasks running --project`. Pure: no fs, no DOM.
 *
 * A ticket is in the project when its epic is on the project's map (shared/home-map-stats.js mapScope: the
 * epic's project is the Home project or one of its sub-projects, or an area of the map claims it by lane,
 * title or project), or, for a ticket under no epic, when its own project is in that family.
 * With no config only the project family counts. With no project every ticket is in scope (null).
 *
 *   projectScope(config, doc, project) -> null | { ids: Set, epics: Set, family: Set, hasId(id) }
 *     ids    epic ids on the map plus the ids of the family's tickets under no epic; a ticket is in scope when
 *            it or a ticket above it is in `ids` (the same test as shared/plan-scope.js scopeTest)
 *   narrowTo(set, scope) -> the ids of `set` that are in scope (a selected place's epics, for example)
 */

import { mapScope, projectFamily } from './home-map-stats.js';

function flat(doc) {
  const byId = new Map();
  for (const s of doc?.sections || []) for (const t of s.tasks || []) if (t?.id && !byId.has(t.id)) byId.set(t.id, { ...t, status: s.id });
  return byId;
}

export function projectScope(config, doc, project) {
  if (!project) return null;
  const family = projectFamily(doc, project);
  const onMap = config?.groups?.length ? mapScope(config, doc, { project }) : null;
  const byId = flat(doc);
  const epicOf = (t) => {
    const seen = new Set();
    let c = t;
    while (c && !seen.has(c.id)) {
      if (c.type === 'epic') return c;
      seen.add(c.id);
      c = c.parentId ? byId.get(c.parentId) : null;
    }
    return null;
  };
  const epics = new Set();
  const ids = new Set();
  for (const t of byId.values()) {
    if (t.type === 'epic') {
      if (family.has(t.project) || (onMap && onMap(t))) { epics.add(t.id); ids.add(t.id); }
    } else if (!epicOf(t) && family.has(t.project)) {
      ids.add(t.id);
    }
  }
  const memo = new Map();
  const hasId = (id) => {
    if (memo.has(id)) return memo.get(id);
    const seen = new Set();
    let ok = false;
    for (let c = byId.get(id); c && !seen.has(c.id); c = c.parentId ? byId.get(c.parentId) : null) {
      seen.add(c.id);
      if (ids.has(c.id)) { ok = true; break; }
    }
    memo.set(id, ok);
    return ok;
  };
  return { ids, epics, family, hasId };
}

/** The ids of `set` that are in `scope`; `set` unchanged when there is no scope, null when there is no set. */
export function narrowTo(set, scope) {
  if (!set) return null;
  if (!scope) return set;
  return new Set([...set].filter(id => scope.hasId(id)));
}
