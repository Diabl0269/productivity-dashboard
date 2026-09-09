/**
 * Free-text agent model field for tasks (e.g. "claude-sonnet", "gpt-4o").
 */

/** @param {string|null|undefined} value */
export function normalizeModel(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s || null;
}

/** Collect unique model values used across tasks (for autocomplete). */
export function collectModels(tasksBySection) {
  const set = new Set();
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      const m = normalizeModel(t.model);
      if (m) set.add(m);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
