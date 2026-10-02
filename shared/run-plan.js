/**
 * Run plan — which pinned epics can be launched now, as parallel lanes.
 * Pure module shared by the CLI (`ch tasks runplan`) and the dashboard "Run plan" tab.
 *
 * Input is the tasks.json document shape: { sections: [{ id, tasks: [...] }], meta }.
 */

export const DEFAULT_MACHINE_CAP = 3;
export const UNASSIGNED_LANE = 'unassigned';

/** Natural id order: T2 before T10, prefix first. */
function compareIds(a, b) {
  const ma = /^(.*?)(\d+)$/.exec(a);
  const mb = /^(.*?)(\d+)$/.exec(b);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1;
    return Number(ma[2]) - Number(mb[2]);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Stable topological sort. `depsOf(id)` returns ids that must come first (ids outside
 * `ids` are ignored). Ties break by id order; if a cycle leaves no free node, the
 * smallest remaining id is emitted, so the result is deterministic and always complete.
 */
function stableTopo(ids, depsOf) {
  const remaining = new Set(ids);
  const out = [];
  while (remaining.size) {
    const sorted = [...remaining].sort(compareIds);
    const next = sorted.find(id => depsOf(id).every(d => d === id || !remaining.has(d))) || sorted[0];
    remaining.delete(next);
    out.push(next);
  }
  return out;
}

/**
 * A "pick" gate is a ticket that needs the human to decide or act before dependants can
 * proceed: a title starting "Co-task:" or "Design:" (case-insensitive), or a label
 * "design" / "co-task" (case-insensitive).
 */
export function isPickGate(task) {
  const title = String(task?.title || '');
  if (/^\s*(co-task|design)\s*:/i.test(title)) return true;
  return (task?.labels || []).some(l => /^(design|co-task)$/i.test(String(l).trim()));
}

/**
 * @param {{ sections?: Array<{ id: string, tasks?: object[] }>, meta?: object }} doc
 * @param {{ machineCap?: number }} [opts]
 */
export function computeRunPlan(doc, { machineCap = DEFAULT_MACHINE_CAP } = {}) {
  const byId = new Map();
  const statusOf = new Map();
  for (const sec of doc?.sections || []) {
    for (const t of sec.tasks || []) {
      if (t && t.id && !byId.has(t.id)) {
        byId.set(t.id, t);
        statusOf.set(t.id, sec.id);
      }
    }
  }
  const isOpen = id => byId.has(id) && !byId.get(id).checked;
  const openBlockers = t => (t.blockedBy || []).filter(isOpen);

  const plan = doc?.meta?.dailyPlan || {};
  const pinned = [];
  for (const id of [...(plan.taskIds || []), ...(plan.carriedIds || [])]) {
    if (!pinned.includes(id) && byId.get(id)?.type === 'epic') pinned.push(id);
  }

  // Descendants (children and their subtasks) per pinned epic; cycle-safe.
  const childrenOf = new Map();
  for (const t of byId.values()) {
    if (!t.parentId) continue;
    if (!childrenOf.has(t.parentId)) childrenOf.set(t.parentId, []);
    childrenOf.get(t.parentId).push(t.id);
  }
  function descendants(epicId) {
    const seen = new Set([epicId]);
    const out = [];
    const stack = [...(childrenOf.get(epicId) || [])];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      stack.push(...(childrenOf.get(id) || []));
    }
    return out;
  }

  const doneEpics = [];
  const live = []; // pinned, not done, in pin order
  const members = new Map(); // epicId -> Set of descendant ids
  for (const id of pinned) {
    const kids = descendants(id);
    const done = byId.get(id).checked || (kids.length > 0 && kids.every(k => !isOpen(k)));
    if (done) { doneEpics.push(id); continue; }
    live.push(id);
    members.set(id, new Set(kids));
  }

  // Which live epic owns a ticket (the epic itself or anything under it).
  const owningEpic = id => live.find(e => e === id || members.get(e).has(id)) || null;

  const epics = new Map();
  for (const epicId of live) {
    const epic = byId.get(epicId);
    const kids = [...members.get(epicId)].filter(isOpen);
    const kidSet = new Set(kids);

    const waitingOn = [];
    const addWait = id => { if (id !== epicId && !waitingOn.includes(id)) waitingOn.push(id); };
    for (const b of openBlockers(epic)) {
      if (kidSet.has(b) || doneEpics.includes(b)) continue;
      addWait(owningEpic(b) || b);
    }
    for (const k of kids) {
      for (const b of openBlockers(byId.get(k))) {
        const owner = owningEpic(b);
        if (owner && owner !== epicId) addWait(owner);
      }
    }

    const picks = [];
    let partial = false;
    for (const k of kids) {
      const blockers = openBlockers(byId.get(k));
      if (blockers.length && blockers.every(b => isPickGate(byId.get(b)))) {
        partial = true;
        for (const b of blockers) if (!picks.includes(b)) picks.push(b);
      }
    }

    const ordered = stableTopo(kids, id => openBlockers(byId.get(id)).filter(b => kidSet.has(b)));
    const tickets = ordered.map(id => {
      const t = byId.get(id);
      return {
        id,
        title: t.title || '',
        status: statusOf.get(id),
        blockedBy: openBlockers(t),
        isPick: isPickGate(t),
      };
    });

    epics.set(epicId, {
      id: epicId,
      title: epic.title || '',
      state: waitingOn.length ? 'waiting' : partial ? 'partial' : 'ready',
      waitingOn,
      picks,
      tickets,
      command: `/ship-task ${epicId}`,
      lane: epic.lane || UNASSIGNED_LANE,
    });
  }

  // Group by lane (first appearance in pin order), order epics within a lane by "after".
  const laneNames = [];
  for (const id of live) {
    const lane = epics.get(id).lane;
    if (!laneNames.includes(lane)) laneNames.push(lane);
  }
  const lanes = laneNames.map(lane => {
    const ids = live.filter(id => epics.get(id).lane === lane);
    const ordered = stableTopo(ids, id => epics.get(id).waitingOn);
    return {
      lane,
      epics: ordered.map(id => {
        const { lane: _lane, ...rest } = epics.get(id);
        return rest;
      }),
    };
  });

  const readyCount = [...epics.values()].filter(e => e.state !== 'waiting').length;
  return { lanes, doneEpics, machineCap, readyCount };
}
