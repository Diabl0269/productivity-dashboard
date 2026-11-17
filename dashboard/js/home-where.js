// home-where.js — what the Home project and the selected place ("where") narrow to, for any Home view, tab or
// strip item (PRO117, PRO127). Built on shared/home-scope.js (the project's tickets: ONE rule for every view, the
// running answer and `ch tasks running --project`) and shared/home-areas.js (the epics of a place).
//
//   projectScopeOf(ctx)            -> shared/home-scope.js projectScope for the Home project, or null (no project)
//   selectedEpicIds(ctx)           -> Set of epic ids in the selected place (inside the project), or null when none
//   scopeIds(ctx)                  -> the ids that narrow a view: the place's epics, else the project's ids, else null
//   ticketInSelection(ctx, ticket) -> true when no place is selected, or the ticket's epic is in it.
//                                     `ticket` is { id, epicId?, parentId? } (a running item, or a tracker ticket).
//   ticketInScope(ctx, ticket)     -> ticketInSelection and inside the Home project
//   selectedPlaceName(ctx)         -> the selected place's name ('Timeline & arrangement'), or '' (one helper for every view)

import { epicIdsForBox } from '../../shared/home-areas.js';
import { projectScope, narrowTo } from '../../shared/home-scope.js';
import { boxOfWhere } from '../../shared/home-config.js';

const cache = new WeakMap(); // doc -> { config, project, scope, byBox: Map(box id -> Set) }; a refresh starts empty

function hitFor(ctx) {
  const doc = ctx.doc();
  const config = ctx.config();
  const project = ctx.project?.() || null;
  let hit = cache.get(doc);
  if (!hit || hit.config !== config || hit.project !== project) {
    cache.set(doc, hit = { config, project, scope: projectScope(config, doc, project), byBox: new Map() });
  }
  return hit;
}

export function projectScopeOf(ctx) {
  return hitFor(ctx).scope;
}

export function selectedEpicIds(ctx) {
  const w = ctx.selection();
  const boxId = w.part || w.area || w.group || null;
  const config = ctx.config();
  if (!boxId || !config) return null;
  const hit = hitFor(ctx);
  // A place's epics, kept to this project: the fallback area would otherwise pull in every other project's epics.
  if (!hit.byBox.has(boxId)) hit.byBox.set(boxId, narrowTo(epicIdsForBox(config, ctx.doc(), boxId), hit.scope));
  return hit.byBox.get(boxId);
}

export function selectedPlaceName(ctx) {
  const w = ctx.selection?.() || {};
  const config = ctx.config?.();
  if (!config || !(w.group || w.area || w.part)) return '';
  return boxOfWhere(config, w)?.name || '';
}

export function scopeIds(ctx) {
  return selectedEpicIds(ctx) || projectScopeOf(ctx)?.ids || null;
}

/** The epic a ticket belongs to: itself when it is an epic, else the nearest epic above it, else null. */
function epicOf(ctx, ticket) {
  if (ticket.epicId !== undefined) return ticket.epicId;
  const byId = new Map();
  for (const s of ctx.doc().sections || []) for (const t of s.tasks || []) byId.set(t.id, t);
  const seen = new Set();
  let cur = byId.get(ticket.id);
  while (cur && !seen.has(cur.id)) {
    if (cur.type === 'epic') return cur.id;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return null;
}

export function ticketInSelection(ctx, ticket) {
  const ids = selectedEpicIds(ctx);
  if (!ids) return true;
  const epic = epicOf(ctx, ticket);
  return epic !== null && ids.has(epic);
}

export function ticketInScope(ctx, ticket) {
  const scope = projectScopeOf(ctx);
  return (!scope || scope.hasId(ticket.id)) && ticketInSelection(ctx, ticket);
}
