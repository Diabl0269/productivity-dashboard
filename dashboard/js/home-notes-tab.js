// home-notes-tab.js — the inspector's Notes tab on Home (PRO121): open notes for the selected place
// (free notes, then review notes on tickets), each with its kind, place, age, edit and dismiss (the
// shared review-note row), then a "Filed" fold of free notes that became tickets. No place selected:
// every open note. Edits go through the normal save (commitReviewChange -> markChanged).

import { registerInspectorTab } from './home-state.js';
import { pendingReviewNotes, freeNotes, freeHolder, freeHandle } from '../../shared/review-notes.js';
import { noteArea } from '../../shared/review-filing.js';
import { laneDisplayName } from '../../shared/run-plan.js';
import { boxOfWhere, findWhere } from '../../shared/home-config.js';
import { lanesForBox } from '../../shared/home-areas.js';
import { ticketInSelection, projectScopeOf } from './home-where.js';
import { reviewNoteRow } from './review-notes-ui.js';
import { commitReviewChange } from './task-detail.js';

const FILED_SHOWN = 20;
let filedOpen = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** "5m", "3h", "2d" since an ISO time. */
export function ageOf(iso, now = Date.now()) {
  const ms = now - Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** The selected place as { box, ids, lanes } (the place and everything inside it), or null for "everything". */
export function placeScope(config, where) {
  const box = boxOfWhere(config, where);
  if (!box) return null;
  const ids = new Set();
  const walk = (b) => { ids.add(b.id); [...(b.areas || []), ...(b.parts || [])].forEach(walk); };
  walk(box);
  return { box, ids, lanes: new Set(lanesForBox(config, box.id)) };
}

/** A free note's place name: its box on the map, else its area's lane name. */
function placeName(config, note) {
  const where = note.where && findWhere(config, note.where);
  const box = where && boxOfWhere(config, where);
  if (box) return box.name;
  return note.area ? laneDisplayName(note.area) : 'No place';
}

/** Open notes in scope: [{ note, holder, ticketId?, place, lane }]. */
export function openNotesIn(doc, config, scope, findTask, project = null) {
  const out = [];
  const docTask = (id) => {
    for (const s of doc?.sections || []) { const t = (s.tasks || []).find(x => x.id === id); if (t) return t; }
    return null;
  };
  const holder = freeHolder(doc);
  for (const entry of pendingReviewNotes(doc)) {
    if (entry.type === 'free') {
      const note = entry.notes[0];
      if (project && !project.family.has(note.project)) continue; // PRO127: the Home project's notes only
      if (scope && !(scope.ids.has(note.where) || (note.area && scope.lanes.has(note.area)))) continue;
      out.push({ note, holder, place: placeName(config, note), lane: note.area || null });
      continue;
    }
    const task = findTask(entry.id);
    const dt = docTask(entry.id);
    if (!task || !dt || (project && !project.hasId(entry.id))) continue;
    for (const note of entry.notes) {
      const lane = noteArea(doc, dt, note);
      // A ticket's note is in the place when its epic is (home-where.js, as every Home view), else by lane.
      if (scope && !(scope.ticketIn ? scope.ticketIn(entry.id) : (lane && scope.lanes.has(lane)))) continue;
      out.push({ note, holder: task, ticketId: entry.id, place: lane ? laneDisplayName(lane) : 'No area', lane });
    }
  }
  return out;
}

function noteItem(ctx, item) {
  const li = el('li', 'hn-item');
  li.dataset.hmKey = item.ticketId ? `note-${item.ticketId}-${item.note.n}` : `note-free-${item.note.n}`;
  li.appendChild(reviewNoteRow(item.holder, item.note, { onChange: commitReviewChange }));
  const meta = el('div', 'hn-meta');
  meta.appendChild(el('span', 'hn-chip', item.place));
  meta.appendChild(el('span', 'hn-age', ageOf(item.note.at)));
  if (item.ticketId) {
    meta.append(el('span', 'hn-on', 'on'), ctx.idButton(item.ticketId));
  } else {
    meta.appendChild(el('span', 'hn-handle', freeHandle(item.note)));
  }
  li.appendChild(meta);
  return li;
}

function filedFold(ctx, root, filed) {
  const wrap = el('div', 'hn-filed');
  const btn = el('button', 'hn-fold-btn');
  btn.type = 'button';
  btn.dataset.hmKey = 'notes-filed';
  btn.setAttribute('aria-expanded', filedOpen ? 'true' : 'false');
  btn.setAttribute('aria-controls', 'hnFiled');
  btn.append(el('span', 'hn-caret', '›'), document.createTextNode(` Filed (${filed.length})`));
  const fold = el('div', 'hn-fold');
  fold.id = 'hnFiled';
  fold.dataset.open = filedOpen ? 'true' : 'false';
  fold.inert = !filedOpen;
  const inner = el('ul', 'hn-list hn-fold-inner');
  for (const note of filed.slice(0, FILED_SHOWN)) {
    const li = el('li', 'hn-filed-row');
    li.appendChild(el('span', `td-note-kind kind-${note.kind}`, note.kind[0].toUpperCase() + note.kind.slice(1)));
    li.appendChild(el('span', 'hn-filed-text', note.text || '(image only)'));
    const as = el('span', 'hn-filed-as', 'filed as ');
    as.appendChild(ctx.idButton(note.filed));
    li.appendChild(as);
    inner.appendChild(li);
  }
  fold.appendChild(inner);
  btn.addEventListener('click', () => {
    filedOpen = !filedOpen;
    btn.setAttribute('aria-expanded', filedOpen ? 'true' : 'false');
    fold.dataset.open = filedOpen ? 'true' : 'false';
    fold.inert = !filedOpen;
  });
  wrap.append(btn, fold);
  root.appendChild(wrap);
}

function renderNotesTab(root, ctx) {
  const config = ctx.config();
  const scope = placeScope(config, ctx.selection());
  if (scope) scope.ticketIn = (id) => ticketInSelection(ctx, { id });
  const doc = ctx.doc();
  const findTask = (id) => {
    for (const list of Object.values(ctx.state().tasks || {})) {
      const t = (list || []).find(x => x.taskId === id);
      if (t) return t;
    }
    return null;
  };
  const items = openNotesIn(doc, config, scope, findTask, projectScopeOf(ctx));
  const head = el('div', 'hn-head');
  head.appendChild(el('h3', 'hm-insp-title', `Open notes (${items.length})`));
  const add = el('button', 'hn-add', 'New note');
  add.type = 'button';
  add.dataset.hmKey = 'notes-new';
  add.title = 'Write a note with no ticket (N)';
  add.addEventListener('click', () => document.dispatchEvent(new CustomEvent('hm:note', { detail: { where: ctx.selection() } }))); // home-notes.js opens the box
  head.appendChild(add);
  root.appendChild(head);
  root.appendChild(el('p', 'hm-muted hn-scope', scope ? `In ${scope.box.name} and the places inside it.` : 'Every place. Pick one to narrow the list.'));
  if (items.length) {
    const list = el('ul', 'hn-list');
    list.setAttribute('aria-label', 'Open notes');
    for (const item of items) list.appendChild(noteItem(ctx, item));
    root.appendChild(list);
  } else {
    root.appendChild(el('p', 'hm-muted hn-empty', 'No open notes here. Press N to write one.'));
  }
  const project = projectScopeOf(ctx);
  const filed = freeNotes(doc).filter(n => n && n.state === 'filed' && n.filed && (!project || project.family.has(n.project))
    && (!scope || scope.ids.has(n.where) || (n.area && scope.lanes.has(n.area)))).reverse();
  if (filed.length) filedFold(ctx, root, filed);
}

registerInspectorTab({ id: 'notes', label: 'Notes', render: renderNotesTab });
