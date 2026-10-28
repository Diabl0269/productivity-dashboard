/**
 * shared/subtasks.js — subtask helpers shared by the CLI and the dashboard (pure: no fs, no DOM).
 *
 *   openSubtasks(task)          the unchecked subtasks, numbered (T191: done/review refuse them)
 *   openSubtasksMessage(...)    the refusal / confirm text listing them
 *   splitSubtask(task, n, ...)  take subtask N off a ticket and return the fields of its new task (T192)
 *   promoteSubtask(doc, ...)    CLI-shaped document version: allocates the id and files it in `todo`
 *
 * The dashboard has no HTTP API for tasks (it saves the whole file), so these functions are the
 * "API": the dashboard calls splitSubtask on its in-memory state, the CLI calls promoteSubtask.
 */

import { nextTaskId, nextTaskIdFromState } from './task-ids.js';
import { epicOf } from './review.js';

/** Unchecked subtasks of a ticket as [{ n (1-based), text }]. */
export function openSubtasks(task) {
  const out = [];
  (task?.subtasks || []).forEach((st, i) => {
    if (st && !st.checked) out.push({ n: i + 1, text: String(st.text || '').trim() });
  });
  return out;
}

/** Text listing the open subtasks. `cli` adds the --promote-subtask / --force hints. */
export function openSubtasksMessage(id, task, { cli = false } = {}) {
  const open = openSubtasks(task);
  const lines = open.map(o => `  ${o.n}. ${o.text || '(empty)'}`);
  const head = `${id} has ${open.length} open subtask${open.length === 1 ? '' : 's'}:`;
  if (!cli) return `${open.length} subtask${open.length === 1 ? ' is' : 's are'} still open:\n${lines.join('\n')}\n\nMark done anyway?`;
  return [
    head,
    ...lines,
    `Split them into tasks with: ch tasks update ${id} --promote-subtask N`,
    'or finish them, or pass --force to close anyway.',
  ].join('\n');
}

/**
 * Take subtask `n` (1-based) off `task` and return the fields of the task it becomes.
 * The caller adds what its own task shape needs (id, section, history, ...).
 *
 * The new task inherits project, labels and priority, links back with a
 * "Split from <ticketId>" line in its description (reviewOf means "opened while reviewing",
 * so it is the wrong field), and gets `parentId` as given (null = standalone).
 * Throws on a bad N or an empty subtask text.
 */
export function splitSubtask(task, n, { ticketId, parentId = null } = {}) {
  const subtasks = Array.isArray(task?.subtasks) ? task.subtasks : [];
  if (!Number.isInteger(n) || n < 1 || n > subtasks.length) {
    throw new Error(`subtask N must be between 1 and ${subtasks.length}`);
  }
  const title = String(subtasks[n - 1].text || '').trim();
  if (!title) throw new Error(`subtask ${n} has no text to use as a title`);
  subtasks.splice(n - 1, 1);
  const fields = {
    title,
    priority: task.priority || 'medium',
    description: `Split from ${ticketId}.`,
    labels: Array.isArray(task.labels) ? [...task.labels] : [],
    parentId: parentId || null,
  };
  if (task.project) fields.project = task.project;
  return fields;
}

/** The epic a promoted subtask lands under by default: the ticket itself when it is an epic, else its epic. */
export function defaultPromoteParent(doc, task) {
  if (task.type === 'epic') return task.id;
  return epicOf(doc, task)?.task.id || null;
}

/**
 * Dashboard-state version (tickets are { taskId, parentId, section, ... } in state.tasks[section]):
 * splits subtask `n` off `task`, files the new ticket at the end of `todo` and returns it.
 * `parent` overrides the default parent (the ticket itself when it is an epic, else its epic).
 */
export function promoteSubtaskInState(state, task, n, { parent, now = new Date() } = {}) {
  const all = Object.values(state.tasks || {}).flat();
  const byTaskId = new Map(all.map(t => [t.taskId, t]));
  let parentId = parent;
  if (parentId === undefined) {
    parentId = null;
    if (task.type === 'epic') parentId = task.taskId;
    else {
      const seen = new Set([task.taskId]);
      for (let p = byTaskId.get(task.parentId); p && !seen.has(p.taskId); p = byTaskId.get(p.parentId)) {
        seen.add(p.taskId);
        if (p.type === 'epic') { parentId = p.taskId; break; }
      }
    }
  } else if (parentId && !byTaskId.has(parentId)) {
    throw new Error(`parent task ${parentId} not found`);
  }
  const fields = splitSubtask(task, n, { ticketId: task.taskId, parentId });
  if (!state.tasks.todo) state.tasks.todo = [];
  const taskId = nextTaskIdFromState(state, fields.project || null);
  const created = now.toISOString().slice(0, 10);
  const next = {
    id: now.getTime() + Math.random(),
    taskId,
    title: fields.title,
    description: fields.description,
    checked: false,
    subtasks: [],
    section: 'todo',
    created,
    updated: null,
    priority: fields.priority,
    type: 'task',
    parentId: fields.parentId,
    project: fields.project || null,
    labels: fields.labels,
    links: [],
    blockedBy: [],
    notes: [],
    history: [{ at: now.toISOString(), event: 'created', to: 'todo' }],
  };
  state.tasks.todo.push(next);
  return next;
}

function allTasks(doc) {
  return (doc.sections || []).flatMap(s => s.tasks || []);
}

/**
 * CLI-shaped document version of splitSubtask: allocates the id the way `ch tasks add` does
 * (nextTaskId over every ticket, scoped to the project's prefix), builds the new task and files
 * it in `todo`. `parent` overrides the default parent (must name an existing ticket).
 * Returns the new task.
 */
export function promoteSubtask(doc, task, n, { parent, now = new Date() } = {}) {
  const parentId = parent || defaultPromoteParent(doc, task);
  if (parent && !allTasks(doc).some(t => t.id === parent)) {
    throw new Error(`parent task ${parent} not found`);
  }
  const todo = (doc.sections || []).find(s => s.id === 'todo');
  if (!todo) throw new Error('section "todo" not found in document');
  const fields = splitSubtask(task, n, { ticketId: task.id, parentId });
  const id = nextTaskId(allTasks(doc), fields.project || null, doc.meta?.projects || []);
  const created = now.toISOString().slice(0, 10);
  const next = {
    id,
    title: fields.title,
    checked: false,
    priority: fields.priority,
    type: 'task',
    created,
    updated: null,
    subtasks: [],
    checks: [],
    description: fields.description,
    history: [{ at: now.toISOString(), event: 'created', to: 'todo' }],
  };
  if (fields.parentId) next.parentId = fields.parentId;
  if (fields.project) next.project = fields.project;
  if (fields.labels.length) next.labels = fields.labels;
  todo.tasks.push(next);
  task.updated = created;
  return next;
}
