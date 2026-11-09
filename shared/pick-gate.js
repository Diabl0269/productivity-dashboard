/**
 * Pick gates: tickets a human must act on (a Co-task or a design pick) before dependants can run.
 * Pure; shared by shared/run-plan.js and shared/epic-ready.js.
 */

/**
 * A co-task that needs a design board: a "design" label, "pick" in its title, or a design canvas
 * link already on it. Other co-tasks
 * (submit a form, check something in the app) are plain to-dos for Tal and get no canvas.
 */
export function isDesignPick(task) {
  if ((task?.labels || []).some(l => /^design$/i.test(String(l).trim()))) return true;
  if (Array.isArray(task?.links) && task.links.some(l => l && /design canvas/i.test(l.label || ''))) return true;
  return /\bpick\b/i.test(String(task?.title || ''));
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
