// run-plan-notes-bar.js — the bar above the review cards: how many review notes wait, the "Show notes"
// list, the File review preview (where each note goes) and Hand to Claude. Takes the page's ctx
// (run-plan-page.js); filingOpen / notesListOpen live on ctx.ui, so each page keeps its own.

import { laneDisplayName } from '../../shared/run-plan.js';
import { claudeCodeSessionUrl } from '../../shared/claude-deeplink.js';
import { epicsToUnpin } from '../../shared/review.js';
import { unsentNotes, countUnsentNotes, pendingReviewNotes, freeHolder } from '../../shared/review-notes.js';
import { planFiling, applyFiling, areaOptions } from '../../shared/review-filing.js';
import { nextTaskId } from '../../shared/task-ids.js';
import { idButton } from './ticket-id-button.js';
import { commitReviewChange } from './task-detail.js';
import { reviewNoteRow } from './review-notes-ui.js';
import { moveTask } from './tasks-board.js';
import { loadTasksJson } from './tasks-json.js';
import { todayStr } from './tasks-parser.js';
import { stateToDoc as toDoc } from './epic-ready-ui.js';
import { el, plainTitle } from './run-plan-util.js';

const HAND_TO_CLAUDE = 'File my review notes: run ch tasks notes route, adjust areas or merge near-duplicates if needed (ch tasks notes add --area / dismiss), then ch tasks notes send. Reply with the new ids only.';

/** Tickets File review would create from `plan` (a design pick files two; new epics are extra). */
function ticketCount(plan) {
  return plan.groups.reduce((n, g) => n + g.items.reduce((m, it) => m + (it.noteKind === 'design' ? 2 : 1), 0), 0);
}

/** Open a new Claude session that files the notes through the CLI. */
function handToClaude(ctx) {
  const url = claudeCodeSessionUrl(HAND_TO_CLAUDE, window.dashboardConfig?.claudeSessionFolder);
  if (!url) return;
  window.location.assign(url);
  ctx.toast('Opening Claude to file your review notes');
}

/** Lane <select> that sets the area of an unrouted note. */
function unroutedRow(ctx, handle) {
  const [id, n] = handle.split('#');
  const task = id === 'free' ? freeHolder(toDoc(ctx.getState())) : ctx.findTicket(id);
  const note = (task?.reviewNotes || []).find(x => String(x.n) === n);
  const row = el('li', 'rp-file-item');
  if (!note) return row;
  row.appendChild(el('span', `td-note-kind kind-${note.kind}`, note.kind[0].toUpperCase() + note.kind.slice(1)));
  row.appendChild(el('span', 'rp-file-text', `${note.text} (from ${id})`));
  const sel = el('select', 'rn-area-select');
  sel.setAttribute('aria-label', `Area for the note from ${id}`);
  const none = el('option', null, 'Pick an area');
  none.value = '';
  sel.appendChild(none);
  for (const slug of areaOptions(ctx.doc, null)) {
    const opt = el('option', null, laneDisplayName(slug));
    opt.value = slug;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    note.area = sel.value;
    commitReviewChange(task);
  });
  row.appendChild(sel);
  return row;
}

/** Inline preview of where every unsent note would go, with Apply and Cancel. */
function renderFilePreview(ctx) {
  const plan = planFiling(ctx.doc);
  const panel = el('div', 'rp-file-preview');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'File review preview');
  for (const g of plan.groups) {
    const block = el('div', 'rp-file-group');
    const where = g.epic.isNew ? `new epic "${g.epic.title}"` : `${g.epic.id} ${g.epic.title}`;
    block.appendChild(el('div', 'rp-file-head', `${g.area ? laneDisplayName(g.area) : 'Own epic'} → ${where}`));
    const list = el('ul', 'rp-file-list');
    g.items.forEach(it => list.appendChild(el('li', 'rp-file-item', `[${it.noteKind}] ${it.title} (from ${it.sourceId})`)));
    block.appendChild(list);
    panel.appendChild(block);
  }
  if (plan.unrouted.length) {
    const block = el('div', 'rp-file-group');
    block.appendChild(el('div', 'rp-file-head', 'Needs an area'));
    const list = el('ul', 'rp-file-list');
    plan.unrouted.forEach(u => list.appendChild(unroutedRow(ctx, u.handle)));
    block.appendChild(list);
    panel.appendChild(block);
  }
  const actions = el('div', 'rp-actions');
  const count = ticketCount(plan);
  const apply = el('button', 'rp-btn rp-btn-primary', `File ${count} ticket${count === 1 ? '' : 's'}`);
  apply.type = 'button';
  apply.disabled = count === 0;
  apply.addEventListener('click', () => fileReview(ctx, plan));
  const cancel = el('button', 'rp-btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { ctx.ui.filingOpen = false; ctx.redraw(); });
  actions.appendChild(apply);
  actions.appendChild(cancel);
  panel.appendChild(actions);
  return panel;
}

/** Id helper for applyFiling: next free id in `doc`, which already holds the tickets added so far. */
function idAllocator(doc, state) {
  return (projectId) => {
    const flat = doc.sections.flatMap(s => s.tasks.map(t => ({ id: t.id })));
    return nextTaskId(flat, projectId || null, state.meta?.projects || []);
  };
}

/**
 * Apply `plan` to a doc built from dashboard state (applyFiling mutates it), then copy the
 * result back: new tickets are parsed with loadTasksJson (the dashboard's own loader) and
 * appended to their sections; notes and checks were edited in place (the doc shares those
 * arrays with the state's tickets); finished reviews go through moveTask; new epics are
 * pinned in meta.dailyPlan (what `ch tasks plan --pin` writes) and closed ones unpinned.
 */
export function fileReview(ctx, plan) {
  const state = ctx.getState();
  const doc = toDoc(state);
  const out = applyFiling(doc, plan, { newId: idAllocator(doc, state) });
  const newEpics = plan.groups.filter(g => g.epic.isNew).length;

  const bySection = new Map();
  for (const id of out.created) {
    const sec = doc.sections.find(s => s.tasks.some(t => t.id === id));
    const task = sec.tasks.find(t => t.id === id);
    if (!bySection.has(sec.id)) bySection.set(sec.id, []);
    bySection.get(sec.id).push(task);
  }
  for (const [secId, list] of bySection) {
    const parsed = loadTasksJson(JSON.stringify({ sections: [{ id: secId, tasks: list }] }));
    if (!state.tasks[secId]) state.tasks[secId] = [];
    state.tasks[secId].push(...parsed.tasks[secId]);
  }

  const touched = new Set(out.filed.map(f => f.handle.split('#')[0]));
  const today = todayStr();
  touched.forEach(id => { const t = ctx.findTicket(id); if (t) t.updated = today; });

  const unpin = new Set();
  for (const id of out.movedToDone) {
    const docTask = doc.sections.flatMap(s => s.tasks).find(t => t.id === id);
    if (docTask) epicsToUnpin(doc, docTask).forEach(x => unpin.add(x));
    const task = ctx.findTicket(id);
    if (task) moveTask(task.id, 'done', -1, { skipRender: true });
  }
  if (!state.meta.dailyPlan) state.meta.dailyPlan = { date: null, taskIds: [], carriedIds: [] };
  const daily = state.meta.dailyPlan;
  for (const id of out.pin) {
    if (!(daily.taskIds || (daily.taskIds = [])).includes(id)) daily.taskIds.push(id);
    if (!daily.date) daily.date = today;
  }
  if (unpin.size) {
    daily.taskIds = (daily.taskIds || []).filter(id => !unpin.has(id));
    daily.carriedIds = (daily.carriedIds || []).filter(id => !unpin.has(id));
  }

  ctx.ui.filingOpen = false;
  commitReviewChange(null);
  const created = out.created.length - newEpics;
  const areas = new Set(plan.groups.map(g => g.area || g.epic.id)).size;
  ctx.toast(`Filed ${created} ticket${created === 1 ? '' : 's'} into ${areas} area${areas === 1 ? '' : 's'}`);
}

/** PRO86: an answer on a done ticket became a review note: file it as a follow-up now (File review's path). */
export function fileNotesOf(ctx, id) {
  const plan = planFiling(toDoc(ctx.getState()), { ticket: id });
  if (plan.groups.length) fileReview(ctx, plan);
  else ctx.toast(`${id}: the answer is a review note that needs an area before it can be filed (Notes above)`);
}

/** Every unsent note, grouped by ticket, with the ticket it came from. Works when the cards are collapsed. */
function renderNotesList(ctx) {
  const panel = el('div', 'rp-file-preview rp-notes-list');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Open review notes');
  for (const entry of pendingReviewNotes(ctx.doc)) {
    // PRO121: a free note has no ticket; its rows edit meta.freeNotes through the same holder shape.
    const task = entry.type === 'free' ? freeHolder(toDoc(ctx.getState())) : ctx.findTicket(entry.id);
    if (!task) continue;
    if (entry.type === 'free') {
      const block = el('div', 'rp-file-group');
      block.appendChild(el('div', 'rp-file-head', `Free note${entry.lane ? ` (${laneDisplayName(entry.lane)})` : ' (no area yet)'}`));
      for (const note of entry.notes) block.appendChild(reviewNoteRow(task, note, { onChange: commitReviewChange }));
      panel.appendChild(block);
      continue;
    }
    const block = el('div', 'rp-file-group');
    const head = el('div', 'rp-file-head');
    head.appendChild(idButton(entry.id));
    head.appendChild(document.createTextNode(` ${plainTitle(entry.title)}`));
    block.appendChild(head);
    for (const note of unsentNotes(task)) {
      const row = reviewNoteRow(task, note, { onChange: commitReviewChange });
      if (note.check) row.title = `On check: ${note.check}`;
      block.appendChild(row);
    }
    panel.appendChild(block);
  }
  return panel;
}

/** Bar above the review cards: how many notes wait, File review and Hand to Claude. */
export function renderFileBar(ctx) {
  const ui = ctx.ui;
  const notes = countUnsentNotes(ctx.doc);
  if (!notes) { ui.filingOpen = false; ui.notesListOpen = false; return null; }
  const pending = pendingReviewNotes(ctx.doc);
  const cards = pending.filter(e => e.type !== 'free').length;
  const free = pending.length - cards; // PRO121: free notes have no ticket
  const wrap = el('div', 'rp-file');
  const bar = el('div', 'rp-file-bar');
  const where = [cards ? `on ${cards} ticket${cards === 1 ? '' : 's'}` : '', free ? `${free} free` : ''].filter(Boolean).join(', ');
  const count = cards ? `${notes} note${notes === 1 ? '' : 's'} ${where}` : `${free} free note${free === 1 ? '' : 's'}`;
  bar.appendChild(el('span', 'rp-file-count', count));
  const file = el('button', 'rp-btn rp-btn-primary', 'File review');
  file.type = 'button';
  file.setAttribute('aria-expanded', ui.filingOpen ? 'true' : 'false');
  file.addEventListener('click', () => { ui.filingOpen = !ui.filingOpen; ctx.redraw(); });
  const list = el('button', 'rp-btn', ui.notesListOpen ? 'Hide notes' : 'Show notes');
  list.type = 'button';
  list.title = 'List every open review note, whichever card it is on';
  list.setAttribute('aria-expanded', ui.notesListOpen ? 'true' : 'false');
  list.addEventListener('click', () => { ui.notesListOpen = !ui.notesListOpen; ctx.redraw(); });
  const hand = el('button', 'rp-btn', 'Hand to Claude');
  hand.type = 'button';
  hand.title = 'Open Claude to file the notes with the CLI';
  hand.addEventListener('click', () => handToClaude(ctx));
  bar.appendChild(list);
  bar.appendChild(file);
  bar.appendChild(hand);
  wrap.appendChild(bar);
  if (ui.notesListOpen) wrap.appendChild(renderNotesList(ctx));
  if (ui.filingOpen) wrap.appendChild(renderFilePreview(ctx));
  return wrap;
}
