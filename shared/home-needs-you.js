/**
 * shared/home-needs-you.js (PRO130): the one rule for "Needs you" on the Home page. Pure: no fs, no DOM.
 *
 *   needsYou(doc, keep, { plan? }) -> { ids: Set<ticketId>, checkRows, count, decisions, reviews, parts }
 *
 * The unit is the ticket (unique ids), the union of:
 *   review   the review queue (computeRunPlan(doc).review)
 *   asks     every id of each grouped open ask card (groupAsks(openAsks(doc)))
 *   interps  open interpretations to confirm
 *   picks    design picks at the "pick" stage (computeRunPlan(doc).picks)
 *   checks   tickets with checks to tick on open work (checksOnOpenWork, the Plan page's list)
 * `keep(id)` narrows by scope (the place, else the project); default: keep everything.
 * `count` = ids.size. `decisions` = unique ids from asks, interps and picks; `reviews` = the other ids (review,
 * checks), so decisions + reviews === count. `parts` holds each source's unique id count. `plan` may be passed
 * when the caller already computed computeRunPlan(doc).
 */

import { computeRunPlan } from './run-plan.js';
import { groupAsks, openAsks } from './asks.js';
import { openInterpretations } from './interpretations.js';
import { checksOnOpenWork } from './review.js';
import { needsTalLinesByEpic } from './needs-tal-lines.js';

export function needsYou(doc, keep = () => true, { plan = null } = {}) {
  const p = plan || computeRunPlan(doc);
  const ok = id => !!id && keep(id);
  const review = new Set((p.review || []).map(r => r.id).filter(ok));
  const asks = new Set();
  for (const c of groupAsks(openAsks(doc))) for (const id of (c.ids || [c.id])) if (ok(id)) asks.add(id);
  const interps = new Set(openInterpretations(doc).map(i => i.id).filter(ok));
  const picks = new Set((p.picks || []).filter(x => x.stage === 'pick').map(x => x.id).filter(ok));
  const checkRows = checksOnOpenWork(doc, { lines: needsTalLinesByEpic(doc) }).filter(c => ok(c.id));
  const checks = new Set(checkRows.map(c => c.id));
  const decided = new Set([...asks, ...interps, ...picks]);
  const ids = new Set([...decided, ...review, ...checks]);
  return {
    ids,
    checkRows, // the checks-to-tick rows (id, title, checks, enteredAt), for a card list that must show every counted ticket
    count: ids.size,
    decisions: decided.size,
    reviews: ids.size - decided.size,
    parts: { review: review.size, asks: asks.size, interps: interps.size, picks: picks.size, checks: checks.size },
  };
}
