// review-notes-ui.js — review-note rows shared by the ticket panel (task-detail.js) and the
// Plan's review cards (run-plan-view.js). Tasks are dashboard-shaped (taskId, reviewNotes).
// Builders mutate the task's notes, then call `onChange(task)` so the caller can save and re-render.

import { NOTE_KINDS, addReviewNote, setNoteState } from '../../shared/review-notes.js';
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
  let saving = false;
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = input.value.trim();
    if (saving || (!text && !staged.length)) return;
    saving = true;
    try {
      const images = [];
      for (const item of staged) images.push(await uploadNoteImage(task, item.file));
      addReviewNote(task, { text, kind: kind.value, check, images });
      staged.forEach(item => URL.revokeObjectURL(item.url));
      stagedImages.delete(stagedKey);
      onChange?.(task);
      focusNoteInput(task, key);
    } catch (err) {
      showStatus(`Could not add note: ${err.message}`);
      saving = false;
    }
  });
  row.appendChild(input);
  row.appendChild(kind);
  row.appendChild(imageBtn);
  row.appendChild(picker);
  row.appendChild(thumbs);
  return row;
}

const stagedImages = new Map();

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
export function reviewNoteRow(task, note, { onChange, area } = {}) {
  const row = make('div', 'td-review-note');
  row.appendChild(make('span', `td-note-kind kind-${note.kind}`, cap(note.kind)));
  if (area) row.appendChild(areaControl(task, note, area, onChange));
  row.appendChild(make('span', 'td-review-note-text', note.text));
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
