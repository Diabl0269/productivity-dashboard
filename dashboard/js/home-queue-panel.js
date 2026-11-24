// home-queue-panel.js — the Overview's queue panels (PRO152): one card per `queues` entry of the project's home
// config, listing the first items of a markdown file. Reorder by dragging or with Alt+Up / Alt+Down on a row,
// Enter opens a row's fields for editing, Drop (or Delete) removes an item and offers Undo. The server owns the
// file (server/home/queue-route.js); this file only paints, keeps focus where it was and sends the changes.
// No queues in the config: no card at all. The card is the Overview's card (makeCard), so it looks like its siblings.

import { el, makeCard, reveal, tick } from './home-overview-cards.js';
import { fetchQueue, putQueue, moveTarget, reordered, sameItems, plainError, droppedText } from './home-queue-data.js';
import { syncItems, openEditor, closeEditor, flashSaved } from './home-queue-rows.js';
import { enableDrag } from './home-queue-drag.js';

const REFRESH_MS = 30e3;
const UNDO_MS = 10e3;

function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

function buildPanel(queue, project) {
  const c = makeCard({ id: `queue-${queue.id}`, title: queue.title, follow: () => c.list.querySelector('.hm-q-row:not(.hm-q-leaving)')?.focus(), label: `${queue.title}: go to the first item` });
  const p = {
    ...c, queue, project, items: [], rows: new Map(), etag: null, loadedAt: 0, loading: false, pending: 0, chain: Promise.resolve(),
    broken: false, sticky: '', latest: null, editing: null, undo: null, undoTimer: 0, tabId: null, dead: false,
  };
  p.card.classList.add('hm-q-card');
  p.btn.dataset.hmKey = `q-head-${queue.id}`;
  const list = el('ul', 'hm-q-list');
  list.setAttribute('aria-label', queue.title);
  c.list.replaceWith(list);
  p.list = list;
  p.error = el('p', 'hm-q-error');
  p.error.setAttribute('role', 'alert');
  p.error.hidden = true;
  p.warn = el('ul', 'hm-q-warn');
  p.warn.setAttribute('aria-label', 'Problems found by the check');
  p.warn.hidden = true;
  p.toast = el('div', 'hm-q-toast');
  p.toast.setAttribute('role', 'status');
  p.toast.hidden = true;
  p.toastText = el('span', 'hm-q-toast-text');
  p.undoBtn = el('button', 'hm-q-undo', 'Undo');
  p.undoBtn.type = 'button';
  p.undoBtn.addEventListener('click', () => undo(p));
  p.toast.append(p.toastText, p.undoBtn);
  p.card.insertBefore(p.error, list);
  p.card.insertBefore(p.warn, list);
  p.card.insertBefore(list, p.more);
  p.card.append(p.toast);
  setText(p.empty, 'Loading...');
  reveal(p.empty, true);
  p.act = { drop: id => drop(p, id), toggle: id => toggle(p, id) };
  p.offDrag = enableDrag(list, (id, to) => move(p, id, to));
  list.addEventListener('keydown', e => rowKeys(p, e));
  p.card.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && p.undo && !e.target.closest?.('input')) { e.preventDefault(); undo(p); }
  });
  return p;
}

// ===== painting =====

function render(p, out) {
  p.etag = out.etag;
  p.loadedAt = Date.now();
  tick(p.count, out.total || 0);
  const shown = out.items.length;
  setText(p.sub, [out.total > shown ? `first ${shown}` : '', out.hidden ? `${out.hidden} hidden` : ''].filter(Boolean).join(', '));
  showError(p, out.error || p.sticky || '');
  const warnKey = out.violations.join('\n');
  if (p.warnKey !== warnKey) {
    p.warnKey = warnKey;
    p.warn.textContent = '';
    for (const v of out.violations) p.warn.appendChild(el('li', 'hm-q-warn-line', v));
  }
  reveal(p.warn, out.violations.length > 0);
  setText(p.empty, out.error ? '' : 'Nothing in this queue.');
  reveal(p.empty, !out.error && out.total === 0);
  setItems(p, out.items);
}

function setItems(p, items) {
  const active = document.activeElement;
  const had = active && p.list.contains(active) ? active.closest('.hm-q-row')?.dataset.id : null;
  if (!sameItems(p.items, items) || p.items.length !== p.rows.size) {
    p.items = items.map(i => ({ ...i, fields: i.fields.map(f => ({ ...f })) }));
    syncItems(p.list, p.rows, p.items, p.act);
  }
  if (p.tabId === null || !p.rows.has(p.tabId)) p.tabId = p.items[0]?.id ?? null;
  for (const [id, li] of p.rows) li.tabIndex = id === p.tabId ? 0 : -1;
  if (had && p.rows.has(had) && document.activeElement !== p.rows.get(had) && !p.rows.get(had).contains(document.activeElement)) p.rows.get(had).focus({ preventScroll: true });
}

function showError(p, text) {
  if (text) setText(p.error, text);
  reveal(p.error, !!text);
}

// ===== loading and writing =====

export async function load(p) {
  if (p.loading || p.pending || p.dead) return;
  p.loading = true;
  try {
    const out = await fetchQueue(p.project, p.queue.id);
    if (p.dead || p.pending) return;
    render(p, out);
  } catch (e) {
    if (!p.dead) { showError(p, plainError(e)); setText(p.empty, ''); reveal(p.empty, false); }
  } finally {
    p.loading = false;
    p.loadedAt = Date.now();
  }
}

/** Send one change after the ones before it (each needs the etag the last answer gave). */
function send(p, body, { onOk } = {}) {
  p.pending += 1;
  p.sticky = '';
  p.chain = p.chain.then(async () => {
    try {
      if (p.broken) return;
      const out = await putQueue(p.project, { id: p.queue.id, etag: p.etag, ...body });
      p.etag = out.etag;
      p.latest = out;
      onOk?.(out);
    } catch (e) {
      p.broken = true;
      p.sticky = plainError(e); // stays on the panel through the refresh that follows, until the next change
      showError(p, p.sticky);
    } finally {
      p.pending -= 1;
      if (p.pending === 0) settle(p);
    }
  });
  return p.chain;
}

function settle(p) {
  const broken = p.broken;
  p.broken = false;
  const out = p.latest;
  p.latest = null;
  if (broken) { p.loadedAt = 0; load(p).then(() => {}); return; }
  if (out) render(p, out);
}

// ===== operations =====

function move(p, id, to) {
  const from = p.items.findIndex(i => i.id === id);
  if (from < 0 || to === from) return;
  const next = reordered(p.items, from, to);
  setItems(p, next);
  send(p, { op: 'move', itemId: id, to });
}

function drop(p, id) {
  const idx = p.items.findIndex(i => i.id === id);
  if (idx < 0) return;
  const item = p.items[idx];
  if (p.editing === id) p.editing = null;
  const li = p.rows.get(id);
  const hadFocus = li?.contains(document.activeElement);
  setItems(p, p.items.filter(i => i.id !== id));
  if (hadFocus) {
    const next = p.items[idx] || p.items[idx - 1];
    (next ? p.rows.get(next.id) : p.btn)?.focus({ preventScroll: true });
    if (next) p.tabId = next.id;
  }
  send(p, { op: 'drop', itemId: id }, { onOk: out => showUndo(p, droppedText(item.title, p.queue.dropAs), out.undo, idx) });
}

function undo(p) {
  const u = p.undo;
  if (!u) return;
  hideUndo(p);
  send(p, { op: 'undo', token: u.token }, { onOk: () => { p.tabId = null; } }).then(() => {
    const row = p.list.querySelectorAll('.hm-q-row:not(.hm-q-leaving)')[u.index];
    row?.focus({ preventScroll: true });
  });
}

function showUndo(p, text, token, index) {
  clearTimeout(p.undoTimer);
  if (!token) return;
  p.undo = { token, index };
  setText(p.toastText, text);
  reveal(p.toast, true);
  p.undoTimer = setTimeout(() => hideUndo(p), UNDO_MS);
}

function hideUndo(p) {
  clearTimeout(p.undoTimer);
  p.undo = null;
  if (p.toast.contains(document.activeElement)) p.list.querySelector('.hm-q-row:not(.hm-q-leaving)')?.focus({ preventScroll: true });
  reveal(p.toast, false);
}

function save(p, id, key, value, input) {
  send(p, { op: 'edit', itemId: id, key, value }, {
    onOk: (out) => {
      const li = p.rows.get(id);
      if (out.itemId && out.itemId !== id && li) { // a new title is a new item id: the row follows it
        p.rows.delete(id);
        p.rows.set(out.itemId, li);
        li.dataset.id = out.itemId;
        if (p.editing === id) p.editing = out.itemId;
        if (p.tabId === id) p.tabId = out.itemId;
        p.items = p.items.map(i => (i.id === id ? { ...i, id: out.itemId } : i));
      }
      flashSaved(input);
    },
  });
}

function toggle(p, id) {
  const li = p.rows.get(id);
  if (!li) return;
  if (li._parts.editor) { close(p, id); return; }
  if (p.editing && p.rows.has(p.editing)) closeEditor(p.rows.get(p.editing));
  p.editing = id;
  p.tabId = id;
  for (const [rid, r] of p.rows) r.tabIndex = rid === id ? 0 : -1;
  const item = p.items.find(i => i.id === id);
  openEditor(li, item, { save: (key, value, input) => save(p, li.dataset.id, key, value, input), close: () => close(p, li.dataset.id) });
}

function close(p, id) {
  const li = p.rows.get(id);
  if (!li) return;
  p.editing = null;
  closeEditor(li);
  li.focus({ preventScroll: true });
}

// ===== keys on a row =====

function rowKeys(p, e) {
  const li = e.target.closest?.('.hm-q-row');
  if (!li || e.target.closest('input')) return;
  const id = li.dataset.id;
  const onRow = e.target === li;
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    e.stopPropagation();
    const to = moveTarget(p.items, id, e.key === 'ArrowUp' ? -1 : 1, p.queue.show);
    if (to !== null) { move(p, id, to); li.focus({ preventScroll: true }); li.scrollIntoView?.({ block: 'nearest' }); }
    return;
  }
  if (e.altKey || e.metaKey || e.ctrlKey) return;
  if (onRow && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); toggle(p, id); return; }
  if (onRow && e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); drop(p, id); return; }
  if (e.key === 'Escape' && li._parts.editor) { e.preventDefault(); e.stopPropagation(); close(p, id); return; }
  if (onRow && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
    const rows = [...p.list.querySelectorAll('.hm-q-row:not(.hm-q-leaving)')];
    const i = rows.indexOf(li);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    e.preventDefault();
    e.stopPropagation();
    p.tabId = rows[j].dataset.id;
    for (const [rid, r] of p.rows) r.tabIndex = rid === p.tabId ? 0 : -1;
    rows[j].focus();
    rows[j].scrollIntoView?.({ block: 'nearest' });
  }
}

// ===== the set of panels of one Overview =====

/**
 * Mount the queue panels into the Overview grid, each card before `before`. `sync(queues, project)` follows the
 * config: panels appear, go and refresh (every 30 s at most). Returns { sync, dispose }.
 */
export function mountQueues(grid, before) {
  const panels = new Map(); // `${project}|${id}` -> panel
  return {
    sync(queues, project) {
      const keys = new Set(queues.map(q => `${project}|${q.id}`));
      for (const [key, p] of [...panels]) {
        if (keys.has(key) && JSON.stringify(p.queue) === JSON.stringify(queues.find(q => `${project}|${q.id}` === key))) continue;
        panels.delete(key);
        destroy(p);
      }
      for (const q of queues) {
        const key = `${project}|${q.id}`;
        let p = panels.get(key);
        if (!p) {
          p = buildPanel(q, project);
          panels.set(key, p);
          grid.insertBefore(p.card, before);
        }
        if (!p.editing && Date.now() - p.loadedAt > REFRESH_MS) load(p);
      }
    },
    dispose() { for (const p of panels.values()) destroy(p); panels.clear(); },
  };
}

function destroy(p) {
  p.dead = true;
  p.offDrag();
  clearTimeout(p.undoTimer);
  p.card.remove();
}
