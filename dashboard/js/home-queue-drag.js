// home-queue-drag.js — drag a queue row to a new place with the pointer (PRO152). The other rows slide aside to
// make room while you drag; on release the panel is told the new index and does the move. A click without
// movement is left alone (it opens the row). Touch starts a drag from the grip only, so the page still scrolls.

import { dropIndex } from './home-queue-data.js';

const THRESHOLD = 4;

/** `list` is the ul; `onDrop(id, to)` is called after a drag that changed the place. Returns an off function. */
export function enableDrag(list, onDrop) {
  let drag = null;

  const rowsOf = () => [...list.children].filter(li => li.classList.contains('hm-q-row') && !li.classList.contains('hm-q-leaving'));

  function begin(e, li) {
    const rows = rowsOf();
    const rects = rows.map(r => r.getBoundingClientRect());
    drag = { li, rows, from: rows.indexOf(li), mids: rects.map(r => r.top + r.height / 2), h: rects[rows.indexOf(li)].height, y0: e.clientY, moved: false, to: rows.indexOf(li) };
  }

  function onDown(e) {
    if (e.button !== 0 || e.target.closest('button, input, .hm-q-editor')) return;
    const li = e.target.closest('.hm-q-row');
    if (!li || li.classList.contains('hm-q-leaving')) return;
    if (e.pointerType === 'touch' && !e.target.closest('.hm-q-grip')) return;
    begin(e, li);
    li.setPointerCapture?.(e.pointerId);
  }

  function onMove(e) {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dy) < THRESHOLD) return;
      drag.moved = true;
      drag.li.classList.add('hm-q-dragging');
      list.classList.add('hm-q-sorting');
    }
    e.preventDefault();
    drag.li.style.transform = `translateY(${dy}px)`;
    drag.to = dropIndex(drag.mids, drag.mids[drag.from] + dy, drag.from);
    drag.rows.forEach((r, i) => {
      if (r === drag.li) return;
      const shift = drag.from < drag.to && i > drag.from && i <= drag.to ? -drag.h : drag.from > drag.to && i >= drag.to && i < drag.from ? drag.h : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function end(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    const was = d.moved;
    list.classList.remove('hm-q-sorting');
    d.li.classList.remove('hm-q-dragging');
    for (const r of d.rows) { r.style.transition = 'none'; r.style.transform = ''; }
    void list.offsetHeight; // the rows are back in their layout places before the panel measures them
    for (const r of d.rows) r.style.transition = '';
    if (was) {
      d.li.dataset.dragged = 'true';
      setTimeout(() => { delete d.li.dataset.dragged; }, 0); // swallows the click that ends the drag
      if (commit && d.to !== d.from) onDrop(d.li.dataset.id, d.to);
    }
  }

  const up = () => end(true);
  const cancel = () => end(false);
  const key = (e) => { if (e.key === 'Escape' && drag?.moved) { e.stopPropagation(); cancel(); } };
  list.addEventListener('pointerdown', onDown);
  list.addEventListener('pointermove', onMove);
  list.addEventListener('pointerup', up);
  list.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', key, true);
  list.addEventListener('click', (e) => { if (e.target.closest('.hm-q-row')?.dataset.dragged) { e.stopPropagation(); e.preventDefault(); } }, true);
  list.addEventListener('dragstart', e => e.preventDefault());
  return () => {
    list.removeEventListener('pointerdown', onDown);
    list.removeEventListener('pointermove', onMove);
    list.removeEventListener('pointerup', up);
    list.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key, true);
  };
}
