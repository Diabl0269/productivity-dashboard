// shared/plan-filter.js — which rows the Overview "Today plan" block shows.
// Pure functions (no DOM), used by dashboard/js/overview.js and unit-tested.

export const PLAN_FILTER_MODES = ['both', 'pinned', 'epics'];
export const DEFAULT_PLAN_FILTER = 'both';

/** Unknown or missing values fall back to the default ('both'). */
export function normalizePlanFilter(mode) {
  return PLAN_FILTER_MODES.includes(mode) ? mode : DEFAULT_PLAN_FILTER;
}

function isDone(t) {
  return !!t.checked || t.section === 'done' || t.section === 'archive';
}

/** { done, total } over the direct children of an epic. */
export function epicProgress(epicId, tasks) {
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (t.parentId !== epicId) continue;
    total += 1;
    if (isDone(t)) done += 1;
  }
  return { done, total };
}

/**
 * @param {Object<string, Array>} tasksBySection  dashboard shape (section id -> tasks with taskId, type, parentId)
 * @param {{taskIds?: string[]}} plan             meta.dailyPlan
 * @param {string} mode                           'pinned' | 'epics' | 'both'
 * @returns {Array<{id: string, kind: 'epic'|'pinned', pinned: boolean, progress: {done:number,total:number}|null}>}
 *   Epics in progress come first, then pinned tickets; an epic that is both appears once.
 */
export function selectPlanRows(tasksBySection, plan, mode) {
  const m = normalizePlanFilter(mode);
  const all = Object.values(tasksBySection || {}).flatMap(list => list || []);
  const byId = new Map(all.filter(t => t.taskId).map(t => [t.taskId, t]));
  const pinnedIds = Array.isArray(plan?.taskIds) ? plan.taskIds : [];
  const pinnedSet = new Set(pinnedIds);
  const rows = [];
  const seen = new Set();
  const progressFor = id => {
    const t = byId.get(id);
    return t && t.type === 'epic' ? epicProgress(id, all) : null;
  };

  if (m !== 'pinned') {
    for (const t of tasksBySection?.['in-progress'] || []) {
      if (t.type !== 'epic' || !t.taskId || t.checked || seen.has(t.taskId)) continue;
      seen.add(t.taskId);
      rows.push({ id: t.taskId, kind: 'epic', pinned: pinnedSet.has(t.taskId), progress: progressFor(t.taskId) });
    }
  }
  if (m !== 'epics') {
    for (const id of pinnedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, kind: 'pinned', pinned: true, progress: progressFor(id) });
    }
  }
  return rows;
}
