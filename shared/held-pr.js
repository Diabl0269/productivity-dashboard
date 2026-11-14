/**
 * shared/held-pr.js — PRO92: a check on an unmerged PR says so.
 *
 * `ch tasks review --held-pr "<why>"` leaves the ticket's PR open on purpose, so every check of
 * that review is about a build of the PR's branch, not main. Each such check carries
 *   heldPr: { pr: <GitHub PR URL>, branch: <branch name, may be empty> }
 * and the Plan page shows "on branch X (PR #n), not merged" beside it until the PR merges.
 * `clearMergedHeldPrs` drops the label once the PR is MERGED (`ch tasks asks --refresh`, and the
 * Plan page when its PR lookup says so).
 *
 * Pure (no fs, no DOM); used by the CLI, the schema and the dashboard.
 */

import { mergePrError } from './asks.js';

/** Schema error for one check's `heldPr` (prefix `r` names it), or ''. */
export function heldPrError(v, r) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `${r} must be an object { pr, branch }`;
  if (typeof v.pr !== 'string' || mergePrError(v.pr)) return `${r}.pr must be a GitHub pull request URL`;
  if (typeof v.branch !== 'string') return `${r}.branch must be a string (may be empty)`;
  return '';
}

/** A well-formed `{ pr, branch }` copy of a stored heldPr, or null (the dashboard loader). */
export function cleanHeldPr(v) {
  return heldPrError(v, 'heldPr') ? null : { pr: v.pr, branch: v.branch };
}

/** "#12" for a pull request URL, or ''. */
export function prNumber(url) {
  const m = /\/pull\/(\d+)/.exec(String(url ?? ''));
  return m ? `#${m[1]}` : '';
}

/**
 * Drop `heldPr` from the checks of `task` (and `task.heldPr`) whose PR has merged.
 * `prState(url)` returns { state } (e.g. 'MERGED') or { error }; errors leave the label.
 * Mutates `task`; returns [{ pr, branch }], one per distinct PR cleared.
 */
export function clearMergedHeldPrs(task, prState) {
  const cleared = new Map();
  const merged = new Map(); // url -> boolean, one lookup per PR
  const isMerged = (url) => {
    if (!merged.has(url)) merged.set(url, String((prState(url) || {}).state || '').toUpperCase() === 'MERGED');
    return merged.get(url);
  };
  for (const c of task?.checks || []) {
    if (!c?.heldPr?.pr || !isMerged(c.heldPr.pr)) continue;
    if (!cleared.has(c.heldPr.pr)) cleared.set(c.heldPr.pr, { pr: c.heldPr.pr, branch: c.heldPr.branch || '' });
    delete c.heldPr;
  }
  if (task?.heldPr?.pr && isMerged(task.heldPr.pr)) {
    if (!cleared.has(task.heldPr.pr)) cleared.set(task.heldPr.pr, { pr: task.heldPr.pr, branch: task.heldPr.branch || '' });
    delete task.heldPr;
  }
  return [...cleared.values()];
}
