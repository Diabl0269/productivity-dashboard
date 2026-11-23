/**
 * shared/open-checks.js — PRO143: the Checks tab. Every ticket that still has a check (or a needs-tal
 * line) for Tal, with the same row shape as the Plan page's review queue. Pure (no fs, no DOM).
 */

import { flat, checkProgress, followUpsOf } from './review.js';
import { unsentNotes } from './review-notes.js';
import { needsTalLinesByEpic } from './needs-tal-lines.js';

const CLOSED = new Set(['done', 'archive']);
const DAY_MS = 24 * 60 * 60 * 1000;

const isTicked = c => !!c && (!!c.checked || !!c.handedTo);

/** ISO time of the newest history move into done, or ''. */
function doneAt(task) {
  const history = Array.isArray(task?.history) ? task.history : [];
  for (let i = history.length - 1; i >= 0; i--) if (history[i]?.to === 'done') return String(history[i].at || '');
  return '';
}

const earliest = list => list.map(c => c.addedAt || '').filter(Boolean).sort()[0];

/**
 * Tickets with an open check, oldest first. `finished: true` rows (every check ticked, no needs-tal
 * line) are dropped while `hideAllTicked`; with it off they show, plus tickets done within `finishedDays`.
 */
export function openCheckTickets(doc, { hideAllTicked = true, now = new Date().toISOString(), finishedDays = 7 } = {}) {
  const lines = needsTalLinesByEpic(doc);
  const nowMs = Date.parse(now);
  const rows = [];
  for (const { task, section } of flat(doc)) {
    const checks = (task.checks || []).filter(Boolean);
    const taskLines = lines.get(task.id) || [];
    if (!checks.length && !taskLines.length) continue;
    if (CLOSED.has(section)) {
      if (hideAllTicked || section !== 'done' || !checks.length) continue;
      const at = Date.parse(doneAt(task));
      if (!Number.isFinite(at) || !Number.isFinite(nowMs) || nowMs - at > finishedDays * DAY_MS) continue;
    }
    const unticked = checks.filter(c => !isTicked(c));
    const finished = unticked.length === 0 && taskLines.length === 0;
    if (finished && hideAllTicked) continue;
    const progress = checkProgress(task);
    const handed = checks.filter(c => !c.checked && c.handedTo).length;
    rows.push({
      id: task.id,
      title: task.title,
      project: task.project || null,
      parentId: task.parentId || null,
      reviewOf: task.reviewOf || null,
      enteredAt: earliest(unticked) || earliest(checks) || task.result?.at || '',
      checks: { done: progress.done + handed, total: progress.total + taskLines.length },
      lines: taskLines,
      notes: unsentNotes(task).length,
      result: task.result || null,
      followUps: followUpsOf(doc, task.id),
      finished,
    });
  }
  return rows.sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** { tickets, open } for the page heading: ticket count and checks still to tick. */
export function checksPageCounts(rows) {
  return { tickets: rows.length, open: rows.reduce((n, r) => n + Math.max(0, r.checks.total - r.checks.done), 0) };
}
