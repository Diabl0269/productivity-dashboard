/**
 * cli/lib/ask-overlap.js — PRO90 for the CLI: "one judgement, one card".
 * Collects the unticked checks / open asks on a ticket and its epic, and builds the refusal text
 * `ch tasks ask` and `ch tasks review` die with when a question and a check repeat each other
 * (the matching rules live in shared/ask-check-overlap.js).
 */

import { epicOf } from '../../shared/review.js';
import { taskAsks } from '../../shared/asks.js';
import { overlapsForAsk, overlapsForCheck } from '../../shared/ask-check-overlap.js';

export const OVERLAP_HINT = 'One judgement shows once: pass --same-judgement to link them (the check hides while the question is open and ticks itself when answered), or --not-same "<why>" if they are different judgements.';

/** The ticket and its epic (when it has one). */
export function ticketAndEpic(doc, task) {
  const epic = epicOf(doc, task)?.task;
  return epic ? [task, epic] : [task];
}

/** Every check on the ticket and its epic as [{ id, check, n }] (n = its number in `ch tasks get`). */
export function checkEntries(doc, task) {
  return ticketAndEpic(doc, task).flatMap(t => (t.checks || []).map((check, i) => ({ id: t.id, check, n: i + 1 })));
}

/** Every open ask of the ticket and its epic as [{ id, ask }] (own asks only, not older Left lines). */
export function askEntries(doc, task) {
  return ticketAndEpic(doc, task).flatMap(t => taskAsks(t).filter(r => !r.legacy).map(ask => ({ id: t.id, ask })));
}

/** One line per overlapping check entry: "<ticket> check <n>: <text>" (a check not stored yet has no n). */
export function checkLines(entries) {
  return entries.map(e => (e.n ? `  ${e.id} check ${e.n}: ${e.check.text}` : `  ${e.id} new check: ${e.check.text}`));
}

/** Refusal for a question that repeats checks. */
export function askOverlapMessage(entries) {
  return `this question repeats a check:\n${checkLines(entries).join('\n')}\n${OVERLAP_HINT}`;
}

/** Refusal for a new check that repeats open questions. */
export function checkOverlapMessage(rows) {
  const lines = rows.map(r => `  ${r.id} question ${r.ask.key}: ${r.ask.text}   (for check: ${r.forCheck})`);
  return `a new check repeats an open question:\n${lines.join('\n')}\n${OVERLAP_HINT}`;
}

/**
 * PRO90 for `ch tasks review`: compare this call's new checks with the open asks on the ticket and
 * its epic, and the call's own `--ask` questions with the checks they would sit beside. Where a check
 * lands the epic's copy is "<child id>: <text>" (rollUpIntoEpic), so links use that text.
 * `askTexts` = the --ask questions; `sameJudgement` / `notSame` are the flags (notSame undefined when absent).
 * Mutates nothing: returns { error, links, askRefs } where `links` = [{ owner, key, ref }] to add to
 * existing asks (applyLinks) and `askRefs[i]` = the checkRefs for the i-th --ask.
 */
export function reviewOverlap(doc, task, checkItems, { askTexts = [], sameJudgement = false, notSame } = {}) {
  const epic = epicOf(doc, task)?.task;
  const landing = (text) => (epic ? { id: epic.id, text: `${task.id}: ${text}` } : { id: task.id, text });
  const flagged = sameJudgement || notSame !== undefined;
  const out = { error: null, links: [], askRefs: [] };

  const rows = [];
  for (const item of checkItems) {
    const land = landing(item.text);
    for (const hit of overlapsForCheck({ text: item.text, heldPr: item.heldPr }, askEntries(doc, task))) {
      if ((hit.ask.checkRefs || []).some(r => r.id === land.id && r.text === land.text)) continue; // already linked
      rows.push({ ...hit, forCheck: item.text, land });
    }
  }
  if (rows.length && !flagged) { out.error = checkOverlapMessage(rows); return out; }
  if (sameJudgement) for (const r of rows) out.links.push({ owner: ticketAndEpic(doc, task).find(t => t.id === r.id), key: r.ask.key, ref: r.land });

  const existing = checkEntries(doc, task);
  const fresh = checkItems.map(i => landing(i.text))
    .filter(l => !existing.some(e => e.id === l.id && e.check.text === l.text))
    .map(l => ({ id: l.id, n: 0, check: { text: l.text, heldPr: checkItems.find(i => landing(i.text).text === l.text)?.heldPr } }));
  for (const text of askTexts) {
    const hits = overlapsForAsk({ text }, [...existing, ...fresh]);
    if (hits.length && !flagged) { out.error = askOverlapMessage(hits); return out; }
    out.askRefs.push(sameJudgement && hits.length ? hits.map(h => ({ id: h.id, text: h.check.text })) : undefined);
  }
  return out;
}

/** Add the refs of `links` (from reviewOverlap) to the open asks they name. */
export function applyLinks(links) {
  for (const { owner, key, ref } of links) {
    const ask = (owner?.asks || []).find(a => String(a.n) === String(key));
    if (!ask) continue;
    if (!Array.isArray(ask.checkRefs)) ask.checkRefs = [];
    if (!ask.checkRefs.some(r => r.id === ref.id && r.text === ref.text)) ask.checkRefs.push({ id: ref.id, text: ref.text });
  }
}
