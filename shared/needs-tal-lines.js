/**
 * shared/needs-tal-lines.js — PRO97: Unverified lines only Tal can judge (`needs-tal: hardware: ...`,
 * taste lines that were never turned into checks) show on the Plan page as soon as their ticket is
 * done, even while the epic is still in progress. Before, they showed only on the epic's review card.
 *
 * Sources, per epic still open that has at least one done child: the epic's own rolled-up Unverified
 * lines (`FRO1: needs-tal: ...`) and each done child's own result. A line that says the same judgement
 * as an open ask on the epic or one of its tickets stays hidden (PRO90): the ask card carries it.
 * Pure (no fs, no DOM).
 */

import { isNeedsTalLine } from './proof-gate.js';
import { openAsks } from './asks.js';
import { normalizeJudgement, sameJudgement } from './ask-check-overlap.js';

// The dashboard moves old done tickets to archive; their unresolved lines still count while the epic is open.
const DONE_SECTIONS = new Set(['done', 'archive']);
const OPEN_EPIC_SECTIONS = new Set(['inbox', 'todo', 'in-progress']);
const ID_PREFIX = /^\s*([A-Za-z]{1,8}\d+):\s*/;
const BODY = /^\s*(?:[A-Za-z]{1,8}\d+:\s*)?needs-tal\s*:\s*/i;

/**
 * @returns {Map<string, Array<{ from: string, text: string }>>} epic id -> lines (`from` = the child's id)
 */
export function needsTalLinesByEpic(doc) {
  const rows = [];
  for (const section of doc?.sections || []) for (const task of section.tasks || []) rows.push({ task, section: section.id });
  const byId = new Map(rows.map(r => [r.task.id, r]));
  const asks = openAsks(doc);
  const out = new Map();
  for (const { task: epic, section } of rows) {
    if (epic.type !== 'epic' || !OPEN_EPIC_SECTIONS.has(section)) continue;
    const family = new Set([epic.id]);
    const doneKids = [];
    for (const r of rows) {
      let p = r.task.parentId;
      const seen = new Set();
      while (p && !seen.has(p)) {
        seen.add(p);
        if (p === epic.id) { family.add(r.task.id); if (DONE_SECTIONS.has(r.section) && r.task.type !== 'epic') doneKids.push(r.task); break; }
        p = byId.get(p)?.task.parentId;
      }
    }
    if (!doneKids.length) continue;
    const lines = [];
    const add = (from, raw) => {
      if (!isNeedsTalLine(raw)) return;
      const text = String(raw).replace(ID_PREFIX, '').replace(BODY, '').trim();
      if (!text || lines.some(l => normalizeJudgement(l.text) === normalizeJudgement(text))) return;
      if (asks.some(a => family.has(a.id) && sameJudgement(a.text, text))) return;
      lines.push({ from, text });
    };
    for (const line of epic.result?.unverified || []) add(ID_PREFIX.exec(String(line))?.[1] || epic.id, line);
    for (const kid of doneKids) for (const line of kid.result?.unverified || []) add(kid.id, line);
    if (lines.length) out.set(epic.id, lines);
  }
  return out;
}
