// review-notes-ui.js — review-note rows shared by the ticket panel (task-detail.js) and the
// Plan's review cards (run-plan-view.js). Tasks are dashboard-shaped (taskId, reviewNotes).
// Builders mutate the task's notes, then call `onChange(task)` so the caller can save and re-render.

import { NOTE_KINDS, addReviewNote, editReviewNote, setNoteState } from '../../shared/review-notes.js';
import { laneDisplayName } from '../../shared/run-plan.js';
import { showStatus } from './state.js';
import { uploadNoteImage, buildThumb, noteImageUrl, acceptImageFiles, pastedImageFiles } from './note-images-ui.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Stable key for a note input, used to put focus back after a re-render. */
export function noteInputKey(task, key) {
  return `${task.taskId || task.id}|${key}`;
}

// ---- drafts ---------------------------------------------------------------------------
// A note being typed survives re-renders (a Pass tick, the watcher applying a background write)
// and a page refresh: text and kind live in localStorage until the note is saved.

const DRAFT_PREFIX = 'td-draft:note-input:';
const lsDo = (fn) => { try { return fn(localStorage); } catch { return null; } };

function readDraft(storeKey) {
  const raw = lsDo(ls => ls.getItem(storeKey));
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return d && typeof d.text === 'string' ? { text: d.text, kind: NOTE_KINDS.includes(d.kind) ? d.kind : null } : null;
  } catch { return null; }
}

function writeDraft(storeKey, text, kind) {
  lsDo(ls => (text.trim() ? ls.setItem(storeKey, JSON.stringify({ text, kind })) : ls.removeItem(storeKey)));
}

// Which note input has focus (and its caret), so a re-render can hand focus to the rebuilt input.
let focusState = null;
let mouseDown = false;
let docListeners = false;
function ensureDocListeners() {
  if (docListeners || typeof document === 'undefined') return;
  docListeners = true;
  document.addEventListener('focusin', (e) => {
    if (!e.target?.classList?.contains('td-review-note-input')) focusState = null;
  });
  document.addEventListener('mousedown', () => { mouseDown = true; }, true);
  document.addEventListener('mouseup', () => { mouseDown = false; }, true);
}

/** True while a note input has focus and text in it: a watcher update should wait. */
export function isNoteInputBusy() {
  if (typeof document === 'undefined') return false;
  const a = document.activeElement;
  return !!a && a.classList?.contains('td-review-note-input') && !!String(a.value || '').trim();
}

/** Focus the note input with this key, once the caller has re-rendered. */
export function focusNoteInput(task, key) {
  requestAnimationFrame(() => {
    const k = noteInputKey(task, key);
    const el = [...document.querySelectorAll('.td-review-note-input')].find(n => n.dataset.key === k);
    if (el) el.focus();
  });
}

/**
 * A note input row (text + kind select). Enter saves. `key` names the input so focus can
 * return to it after `onChange` re-renders.
 */
export function reviewNoteAddRow(task, { check, key, placeholder, label, onChange }) {
  const row = make('div', 'td-review-note-add');
  const input = make('input', 'td-review-note-input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  input.dataset.key = noteInputKey(task, key);
  const kind = make('select', 'td-review-note-kind');
  kind.setAttribute('aria-label', 'Note kind');
  for (const k of NOTE_KINDS) {
    const opt = make('option', null, cap(k));
    opt.value = k;
    kind.appendChild(opt);
  }

  // Images waiting to be saved with the note. Kept per input so a re-render (another note saved)
  // doesn't drop them; not drafted to disk, so a page refresh does.
  const stagedKey = noteInputKey(task, key);
  const staged = stagedImages.get(stagedKey) || [];
  stagedImages.set(stagedKey, staged);
  const thumbs = make('div', 'td-note-thumbs td-note-thumbs-staged');
  const renderStaged = () => {
    thumbs.textContent = '';
    thumbs.hidden = staged.length === 0;
    staged.forEach((item, i) => thumbs.appendChild(buildThumb(item.url, `Staged image ${i + 1}`, () => {
      URL.revokeObjectURL(item.url);
      staged.splice(i, 1);
      renderStaged();
    })));
  };
  const stage = (files) => {
    for (const f of acceptImageFiles(files)) staged.push({ file: f, url: URL.createObjectURL(f) });
    renderStaged();
  };
  renderStaged();

  const picker = make('input');
  picker.type = 'file';
  picker.accept = 'image/*';
  picker.multiple = true;
  picker.hidden = true;
  picker.tabIndex = -1;
  picker.setAttribute('aria-hidden', 'true');
  picker.addEventListener('change', () => { stage(Array.from(picker.files || [])); picker.value = ''; });
  const imageBtn = make('button', 'td-review-note-image-btn', 'Image');
  imageBtn.type = 'button';
  imageBtn.title = 'Attach a screenshot to this note (or paste one into the note box)';
  imageBtn.setAttribute('aria-label', `${label}: add image`);
  imageBtn.addEventListener('click', () => picker.click());

  input.addEventListener('paste', (e) => {
    const files = pastedImageFiles(e);
    if (!files.length) return; // plain text paste continues as normal
    e.preventDefault();
    stage(files);
  });
  // Draft: restore what was typed before a re-render or refresh.
  ensureDocListeners();
  const draftKey = DRAFT_PREFIX + stagedKey;
  const hint = make('span', 'td-review-note-draft-hint', 'unsaved');
  hint.title = 'Typed but not saved yet. Press Enter, or click away, to save it as a note';
  const syncHint = () => { hint.hidden = !input.value.trim(); };
  const stored = readDraft(draftKey);
  if (stored) {
    input.value = stored.text;
    if (stored.kind) kind.value = stored.kind;
  }
  syncHint();
  input.addEventListener('input', () => { writeDraft(draftKey, input.value, kind.value); syncHint(); });
  kind.addEventListener('change', () => writeDraft(draftKey, input.value, kind.value));
  const remember = () => { focusState = { key: stagedKey, start: input.selectionStart, end: input.selectionEnd }; };
  input.addEventListener('focus', remember);
  for (const ev of ['keyup', 'click', 'input']) input.addEventListener(ev, remember);
  if (focusState && focusState.key === stagedKey) {
    const want = focusState;
    requestAnimationFrame(() => {
      if (!input.isConnected || (document.activeElement && document.activeElement !== document.body && document.activeElement !== input)) return;
      input.focus();
      try { input.setSelectionRange(want.start ?? input.value.length, want.end ?? input.value.length); } catch { /* not text */ }
    });
  }

  const save = async ({ refocus }) => {
    const text = input.value.trim();
    if (savingKeys.has(stagedKey) || (!text && !staged.length)) return;
    savingKeys.add(stagedKey);
    try {
      const images = [];
      for (const item of staged) images.push(await uploadNoteImage(task, item.file));
      addReviewNote(task, { text, kind: kind.value, check, images });
      staged.forEach(item => URL.revokeObjectURL(item.url));
      stagedImages.delete(stagedKey);
      lsDo(ls => ls.removeItem(draftKey));
      input.value = '';
      syncHint();
      onChange?.(task);
      if (refocus) focusNoteInput(task, key);
    } catch (err) {
      showStatus(`Could not add note: ${err.message}`);
    } finally {
      savingKeys.delete(stagedKey);
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    save({ refocus: true });
  });
  // Clicking or tabbing away saves what was typed. Not when focus only moves within this row
  // (the kind select, the Image button), and not while the mouse is down, so the click that
  // caused the blur (a Pass tick) lands before the re-render.
  input.addEventListener('blur', (e) => {
    if (!input.isConnected) return; // removed by a re-render: the draft is already stored
    if (e.relatedTarget && row.contains(e.relatedTarget)) return;
    if (focusState && focusState.key === stagedKey) focusState = null;
    const attempt = () => setTimeout(() => {
      if (mouseDown) { document.addEventListener('mouseup', attempt, { once: true, capture: true }); return; }
      if (document.activeElement === input || !input.value.trim()) return;
      save({ refocus: false });
    }, 0);
    attempt();
  });
  row.appendChild(input);
  row.appendChild(hint);
  row.appendChild(kind);
  row.appendChild(imageBtn);
  row.appendChild(picker);
  row.appendChild(thumbs);
  return row;
}

const stagedImages = new Map();
const savingKeys = new Set();

/**
 * The note's area as a small chip that turns into a select on click.
 * `area` = { current: slug|null, options: [slug] }.
 */
function areaControl(task, note, area, onChange) {
  const wrap = make('span', 'rn-area');
  const show = () => {
    wrap.textContent = '';
    const chip = make('button', 'rn-area-chip', area.current ? laneDisplayName(area.current) : 'No area');
    chip.type = 'button';
    chip.title = 'Which area this note files into. Click to change';
    chip.setAttribute('aria-label', `Area of this note: ${area.current ? laneDisplayName(area.current) : 'none'}. Change`);
    chip.addEventListener('click', edit);
    wrap.appendChild(chip);
  };
  const edit = () => {
    wrap.textContent = '';
    const sel = make('select', 'rn-area-select');
    sel.setAttribute('aria-label', 'Area of this note');
    const none = make('option', null, 'No area');
    none.value = '';
    sel.appendChild(none);
    for (const slug of area.options) {
      const opt = make('option', null, laneDisplayName(slug));
      opt.value = slug;
      sel.appendChild(opt);
    }
    sel.value = area.current || '';
    sel.addEventListener('change', () => {
      if (sel.value) note.area = sel.value; else delete note.area;
      onChange?.(task);
    });
    sel.addEventListener('blur', show);
    wrap.appendChild(sel);
    sel.focus();
  };
  show();
  return wrap;
}

/** One unsent note: kind chip, optional area chip, text, and a dismiss button. */
function noteKindSelect(task, note, onChange) {
  const sel = make('select', `td-note-kind td-note-kind-select kind-${note.kind}`);
  sel.setAttribute('aria-label', 'Change note kind');
  sel.title = 'Change note kind';
  for (const k of NOTE_KINDS) {
    const opt = make('option', null, cap(k));
    opt.value = k;
    sel.appendChild(opt);
  }
  sel.value = note.kind;
  sel.addEventListener('change', () => {
    editReviewNote(task, note.n, { kind: sel.value });
    onChange?.(task);
  });
  return sel;
}

/** The note's text as a button; clicking swaps in an input. Enter or leaving saves, Esc cancels. */
function noteTextButton(task, note, onChange) {
  const btn = make('button', 'td-review-note-text td-review-note-edit', note.text || '(image only)');
  btn.type = 'button';
  btn.title = 'Click to edit';
  btn.setAttribute('aria-label', `Edit note: ${note.text || 'image only'}`);
  btn.addEventListener('click', () => {
    const input = make('input', 'td-review-note-input td-review-note-edit-input');
    input.type = 'text';
    input.value = note.text;
    input.setAttribute('aria-label', 'Edit note text');
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save && input.value.trim() !== note.text) {
        try {
          editReviewNote(task, note.n, { text: input.value });
          onChange?.(task);
          return;
        } catch (err) {
          showStatus(`Could not edit note: ${err.message}`);
        }
      }
      input.replaceWith(btn);
      if (!save) btn.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    btn.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  return btn;
}

export function reviewNoteRow(task, note, { onChange, area } = {}) {
  const row = make('div', 'td-review-note');
  row.appendChild(noteKindSelect(task, note, onChange));
  if (area) row.appendChild(areaControl(task, note, area, onChange));
  row.appendChild(noteTextButton(task, note, onChange));
  const x = make('button', 'td-review-note-dismiss', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Dismiss note');
  x.addEventListener('click', () => {
    setNoteState(task, note.n, 'dismissed');
    onChange?.(task);
  });
  row.appendChild(x);
  if (note.images?.length) {
    const thumbs = make('div', 'td-note-thumbs');
    note.images.forEach((rel, i) => thumbs.appendChild(buildThumb(noteImageUrl(rel), `Note image ${i + 1}`)));
    row.appendChild(thumbs);
  }
  return row;
}
