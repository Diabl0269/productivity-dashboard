/**
 * shared/interpretations.js — "Interpretation:" lines a run left for Tal (PRO96).
 *
 * When a run reads a vague ticket one way it writes a line `Interpretation: <the reading>` in the
 * ticket's description (`ch tasks interpret <id> "<reading>"` adds it) or in its result's `left` list.
 * The Plan page's "For you" list shows each open one as a card: OK, or "Not this" + a correction.
 *
 * An interpretation is never a gate: no ask, no waitingOn, no Co-task. The ticket stays runnable and
 * autorun builds it on the reading the run chose. "Not this" is stored as the NEWEST review note on the
 * ticket (so `ch tasks get` shows it and the newest note wins over the description); OK stores nothing
 * but the resolution. Either way the card is resolved in `resolvedAsks` as { kind: 'interpretation',
 * text: <reading>, state: 'done' (OK) | 'answered' (Not this), at }, so it does not come back.
 *
 * Pure (no fs, no DOM); used by the CLI and the dashboard.
 */

import { ASK_OPEN_SECTIONS } from './asks.js';
import { addReviewNote } from './review-notes.js';

const LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?interpretation(?:\*\*)?\s*:\s*(?:\*\*)?\s*(\S.*?)\s*$/i;

/** The reading on one line (`Interpretation: ...`), or '' when it is not such a line. */
export function parseInterpretationLine(line) {
  const m = LINE_RE.exec(String(line ?? ''));
  return m ? m[1].replace(/\*\*$/, '').trim() : '';
}

/** Every reading in a block of text, in order, without repeats. */
export function interpretationsIn(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const r = parseInterpretationLine(line);
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

/** Readings on a ticket: its description, then its result's left lines. */
export function taskInterpretations(task) {
  const out = interpretationsIn(task?.description);
  for (const line of task?.result?.left || []) {
    const r = parseInterpretationLine(line);
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

function resolvedReadings(task) {
  return new Set((task?.resolvedAsks || []).filter(x => x && x.kind === 'interpretation').map(x => x.text));
}

/**
 * Open interpretation cards: [{ id, title, section, key, text, at }] on open tickets (inbox, todo,
 * in-progress, review), oldest first. Key is `I<n>` (n = position among the ticket's readings).
 */
export function openInterpretations(doc) {
  const out = [];
  for (const section of doc?.sections || []) {
    if (!ASK_OPEN_SECTIONS.includes(section.id)) continue;
    for (const task of section.tasks || []) {
      if (!task?.id) continue;
      const done = resolvedReadings(task);
      taskInterpretations(task).forEach((text, i) => {
        if (done.has(text)) return;
        out.push({ id: task.id, title: task.title || '', section: section.id, key: `I${i + 1}`, text, at: task.updated || task.created || '' });
      });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Resolve the reading `text` on `task`. action 'ok' resolves silently; 'not-this' needs `reply` and adds
 * it as a review note (the newest note) before resolving. Mutates `task`; never touches waitingOn or asks.
 * @returns {{ state, note }}
 */
export function resolveInterpretation(task, text, { action, reply = '', now = new Date().toISOString() } = {}) {
  if (action !== 'ok' && action !== 'not-this') throw new Error(`unknown action "${action}" (ok or not-this)`);
  if (!taskInterpretations(task).includes(text)) throw new Error(`${task?.id || 'ticket'} has no interpretation "${text}"`);
  let note = null;
  if (action === 'not-this') {
    const fix = String(reply ?? '').trim();
    if (!fix) throw new Error('"Not this" needs the correction');
    note = addReviewNote(task, { text: `Interpretation correction: "${text}" is wrong. ${fix}`, kind: 'fix', now });
  }
  if (!Array.isArray(task.resolvedAsks)) task.resolvedAsks = [];
  const state = action === 'ok' ? 'done' : 'answered';
  task.resolvedAsks.push({ kind: 'interpretation', text, state, at: now });
  return { state, note };
}

/** Add `Interpretation: <reading>` to the ticket's description (once). Returns true when added. */
export function addInterpretation(task, reading) {
  const text = String(reading ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('the reading is empty');
  if (taskInterpretations(task).includes(text)) return false;
  const base = String(task.description ?? '').replace(/\s+$/, '');
  task.description = `${base}${base ? '\n' : ''}Interpretation: ${text}`;
  return true;
}
