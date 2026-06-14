// tasks-json.js - Load/serialize tasks.json (JSON format) for the dashboard

/**
 * Load tasks from tasks.json text content.
 *
 * Input format (tasks.json):
 *   { version: 1, sections: [{ id, name, tasks: [{ id, title, note?, checked, priority, created, updated, subtasks }] }] }
 *
 * Output: dashboard in-memory shape:
 *   { sections: [{ id, name }], tasks: { [sectionId]: [taskObj] } }
 *
 * Each taskObj gets:
 *   - id: ephemeral numeric id (Date.now() + Math.random()) — same as parseTaskMarkdown
 *   - taskId: the stable string id from JSON (e.g. "T1")
 *   - section: the sectionId string
 *   - title, note, checked, priority, created, updated, subtasks: from JSON
 */
export function loadTasksJson(text) {
  const data = JSON.parse(text);
  const sections = [];
  const tasks = {};

  for (const sec of (data.sections || [])) {
    sections.push({ id: sec.id, name: sec.name });
    tasks[sec.id] = (sec.tasks || []).map(t => ({
      id: Date.now() + Math.random(),
      taskId: t.id || null,
      title: t.title || '',
      note: t.note || '',
      checked: !!t.checked,
      priority: t.priority || 'medium',
      created: t.created || null,
      updated: t.updated || null,
      subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(st => ({ text: st.text || '', checked: !!st.checked })) : [],
      section: sec.id,
    }));
  }

  return { sections, tasks };
}

/**
 * Serialize the dashboard in-memory shape back to tasks.json text.
 *
 * Output format:
 *   { version: 1, sections: [{ id, name, tasks: [{ id, title, note, checked, priority, created, updated, subtasks }] }] }
 *
 * Drops the ephemeral numeric `id` and the per-task `section` field.
 * Uses `taskId` as the stable `id` in the JSON output.
 */
export function serializeTasksJson(sections, tasks) {
  const out = {
    version: 1,
    sections: sections.map(sec => ({
      id: sec.id,
      name: sec.name,
      tasks: (tasks[sec.id] || []).map(t => ({
        id: t.taskId || null,
        title: t.title,
        note: t.note || undefined,
        checked: !!t.checked,
        priority: t.priority || 'medium',
        created: t.created || null,
        updated: t.updated || null,
        subtasks: (t.subtasks || []).map(st => ({ text: st.text, checked: !!st.checked })),
      })),
    })),
  };
  return JSON.stringify(out, null, 2) + '\n';
}
