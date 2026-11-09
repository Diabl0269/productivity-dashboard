/**
 * Epic readiness: is an epic Ready to run, or Not ready, and why (plain words).
 * Pure module shared by `ch tasks ready`, `ch tasks runplan`, the Plan page and ticket window,
 * and a dispatcher script (the per-child shape below is its contract).
 *
 * An epic is Ready when it is in todo or in-progress, is not a "later"/"future" bucket, has at
 * least one runnable child, is not waiting on an open pick or co-task, and every runnable child
 * says "How to check it". An epic runs by itself only when it is Ready AND has the `auto` label.
 *
 * Input is the tasks.json document shape: { sections: [{ id, tasks: [...] }], meta }.
 */

import { isDesignPick, isPickGate } from './pick-gate.js';

/** Sections whose tickets are finished: they no longer block anything (an epic in review is waiting on Tal, not on work). */
const FINISHED = new Set(['done', 'review', 'archive']);
/** Labels that hold a ticket back from automatic runs: they need a human go-ahead. */
export const HELD_LABELS = ['deploy', 'money', 'public-post', 'needs-approval'];
export const AUTO_LABEL = 'auto';
const LATER_TITLE = /\b(later|future)\b/i;
const COMPUTER_USE_TEXT = /computer use|open\/save panel|menu bar|voiceover|another app/i;
const RUNNABLE_SECTIONS = new Set(['todo', 'in-progress']);

/** Auto-queue priorities, first to run first. Stored on the epic as `autoPriority` (the ticket's own `priority` stays low/medium/high). */
export const AUTO_PRIORITIES = ['high', 'normal', 'low'];

/** An epic's queue priority: 'high' | 'normal' | 'low'; missing or unknown = 'normal'. */
export function autoPriorityOf(epic) {
  const p = String(epic?.autoPriority ?? '').trim().toLowerCase();
  return AUTO_PRIORITIES.includes(p) ? p : 'normal';
}

/** An epic's `autoRank` (finite number, lower runs first), or null when it has none. */
export function autoRankOf(epic) {
  const n = epic?.autoRank;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const labelsOf = t => (t?.labels || []).map(l => String(l).trim().toLowerCase());

/** True when the epic carries the `auto` label (Tal switched Auto on for it). */
export function isAuto(task) { return labelsOf(task).includes(AUTO_LABEL); }

/** The tier named by a `model:<tier>` label, when it is one we run; else null. */
function modelTier(task) {
  const label = (task?.labels || []).find(l => /^model:\s*\S/i.test(String(l)));
  if (!label) return null;
  const tier = String(label).replace(/^model:\s*/i, '').trim().toLowerCase();
  return ['opus', 'sonnet', 'haiku'].includes(tier) ? tier : null;
}

/** The "How to check it" text of a ticket's "In plain words" section, or null when it has none. */
export function howToCheckText(task) {
  const desc = String(task?.description || '');
  const start = /^##\s+In plain words\s*$/im.exec(desc);
  if (!start) return null;
  const rest = desc.slice(start.index + start[0].length);
  const next = /^##\s/m.exec(rest);
  const body = next ? rest.slice(0, next.index) : rest;
  const at = body.search(/how to check it/i);
  return at < 0 ? null : body.slice(at);
}

function indexDoc(doc) {
  const byId = new Map();
  const sectionOf = new Map();
  for (const sec of doc?.sections || []) {
    for (const t of sec.tasks || []) {
      if (t && t.id && !byId.has(t.id)) { byId.set(t.id, t); sectionOf.set(t.id, sec.id); }
    }
  }
  const childrenOf = new Map();
  for (const t of byId.values()) {
    if (!t.parentId) continue;
    if (!childrenOf.has(t.parentId)) childrenOf.set(t.parentId, []);
    childrenOf.get(t.parentId).push(t.id);
  }
  return { byId, sectionOf, childrenOf };
}

/** Every ticket under `epicId` at any depth, in document order of discovery. */
function descendantIds(epicId, childrenOf) {
  const seen = new Set([epicId]);
  const out = [];
  const stack = [...(childrenOf.get(epicId) || [])].reverse();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...[...(childrenOf.get(id) || [])].reverse());
  }
  return out;
}

function readinessIn(ix, epic) {
  const { byId, sectionOf, childrenOf } = ix;
  const sectionId = sectionOf.get(epic.id) || null;
  const blockerOpen = id => byId.has(id) && !FINISHED.has(sectionOf.get(id));
  const openBlockers = t => (t.blockedBy || []).filter(blockerOpen);

  // Open non-epic tickets under the epic (sub-epics are containers; their tickets count).
  const open = descendantIds(epic.id, childrenOf)
    .map(id => byId.get(id))
    .filter(t => t.type !== 'epic' && !FINISHED.has(sectionOf.get(t.id)) && !t.checked);
  const openIds = new Set(open.map(t => t.id));

  // Open picks / co-tasks that another open child waits on gate the epic.
  const gatePicks = open.filter(t => isPickGate(t) && open.some(o => o.id !== t.id && (o.blockedBy || []).includes(t.id)));

  const children = open.map(t => {
    const sec = sectionOf.get(t.id);
    const blockedBy = openBlockers(t);
    const held = labelsOf(t).filter(l => HELD_LABELS.includes(l));
    let why = null;
    if (isPickGate(t)) why = isDesignPick(t) ? 'your pick' : 'your co-task';
    else if (!RUNNABLE_SECTIONS.has(sec)) why = `in ${sec}`;
    else if (t.blocked) why = 'marked blocked';
    else if (typeof t.waitingOn === 'string' && t.waitingOn.trim()) why = `waiting on ${t.waitingOn.trim()}`;
    else if (blockedBy.length) {
      const pick = blockedBy.find(b => openIds.has(b) && isPickGate(byId.get(b)));
      why = pick ? `waits on your ${isDesignPick(byId.get(pick)) ? 'pick' : 'co-task'} ${pick}` : `blocked by ${blockedBy.join(', ')}`;
    } else if (held.length) why = `held: ${held.join(', ')}`;
    const check = howToCheckText(t);
    return {
      id: t.id,
      title: t.title || '',
      section: sec,
      runnable: why === null,
      why,
      model: modelTier(t),
      needsComputerUse: labelsOf(t).includes('computer-use') || (check !== null && COMPUTER_USE_TEXT.test(check)),
      blockedBy,
    };
  });

  const runnable = children.filter(c => c.runnable);
  const reasons = [];
  if (!['todo', 'in-progress'].includes(sectionId)) reasons.push(`in ${sectionId === 'backlog' ? 'backlog' : sectionId}`);
  if (LATER_TITLE.test(String(epic.title || ''))) reasons.push('a later bucket');
  const epicBlockers = openBlockers(epic);
  if (epicBlockers.length) reasons.push(`waits on ${epicBlockers.join(', ')}`);
  if (epic.blocked) reasons.push('marked blocked');
  for (const p of gatePicks) reasons.push(`waits on your ${isDesignPick(p) ? 'pick' : 'co-task'} ${p.id}`);
  if (!runnable.length && !reasons.length) {
    const held = children.filter(c => /^held:/.test(c.why || ''));
    reasons.push(!children.length ? 'nothing open to run'
      : held.length === children.length ? 'every open ticket is held for your go-ahead'
        : 'no ticket is free to run');
  }
  for (const c of runnable) {
    if (howToCheckText(byId.get(c.id)) === null) reasons.push(`${c.id} has no How to check it`);
  }

  return {
    id: epic.id,
    title: epic.title || '',
    section: sectionId,
    lane: typeof epic.lane === 'string' && epic.lane.trim() ? epic.lane.trim() : null,
    ready: reasons.length === 0,
    reasons,
    auto: isAuto(epic),
    priority: autoPriorityOf(epic),
    autoRank: autoRankOf(epic),
    model: runnable.some(c => c.model === 'opus') ? 'opus' : 'sonnet',
    children,
  };
}

/** Readiness of one epic: { id, title, section, lane, ready, reasons, auto, priority, autoRank, model, children }. */
export function epicReadiness(doc, epic) {
  return readinessIn(indexDoc(doc), epic);
}

/** Readiness of every open epic (any section but done, review, archive), in document order. */
export function openEpicReadiness(doc) {
  const ix = indexDoc(doc);
  const out = [];
  for (const sec of doc?.sections || []) {
    if (FINISHED.has(sec.id)) continue;
    for (const t of sec.tasks || []) {
      if (t && t.type === 'epic' && ix.byId.get(t.id) === t) out.push(readinessIn(ix, t));
    }
  }
  return out;
}

/** One line for an epic: "Ready", "Ready · Auto" or "Not ready: reason; reason". */
export function readinessLabel(r) {
  if (r.ready) return r.auto ? 'Ready · Auto' : 'Ready';
  return `Not ready: ${r.reasons.join('; ')}${r.auto ? ' (Auto is on)' : ''}`;
}

/**
 * Epics that belong in the run-plan lanes besides the pinned ones: every open epic that is
 * in progress or Ready (pins mean "this week's focus", so lanes must not depend on them).
 */
export function epicIdsForLanes(readiness, doc) {
  const inProgress = new Set();
  for (const sec of doc?.sections || []) {
    if (sec.id === 'in-progress') for (const t of sec.tasks || []) if (t.type === 'epic') inProgress.add(t.id);
  }
  return readiness.filter(r => r.ready || inProgress.has(r.id)).map(r => r.id);
}

/**
 * The order Auto epics start in: priority (high, normal, low), then `autoRank` (lower first; epics
 * without one come after ranked ones), then the order given (plan order). Returns a new array.
 * @param {{priority?: string, autoRank?: number|null}[]} readiness  epicReadiness results, in plan order
 */
export function autoQueueOrder(readiness) {
  const prio = r => AUTO_PRIORITIES.indexOf(AUTO_PRIORITIES.includes(r?.priority) ? r.priority : 'normal');
  const rank = r => (typeof r?.autoRank === 'number' && Number.isFinite(r.autoRank) ? r.autoRank : Infinity);
  return (readiness || []).map((r, i) => ({ r, i }))
    .sort((a, b) => prio(a.r) - prio(b.r)
      || (rank(a.r) === rank(b.r) ? 0 : rank(a.r) < rank(b.r) ? -1 : 1)
      || a.i - b.i)
    .map(x => x.r);
}
