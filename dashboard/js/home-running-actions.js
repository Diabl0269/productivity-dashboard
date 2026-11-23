// home-running-actions.js (AGE200): the one button an idle epic offers, in plain words. Used by the Running now
// panel and the Overview card. `epic` is an entry of the running answer's `epics` ({ promoteIds, ready, auto }).

import { promoteBacklogTickets, setEpicAuto } from './task-selection.js';

/** { label, run } for an idle or stale epic, or null when nothing a click could fix (it waits on something else). */
export function promoteAction(id, epic) {
  const ids = epic?.promoteIds || [];
  if (ids.length) {
    return { label: ids.length === 1 ? `Move ${ids[0]} to To do` : `Move ${ids.length} to To do`, run: () => promoteBacklogTickets(ids) };
  }
  if (epic?.ready && !epic.auto) return { label: 'Turn on Auto', run: () => setEpicAuto(id, true) };
  return null;
}
