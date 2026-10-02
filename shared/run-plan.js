/**
 * Run plan — which pinned epics can be launched now, as parallel lanes (rows).
 * Pure module shared by the CLI (`ch tasks runplan`) and the dashboard "Run plan" tab.
 *
 * Input is the tasks.json document shape: { sections: [{ id, tasks: [...] }], meta }.
 */

export const DEFAULT_MACHINE_CAP = 3;
export const UNASSIGNED_LANE = 'unassigned';
export const DESIGN_LANE = 'design';

/** Stage of an open pick gate: draw a canvas, wait for Tal's pick, or publish the pick. */
function pickStage(t) {
  const waiting = String((t && t.waitingOn) || '');
  const hasCanvas = Array.isArray(t && t.links) && t.links.some(l => l && /design canvas/i.test(l.label || ''));
  const hasDecision = Array.isArray(t && t.decisions) && t.decisions.length > 0;
  if (/^\s*claude\s*:/i.test(waiting)) return 'draw';
  if (/^\s*tal\s*:/i.test(waiting)) return 'pick';
  if (hasDecision) return 'publish';
  return hasCanvas ? 'pick' : 'draw';
}

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
 * A "pick" gate is a ticket the human must act on before dependants can proceed: a title
 * starting "Co-task:" (case-insensitive) or a label "co-task". A "Design:" ticket is NOT a
 * pick; an agent builds it.
 */
export function isPickGate(task) {
  if (/^\s*co-task\s*:/i.test(String(task?.title || ''))) return true;
  return (task?.labels || []).some(l => /^co-task$/i.test(String(l).trim()));
}

/** "A", "A and B", "A, B and C". */
function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** An epic needs an app build when its id starts with FRO or its project is agentsynth/frontend. */
function needsBuildEpic(epic) {
  return /^FRO\d/.test(epic.id) || epic.project === 'agentsynth' || epic.project === 'frontend';
}

/**
 * @param {{ sections?: Array<{ id: string, tasks?: object[] }>, meta?: object }} doc
 * @param {{ machineCap?: number }} [opts]
 */
export function computeRunPlan(doc, { machineCap = DEFAULT_MACHINE_CAP } = {}) {
  const byId = new Map();
  const sectionOf = new Map(); // task id -> id of the section it sits in
  for (const sec of doc?.sections || []) {
    for (const t of sec.tasks || []) {
      if (t && t.id && !byId.has(t.id)) { byId.set(t.id, t); sectionOf.set(t.id, sec.id); }
    }
  }
  const isOpen = id => byId.has(id) && !byId.get(id).checked;
  const openBlockers = t => (t.blockedBy || []).filter(isOpen);

  const plan = doc?.meta?.dailyPlan || {};
  const pinned = [];
  for (const id of [...(plan.taskIds || []), ...(plan.carriedIds || [])]) {
    if (!pinned.includes(id) && byId.get(id)?.type === 'epic') pinned.push(id);
  }

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
  const live = [];
  const members = new Map();
  for (const id of pinned) {
    const kids = descendants(id);
    const done = byId.get(id).checked || (kids.length > 0 && kids.every(k => !isOpen(k)));
    if (done) { doneEpics.push(id); continue; }
    live.push(id);
    members.set(id, new Set(kids));
  }
  const owningEpic = id => live.find(e => e === id || members.get(e).has(id)) || null;
  const laneOf = id => byId.get(id).lane || UNASSIGNED_LANE;

  // Open pick gates under live epics, and which epics they gate.
  const picks = new Map(); // pickId -> { id, title, gates: [] }
  for (const epicId of live) {
    for (const k of members.get(epicId)) {
      if (isOpen(k) && isPickGate(byId.get(k)) && !picks.has(k)) {
        picks.set(k, { id: k, title: byId.get(k).title || '', gates: [] });
      }
    }
  }

  const info = new Map();
  for (const epicId of live) {
    const kidSet = new Set([...members.get(epicId)].filter(isOpen));
    const work = [...kidSet].filter(k => !picks.has(k));

    // Epic dependencies: epic-level blockers and child-level blockers inside other live epics.
    const deps = [];
    const addDep = id => { if (id && id !== epicId && !deps.includes(id)) deps.push(id); };
    for (const b of openBlockers(byId.get(epicId))) {
      if (!kidSet.has(b)) addDep(owningEpic(b));
    }
    for (const k of kidSet) {
      for (const b of openBlockers(byId.get(k))) addDep(owningEpic(b));
    }

    // A work ticket is gated when an open pick (or a gated ticket) blocks it.
    const gatedMemo = new Map();
    const gatingPicks = new Set();
    function gated(id, trail = new Set()) {
      if (gatedMemo.has(id)) return gatedMemo.get(id);
      if (trail.has(id)) return false;
      trail.add(id);
      let g = false;
      for (const b of openBlockers(byId.get(id))) {
        if (picks.has(b)) { g = true; gatingPicks.add(b); } else if (kidSet.has(b) && gated(b, trail)) g = true;
      }
      gatedMemo.set(id, g);
      return g;
    }
    const gatedWork = work.filter(k => gated(k));
    const freeWork = work.filter(k => !gatedWork.includes(k));
    for (const p of gatingPicks) {
      const gates = picks.get(p).gates;
      if (!gates.includes(epicId)) gates.push(epicId);
    }
    // Picks that gate nothing yet still hold up the epic they live in.
    for (const k of kidSet) if (picks.has(k) && !picks.get(k).gates.includes(epicId)) picks.get(k).gates.push(epicId);

    let phase;
    if (work.length === 0) phase = [...kidSet].some(k => picks.has(k)) ? 'later' : 'now';
    else if (freeWork.length === 0) phase = 'later';
    else if (gatedWork.length > 0) phase = 'partial';
    else phase = 'now';

    // In progress: the epic itself or any open ticket under it sits in the in-progress section.
    const inProgress = sectionOf.get(epicId) === 'in-progress'
      || [...kidSet].some(k => sectionOf.get(k) === 'in-progress');

    info.set(epicId, {
      epicId, deps, phase, inProgress, work, freeWork, gatedWork,
      pickIds: [...gatingPicks].sort(compareIds),
      epicPicks: [...kidSet].filter(k => picks.has(k)).sort(compareIds),
    });
  }

  const card = (epicId, state, isRest, openTickets, why) => ({
    id: epicId,
    title: byId.get(epicId).title || '',
    state,
    isRest,
    openTickets,
    why,
    command: `/ship-task ${epicId}`,
    inProgress: info.get(epicId).inProgress,
    step: 0,
  });

  /**
   * Give each card of one row its `step`. Named lanes run in order, so step = position.
   * In the unassigned lane, cards with no dependency on another card in the row can run at
   * the same time: step 0, else 1 + the highest step among their same-lane dependencies.
   * Unassigned rows are stably sorted by step so equal steps sit together.
   */
  function assignSteps(row, lane) {
    if (lane !== UNASSIGNED_LANE) {
      row.forEach((c, idx) => { c.step = idx; });
      return row;
    }
    const stepOf = new Map();
    for (const c of row) {
      const deps = info.get(c.id).deps.filter(d => laneOf(d) === lane && stepOf.has(d));
      c.step = deps.length ? 1 + Math.max(...deps.map(d => stepOf.get(d))) : 0;
      stepOf.set(c.id, c.step);
    }
    return row.map((c, idx) => ({ c, idx })).sort((a, b) => a.c.step - b.c.step || a.idx - b.idx).map(x => x.c);
  }

  const laneNames = [];
  for (const id of live) {
    const l = laneOf(id);
    if (!laneNames.includes(l)) laneNames.push(l);
  }

  const lanes = laneNames.map(lane => {
    const ids = live.filter(id => laneOf(id) === lane);
    const ordered = stableTopo(ids, id => info.get(id).deps.filter(d => laneOf(d) === lane));
    const now = [];
    const later = [];
    const resolved = new Map();
    const waitPicks = new Set();
    const waitEpics = new Set();
    for (const id of ordered) {
      const i = info.get(id);
      const crossLane = i.deps.filter(d => laneOf(d) !== lane);
      const sameLane = i.deps.filter(d => laneOf(d) === lane);
      const laterSameLane = sameLane.filter(d => resolved.get(d) === 'later');
      const pickList = i.pickIds.length ? i.pickIds : i.epicPicks;
      const pickText = pickList.length
        ? `your ${joinList(pickList)} ${pickList.length > 1 ? 'picks' : 'pick'}` : '';
      let phase = i.phase;
      if (crossLane.length || laterSameLane.length) phase = 'later';
      resolved.set(id, phase);

      if (phase === 'later' || phase === 'partial') pickList.forEach(p => waitPicks.add(p));
      if (phase === 'later') [...crossLane, ...laterSameLane].forEach(e => waitEpics.add(e));

      if (phase === 'later') {
        const needs = joinList([...crossLane, ...laterSameLane, ...(pickText ? [pickText] : [])]);
        later.push(card(id, 'later', false, i.work.length, needs ? `Needs ${needs}` : 'Needs the card before it'));
      } else if (phase === 'partial') {
        now.push(card(id, 'partial', false, i.freeWork.length, `Stops at ${pickText}`));
        later.push(card(id, 'later', true, i.gatedWork.length, `Needs ${pickText}`));
      } else {
        now.push(card(id, 'ready', false, i.work.length,
          sameLane.length ? `Runs after ${joinList(sameLane)}` : 'Nothing blocking it'));
      }
    }
    return {
      lane,
      name: lane === UNASSIGNED_LANE ? 'No lane yet' : lane,
      needsBuild: ids.some(id => needsBuildEpic(byId.get(id))),
      now: assignSteps(now, lane),
      later: assignSteps(later, lane),
      waitsOn: { picks: [...waitPicks].sort(compareIds), epics: [...waitEpics].sort(compareIds) },
    };
  });
  const appStartCount = lanes.reduce(
    (n, l) => n + l.now.filter(c => c.step === 0 && needsBuildEpic(byId.get(c.id))).length, 0);

  const pickList = [...picks.values()]
    .map(p => ({ ...p, gates: p.gates.sort(compareIds), stage: pickStage(byId.get(p.id)) }))
    .sort((a, b) => compareIds(a.id, b.id));

  if (pickList.length) {
    const idsAt = stage => pickList.filter(p => p.stage === stage).map(p => p.id);
    const drawIds = idsAt('draw');
    const pickIds = idsAt('pick');
    const publishIds = idsAt('publish');
    const now = [];
    if (drawIds.length) {
      now.push({
        id: 'design-canvases',
        title: `Draw the ${drawIds.length} pick ${drawIds.length === 1 ? 'canvas' : 'canvases'}`,
        state: 'ready',
        isRest: false,
        openTickets: drawIds.length,
        why: 'An agent draws one board per pick ticket',
        command: `Draw the design canvases for ${joinList(drawIds)} (one board per ticket, options plus a recommended default, Design System components), link each canvas on its ticket, then stop for my picks.`,
        isPrompt: true,
        inProgress: false,
        step: now.length,
      });
    }
    if (pickIds.length) {
      now.push({
        id: 'design-picks',
        title: 'You: pick on each canvas',
        state: 'pick',
        isRest: false,
        openTickets: pickIds.length,
        why: `Picks: ${joinList(pickIds)}`,
        command: null,
        inProgress: false,
        step: now.length,
      });
    }
    if (publishIds.length) {
      now.push({
        id: 'design-publish',
        title: `Publish the ${publishIds.length} picked ${publishIds.length === 1 ? 'design' : 'designs'} to the Design System`,
        state: 'ready',
        isRest: false,
        openTickets: publishIds.length,
        why: 'An agent adds the chosen options to the Design System',
        command: `Publish the picked designs for ${joinList(publishIds)} to the AgentSynth Design System and Storybook (chosen option only, as recorded in each ticket's decisions), then close each pick ticket.`,
        isPrompt: true,
        inProgress: false,
        step: now.length,
      });
    }
    lanes.unshift({
      lane: DESIGN_LANE,
      name: 'Design round',
      needsBuild: false,
      now,
      later: [],
      waitsOn: { picks: [], epics: [] },
    });
  }

  return {
    lanes,
    doneEpics,
    picks: pickList,
    machineCap,
    appLaneCount: lanes.filter(l => l.needsBuild).length,
    appStartCount,
  };
}
