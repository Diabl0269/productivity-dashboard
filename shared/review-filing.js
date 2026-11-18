/**
 * shared/review-filing.js — "File review": turn unsent review notes into tickets, each under
 * the next epic of the note's AREA (a lane slug).
 *
 * planFiling(doc) is pure and says where every unsent note would go; applyFiling(doc, plan)
 * mutates the doc (creates epics and tickets, marks notes filed, hands checks over, moves a
 * finished review to done). Pinning and unpinning are left to the caller (see `pin`/`unpin`
 * in the result) so this module stays free of plan/meta helpers.
 *
 * PRO104: an answered ask on a done / review / archive ticket that nothing picked up yet is planned and
 * filed like a note on that ticket (one ticket per answer; the ask is marked `filedAs: <new id>`).
 *
 * PRO121: a free note (`doc.meta.freeNotes`, handle `free#n`) routes by its own `area` only (none:
 * unrouted, "needs an area"); its ticket has no `reviewOf` and the meta note is marked filed.
 *
 * Pure (no fs, no DOM); used by the CLI and the dashboard.
 */

import { epicOf, allChecksTicked, REVIEW_SECTION } from './review.js';
import { unsentNotes, hasUnsentNotes, freeNotes, freeSource, freeHandle, isFreeSource, FREE_ID } from './review-notes.js';
import { laneDisplayName } from './run-plan.js';

/** Sections whose epics still take new work. */
export const OPEN_SECTIONS = ['inbox', 'backlog', 'todo', 'in-progress'];
const NEXT_SECTIONS = ['todo']; // an in-progress epic has a session running: don't grow it under its feet
const TITLE_MAX = 120;
const IMAGE_ONLY_TEXT = 'see the attached screenshot';

const isLater = (epic) => /\(later\)\s*$/i.test(epic.title || '');
const sameProject = (a, b) => (a || null) === (b || null);
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Sections whose answered asks the notes run picks up (the work is closed: nobody will read the answer). */
const ANSWER_SECTIONS = ['done', REVIEW_SECTION, 'archive'];

/** Handle of an answered ask: `T1#ask2` (a note's is `T1#2`). */
const askHandle = (task, ask) => `${task.id}#ask${ask.n}`;

/** True when a review note already carries this ask's answer (the PRO102 / older done-ticket path). */
function answerHasNote(task, ask) {
  const head = `answered "${ask.text}"`;
  return (task.reviewNotes || []).some(n => n && typeof n.text === 'string' && n.text.includes(head));
}

/**
 * Answered asks on closed tickets that no ticket has picked up: state 'answered', ticket in done / review /
 * archive, no `filedAs`, no review note already holding the answer. Document order.
 * @returns {{ task, section, ask, handle }[]}
 */
export function pendingAnswers(doc, { ticket } = {}) {
  const out = [];
  for (const { task, section } of rows(doc)) {
    if (!ANSWER_SECTIONS.includes(section) || (ticket && task.id !== ticket)) continue;
    for (const ask of task.asks || []) {
      if (!ask || ask.state !== 'answered' || !ask.answer || ask.filedAs || answerHasNote(task, ask)) continue;
      out.push({ task, section, ask, handle: askHandle(task, ask) });
    }
  }
  return out;
}

function rows(doc) {
  const out = [];
  for (const section of doc?.sections || []) {
    for (const task of section.tasks || []) out.push({ task, section: section.id });
  }
  return out;
}

/** Ticket title from a note: trimmed, first letter capitalised, at most 120 chars. */
export function titleOf(text) {
  const t = capFirst(String(text).trim() || IMAGE_ONLY_TEXT);
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t;
}

/** The area (lane slug) a note files into, or null: its own `area`, else the lane of the ticket / its epic (a free note: its own only). */
export function noteArea(doc, ticket, note) {
  if (note.area) return note.area;
  if (isFreeSource(ticket)) return null;
  if (ticket.type === 'epic') return ticket.lane || null;
  return epicOf(doc, ticket)?.task.lane || null;
}

/** Lane slugs offered for a note's area: lanes of open epics, plus `current`. Sorted. */
export function areaOptions(doc, current) {
  const set = new Set();
  for (const { task, section } of rows(doc)) {
    if (task.type === 'epic' && task.lane && OPEN_SECTIONS.includes(section)) set.add(task.lane);
  }
  if (current) set.add(current);
  return [...set].sort();
}

/** First open epic in `lane`/`project` matching `pick`, ordered by `order` sections then document order. */
function findEpic(all, lane, project, sections, extra) {
  const epics = all.filter(({ task, section }) => task.type === 'epic' && task.lane === lane
    && sameProject(task.project, project) && sections.includes(section) && extra(task, section));
  for (const s of sections) {
    const hit = epics.find(e => e.section === s);
    if (hit) return hit;
  }
  return null;
}

/** The epic of a still-open (todo / in-progress) source ticket when that epic is open and no "later" bucket; else null. */
function ownEpicWhileOpen(all, doc, task) {
  if (isFreeSource(task) || task.type === 'epic') return null;
  const row = all.find(r => r.task === task);
  if (!row || !['todo', 'in-progress'].includes(row.section)) return null;
  const own = epicOf(doc, task);
  return own && OPEN_SECTIONS.includes(own.section) && !isLater(own.task) ? own : null;
}

/**
 * Where every unsent note would go. `ticket` limits it to one noted ticket.
 * Returns { groups: [{ area, epic: { id|null, title, section, isNew, project }, items:
 * [{ handle, noteKind, title, sourceId }] }], unrouted: [{ handle, reason }] }.
 */
export function planFiling(doc, { ticket } = {}) {
  const all = rows(doc);
  const groups = [];
  const unrouted = [];
  const entries = [];
  for (const { task } of all) {
    if (ticket && task.id !== ticket) continue;
    for (const note of unsentNotes(task)) {
      entries.push({ task, note, handle: `${task.id}#${note.n}`, item: { noteKind: note.kind, title: titleOf(note.text), sourceId: task.id } });
    }
    for (const a of pendingAnswers(doc, { ticket: task.id })) {
      entries.push({
        task, note: { kind: 'fix' }, handle: a.handle,
        item: { noteKind: 'fix', title: titleOf(`Answer on ${task.id}: ${a.ask.answer}`), sourceId: task.id, askN: a.ask.n },
      });
    }
  }
  // PRO121: free notes (no ticket) after the ticket notes; `--ticket free` limits the plan to them.
  if (!ticket || ticket === FREE_ID) {
    for (const note of freeNotes(doc)) {
      if (!note || note.state !== 'new') continue;
      entries.push({ task: freeSource(note), note, handle: freeHandle(note), item: { noteKind: note.kind, title: titleOf(note.text), sourceId: FREE_ID } });
    }
  }
  for (const { task, note, handle, item: base } of entries) {
    const item = { handle, ...base };
    const area = noteArea(doc, task, note);
    const project = task.project || null;
    let epic = null;
    let key;
    if (!area) {
      const own = isFreeSource(task) ? null : task.type === 'epic' ? all.find(r => r.task === task) : epicOf(doc, task);
      if (own && OPEN_SECTIONS.includes(own.section)) {
        epic = { id: own.task.id, title: own.task.title, section: own.section, isNew: false, project: own.task.project || null };
        key = `own|${own.task.id}`;
      } else {
        unrouted.push({ handle, reason: 'needs an area' });
        continue;
      }
    } else if (note.kind !== 'idea' && ownEpicWhileOpen(all, doc, task)) {
      // PRO133: the note's ticket is still open (todo / in-progress), so a follow-up its own build may wait on must sit
      // under the ticket's own epic: "the next epic of the area" can wait on this epic and could never run.
      const own = ownEpicWhileOpen(all, doc, task);
      epic = { id: own.task.id, title: own.task.title, section: own.section, isNew: false, project: own.task.project || null };
      key = `own|${own.task.id}`;
    } else if (note.kind === 'idea') {
      const hit = findEpic(all, area, project, OPEN_SECTIONS, t => isLater(t) || t.title === `${laneDisplayName(area)}: later`);
      epic = hit
        ? { id: hit.task.id, title: hit.task.title, section: hit.section, isNew: false, project }
        : { id: null, title: `${laneDisplayName(area)}: later`, section: 'backlog', isNew: true, project };
      key = `later|${area}|${project}`;
    } else {
      const hit = findEpic(all, area, project, NEXT_SECTIONS, t => !isLater(t));
      epic = hit
        ? { id: hit.task.id, title: hit.task.title, section: hit.section, isNew: false, project }
        : { id: null, title: `${laneDisplayName(area)} follow-ups`, section: 'todo', isNew: true, project };
      key = `next|${area}|${project}`;
    }
    let group = groups.find(g => g.key === key);
    if (!group) { group = { key, area: area || null, epic, items: [] }; groups.push(group); }
    group.items.push(item);
  }
  return { groups: groups.map(({ key, ...g }) => g), unrouted };
}

function makeTask(id, title, { section, parentId, project, labels, description, blockedBy, reviewOf, type, lane, now }) {
  const task = {
    id, title, checked: false, priority: 'medium', type: type || 'task',
    created: now.slice(0, 10), updated: null, subtasks: [], checks: [], links: [],
  };
  if (description) task.description = description;
  if (parentId) task.parentId = parentId;
  if (reviewOf) task.reviewOf = reviewOf;
  if (project) task.project = project;
  if (lane) task.lane = lane;
  if (labels?.length) task.labels = labels;
  if (blockedBy?.length) task.blockedBy = blockedBy;
  task.history = [{ at: now, event: 'created', to: section }];
  return task;
}

function describe(src, note, text) {
  if (isFreeSource(src)) {
    const place = note.where ? ` Place: ${note.where}.` : '';
    return `## In plain words\n**What you'll notice:** ${text}\n**Why it matters:** from a free note (${String(note.at || '').slice(0, 10)}).${place}\n**How to check it:** the note's point is fixed.\n\n## Technical detail (for Claude)\nFiled by File review from note ${freeHandle(note)}.`;
  }
  const on = note.check ? ` on the check "${note.check}"` : '';
  return `## In plain words\n**What you'll notice:** ${text}\n**Why it matters:** noted while reviewing ${src.id}${on}.\n**How to check it:** see ${src.id}'s review card.\n\n## Technical detail (for Claude)\nFiled by File review from note ${src.id}#${note.n}.`;
}

/** The description of the ticket filed from an answered ask: the question, its options and the answer. */
function describeAnswer(src, ask) {
  const opts = (ask.options || []).map(o => `${o.key}: ${o.text}`).join('; ');
  return `## In plain words\n**What you'll notice:** Tal answered "${ask.text}" with "${ask.answer}".\n**Why it matters:** the answer came after ${src.id} closed, so nobody has acted on it yet.\n**How to check it:** the work the answer asks for is done.\n\n## Technical detail (for Claude)\nFiled from the answered ask ${src.id}#ask${ask.n}.\nQuestion: ${ask.text}\n${opts ? `Options: ${opts}\n` : ''}Answer: ${ask.answer}${ask.details ? `\nDetails: ${ask.details}` : ''}`;
}

/** File one answered ask as a ticket under `epicId` and mark the ask `filedAs`. */
function fileAnswer(item, { byId, add, epicId, now, out }) {
  const src = byId(item.sourceId);
  const ask = (src?.asks || []).find(a => a && a.n === item.askN);
  if (!src || !ask || ask.state !== 'answered' || ask.filedAs) return;
  const ui = (src.labels || []).includes('ui') ? ['ui'] : [];
  const id = out.newId(src.project || null);
  add('todo', makeTask(id, item.title, {
    parentId: epicId, project: src.project || null, reviewOf: src.id, now, section: 'todo', labels: ['model:sonnet', ...ui], description: describeAnswer(src, ask),
  }));
  ask.filedAs = id;
  src.updated = now.slice(0, 10);
  out.filed.push({ handle: item.handle, id });
}

/**
 * Apply `plan` to `doc`. `newId(projectId)` allocates ids (called after each ticket is added to
 * the doc). Returns { created: [ids], filed: [{ handle, id }], movedToDone: [ids],
 * pin: [new epic ids the caller should pin] }. Callers also run their own auto-unpin for
 * each id in `movedToDone`.
 */
export function applyFiling(doc, plan, { newId, now = new Date().toISOString() } = {}) {
  const sec = (id) => {
    const s = (doc.sections || []).find(x => x.id === id);
    if (!s) throw new Error(`section "${id}" not found`);
    if (!Array.isArray(s.tasks)) s.tasks = [];
    return s;
  };
  const out = { created: [], filed: [], movedToDone: [], pin: [], newId };
  const touched = new Set();

  const add = (section, task) => { sec(section).tasks.push(task); out.created.push(task.id); };
  const byId = (id) => rows(doc).find(r => r.task.id === id)?.task;

  for (const group of plan.groups) {
    const e = group.epic;
    let epicId = e.id;
    if (e.isNew) {
      const blocker = e.section === 'todo'
        ? rows(doc).find(r => r.section === 'in-progress' && r.task.type === 'epic' && r.task.lane === group.area && sameProject(r.task.project, e.project))
        : null;
      epicId = newId(e.project);
      // The epic's label names its orchestrator (AGE34): opus only when a design pick gates its
      // builds; a bucket of independent fixes or ideas runs on sonnet. /process-review-notes
      // re-judges it once it knows which tickets share files.
      const designGated = group.items.some(item => {
        if (item.sourceId === FREE_ID) return freeNotes(doc).some(x => x && freeHandle(x) === item.handle && x.kind === 'design');
        const src = byId(item.sourceId);
        return (src?.reviewNotes || []).some(x => `${src.id}#${x.n}` === item.handle && x.kind === 'design');
      });
      const epic = makeTask(epicId, e.title, {
        section: e.section, project: e.project, type: 'epic', lane: group.area, labels: [designGated ? 'model:opus' : 'model:sonnet'], now,
        blockedBy: blocker ? [blocker.task.id] : [],
        description: `## In plain words\n**What you'll notice:** ${e.section === 'backlog' ? 'ideas noted during reviews wait here' : 'fixes and design picks noted during reviews land here'}.\n**Why it matters:** keeps review notes with the rest of the ${laneDisplayName(group.area)} work.\n**How to check it:** open the tickets under it.\n\n## Technical detail (for Claude)\nCreated by File review.`,
      });
      add(e.section, epic);
      if (e.section !== 'backlog') out.pin.push(epicId);
    }
    for (const item of group.items) {
      if (item.askN) { fileAnswer(item, { byId, add, epicId, now, out }); continue; }
      // PRO121: a free note has no ticket: no reviewOf, no labels or checks to read; the note itself is marked filed.
      const free = item.sourceId === FREE_ID;
      const freeNote = free ? freeNotes(doc).find(x => x && freeHandle(x) === item.handle) : null;
      const src = free ? (freeNote ? freeSource(freeNote) : null) : byId(item.sourceId);
      const note = free ? freeNote : (src?.reviewNotes || []).find(x => `${src.id}#${x.n}` === item.handle);
      if (!src || !note || note.state !== 'new') continue;
      const ui = (src.labels || []).includes('ui') ? ['ui'] : [];
      const base = { parentId: epicId, project: src.project || null, reviewOf: free ? undefined : src.id, now };
      const text = note.text.trim() || IMAGE_ONLY_TEXT;
      const created = [];
      let filedId;
      if (note.kind === 'idea') {
        filedId = newId(src.project || null);
        created.push(filedId);
        // PRO108: the ticket's section follows its epic. Under a todo / in-progress epic an idea is
        // runnable work (a backlog child there is skipped by auto-run); only a backlog epic keeps it in backlog.
        const ideaSection = e.section === 'todo' || e.section === 'in-progress' ? 'todo' : 'backlog';
        add(ideaSection, makeTask(filedId, item.title, { ...base, section: ideaSection, labels: ['model:sonnet', ...ui], description: describe(src, note, text) }));
      } else if (note.kind === 'design') {
        const pickId = newId(src.project || null);
        created.push(pickId);
        add('todo', makeTask(pickId, `Co-task: pick ${lowerFirst(text)}`.slice(0, TITLE_MAX), {
          ...base, section: 'todo', labels: ['design', 'model:opus', ...ui], description: describe(src, note, text),
        }));
        filedId = newId(src.project || null);
        created.push(filedId);
        add('todo', makeTask(filedId, titleOf(`${text}, per the pick`), {
          ...base, section: 'todo', labels: ['model:sonnet', ...ui], blockedBy: [pickId], description: describe(src, note, text),
        }));
      } else {
        filedId = newId(src.project || null);
        created.push(filedId);
        add('todo', makeTask(filedId, item.title, { ...base, section: 'todo', labels: ['model:sonnet', ...ui], description: describe(src, note, text) }));
      }
      // The reviewer's screenshots travel with the ticket as a note, so whoever fixes it sees them.
      if (note.images?.length) {
        for (const id of created) {
          byId(id).notes = [{ at: now, text: free ? `Screenshot from ${freeHandle(note)}` : `Screenshot from the review of ${src.id}`, images: [...note.images] }];
        }
      }
      note.state = 'filed';
      note.filed = filedId;
      if (free) { out.filed.push({ handle: item.handle, id: filedId }); continue; }
      if (note.check) {
        const check = (src.checks || []).find(c => c.text === note.check);
        if (check) { check.checked = true; check.handedTo = filedId; }
      }
      src.updated = now.slice(0, 10);
      touched.add(src.id);
      out.filed.push({ handle: item.handle, id: filedId });
    }
  }

  for (const id of touched) {
    const row = rows(doc).find(r => r.task.id === id);
    if (!row || row.section !== REVIEW_SECTION || hasUnsentNotes(row.task) || !allChecksTicked(row.task)) continue;
    const from = sec(REVIEW_SECTION);
    from.tasks = from.tasks.filter(t => t !== row.task);
    row.task.checked = true;
    if (!Array.isArray(row.task.history)) row.task.history = [];
    row.task.history.push({ at: now, event: 'moved', from: REVIEW_SECTION, to: 'done' });
    sec('done').tasks.push(row.task);
    out.movedToDone.push(id);
  }
  delete out.newId;
  return out;
}
