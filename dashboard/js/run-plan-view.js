// run-plan-view.js — "Plan" tab: review, Auto queue, Ready state, then in-progress, Ready and pinned epics as lanes (rows); see shared/run-plan.js

import { computeRunPlan, threadLink, laneDisplayName, totalsLine } from '../../shared/run-plan.js';
import { claudeCodeSessionUrl } from '../../shared/claude-deeplink.js';
import { epicsToUnpin, groupChecksByProject } from '../../shared/review.js';
import { buildFreshnessNote } from './build-freshness-note.js';
import { projectGroupHeader, playVideoButton, audioPlayer } from './check-evidence.js';
import { unsentNotes, countUnsentNotes, pendingReviewNotes } from '../../shared/review-notes.js';
import { planFiling, applyFiling, noteArea, areaOptions } from '../../shared/review-filing.js';
import { nextTaskId } from '../../shared/task-ids.js';
import { withAutoLabel } from '../../shared/epic-ready.js';
import { fillEpicEstimates } from './ticket-cost-ui.js';
import { openTaskDetail, toggleReviewCheck, commitReviewChange } from './task-detail.js';
import { reviewNoteRow, reviewNoteAddRow } from './review-notes-ui.js';
import { moveTask } from './tasks-board.js';
import { loadTasksJson } from './tasks-json.js';
import { todayStr } from './tasks-parser.js';
import { stateToDoc as toDoc, renderReadyState, buildAutoToggle } from './epic-ready-ui.js';
import { renderAutoQueue } from './auto-queue-ui.js';
import { renderLaterFold } from './run-plan-later.js';
import { renderReasonBlock } from './run-plan-reasons.js';
import { renderNextStartLine } from './next-start-line.js';
import { asksFromState, renderAskCard, checkMergedPrs, updateAsksBadge, setAskFiler } from './asks-strip.js';
import { markChanged } from './tasks-io.js';
import { showStatus } from './state.js';

let getState = null;
let toastTimer = null;

export function setRunPlanStateGetter(fn) { getState = fn; }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const STATE_LABEL = { backlog: 'In backlog', ready: 'Ready now', partial: 'Partly ready', later: 'Later', notready: 'Not ready', pick: 'Your pick' };

/** Open a ticket's detail in place (no navigation); toasts if the ticket is gone. */
function openTicket(id) {
  const state = getState?.();
  for (const list of Object.values(state?.tasks || {})) {
    const task = (list || []).find(t => t.taskId === id);
    if (task) { openTaskDetail(task); return; }
  }
  showToast(`Ticket ${id} not found`);
}

/** A ticket id as a button that opens the ticket. */
function idButton(id, className = 'rp-id rp-link') {
  const btn = el('button', className, id);
  btn.type = 'button';
  btn.title = `Open ${id}`;
  btn.setAttribute('aria-label', `Open ticket ${id}`);
  btn.dataset.ticket = id;
  btn.addEventListener('click', () => openTicket(id));
  return btn;
}

/** The ticket (dashboard shape) with this id, or null. */
function findTicket(id) {
  for (const list of Object.values(getState?.()?.tasks || {})) {
    const task = (list || []).find(t => t.taskId === id);
    if (task) return task;
  }
  return null;
}

/** Section name a ticket sits in, or ''. */
function sectionNameOf(id) {
  const state = getState?.();
  for (const [secId, list] of Object.entries(state?.tasks || {})) {
    if ((list || []).some(t => t.taskId === id)) return (state.sections || []).find(s => s.id === secId)?.title || secId;
  }
  return '';
}

/** "Co-task: pick the layout" -> "Pick the layout". */
function plainTitle(title) {
  const t = String(title || '').replace(/^\s*co-task\s*:\s*/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** First "What you'll notice" sentence of a ticket's description, else its first line. */
function noticeLine(task) {
  const text = String(task?.description || '');
  const m = /What you'll notice:\*{0,2}\s*([^\n]+)/i.exec(text);
  const line = m ? m[1] : text.split('\n').find(l => l.trim() && !l.startsWith('#')) || '';
  const clean = line.replace(/\*\*/g, '').trim();
  return truncate(clean.charAt(0).toUpperCase() + clean.slice(1), 170);
}

/** "From review of <id>" note, or null when the ticket has none. */
/** "Open thread" link to the Claude thread working on a ticket, or null when none is linked. */
function threadAnchor(task) {
  const link = threadLink(task);
  if (!link) return null;
  const a = el('a', 'rp-canvas-link rp-thread-link', 'Open thread ↗');
  a.href = link.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = 'Open the Claude thread working on this ticket';
  return a;
}

function reviewOfNote(reviewOf, className = 'rp-review-of') {
  if (!reviewOf) return null;
  const note = el('div', className, 'From review of ');
  note.appendChild(idButton(reviewOf, 'rp-link rp-review-id'));
  return note;
}

const SHIPPED_MAX = 120;
function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "3 Oct" style short date from an ISO timestamp (empty when unparseable). */
function shortDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Review cards start collapsed; ids here were expanded by hand (survives re-renders).
const openReview = new Set();
// Whether the File review preview is open (survives re-renders).
let filingOpen = false;
// Whether the "Open notes" list is shown (survives re-renders).
let notesListOpen = false;
// The tasks.json-shaped doc of the render in progress (used for areas and filing).
let currentDoc = null;

const HAND_TO_CLAUDE = 'File my review notes: run ch tasks notes route, adjust areas or merge near-duplicates if needed (ch tasks notes add --area / dismiss), then ch tasks notes send. Reply with the new ids only.';

/** Area chip data for a note: its area (own or computed) and the lanes it can move to. */
function areaFor(task, note) {
  const docTask = currentDoc.sections.flatMap(s => s.tasks).find(t => t.id === task.taskId);
  const current = docTask ? noteArea(currentDoc, docTask, note) : null;
  return { current, options: areaOptions(currentDoc, current) };
}

/** Note rows for one place on a card (a check, or "not tied to a check"). */
function noteCell(task, notes, { check, key, placeholder, label }) {
  const cell = el('div', 'rp-check-notes');
  notes.forEach(n => cell.appendChild(reviewNoteRow(task, n, { onChange: commitReviewChange, area: areaFor(task, n) })));
  cell.appendChild(reviewNoteAddRow(task, { check, key, placeholder, label, onChange: commitReviewChange }));
  return cell;
}

/** The expanded check grid: Pass | What to check | Your note, then a row for general notes. */
function renderCheckGrid(task) {
  const grid = el('div', 'rp-checks');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', `${task.taskId}: checks and notes`);
  const head = el('div', 'rp-check-row rp-check-head');
  ['Pass', 'What to check', 'Your note'].forEach(t => head.appendChild(el('div', 'rp-check-h', t)));
  grid.appendChild(head);
  const checks = task.checks || [];
  const unsent = unsentNotes(task);
  const addRow = (c, i) => {
    const row = el('div', 'rp-check-row');
    const pass = el('div', 'rp-check-pass');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!c.checked;
    cb.setAttribute('aria-label', `Pass check ${i + 1}: ${c.text}`);
    if (c.handedTo) {
      cb.checked = true;
      cb.disabled = true;
      cb.title = `Handed to ${c.handedTo}`;
    } else {
      cb.addEventListener('change', () => toggleReviewCheck(task, c));
    }
    pass.appendChild(cb);
    row.appendChild(pass);
    const what = el('div', 'rp-check-what' + (c.checked ? ' rp-check-done' : ''));
    what.appendChild(el('span', null, c.text || ''));
    if (c.handedTo) {
      what.appendChild(document.createTextNode(' → '));
      what.appendChild(idButton(c.handedTo, 'rp-link rp-review-id'));
    }
    if (c.agentVerified) {
      const av = c.agentVerified;
      const failed = av.result === 'fail';
      const when = new Date(av.at);
      const short = isNaN(when) ? '' : ' ' + when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      what.appendChild(document.createTextNode(' '));
      const badge = el('span', 'rp-check-agent' + (failed ? ' rp-check-agent-fail' : ''), failed ? 'Agent: failed' : `Agent verified${short}`);
      badge.title = av.note;
      what.appendChild(badge);
    }
    if (c.video) {
      what.appendChild(document.createTextNode(' '));
      what.appendChild(playVideoButton(c, i + 1, what));
    }
    if (c.noVideo) {
      what.appendChild(document.createTextNode(' '));
      what.appendChild(el('span', 'rp-check-muted', `No video: ${c.noVideo}`));
    }
    if (c.audio) what.appendChild(audioPlayer(c, i + 1));
    row.appendChild(what);
    row.appendChild(noteCell(task, unsent.filter(n => n.check === c.text), {
      check: c.text, key: i, placeholder: 'What did you see? Enter saves', label: `Note on check ${i + 1}`,
    }));
    grid.appendChild(row);
  };
  // Checks sharing a saved project sit together under one header; the rest keep their order after.
  for (const group of groupChecksByProject(checks)) {
    if (group.project) grid.appendChild(projectGroupHeader(group.project, 'rp-check-row ce-group-head'));
    group.items.forEach(({ check, index }) => addRow(check, index));
  }
  const texts = new Set(checks.map(c => c.text));
  const general = el('div', 'rp-check-row rp-check-general');
  general.appendChild(el('div', 'rp-check-pass'));
  general.appendChild(el('div', 'rp-check-what rp-check-muted', 'Anything not tied to a check'));
  general.appendChild(noteCell(task, unsent.filter(n => !n.check || !texts.has(n.check)), {
    key: 'general', placeholder: 'What did you see? Enter saves', label: 'General note',
  }));
  grid.appendChild(general);
  return grid;
}

/** Tickets File review would create from `plan` (a design pick files two; new epics are extra). */
function ticketCount(plan) {
  return plan.groups.reduce((n, g) => n + g.items.reduce((m, it) => m + (it.noteKind === 'design' ? 2 : 1), 0), 0);
}

/** Open a new Claude session that files the notes through the CLI. */
function handToClaude() {
  const url = claudeCodeSessionUrl(HAND_TO_CLAUDE, window.dashboardConfig?.claudeSessionFolder);
  if (!url) return;
  window.location.assign(url);
  showToast('Opening Claude to file your review notes');
}

/** Lane <select> that sets the area of an unrouted note. */
function unroutedRow(handle) {
  const [id, n] = handle.split('#');
  const task = findTicket(id);
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
  for (const slug of areaOptions(currentDoc, null)) {
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
function renderFilePreview() {
  const plan = planFiling(currentDoc);
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
    plan.unrouted.forEach(u => list.appendChild(unroutedRow(u.handle)));
    block.appendChild(list);
    panel.appendChild(block);
  }
  const actions = el('div', 'rp-actions');
  const count = ticketCount(plan);
  const apply = el('button', 'rp-btn rp-btn-primary', `File ${count} ticket${count === 1 ? '' : 's'}`);
  apply.type = 'button';
  apply.disabled = count === 0;
  apply.addEventListener('click', () => fileReview(plan));
  const cancel = el('button', 'rp-btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { filingOpen = false; renderRunPlanView(); });
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
function fileReview(plan) {
  const state = getState();
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
  touched.forEach(id => { const t = findTicket(id); if (t) t.updated = today; });

  const unpin = new Set();
  for (const id of out.movedToDone) {
    const docTask = doc.sections.flatMap(s => s.tasks).find(t => t.id === id);
    if (docTask) epicsToUnpin(doc, docTask).forEach(x => unpin.add(x));
    const task = findTicket(id);
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

  filingOpen = false;
  commitReviewChange(null);
  const created = out.created.length - newEpics;
  const areas = new Set(plan.groups.map(g => g.area || g.epic.id)).size;
  showToast(`Filed ${created} ticket${created === 1 ? '' : 's'} into ${areas} area${areas === 1 ? '' : 's'}`);
}

/** PRO86: an answer on a done ticket became a review note: file it as a follow-up now (File review's path). */
function fileNotesOf(id) {
  const plan = planFiling(toDoc(getState()), { ticket: id });
  if (plan.groups.length) fileReview(plan);
  else showToast(`${id}: the answer is a review note that needs an area before it can be filed (Notes above)`);
}

/** Every unsent note, grouped by ticket, with the ticket it came from. Works when the cards are collapsed. */
function renderNotesList() {
  const panel = el('div', 'rp-file-preview rp-notes-list');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Open review notes');
  for (const entry of pendingReviewNotes(currentDoc)) {
    const task = findTicket(entry.id);
    if (!task) continue;
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
function renderFileBar() {
  const notes = countUnsentNotes(currentDoc);
  if (!notes) { filingOpen = false; notesListOpen = false; return null; }
  const cards = pendingReviewNotes(currentDoc).length;
  const wrap = el('div', 'rp-file');
  const bar = el('div', 'rp-file-bar');
  bar.appendChild(el('span', 'rp-file-count', `${notes} note${notes === 1 ? '' : 's'} on ${cards} ticket${cards === 1 ? '' : 's'}`));
  const file = el('button', 'rp-btn rp-btn-primary', 'File review');
  file.type = 'button';
  file.setAttribute('aria-expanded', filingOpen ? 'true' : 'false');
  file.addEventListener('click', () => { filingOpen = !filingOpen; renderRunPlanView(); });
  const list = el('button', 'rp-btn', notesListOpen ? 'Hide notes' : 'Show notes');
  list.type = 'button';
  list.title = 'List every open review note, whichever card it is on';
  list.setAttribute('aria-expanded', notesListOpen ? 'true' : 'false');
  list.addEventListener('click', () => { notesListOpen = !notesListOpen; renderRunPlanView(); });
  const hand = el('button', 'rp-btn', 'Hand to Claude');
  hand.type = 'button';
  hand.title = 'Open Claude to file the notes with the CLI';
  hand.addEventListener('click', handToClaude);
  bar.appendChild(list);
  bar.appendChild(file);
  bar.appendChild(hand);
  wrap.appendChild(bar);
  if (notesListOpen) wrap.appendChild(renderNotesList());
  if (filingOpen) wrap.appendChild(renderFilePreview());
  return wrap;
}

/**
 * PRO86: the "For you" block above the lanes, one list oldest first with two kinds of item:
 * epics (and standalone tickets) ready for review, their checks inside, and decisions (asks-strip.js
 * cards with option buttons). Every item carries its media.
 */
function renderReview(review, openChecks, asks) {
  const block = el('section', 'rp-review rp-for-you');
  const total = review.length + asks.length;
  block.setAttribute('aria-label', `For you (${total})`);
  block.appendChild(el('h2', 'rp-review-title', total ? `For you (${total})` : 'For you'));
  const fileBar = renderFileBar();
  if (fileBar) block.appendChild(fileBar);
  if (total) block.appendChild(renderReviewList(review, asks));
  else block.appendChild(el('p', 'rp-review-empty', 'Nothing waits on you: no epic to review, no decision to make.'));
  if (openChecks.length) {
    const total = openChecks.reduce((sum, item) => sum + item.checks.total - item.checks.done, 0);
    block.appendChild(el('h3', 'rp-review-subtitle', `Checks on epics still in progress (${total})`));
    block.appendChild(el('p', 'rp-review-empty', 'These parts already shipped. The epic stays open for its other tickets.'));
    block.appendChild(renderReviewList(openChecks));
  }
  return block;
}

/** Review items and decision cards in one list, oldest first (a review by when it entered review, a decision by when it was asked). */
function renderReviewList(items, asks = []) {
  const list = el('ol', 'rp-review-list');
  const when = x => String(x.kind === 'ask' ? x.card.at || '' : x.item.enteredAt || '') || '9999';
  const all = [...items.map(item => ({ kind: 'review', item })), ...asks.map(card => ({ kind: 'ask', card }))];
  if (asks.length) all.sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0));
  for (const entry of all) {
    if (entry.kind === 'ask') { list.appendChild(renderAskCard(getState(), entry.card, renderRunPlanView)); continue; }
    const { item } = entry;
    const task = findTicket(item.id);
    const open = openReview.has(item.id);
    const li = el('li', 'rp-review-item' + (open ? ' rp-open' : ''));
    const row = el('div', 'rp-row');
    row.appendChild(idButton(item.id));
    const since = shortDate(item.enteredAt);
    if (since) row.appendChild(el('span', 'rp-review-since', `since ${since}`));
    const toggle = el('button', 'rp-chip rp-chip-review rp-chip-toggle', `${item.checks.done}/${item.checks.total} checked ${open ? '▴' : '▾'}`);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.title = open ? 'Hide the checks' : 'Show the checks and add notes';
    toggle.addEventListener('click', () => {
      if (open) openReview.delete(item.id); else openReview.add(item.id);
      renderRunPlanView();
    });
    row.appendChild(toggle);
    if (item.notes > 0) row.appendChild(el('span', 'rp-chip rp-chip-notes', `${item.notes} note${item.notes > 1 ? 's' : ''} unsent`));
    const thread = threadAnchor(task);
    if (thread) row.appendChild(thread);
    li.appendChild(row);
    li.appendChild(el('div', 'rp-title', item.title));
    const shipped = item.result?.shipped?.[0];
    if (shipped) li.appendChild(el('div', 'rp-why', truncate(shipped, SHIPPED_MAX)));
    const build = buildFreshnessNote(task, Object.values(getState?.()?.tasks || {}).flat(), renderRunPlanView);
    if (build) li.appendChild(build);
    const from = reviewOfNote(item.reviewOf);
    if (from) li.appendChild(from);
    for (const fu of item.followUps) {
      const line = el('div', 'rp-review-of', 'Follow-up: ');
      line.appendChild(idButton(fu.id, 'rp-link rp-review-id'));
      line.appendChild(document.createTextNode(` (${fu.section})`));
      li.appendChild(line);
    }
    if (open && task) li.appendChild(renderCheckGrid(task));
    list.appendChild(li);
  }
  return list;
}

// ----- Hover preview + same-ticket highlight (delegated, installed once per render root) -----
let previewEl = null;
function hidePreview() { if (previewEl) previewEl.hidden = true; }
function showPreview(btn) {
  const id = btn.dataset.ticket;
  const task = findTicket(id);
  if (!task) return;
  if (!previewEl) {
    previewEl = el('div', 'rp-preview');
    previewEl.setAttribute('role', 'tooltip');
    document.body.appendChild(previewEl);
  }
  previewEl.textContent = '';
  const head = el('div', 'rp-preview-head');
  head.appendChild(el('b', null, id));
  const sec = sectionNameOf(id);
  if (sec) head.appendChild(el('span', 'rp-preview-sec', sec));
  previewEl.appendChild(head);
  previewEl.appendChild(el('div', 'rp-preview-title', plainTitle(task.title)));
  const epic = task.parentId ? findTicket(task.parentId) : null;
  if (epic) previewEl.appendChild(el('div', 'rp-preview-line', `In ${task.parentId}: ${truncate(epic.title || '', 70)}`));
  const notice = noticeLine(task);
  if (notice) previewEl.appendChild(el('div', 'rp-preview-line', notice));
  const canvas = (task.links || []).find(l => /design canvas/i.test(l.label || ''));
  previewEl.appendChild(el('div', 'rp-preview-line', canvas ? 'Canvas linked' : (task.links?.length ? `${task.links.length} link${task.links.length > 1 ? 's' : ''}` : '')));
  previewEl.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = previewEl.offsetWidth;
  const h = previewEl.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const top = r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
  previewEl.style.left = `${left}px`;
  previewEl.style.top = `${top}px`;
}
function highlight(root, id, on) {
  root.querySelectorAll('[data-ticket]').forEach(n => {
    if (n.dataset.ticket === id) n.classList.toggle('rp-hl', on);
  });
}
function installHover(root) {
  if (root.dataset.rpHover) return;
  root.dataset.rpHover = '1';
  const target = e => e.target.closest?.('[data-ticket]');
  const enter = e => {
    const t = target(e);
    if (!t) return;
    highlight(root, t.dataset.ticket, true);
    if (t.tagName === 'BUTTON') showPreview(t);
  };
  const leave = e => {
    const t = target(e);
    if (!t) return;
    highlight(root, t.dataset.ticket, false);
    hidePreview();
  };
  root.addEventListener('mouseover', enter);
  root.addEventListener('mouseout', leave);
  root.addEventListener('focusin', enter);
  root.addEventListener('focusout', leave);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hidePreview(); });
}

// Which design card's ticket list is open (survives re-renders).
let openDrawer = null;

const LANE_COLORS = 4; // --rp-c1..4; the design lane uses the pick colour
const PROGRESS_KEY = 'runPlanProgress';

// ----- Start -> Started -> Done progress, kept in localStorage (best effort) -----
function readProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; }
}
function writeProgress(map) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(map)); } catch { /* storage unavailable */ }
}
const NEXT = { '': 'started', started: 'done', done: '' };
const TOGGLE_LABEL = { '': 'Start', started: 'Started', done: 'Done' };

function showToast(message) {
  let toast = document.getElementById('runPlanToast');
  if (!toast) {
    toast = el('div', 'rp-toast');
    toast.id = 'runPlanToast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Start: open the Claude desktop app on a new Code session with this card's command typed in. */
function openClaudeSession(card) {
  const folder = window.dashboardConfig?.claudeSessionFolder;
  const url = claudeCodeSessionUrl(card.command, folder);
  if (!url) return;
  window.location.assign(url);
  const pick = card.model ? ` (pick ${card.model} in the model menu)` : '';
  showToast(folder ? `Opening Claude: ${card.command}${pick}` : `Opening Claude${pick} (set claudeSessionFolder in config.json to pick the folder)`);
}

// Readiness by epic id for this draw, and where to put focus after the redraw a toggle causes.
let readinessById = new Map();
let pendingAutoFocus = null;

/** Flip an epic's Auto label through the normal save; the redraw updates the queue and any open epic window. */
function setEpicAuto(r, on, where) {
  const task = findTicket(r.id);
  if (!task) { showToast(`Ticket ${r.id} not found`); return; }
  task.labels = withAutoLabel(task.labels, on);
  pendingAutoFocus = { id: r.id, where };
  showStatus(`${r.id}: Auto ${on ? 'on' : 'off'}`);
  commitReviewChange(task);
}

function renderCard(card, phase) {
  const key = `${card.id}:${phase}`;
  const article = el('article', `rp-card rp-${card.state}`);
  article.setAttribute('aria-label', `${card.id} ${card.title}`);
  if (!card.ticketIds) article.dataset.ticket = card.id;

  const row = el('div', 'rp-row');
  const coTasks = card.id === 'co-tasks';
  row.appendChild(card.state === 'pick' || card.isPrompt ? el('span', 'rp-id', coTasks ? 'Co-tasks' : 'Design') : idButton(card.id));
  const running = card.inProgress && (card.state === 'ready' || card.state === 'partial');
  row.appendChild(running
    ? el('span', 'rp-chip rp-chip-running', 'In progress')
    : el('span', `rp-chip rp-chip-${card.state}`, coTasks ? 'Your to-do' : (STATE_LABEL[card.state] || card.state)));
  if (card.model) row.appendChild(el('span', 'rp-chip rp-chip-model', `Orchestrator: ${card.model}`));
  article.appendChild(row);

  article.appendChild(el('div', 'rp-title', card.isRest ? `${card.title} (rest)` : card.title));
  const n = card.openTickets;
  const countText = `${n} open ${n === 1 ? 'ticket' : 'tickets'}`;
  if (card.ticketIds) {
    const open = openDrawer === card.id;
    const count = el('button', 'rp-btn rp-count-btn', `${countText} ${open ? '▴' : '▾'}`);
    count.type = 'button';
    count.setAttribute('aria-expanded', open ? 'true' : 'false');
    count.title = open ? 'Hide the ticket list' : 'Show these tickets';
    count.addEventListener('click', () => {
      openDrawer = openDrawer === card.id ? null : card.id;
      renderRunPlanView();
    });
    article.appendChild(count);
    const ids = el('div', 'rp-ids');
    card.ticketIds.forEach(id => ids.appendChild(idButton(id, 'rp-link rp-chip-id')));
    article.appendChild(ids);
  } else {
    article.appendChild(el('div', 'rp-items', countText));
    if (card.state !== 'pick' && !card.isPrompt) {
      const cost = el('div', 'rp-items rp-cost');
      cost.dataset.estEpic = card.id;
      cost.hidden = true;
      article.appendChild(cost);
    }
  }
  const fromReview = reviewOfNote(findTicket(card.id)?.reviewOf);
  if (fromReview) article.appendChild(fromReview);
  if (card.state === 'notready' && card.reasons?.length) {
    renderReasonBlock(card, id => idButton(id, 'rp-link rp-chip-id'), renderRunPlanView).forEach(n => article.appendChild(n));
  } else if (card.why && !(card.ticketIds && /^(Picks|Co-tasks): /.test(card.why))) article.appendChild(el('div', 'rp-why', card.why));

  const actions = el('div', 'rp-actions');
  const autoR = !card.ticketIds && card.state !== 'pick' && !card.isPrompt ? readinessById.get(card.id) : null;
  if (autoR) actions.appendChild(buildAutoToggle(autoR, on => setEpicAuto(autoR, on, 'lane')));
  if (card.command) {
    const copy = el('button', 'rp-btn rp-cmd', card.isPrompt ? 'Copy prompt' : card.command);
    copy.type = 'button';
    copy.title = card.command;
    copy.setAttribute('aria-label', card.isPrompt ? 'Copy the design prompt' : `Copy command ${card.command}`);
    copy.addEventListener('click', async () => {
      const ok = await copyText(card.command);
      showToast(ok ? (card.isPrompt ? 'Copied the design prompt' : `Copied: ${card.command}`) : `Copy blocked: ${card.command}`);
    });
    actions.appendChild(copy);
  }
  const progress = readProgress();
  let state = progress[key] || '';
  const toggle = el('button', 'rp-btn rp-toggle', TOGGLE_LABEL[state]);
  toggle.type = 'button';
  const apply = () => {
    // Start names the model to pick: the desktop app's link can't set it.
    toggle.textContent = !state && card.model ? `Start · ${card.model}` : TOGGLE_LABEL[state];
    toggle.title = card.model ? `Opens Claude with ${card.command}; pick ${card.model} in the model menu` : '';
    toggle.setAttribute('aria-pressed', state ? 'true' : 'false');
    toggle.setAttribute('aria-label', `${card.id} ${card.title}: ${state || 'not started'}${card.model ? `, model ${card.model}` : ''}. Activate to change`);
    article.classList.toggle('rp-done', state === 'done');
  };
  toggle.addEventListener('click', () => {
    const prev = state;
    state = NEXT[state];
    if (prev === '' && state === 'started') openClaudeSession(card);
    const map = readProgress();
    if (state) map[key] = state; else delete map[key];
    writeProgress(map);
    apply();
  });
  apply();
  actions.appendChild(toggle);
  const thread = card.ticketIds ? null : threadAnchor(findTicket(card.id));
  if (thread) actions.appendChild(thread);
  article.appendChild(actions);
  return article;
}

/** Cards sharing a step stack in one column; arrows sit between columns only. */
function appendCards(parent, cards, phase) {
  const steps = [...new Set(cards.map(c => c.step ?? 0))].sort((x, y) => x - y);
  steps.forEach((step, i) => {
    if (i > 0) {
      const arrow = el('span', 'rp-arrow', '→');
      arrow.setAttribute('aria-hidden', 'true');
      parent.appendChild(arrow);
    }
    const col = el('div', 'rp-col');
    cards.filter(c => (c.step ?? 0) === step).forEach(c => col.appendChild(renderCard(c, phase)));
    parent.appendChild(col);
  });
}

/** Words for the divider, as DOM: "after <epics> and your pick(s) <ids>". Ids are buttons. */
function renderDivider(waitsOn) {
  const { picks = [], epics = [] } = waitsOn || {};
  const divider = el('div', 'rp-picks');
  const label = el('div', 'rp-picks-label');
  if (!picks.length && !epics.length) {
    label.textContent = 'later';
    divider.appendChild(label);
    return divider;
  }
  const pickWord = picks.length > 1 ? 'your picks' : 'your pick';
  label.textContent = picks.length && !epics.length ? `after ${pickWord}` : 'after';
  divider.appendChild(label);
  const group = (ids, text) => {
    if (text) divider.appendChild(el('div', 'rp-picks-label', text));
    const stack = el('div', 'rp-picks-ids');
    ids.forEach(id => stack.appendChild(idButton(id, 'rp-link rp-picks-id')));
    divider.appendChild(stack);
  };
  if (epics.length) group(epics);
  if (picks.length) group(picks, epics.length ? `and ${pickWord}` : '');
  return divider;
}

const STAGE_LABEL = { draw: 'Canvas to draw', pick: 'Waiting for your pick', publish: 'Pick made, publish it', todo: 'Your to-do' };

/** Ticket list under the design lane: id, title, epic it belongs to, and its canvas once linked. */
function renderDrawer(card, picks) {
  const drawer = el('div', 'rp-drawer');
  drawer.setAttribute('role', 'region');
  drawer.setAttribute('aria-label', `${card.title}: tickets`);
  drawer.appendChild(el('div', 'rp-drawer-title', card.title));
  const list = el('ul', 'rp-drawer-list');
  const rows = card.ticketIds.map(id => picks.find(p => p.id === id)).filter(Boolean);
  for (const p of rows) {
    const li = el('li', 'rp-drawer-row');
    li.dataset.ticket = p.id;
    li.appendChild(idButton(p.id));
    li.appendChild(el('span', 'rp-drawer-name', plainTitle(p.title)));
    const epic = el('span', 'rp-drawer-epic');
    if (p.epic) {
      epic.appendChild(document.createTextNode('in '));
      epic.appendChild(idButton(p.epic, 'rp-link rp-review-id'));
      epic.appendChild(document.createTextNode(` ${truncate(findTicket(p.epic)?.title || '', 48)}`));
    }
    li.appendChild(epic);
    li.appendChild(el('span', `rp-chip rp-chip-${p.stage === 'todo' ? 'pick' : 'later'}`, STAGE_LABEL[p.stage] || p.stage));
    if (p.canvas) {
      const a = el('a', 'rp-canvas-link', 'Open canvas ↗');
      a.href = p.canvas.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
    } else if (p.stage !== 'todo') {
      li.appendChild(el('span', 'rp-no-canvas', 'No canvas yet'));
    }
    list.appendChild(li);
  }
  drawer.appendChild(list);
  return drawer;
}

function renderLane(lane, index, picks) {
  const track = el('section', 'rp-track');
  track.setAttribute('aria-label', `Lane ${lane.name}`);
  const colorIdx = lane.lane === 'design' ? 'pick' : (index % LANE_COLORS) + 1;
  track.style.setProperty('--c', `var(--rp-c${colorIdx})`);

  const head = el('div', 'rp-head');
  head.appendChild(el('h3', 'rp-name', lane.name));
  head.appendChild(el('div', 'rp-note', lane.needsBuild ? 'Needs an app build' : 'No app build'));
  if (lane.lane !== 'design') {
    const epics = new Set([...lane.now, ...lane.later].map(c => c.id)).size;
    const open = [...lane.now, ...lane.later].reduce((n, c) => n + (c.openTickets || 0), 0);
    head.appendChild(el('div', 'rp-note rp-count',
      `${epics} ${epics === 1 ? 'epic' : 'epics'} · ${open} open ${open === 1 ? 'ticket' : 'tickets'}${lane.laterEpics?.length ? ` · ${lane.laterEpics.length} later` : ''}`));
  }
  if (lane.lane !== 'design') {
    const epicIds = [...new Set([...lane.now, ...lane.later].map(c => c.id))];
    const wrap = el('div', 'rp-lane-epics');
    epicIds.forEach(id => wrap.appendChild(idButton(id, 'rp-link rp-chip-id')));
    head.appendChild(wrap);
  }
  if (lane.lane === 'unassigned') {
    head.appendChild(el('div', 'rp-note rp-hint', 'Give each a lane: ch tasks update <id> --lane <slug>'));
  }
  track.appendChild(head);

  const row = el('div', 'rp-lane');
  row.tabIndex = 0;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', `${lane.name} cards, in order`);
  appendCards(row, lane.now, 'now');
  if (lane.later.length) {
    row.appendChild(renderDivider(lane.waitsOn));
    appendCards(row, lane.later, 'later');
  }
  const body = el('div', 'rp-lane-body');
  body.appendChild(row);
  const laterFold = renderLaterFold(lane, id => idButton(id), renderRunPlanView);
  if (laterFold) body.appendChild(laterFold);
  track.appendChild(body);
  const openCard = lane.lane === 'design' && lane.now.find(c => c.ticketIds && c.id === openDrawer);
  if (openCard) track.appendChild(renderDrawer(openCard, picks));
  return track;
}

/** Pinned epics that are finished: each id opens it, with the unpin command. */
function renderDoneNote(ids) {
  const note = el('p', 'rp-done-note', 'Done, still pinned: ');
  ids.forEach((id, i) => {
    if (i > 0) note.appendChild(document.createTextNode(', '));
    note.appendChild(idButton(id, 'rp-link rp-review-id'));
  });
  note.appendChild(document.createTextNode(` (unpin with ch tasks plan --unpin ${ids[0]})`));
  return note;
}

function renderRules(plan) {
  const rules = el('div', 'rp-rules');
  const pill = (bold, rest) => {
    const p = el('span', 'rp-rule');
    if (bold) p.appendChild(el('b', null, bold));
    p.appendChild(document.createTextNode(rest));
    rules.appendChild(p);
  };
  pill('Epics in one lane run in order; lanes run side by side', '. Cards in a lane run left to right, cards stacked in one column can run at the same time');
  pill(`At most ${plan.machineCap} app builds at once`, ` (${plan.appStartCount} could start now)`);
  pill('Partly ready', ' = run it now, it stops at the design picks; run the same command again after your picks');
  return rules;
}

function renderLegend() {
  const legend = el('div', 'rp-legend');
  for (const [cls, text] of [['running', 'In progress'], ['ready', 'Ready now'], ['partial', 'Partly ready'], ['later', 'Later'], ['notready', 'Not ready'], ['pick', 'Your picks and co-tasks']]) {
    const item = el('span');
    item.appendChild(el('span', `rp-dot rp-dot-${cls}`));
    item.appendChild(document.createTextNode(text));
    legend.appendChild(item);
  }
  return legend;
}

/** Write a queue move: set autoPriority / autoRank on each changed epic ('normal' = no field), save and redraw. */
function applyQueueChanges(changes, note) {
  const tasks = changes.map(c => ({ c, task: findTicket(c.id) })).filter(x => x.task);
  tasks.forEach(({ c, task }, i) => {
    task.autoPriority = c.priority === 'normal' ? null : c.priority;
    task.autoRank = c.autoRank;
    if (i < tasks.length - 1) markChanged(task);
    else commitReviewChange(task);
  });
  showStatus(note);
  const live = document.querySelector('.rp-aq-live');
  if (live) live.textContent = note;
}

export function renderRunPlanView() {
  const root = document.getElementById('runPlanMain');
  if (!root) return;
  root.textContent = '';
  installHover(root);
  hidePreview();
  const state = getState?.();
  if (!state?.tasks) {
    root.appendChild(el('p', 'rp-empty', 'Load tasks to see the plan.'));
    return;
  }
  currentDoc = toDoc(state);
  const plan = computeRunPlan(currentDoc);

  setAskFiler(fileNotesOf); // here, not at import time: the modules import each other
  const asks = asksFromState(state);
  updateAsksBadge(asks.length);
  checkMergedPrs(state, asks, renderRunPlanView);
  root.appendChild(renderReview(plan.review || [], plan.openChecks || [], asks));
  readinessById = new Map((plan.readiness || []).map(r => [r.id, r]));
  root.appendChild(renderNextStartLine());
  root.appendChild(renderAutoQueue(plan.readiness || [], {
    idButton: id => idButton(id, 'rp-link rp-chip-id'),
    openTicket,
    redraw: renderRunPlanView,
    apply: applyQueueChanges,
  }));
  root.appendChild(renderReadyState(plan.readiness || [], id => idButton(id, 'rp-link rp-chip-id'), setEpicAuto));
  if (plan.lanes.length === 0) {
    root.appendChild(el('p', 'rp-empty', 'No epic is in progress or Ready, and none is pinned.'));
    return;
  }
  root.appendChild(renderRules(plan));
  root.appendChild(renderLegend());
  if (plan.totals) {
    const t = totalsLine(plan.totals);
    const line = el('p', t.ok ? 'rp-totals' : 'rp-totals rp-totals-warn', t.text);
    line.dataset.totals = t.ok ? 'ok' : 'missing';
    root.appendChild(line);
  }
  const tracks = el('div', 'rp-tracks');
  plan.lanes.forEach((lane, i) => tracks.appendChild(renderLane(lane, i, plan.picks || [])));
  root.appendChild(tracks);
  if (plan.doneEpics.length) root.appendChild(renderDoneNote(plan.doneEpics));
  fillEpicEstimates(root);
  restoreAutoFocus(root);
}

/** After a switch redraws the page, put focus back on the same switch (same place on the page). */
function restoreAutoFocus(root) {
  if (!pendingAutoFocus) return;
  const { id, where } = pendingAutoFocus;
  pendingAutoFocus = null;
  const scope = where === 'ready' ? '.rp-ready' : '.rp-tracks';
  root.querySelector(`${scope} [data-auto-toggle="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}

/** Re-render when tasks change (called from renderTasks); only if the tab is showing. */
export function refreshRunPlanView() {
  const panel = document.getElementById('runPlanPanel');
  if (panel?.classList.contains('active')) renderRunPlanView();
}
