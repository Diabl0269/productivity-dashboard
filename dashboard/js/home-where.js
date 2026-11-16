// home-where.js — what the selected place ("where") narrows to, for any Home view, tab or strip item (PRO117).
// Built on shared/home-areas.js: a ticket is in the selection when its epic sits in the selected box.
//
//   selectedEpicIds(ctx)           -> Set of epic ids in the selected place, or null when nothing is selected
//   ticketInSelection(ctx, ticket) -> true when no place is selected, or the ticket's epic is in it.
//                                     `ticket` is { id, epicId?, parentId? } (a running item, or a tracker ticket).

import { epicIdsForBox } from '../../shared/home-areas.js';

const cache = new WeakMap(); // doc -> { config, byBox: Map(box id -> Set) }; a new doc object (a refresh) starts empty

export function selectedEpicIds(ctx) {
  const w = ctx.selection();
  const boxId = w.part || w.area || w.group || null;
  const config = ctx.config();
  if (!boxId || !config) return null;
  const doc = ctx.doc();
  let hit = cache.get(doc);
  if (!hit || hit.config !== config) cache.set(doc, hit = { config, byBox: new Map() });
  if (!hit.byBox.has(boxId)) hit.byBox.set(boxId, epicIdsForBox(config, doc, boxId));
  return hit.byBox.get(boxId);
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
