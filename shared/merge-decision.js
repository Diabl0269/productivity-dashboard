/**
 * shared/merge-decision.js (AGE219): a held PR whose try steps say there is nothing to see or hear has only a
 * merge decision: it files no "Try on branch" check (the merge ask carries it), and a check that looks like
 * one gets no Open project button. Pure (no fs, no DOM); used by the CLI gate and the dashboard.
 */
import { NOTHING_TO_SEE_RE } from './turnkey-check.js';

const NOTHING_TO_TRY_RE = /\bnot needed beyond the merge decision\b|\bnothing to hear(?: or see)?\b|\bnothing to (?:see or hear|hear or see)\b/i;

/** Do these try steps (or check text) say there is nothing to see or hear? */
export function saysNothingToTry(text) {
  const t = String(text ?? '');
  return NOTHING_TO_SEE_RE.test(t) || NOTHING_TO_TRY_RE.test(t);
}

/** Is this check a merge decision: "Try on branch ..." text that itself says there is nothing to see or hear? */
export function isMergeDecisionCheck(text) {
  const t = String(text ?? '');
  return /(?:^|:\s)\s*Try on branch\b/i.test(t) && saysNothingToTry(t);
}
