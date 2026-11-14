/**
 * shared/ask-check-overlap.js — PRO90: one judgement, one card.
 *
 * A question (ask) and a check can put the same judgement to Tal twice ("Reverb Mix at 30% sounds
 * right?" as a decision and "taste: Reverb Mix 30%" as a check). `ch tasks ask` and `ch tasks review`
 * refuse the second one unless the caller links them (`--same-judgement`: the ask stores
 * `checkRefs`, the check hides while the ask is open and ticks itself when it is answered) or says
 * they differ (`--not-same "<why>"`).
 *
 * Pure (no fs, no DOM); used by the CLI and the dashboard.
 */

// "FRO12: " at the start of a check an epic rolled up from its child.
const ROLLED_PREFIX = /^[A-Za-z]{1,8}\d+:\s*/;
// Words that carry no judgement of their own ("sounds right", "does the ... feel").
const STOP = new Set([
  'the', 'and', 'for', 'does', 'did', 'was', 'are', 'with', 'that', 'this', 'than', 'from', 'into', 'its',
  'right', 'good', 'ok', 'okay', 'fine', 'nice', 'sound', 'sounds', 'feel', 'feels', 'look', 'looks', 'still', 'too', 'also', 'judge',
]);

/** Lower case, no rolled-up id prefix, no leading "taste:", no punctuation, single spaces. */
export function normalizeJudgement(text) {
  return String(text ?? '')
    .replace(ROLLED_PREFIX, '')
    .replace(/^\s*taste\s*:\s*/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const wordSet = (norm) => new Set(norm.split(' ').filter(w => w.length >= 3 && !STOP.has(w)));

/**
 * Do two texts put the same judgement to Tal? True when the normalized texts are equal, one contains
 * the other (the shorter has at least 3 words), or their word sets (words of 3+ letters, minus filler)
 * overlap by 0.6 or more (Jaccard; each set needs 2 words).
 */
export function sameJudgement(a, b) {
  const x = normalizeJudgement(a);
  const y = normalizeJudgement(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.split(' ').length >= 3 && long.includes(short)) return true;
  const sx = wordSet(x);
  const sy = wordSet(y);
  if (sx.size < 2 || sy.size < 2) return false;
  let shared = 0;
  for (const w of sx) if (sy.has(w)) shared++;
  return shared / (sx.size + sy.size - shared) >= 0.6;
}

const prKey = (url) => String(url ?? '').trim().replace(/\/+$/, '').toLowerCase();
const unticked = (check) => !!check && !check.checked && !check.handedTo;

/**
 * The unticked checks `ask` repeats. `ask` = { text, details?, mergePr? }; `checks` = [{ id, check, ... }]
 * (id = the ticket holding the check). A merge ask repeats the check of its own held PR.
 * @returns {Array} the matching entries of `checks`
 */
export function overlapsForAsk(ask, checks) {
  return (checks || []).filter(({ check }) => unticked(check)
    && (sameJudgement(ask?.text, check.text)
      || (!!ask?.mergePr && !!check.heldPr?.pr && prKey(check.heldPr.pr) === prKey(ask.mergePr))));
}

/**
 * The open asks `check` repeats (the inverse of overlapsForAsk). `asks` = [{ id, ask: { text, mergePr?, ... } }].
 * @returns {Array} the matching entries of `asks`
 */
export function overlapsForCheck(check, asks) {
  if (!unticked(check)) return [];
  return (asks || []).filter(({ ask }) => sameJudgement(ask?.text, check.text)
    || (!!ask?.mergePr && !!check.heldPr?.pr && prKey(check.heldPr.pr) === prKey(ask.mergePr)));
}

/** The keys "<ticket id>\0<check text>" of every check an OPEN ask links (rows of taskAsks / openAsks with checkRefs). */
export function linkedCheckKeys(rows) {
  const keys = new Set();
  for (const r of rows || []) for (const ref of r.checkRefs || []) keys.add(`${ref.id}\0${ref.text}`);
  return keys;
}
