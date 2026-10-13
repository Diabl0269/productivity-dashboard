/**
 * shared/review-filing.js — "File review": turn unsent review notes into tickets, each under
 * the next epic of the note's AREA (a lane slug).
 *
 * planFiling(doc) is pure and says where every unsent note would go; applyFiling(doc, plan)
 * mutates the doc (creates epics and tickets, marks notes filed, hands checks over, moves a
 * finished review to done). Pinning and unpinning are left to the caller (see `pin`/`unpin`
 * in the result) so this module stays free of plan/meta helpers.
 *
 * Pure (no fs, no DOM); used by the CLI and the dashboard.
 */

import { epicOf, allChecksTicked, REVIEW_SECTION } from './review.js';
import { unsentNotes, hasUnsentNotes } from './review-notes.js';
import { laneDisplayName } from './run-plan.js';

/** Sections whose epics still take new work. */
export const OPEN_SECTIONS = ['inbox', 'backlog', 'todo', 'in-progress'];
const NEXT_SECTIONS = ['todo']; // an in-progress epic has a session running: don't grow it under its feet
const TITLE_MAX = 120;

const isLater = (epic) => /\(later\)\s*$/i.test(epic.title || '');
const sameProject = (a, b) => (a || null) === (b || null);
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function rows(doc) {
  const out = [];
  for (const section of doc?.sections || []) {
    for (const task of section.tasks || []) out.push({ task, section: section.id });
  }
  return out;
}

/** Ticket title from a note: trimmed, first letter capitalised, at most 120 chars. */
function titleOf(text) {
  const t = capFirst(String(text).trim());
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t;
}

/** The area (lane slug) a note files into, or null: its own `area`, else the lane of the ticket / its epic. */
export function noteArea(doc, ticket, note) {
  if (note.area) return note.area;
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

/**
 * Where every unsent note would go. `ticket` limits it to one noted ticket.
 * Returns { groups: [{ area, epic: { id|null, title, section, isNew, project }, items:
 * [{ handle, noteKind, title, sourceId }] }], unrouted: [{ handle, reason }] }.
 */
export function planFiling(doc, { ticket } = {}) {
  const all = rows(doc);
  const groups = [];
  const unrouted = [];
  for (const { task } of all) {
    if (ticket && task.id !== ticket) continue;
    for (const note of unsentNotes(task)) {
      const handle = `${task.id}#${note.n}`;
      const item = { handle, noteKind: note.kind, title: titleOf(note.text), sourceId: task.id };
      const area = noteArea(doc, task, note);
      const project = task.project || null;
      let epic = null;
      let key;
      if (!area) {
        const own = task.type === 'epic' ? all.find(r => r.task === task) : epicOf(doc, task);
        if (own && OPEN_SECTIONS.includes(own.section)) {
          epic = { id: own.task.id, title: own.task.title, section: own.section, isNew: false, project: own.task.project || null };
          key = `own|${own.task.id}`;
        } else {
          unrouted.push({ handle, reason: 'needs an area' });
          continue;
        }
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
  const on = note.check ? ` on the check "${note.check}"` : '';
  return `## In plain words\n**What you'll notice:** ${text}\n**Why it matters:** noted while reviewing ${src.id}${on}.\n**How to check it:** see ${src.id}'s review card.\n\n## Technical detail (for Claude)\nFiled by File review from note ${src.id}#${note.n}.`;
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
  const out = { created: [], filed: [], movedToDone: [], pin: [] };
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
      const epic = makeTask(epicId, e.title, {
        section: e.section, project: e.project, type: 'epic', lane: group.area, now,
        blockedBy: blocker ? [blocker.task.id] : [],
        description: `## In plain words\n**What you'll notice:** ${e.section === 'backlog' ? 'ideas noted during reviews wait here' : 'fixes and design picks noted during reviews land here'}.\n**Why it matters:** keeps review notes with the rest of the ${laneDisplayName(group.area)} work.\n**How to check it:** open the tickets under it.\n\n## Technical detail (for Claude)\nCreated by File review.`,
      });
      add(e.section, epic);
      if (e.section !== 'backlog') out.pin.push(epicId);
    }
    for (const item of group.items) {
      const src = byId(item.sourceId);
      const note = (src?.reviewNotes || []).find(x => `${src.id}#${x.n}` === item.handle);
      if (!src || !note || note.state !== 'new') continue;
      const ui = (src.labels || []).includes('ui') ? ['ui'] : [];
      const base = { parentId: epicId, project: src.project || null, reviewOf: src.id, now };
      let filedId;
      if (note.kind === 'idea') {
        filedId = newId(src.project || null);
        add('backlog', makeTask(filedId, item.title, { ...base, section: 'backlog', labels: ['model:sonnet', ...ui], description: describe(src, note, note.text.trim()) }));
      } else if (note.kind === 'design') {
        const pickId = newId(src.project || null);
        add('todo', makeTask(pickId, `Co-task: pick ${lowerFirst(note.text.trim())}`.slice(0, TITLE_MAX), {
          ...base, section: 'todo', labels: ['design', 'model:opus', ...ui], description: describe(src, note, note.text.trim()),
        }));
        filedId = newId(src.project || null);
        add('todo', makeTask(filedId, titleOf(`${note.text.trim()}, per the pick`), {
          ...base, section: 'todo', labels: ['model:sonnet', ...ui], blockedBy: [pickId], description: describe(src, note, note.text.trim()),
        }));
      } else {
        filedId = newId(src.project || null);
        add('todo', makeTask(filedId, item.title, { ...base, section: 'todo', labels: ['model:sonnet', ...ui], description: describe(src, note, note.text.trim()) }));
      }
      note.state = 'filed';
      note.filed = filedId;
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
  return out;
}
