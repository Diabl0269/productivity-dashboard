/**
 * shared/check-entries.js: the one selection of "open checks" that `ch tasks checks`, `checks --lint` and
 * `checks --turnkey` walk: every unticked, not-handed-off check on an open epic (any open section) and on an
 * in-progress or Ready-for-review ticket. Pure (no fs, no DOM).
 */
import { epicOf } from './review.js';

/** @returns {{ task: object, epic: object|null, section: string, n: number, check: object }[]} n is 1-based. */
export function openCheckEntries(doc) {
  const out = [];
  for (const section of doc?.sections || []) {
    if (section.id === 'done' || section.id === 'archive') continue;
    for (const task of section.tasks || []) {
      if (task.type !== 'epic' && section.id !== 'in-progress' && section.id !== 'review') continue;
      const epic = task.type === 'epic' ? null : (epicOf(doc, task)?.task || null);
      (task.checks || []).forEach((check, i) => {
        if (check && !check.checked && !check.handedTo) out.push({ task, epic, section: section.id, n: i + 1, check });
      });
    }
  }
  return out;
}
