// task-undo.js — Soft-delete with toast Undo (~7s)

import { markChanged } from './tasks-io.js';
import { showStatusAction } from './state.js';

let getState = null;
let getRenderTasks = null;

/** @type {{ tasks: {task:any, sectionId:string, index:number}[], timer:any } | null} */
let pending = null;

export function setUndoCallbacks({ stateFn, renderFn }) {
  getState = stateFn;
  getRenderTasks = renderFn;
}

const UNDO_MS = 7000;

/**
 * Soft-delete one or more tasks; show Undo toast.
 * Permanent after UNDO_MS if not undone.
 */
export function softDeleteTasks(tasks) {
  if (!tasks || tasks.length === 0 || !getState) return;
  const state = getState();
  const { sections, tasks: bySection } = state;

  // Cancel prior pending delete (commit it)
  commitPending();

  const snapshots = [];
  for (const task of tasks) {
    for (const section of sections) {
      const list = bySection[section.id] || [];
      const idx = list.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        const [removed] = list.splice(idx, 1);
        snapshots.push({ task: removed, sectionId: section.id, index: idx });
        break;
      }
    }
  }

  if (snapshots.length === 0) return;

  pending = { tasks: snapshots, timer: null };
  markChanged();
  getRenderTasks && getRenderTasks()();

  const label = snapshots.length === 1
    ? `Deleted "${snapshots[0].task.title}"`
    : `Deleted ${snapshots.length} tasks`;

  pending.timer = setTimeout(() => {
    pending = null;
  }, UNDO_MS);

  showStatusAction(label, {
    actionLabel: 'Undo',
    durationMs: UNDO_MS,
    onAction: () => undoDelete(),
  });
}

export function softDeleteTask(task) {
  softDeleteTasks([task]);
}

function undoDelete() {
  if (!pending || !getState) return;
  clearTimeout(pending.timer);
  const state = getState();
  // Restore in reverse order so indices stay valid
  for (const snap of [...pending.tasks].reverse()) {
    if (!state.tasks[snap.sectionId]) state.tasks[snap.sectionId] = [];
    const list = state.tasks[snap.sectionId];
    const idx = Math.min(snap.index, list.length);
    snap.task.section = snap.sectionId;
    list.splice(idx, 0, snap.task);
  }
  pending = null;
  markChanged();
  getRenderTasks && getRenderTasks()();
  showStatusAction('Restored', { durationMs: 2000 });
}

function commitPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
}
