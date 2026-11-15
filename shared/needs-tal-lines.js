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

const MEDIA_RE = /\b(project|video|audio|image)\s*=\s*(\S+)/gi;

/** `FRO1: needs-tal: hardware: x | video=a.mp4` -> { text: 'hardware: x', media: { video: 'a.mp4' } } (media only when present). */
export function parseNeedsTalLine(raw) {
  let body = String(raw).replace(ID_PREFIX, '').replace(BODY, '');
  const media = {};
  const bar = body.lastIndexOf('|');
  if (bar >= 0) {
    const found = [...body.slice(bar + 1).matchAll(MEDIA_RE)];
    if (found.length) {
      for (const m of found) media[m[1].toLowerCase()] = m[2];
      body = body.slice(0, bar);
    }
  }
  return { text: body.trim(), media };
}

/** PRO112: the line text the Plan page shows and matches on when a tick resolves the line. */
export const needsTalText = (raw) => parseNeedsTalLine(raw).text;

/**
 * @returns {Map<string, Array<{ from: string, text: string, media?: object }>>} epic id -> lines (`from` = the child's id)
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
      const { text, media } = parseNeedsTalLine(raw);
      if (!text || lines.some(l => normalizeJudgement(l.text) === normalizeJudgement(text))) return;
      if (asks.some(a => family.has(a.id) && sameJudgement(a.text, text))) return;
      lines.push(Object.keys(media).length ? { from, text, media } : { from, text });
    };
    for (const line of epic.result?.unverified || []) add(ID_PREFIX.exec(String(line))?.[1] || epic.id, line);
    for (const kid of doneKids) for (const line of kid.result?.unverified || []) add(kid.id, line);
    if (lines.length) out.set(epic.id, lines);
  }
  return out;
}

/**
 * PRO112: Tal ticks a needs-tal line. Drop every needs-tal Unverified entry with this text from each
 * of `tickets` (the source child and the epic's rolled-up copy), like `--resolve-unverified`.
 * Returns how many entries were removed.
 */
export function resolveNeedsTalLine(tickets, text) {
  const want = normalizeJudgement(text);
  let removed = 0;
  for (const t of tickets || []) {
    const list = t?.result?.unverified;
    if (!Array.isArray(list)) continue;
    const keep = list.filter(l => !(isNeedsTalLine(l) && normalizeJudgement(needsTalText(l)) === want));
    removed += list.length - keep.length;
    if (keep.length === list.length) continue;
    if (keep.length) t.result.unverified = keep; else delete t.result.unverified;
  }
  return removed;
}
