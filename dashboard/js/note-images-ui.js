// note-images-ui.js — image upload, thumbnails and paste/pick staging shared by ticket notes
// (task-detail.js) and review notes (review-notes-ui.js). Files live on disk via /api/note-image.

import { showStatus } from './state.js';

export const NOTE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Upload one image for the ticket; resolves to the stored path `<ticketId>/<file>`. */
export async function uploadNoteImage(task, file) {
  const ticketId = task.taskId;
  if (!ticketId) throw new Error('this ticket has no id yet');
  const dataBase64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('could not read the image'));
    r.readAsDataURL(file);
  });
  const res = await fetch('/api/note-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId, filename: file.name || '', dataBase64 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.path) throw new Error(data.error || 'upload failed (' + res.status + ')');
  return data.path;
}

/** Thumbnail with an optional remove (x) button. */
export function buildThumb(src, label, onRemove) {
  const box = document.createElement('div');
  box.className = 'td-note-thumb';
  const img = document.createElement('img');
  img.src = src;
  img.alt = label;
  if (onRemove) {
    box.appendChild(img);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'td-note-thumb-remove';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Remove ' + label.toLowerCase());
    x.title = 'Remove image';
    x.addEventListener('click', onRemove);
    box.appendChild(x);
  } else {
    const a = document.createElement('a');
    a.href = src;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Open full size in a new tab';
    a.setAttribute('aria-label', 'Open ' + label.toLowerCase() + ' full size');
    a.appendChild(img);
    box.appendChild(a);
  }
  return box;
}

export function noteImageUrl(rel) {
  return '/attachments/' + rel.split('/').map(encodeURIComponent).join('/');
}

/** Keep png/jpg/webp/gif files under the size cap; says why it dropped one. */
export function acceptImageFiles(files) {
  const ok = [];
  for (const f of files) {
    if (!f || !/^image\/(png|jpeg|webp|gif)$/.test(f.type)) {
      showStatus('Only png, jpg, webp or gif images can be added');
      continue;
    }
    if (f.size > NOTE_IMAGE_MAX_BYTES) { showStatus('Image is larger than 8 MB'); continue; }
    ok.push(f);
  }
  return ok;
}

/** Image files on a paste event, or [] for a plain text paste. */
export function pastedImageFiles(e) {
  const items = Array.from(e.clipboardData?.items || []).filter(it => it.kind === 'file' && it.type.startsWith('image/'));
  return items.map(it => it.getAsFile()).filter(Boolean);
}
