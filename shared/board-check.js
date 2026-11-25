/**
 * shared/board-check.js (AGE214): a check that sends Tal "to the board" must link the board, and a board that
 * already has an answer never becomes a check. Pure (no fs, no DOM).
 *   - boardCheckProblem: refuses a check mentioning "the board" when neither the ticket nor its epic (nor the
 *     call's own links) holds a board link (url has claude.ai/artifact, or label starts "Design canvas").
 *   - boardAnsweredProblem: heuristic: a ticket note or decision saying commented / answered / picked, written
 *     after the board link was added (any, when the link has no date), means the answer exists: decision, not check.
 *   - boardSweepProblems: the same link rule over every open check (`ch tasks checks --lint`).
 */
import { openCheckEntries } from './check-entries.js';

export const ON_BOARD_RE = /\bthe board\b/i;
const ANSWERED_RE = /\b(?:commented|answered|picked)\b/i;

/** Is this link a design board? */
export function isBoardLink(l) {
  return !!l && (/claude\.ai\/artifact/i.test(l.url || '') || /^\s*design canvas/i.test(l.label || ''));
}

/** Does the check text send Tal to a board? */
export function mentionsBoard(text) {
  return ON_BOARD_RE.test(String(text ?? ''));
}

/** `tasks`: the ticket and its epic; `extraLinks`: links the call adds ({url,label}[] or url strings). */
export function hasBoardLink(tasks, extraLinks = []) {
  const extra = (extraLinks || []).map(l => (typeof l === 'string' ? { url: l } : l));
  return [...(tasks || []).flatMap(t => t?.links || []), ...extra].some(isBoardLink);
}

const LINK_FIX = 'add the board with --design-link <artifact url> (review) or ch tasks update <id> --add-link <artifact url> --link-label "Design canvas"';

/** Refusal text, or null. `texts`: check texts (strings). */
export function boardCheckProblem(texts, { tasks = [], extraLinks = [] } = {}) {
  const bad = (texts || []).filter(mentionsBoard);
  if (!bad.length || hasBoardLink(tasks, extraLinks)) return null;
  return `a check mentions the board but the ticket (or its epic) has no board link, so Tal cannot open it: ${LINK_FIX}.\n`
    + bad.map(t => `  - "${String(t).slice(0, 80)}"`).join('\n');
}

/** Refusal text, or null: the board already has an answer, so put it in --decision and drop the check. */
export function boardAnsweredProblem(texts, task) {
  if (!(texts || []).some(mentionsBoard)) return null;
  const link = (task?.links || []).find(isBoardLink);
  const since = link?.addedAt || link?.at || null;
  const entries = [...(task?.notes || []), ...(task?.decisions || [])];
  const hit = entries.find(e => ANSWERED_RE.test(String(e?.text || '')) && (!since || !e.at || String(e.at) >= String(since)));
  if (!hit) return null;
  return `the board already has an answer ("${String(hit.text).slice(0, 80)}"): put it in --decision and drop this check`;
}

/** One line per unticked check on an open ticket/epic that mentions the board with no board link on it or its epic. */
export function boardSweepProblems(doc) {
  return openCheckEntries(doc)
    .filter(e => mentionsBoard(e.check.text) && !isBoardLink(e.check.link) && !hasBoardLink([e.task, e.epic]))
    .map(e => `${e.task.id}#${e.n} mentions the board but ${e.task.id}${e.epic ? ` and ${e.epic.id}` : ''} has no board link: "${String(e.check.text).slice(0, 80)}"`);
}
