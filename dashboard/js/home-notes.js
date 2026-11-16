// home-notes.js — free notes on Home (PRO121): the "Note" button in the top bar's `note` slot and the
// N key open a small note box that grows from the button. A free note needs no ticket: it is stored in
// meta.freeNotes (shared/review-notes.js) and the notes run files it like any review note.
// The inspector's Notes tab (home-notes-tab.js) lists open and filed notes.
//
// Box: text (Enter saves, Shift+Enter new line), kind, place (pre-filled from the selected place; the
// note's area is the place's first lane, its project the place's first project), images by paste,
// drop or the Image button. Esc or a click away closes it with the reverse animation and keeps the draft.

import { registerTopBarItem, getSelection, getHomeConfig, getProject, selectedBoxId } from './home-state.js';
import { activeMainTab } from './state.js';
import { NOTE_KINDS, addFreeNote, FREE_ID } from '../../shared/review-notes.js';
import { laneDisplayName } from '../../shared/run-plan.js';
import { uploadNoteImage, buildThumb, acceptImageFiles, pastedImageFiles } from './note-images-ui.js';
import { commitReviewChange, isTaskDetailOpen } from './task-detail.js';
import { isTaskCreateOpen } from './task-create.js';
import { taskState } from './tasks-main.js';
import { stateToDoc } from './epic-ready-ui.js';
import { showStatus } from './state.js';
import './home-notes-tab.js';

const DRAFT_KEY = 'home.noteDraft';
const MOTION_MS = 160;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const lsDo = (fn) => { try { return fn(localStorage); } catch { return null; } };

/** Every place of the map, in outline order: { id, name, label, depth, lane, project }. */
export function placeOptions(config) {
  const out = [];
  if (!config) return out;
  for (const g of config.groups || []) {
    const groupProject = (g.keywordProjects || []).find(Boolean) || null;
    out.push({ id: g.id, name: g.name, label: g.name, depth: 0, lane: (g.lanes || [])[0] || null, project: groupProject });
    for (const a of g.areas || []) {
      const lane = (a.lanes || [])[0] || null;
      const project = (a.projects || [])[0] || groupProject;
      out.push({ id: a.id, name: a.name, label: a.name, depth: 1, lane, project });
      for (const p of a.parts || []) {
        out.push({ id: p.id, name: p.name, label: p.name, depth: 2, lane: (p.lanes || [])[0] || lane, project: (p.projects || [])[0] || project });
      }
    }
  }
  return out;
}

/** The tracker project a note at `place` files under: the place's, if the tracker knows it, else Home's project. */
function projectFor(place) {
  const known = (taskState.meta?.projects || []).map(p => p.id);
  const want = place?.project;
  if (want && (!known.length || known.includes(want))) return want;
  return getProject() || known[0] || null;
}

// ===== the draft (survives a close, a re-render and a page refresh; images only a re-render) =====

const draft = { text: '', kind: 'fix', place: null, images: [] };
(function readDraft() {
  const raw = lsDo(ls => ls.getItem(DRAFT_KEY));
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (typeof d.text === 'string') draft.text = d.text;
    if (NOTE_KINDS.includes(d.kind)) draft.kind = d.kind;
    if (typeof d.place === 'string') draft.place = d.place;
  } catch { /* a broken draft is dropped */ }
}());
function storeDraft() {
  lsDo(ls => (draft.text.trim() ? ls.setItem(DRAFT_KEY, JSON.stringify({ text: draft.text, kind: draft.kind, place: draft.place })) : ls.removeItem(DRAFT_KEY)));
}

// ===== the box =====

let ui = null; // { root, btn, box, input, kind, place, hint, thumbs, picker }
let open = false;
let saving = false;
let closeTimer = null;

function buildBox(root) {
  const btn = el('button', 'hn-btn');
  btn.type = 'button';
  btn.dataset.hmKey = 'note-open';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'hnBox');
  btn.title = 'Write a note with no ticket (N)';
  btn.append(el('span', null, 'Note'), el('kbd', 'hm-key', 'N'));
  btn.addEventListener('click', () => (open ? closeBox() : openBox()));

  const box = el('div', 'hn-box');
  box.id = 'hnBox';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'New note');

  const input = el('textarea', 'hn-input');
  input.rows = 3;
  input.placeholder = 'An idea or a fix you ran into…';
  input.setAttribute('aria-label', 'Note text. Enter saves, Shift+Enter starts a new line');
  input.addEventListener('input', () => { draft.text = input.value; storeDraft(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
  });
  input.addEventListener('paste', (e) => {
    const files = pastedImageFiles(e);
    if (!files.length) return;
    e.preventDefault();
    stage(files);
  });

  const row = el('div', 'hn-row');
  const kind = el('select', 'td-review-note-kind hn-kind');
  kind.setAttribute('aria-label', 'Note kind');
  for (const k of NOTE_KINDS) { const o = el('option', null, cap(k)); o.value = k; kind.appendChild(o); }
  kind.addEventListener('change', () => { draft.kind = kind.value; storeDraft(); });
  const place = el('select', 'hn-place');
  place.setAttribute('aria-label', 'Place on the map');
  place.addEventListener('change', () => { draft.place = place.value || null; storeDraft(); paintHint(); });
  const imageBtn = el('button', 'td-review-note-image-btn', 'Image');
  imageBtn.type = 'button';
  imageBtn.title = 'Attach a screenshot (or paste or drop one into the box)';
  const picker = el('input');
  picker.type = 'file';
  picker.accept = 'image/*';
  picker.multiple = true;
  picker.hidden = true;
  picker.tabIndex = -1;
  picker.addEventListener('change', () => { stage(Array.from(picker.files || [])); picker.value = ''; });
  imageBtn.addEventListener('click', () => picker.click());
  row.append(kind, place, imageBtn, picker);

  const thumbs = el('div', 'td-note-thumbs hn-thumbs');
  thumbs.hidden = true;
  const foot = el('div', 'hn-foot');
  const hint = el('span', 'hn-hint');
  const saveBtn = el('button', 'hn-save', 'Save');
  saveBtn.type = 'button';
  saveBtn.title = 'Save the note (Enter)';
  saveBtn.addEventListener('click', () => save());
  foot.append(hint, saveBtn);
  box.append(input, row, thumbs, foot);

  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeBox({ refocus: true });
  });
  box.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  box.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    e.preventDefault();
    stage(files);
  });
  root.append(btn, box);
  ui = { root, btn, box, input, kind, place, hint, thumbs, picker };
}

function stage(files) {
  for (const f of acceptImageFiles(files)) draft.images.push({ file: f, url: URL.createObjectURL(f) });
  paintThumbs();
}

function paintThumbs() {
  if (!ui) return;
  ui.thumbs.textContent = '';
  ui.thumbs.hidden = !draft.images.length;
  draft.images.forEach((item, i) => ui.thumbs.appendChild(buildThumb(item.url, `Image ${i + 1}`, () => {
    URL.revokeObjectURL(item.url);
    draft.images.splice(i, 1);
    paintThumbs();
  })));
}

function places() { return placeOptions(getHomeConfig()); }

function paintPlaces() {
  const list = places();
  ui.place.textContent = '';
  const none = el('option', null, 'No place');
  none.value = '';
  ui.place.appendChild(none);
  for (const p of list) {
    const o = el('option', null, `${'  '.repeat(p.depth)}${p.label}`);
    o.value = p.id;
    ui.place.appendChild(o);
  }
  ui.place.value = list.some(p => p.id === draft.place) ? draft.place : '';
  ui.placesPainted = list.length;
}

function paintHint() {
  const p = places().find(x => x.id === ui.place.value);
  const project = projectFor(p);
  ui.hint.textContent = p?.lane
    ? `Files under ${laneDisplayName(p.lane)}${project ? ` · ${project}` : ''}`
    : 'No area yet: the notes run asks for one';
}

function placeBox() {
  const r = ui.btn.getBoundingClientRect();
  ui.box.style.top = `${Math.round(r.bottom + 6)}px`;
  ui.box.style.right = `${Math.max(16, Math.round(window.innerWidth - r.right))}px`;
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function openBox({ where } = {}) {
  if (!ui || !ui.root.isConnected) return false;
  clearTimeout(closeTimer);
  // A fresh note takes the asked-for place, else the selected one; a kept draft keeps its own.
  if (!draft.text.trim() && !draft.images.length) {
    const asked = typeof where === 'string' ? where : (where && (where.part || where.area || where.group));
    draft.place = (asked && places().some(p => p.id === asked) ? asked : null) || selectedBoxId() || getSelection().group || null;
  }
  paintPlaces();
  ui.input.value = draft.text;
  ui.kind.value = draft.kind;
  paintHint();
  paintThumbs();
  placeBox();
  ui.box.hidden = false;
  open = true;
  ui.btn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    ui.box.classList.add('hn-open');
    ui.input.focus();
    ui.input.setSelectionRange(ui.input.value.length, ui.input.value.length);
  });
  document.addEventListener('pointerdown', onOutside, true);
  return true;
}

export function closeBox({ refocus = false } = {}) {
  if (!ui || !open) return;
  open = false;
  document.removeEventListener('pointerdown', onOutside, true);
  ui.btn.setAttribute('aria-expanded', 'false');
  ui.box.classList.remove('hn-open');
  closeTimer = setTimeout(() => { if (!open) ui.box.hidden = true; }, reduced() ? 0 : MOTION_MS + 20);
  if (refocus || ui.box.contains(document.activeElement)) ui.btn.focus();
}

function onOutside(e) {
  if (!ui || ui.box.contains(e.target) || ui.btn.contains(e.target)) return;
  closeBox();
}

async function save() {
  const text = ui.input.value.trim();
  if (saving || (!text && !draft.images.length)) return;
  const place = places().find(x => x.id === ui.place.value) || null;
  const project = projectFor(place);
  if (!project) { showStatus('Pick a project on Home first: a note needs one to become a ticket'); return; }
  saving = true;
  try {
    const images = [];
    for (const item of draft.images) images.push(await uploadNoteImage({ taskId: FREE_ID }, item.file));
    const note = addFreeNote(stateToDoc(taskState), {
      text, kind: ui.kind.value, project, area: place?.lane || undefined, where: place?.id, images,
    });
    draft.images.forEach(item => URL.revokeObjectURL(item.url));
    Object.assign(draft, { text: '', kind: 'fix', place: null, images: [] });
    storeDraft();
    ui.input.value = '';
    closeBox({ refocus: true });
    commitReviewChange(null); // the normal save path: markChanged, then every view redraws
    showStatus(`Noted as ${FREE_ID}#${note.n}${place?.lane ? '' : ' (no area yet)'}`);
  } catch (err) {
    showStatus(`Could not save the note: ${err.message}`);
  } finally {
    saving = false;
  }
}

// ===== the N key (Home's key rules: never while typing, never under a dialog) =====

function isTypingTarget(t) {
  const tag = t?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t?.isContentEditable;
}

document.addEventListener('keydown', (e) => {
  if (activeMainTab !== 'home' || e.defaultPrevented || open) return;
  if (e.key !== 'n' && e.key !== 'N') return;
  if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
  if (isTaskDetailOpen() || isTaskCreateOpen() || document.querySelector('dialog[open], .modal-overlay.visible, .modal.visible')) return;
  if (openBox()) e.preventDefault();
});

// Other Home views open the box with document.dispatchEvent(new CustomEvent('hm:note', { detail: { where } })),
// `where` (optional) a box id or a { group, area, part } selection that pre-fills the place.
document.addEventListener('hm:note', (e) => {
  if (open) { ui.input.focus(); return; }
  openBox({ where: e.detail?.where });
});

registerTopBarItem({
  id: 'note',
  slot: 'note',
  render(root) { buildBox(root); },
  // Live data refreshes must not rebuild the box under a half-typed note: keep it, just re-anchor it.
  // The box opened before Home's map config arrived: fill the place list now that it has.
  update() {
    if (!open || !ui) return;
    placeBox();
    if (!ui.placesPainted && places().length) {
      if (!draft.place) draft.place = selectedBoxId() || getSelection().group || null;
      paintPlaces();
      paintHint();
    }
  },
});
