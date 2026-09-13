// task-detail-fields.js — Pure helpers for task detail modal field chrome.

/** @param {{ taskId?: string|null, originalId?: string|null }|null|undefined} task */
export function taskIdDisplayState(task) {
  const taskId = task?.taskId || '';
  return {
    taskId,
    label: taskId || '\u2014',
    placeholder: taskId ? '' : '\u2014',
    size: Math.max(3, Math.min(18, taskId.length || 1)),
    title: task?.originalId && task.originalId !== taskId
      ? `Original ID: ${task.originalId} — click to rename`
      : taskId
        ? `${taskId} — click to rename`
        : 'No ticket ID',
  };
}

/**
 * Ensure the current parent stays selectable even when type rules exclude it.
 * @param {object[]} candidates
 * @param {{ parentId?: string|null, taskId?: string|null }|null|undefined} task
 * @param {(parentId: string) => (object|null|undefined)} resolveTask
 */
export function buildParentPickerCandidates(candidates, task, resolveTask) {
  const list = [...(candidates || [])];
  const parentId = task?.parentId || null;
  if (!parentId || list.some(p => p.taskId === parentId)) return list;
  const orphan = resolveTask(parentId);
  if (orphan) list.unshift(orphan);
  return list;
}
