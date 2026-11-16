/**
 * shared/notes-prep.js — the mechanical parts of the daily review-notes run (PRO105), so the model
 * only does the judgement (rewording, merging, drawing picks).
 *
 *   prepNotes(doc)          before filing: every note's route plus flags a reader would otherwise find by
 *                           hand: no area, new epic, a spike / feature / over-full target epic, a design
 *                           note (files two tickets), and near-duplicates among open tickets and the other
 *                           notes of the round (word overlap, a hint, never a decision)
 *   roundReport(doc, since) after filing: one line per filed note (`handle -> id, model, epic`), the tickets
 *                           still carrying the raw note title (not yet rewritten), and per epic whether it is
 *                           ready and could take the `auto` label (applyAuto adds it)
 *
 * Pure (no fs, no DOM); the CLI (`ch tasks notes prep | report`) saves.
 */

import { planFiling, titleOf } from './review-filing.js';
import { freeNotes, freeHandle } from './review-notes.js';
import { openEpicReadiness, AUTO_LABEL, withAutoLabel } from './epic-ready.js';

const OPEN_SECTIONS = ['inbox', 'backlog', 'todo', 'in-progress', 'review'];
const EPIC_CAP = 8; // open tickets per epic that still fit one session (process-review-notes 5b)
const DUP_MIN = 0.5;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'when', 'from', 'into', 'are', 'not', 'its', 'but', 'you', 'your', 'should', 'would', 'could', 'have', 'has', 'was', 'were', 'will', 'can', 'there', 'than', 'then', 'they', 'them', 'does', 'doesn']);

/** Significant words of a text: lower case, 3+ letters or digits, no filler. */
export function words(text) {
  const out = new Set();
  for (const w of String(text ?? '').toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3 && !STOP.has(w)) out.add(w);
  return out;
}

/** Overlap of two word sets relative to the smaller one (0..1): a short note inside a long title still scores. */
export function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}

function rows(doc) {
  const out = [];
  for (const section of doc?.sections || []) for (const task of section.tasks || []) out.push({ task, section: section.id });
  return out;
}

const labelsOf = (t) => (Array.isArray(t?.labels) ? t.labels.map(l => String(l).toLowerCase()) : []);
const modelOf = (t) => (labelsOf(t).find(l => l.startsWith('model:')) || 'model:?').slice(6);

/** Flags for a target epic: spike, in an unusual state, already over the cap. */
function epicFlags(epic, all) {
  if (!epic || epic.isNew) return epic?.isNew ? ['new-epic'] : [];
  const flags = [];
  const row = all.find(r => r.task.id === epic.id);
  if (!row) return flags;
  if (/spike/i.test(row.task.title || '') || labelsOf(row.task).includes('spike')) flags.push('spike-epic');
  const open = all.filter(r => r.task.parentId === epic.id && r.task.type !== 'epic' && !['done', 'archive', 'review'].includes(r.section) && !r.task.checked).length;
  if (open >= EPIC_CAP) flags.push(`epic-has-${open}-open`);
  return flags;
}

/**
 * Before filing. Returns { items: [{ handle, kind, title, area, epic, flags, dupes }], unrouted, counts }.
 * `dupes`: [{ kind: 'ticket'|'note', id|handle, title, score }] best matches first, at most 3.
 */
export function prepNotes(doc, { ticket } = {}) {
  const plan = planFiling(doc, { ticket });
  const all = rows(doc);
  const open = all.filter(r => OPEN_SECTIONS.includes(r.section) && r.task.type !== 'epic');
  const items = [];
  for (const g of plan.groups) {
    for (const it of g.items) {
      const flags = [...epicFlags(g.epic, all)];
      if (it.noteKind === 'design') flags.push('design-two-tickets');
      items.push({
        handle: it.handle, kind: it.askN ? 'answer' : it.noteKind, title: it.title, sourceId: it.sourceId,
        area: g.area, epic: { id: g.epic.id, title: g.epic.title, section: g.epic.section, isNew: !!g.epic.isNew }, flags, dupes: [],
      });
    }
  }
  const sets = items.map(i => words(i.title));
  items.forEach((item, i) => {
    const hits = [];
    for (const r of open) {
      if (r.task.id === item.sourceId) continue; // the ticket the note was written on
      const score = overlap(sets[i], words(r.task.title));
      if (score >= DUP_MIN) hits.push({ kind: 'ticket', id: r.task.id, title: r.task.title, score });
    }
    items.forEach((other, j) => {
      if (j === i) return;
      const score = overlap(sets[i], sets[j]);
      if (score >= DUP_MIN) hits.push({ kind: 'note', handle: other.handle, title: other.title, score });
    });
    item.dupes = hits.sort((a, b) => b.score - a.score).slice(0, 3).map(h => ({ ...h, score: Math.round(h.score * 100) / 100 }));
  });
  for (const u of plan.unrouted) items.push({ handle: u.handle, kind: 'note', title: '', area: null, epic: null, flags: ['no-area'], dupes: [] });
  return {
    items,
    unrouted: plan.unrouted.map(u => u.handle),
    counts: { notes: items.length, flagged: items.filter(i => i.flags.length).length, withDupes: items.filter(i => i.dupes.length).length },
  };
}

/**
 * PRO110 (step 5d): checks an agent verified since `since` (`agentVerified.at`), and checks still skipped: unticked, not handed
 * off and not agent-verified, on tickets touched since (`updated` on or after the day). Same "unverified" test as `ch tasks checks`.
 */
export function checkStats(doc, since) {
  const day = String(since || '').slice(0, 10);
  let verified = 0;
  const skipped = [];
  for (const { task } of rows(doc)) {
    (task.checks || []).forEach((c, i) => {
      if (!c) return;
      if (c.agentVerified?.at && String(c.agentVerified.at) >= String(since || '')) verified++;
      else if (!c.checked && !c.handedTo && !c.agentVerified && String(task.updated || '') >= day) skipped.push(`${task.id}#${i + 1}`);
    });
  }
  return { verified, skipped: skipped.length, skippedChecks: skipped };
}

/**
 * After filing. `since` is the run start (ISO date or time): tickets created on or after its date count.
 * Returns { lines: [...], notInvestigated: [ids of raw tickets], checks: { verified, skipped, skippedChecks }, epics: [{ id, title, ready, auto, reasons, candidate, model, children }] }.
 * `raw`: the ticket still has File review's stub description (or the note's own words and no "In plain words"): not rewritten yet.
 * `candidate`: the epic is Ready, `auto` is off and it is not a later / backlog bucket: it may take the label.
 */
export function roundReport(doc, since) {
  const day = String(since || '').slice(0, 10);
  const all = rows(doc);
  const byId = new Map(all.map(r => [r.task.id, r.task]));
  const lines = [];
  const addLines = (handle, note) => {
    if (!note || note.state !== 'filed' || !note.filed) return;
    for (const id of [].concat(note.filed)) {
      const t = byId.get(String(id));
      if (!t || (day && String(t.created || '') < day)) continue;
      const epic = byId.get(t.parentId);
      lines.push({
        handle, id: t.id, model: modelOf(t), epic: epic?.id || null, epicTitle: epic?.title || '',
        raw: /Filed by File review from note/.test(t.description || '') || (t.title === titleOf(note.text) && !/## In plain words/.test(t.description || '')),
      });
    }
  };
  for (const { task } of all) {
    for (const note of task.reviewNotes || []) if (note) addLines(`${task.id}#${note.n}`, note);
  }
  for (const note of freeNotes(doc)) if (note) addLines(freeHandle(note), note); // PRO121

  const epicIds = [...new Set(lines.map(l => l.epic).filter(Boolean))];
  const ready = new Map(openEpicReadiness(doc).map(r => [r.id, r]));
  const epics = epicIds.map((id) => {
    const r = ready.get(id);
    const e = byId.get(id);
    return {
      id, title: e?.title || '', ready: !!r?.ready, auto: !!r?.auto, reasons: r?.reasons || [],
      candidate: !!r?.ready && !r?.auto, model: modelOf(e), children: lines.filter(l => l.epic === id).length,
    };
  });
  const notInvestigated = lines.filter(l => l.raw).map(l => l.id);
  return { lines, epics, checks: checkStats(doc, since), notInvestigated };
}

/** Add the `auto` label to every candidate epic in `report` (mutates `doc`); returns the ids changed. */
export function applyAuto(doc, report, { now = new Date().toISOString() } = {}) {
  const done = [];
  for (const e of report.epics) {
    if (!e.candidate) continue;
    const t = rows(doc).find(r => r.task.id === e.id)?.task;
    if (!t || labelsOf(t).includes(AUTO_LABEL)) continue;
    t.labels = withAutoLabel(t.labels, true);
    t.updated = now.slice(0, 10);
    done.push(e.id);
  }
  return done;
}
