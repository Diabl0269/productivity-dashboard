// task-keyboard.js — Keyboard-first board/list shortcuts (ignored while typing)

import { activeMainTab } from './state.js';
import { openCreateTaskModal, isTaskCreateOpen } from './task-create.js';
import { openTaskDetail, isTaskDetailOpen } from './task-detail.js';
import { moveTask } from './tasks-board.js';
import { softDeleteTask } from './task-undo.js';
import { appendHistory } from './task-fields.js';
import { markChanged } from './tasks-io.js';
import {
  toggleSelect, escapeClearsSelectionOrFilters,
} from './task-selection.js';

let getState = null;
let getRenderTasks = null;
let focusedEphemeralId = null;

export function setKeyboardCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function visibleCards() {
  return [...document.querySelectorAll('#board .task-card:not([style*="display: none"]), #listView .list-item:not([style*="display: none"])')];
}

function findTaskByEphemeralId(id) {
  const state = getState() || {};
  const num = typeof id === 'string' ? parseFloat(id) : id;
  for (const list of Object.values(state.tasks || {})) {
    for (const t of list || []) {
      if (t.id === num || String(t.id) === String(id)) return t;
    }
  }
  return null;
}

function focusCard(card) {
  if (!card) return;
  focusedEphemeralId = card.dataset.id;
  document.querySelectorAll('.task-card.kb-focus, .list-item.kb-focus').forEach(el => {
    el.classList.remove('kb-focus');
  });
  card.classList.add('kb-focus');
  card.focus({ preventScroll: false });
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function currentCard() {
  const cards = visibleCards();
  if (focusedEphemeralId) {
    const found = cards.find(c => c.dataset.id === focusedEphemeralId || c.dataset.taskId === focusedEphemeralId);
    if (found) return found;
  }
  const selected = cards.find(c => c.classList.contains('selected'));
  if (selected) return selected;
  return cards[0] || null;
}

function navigate(delta) {
  const cards = visibleCards();
  if (cards.length === 0) return;
  const cur = currentCard();
  let idx = cur ? cards.indexOf(cur) : -1;
  idx = Math.max(0, Math.min(cards.length - 1, idx + delta));
  focusCard(cards[idx]);
}

function cyclePriority(task, dir = 1) {
  const order = ['low', 'medium', 'high'];
  const cur = task.priority || 'medium';
  const i = order.indexOf(cur);
  const next = order[(i + dir + order.length) % order.length];
  appendHistory(task, { event: 'priority', from: cur, to: next });
  task.priority = next;
  markChanged(task);
  getRenderTasks && getRenderTasks()();
}

function setPriority(task, p) {
  const prev = task.priority || 'medium';
  if (prev === p) return;
  task.priority = p;
  appendHistory(task, { event: 'priority', from: prev, to: p });
  markChanged(task);
  getRenderTasks && getRenderTasks()();
}

function moveAcrossColumns(task, dir) {
  const state = getState() || {};
  const sections = (state.sections || []).filter(s => s.id !== 'archive');
  const idx = sections.findIndex(s => s.id === task.section);
  if (idx < 0) return;
  const next = sections[idx + dir];
  if (!next) return;
  moveTask(task.id, next.id, -1);
}

export function initTaskKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (activeMainTab !== 'tasks') return;
    if (isTypingTarget(e.target)) return;
    if (isTaskDetailOpen() || isTaskCreateOpen()) {
      // Esc handled by modals; don't steal other keys
      return;
    }

    const key = e.key;

    if (key === 'Escape') {
      e.preventDefault();
      escapeClearsSelectionOrFilters();
      focusedEphemeralId = null;
      document.querySelectorAll('.kb-focus').forEach(el => el.classList.remove('kb-focus'));
      return;
    }

    if (key === 'n' || key === 'N') {
      e.preventDefault();
      const state = getState() || {};
      openCreateTaskModal(state.quickAddSection || 'todo');
      return;
    }

    if (key === '?' && e.shiftKey) {
      e.preventDefault();
      const hint = document.getElementById('keyboardHints');
      if (hint) hint.hidden = !hint.hidden;
      return;
    }

    const card = currentCard();
    const task = card ? findTaskByEphemeralId(card.dataset.id) : null;

    if (key === 'j' || key === 'ArrowDown') {
      e.preventDefault();
      navigate(1);
      return;
    }
    if (key === 'k' || key === 'ArrowUp') {
      e.preventDefault();
      navigate(-1);
      return;
    }

    if (!task) return;

    if (key === 'Enter') {
      e.preventDefault();
      openTaskDetail(task);
      return;
    }

    if (key === 'x') {
      e.preventDefault();
      toggleSelect(task, { additive: true });
      return;
    }

    if (key === '1') { e.preventDefault(); setPriority(task, 'low'); return; }
    if (key === '2') { e.preventDefault(); setPriority(task, 'medium'); return; }
    if (key === '3') { e.preventDefault(); setPriority(task, 'high'); return; }

    if (key === 'h' || key === 'ArrowLeft') {
      e.preventDefault();
      moveAcrossColumns(task, -1);
      return;
    }
    if (key === 'l' || key === 'ArrowRight') {
      e.preventDefault();
      moveAcrossColumns(task, 1);
      return;
    }

    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      softDeleteTask(task);
      return;
    }

    if (key === 'p' || key === 'P') {
      e.preventDefault();
      cyclePriority(task, 1);
    }
  });
}
