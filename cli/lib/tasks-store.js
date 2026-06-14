/**
 * cli/lib/tasks-store.js
 * CRUD operations for tasks.json.
 *
 * Exports:
 *   load(): doc
 *   save(doc): void
 *   nextId(doc): string
 *   findTask(doc, id): {task, section} | null
 *   findAll(doc, id): [{task, section}]
 *   sectionById(doc, id): {id,name,tasks} | undefined
 *   flatTasks(doc, {active}={}): [{...task, section}]
 *   todayStr(): string  — 'YYYY-MM-DD'
 */

import { readJson, tasksJsonPath, atomicWrite } from './io.js';
import { validateTasksDoc } from './schema.js';

/**
 * Load tasks.json, validate, and return the document.
 * Throws if file is missing, invalid JSON, or fails schema validation.
 */
export function load() {
  const doc = readJson(tasksJsonPath());
  const result = validateTasksDoc(doc);
  if (!result.valid) {
    throw new Error(`tasks.json validation failed:\n${result.errors.join('\n')}`);
  }
  return doc;
}

/**
 * Validate and atomically save doc to tasks.json.
 * Throws if validation fails.
 * Pretty-printed with 2-space indent (human/dashboard-facing).
 */
export function save(doc) {
  const result = validateTasksDoc(doc);
  if (!result.valid) {
    throw new Error(`tasks.json validation failed:\n${result.errors.join('\n')}`);
  }
  atomicWrite(tasksJsonPath(), JSON.stringify(doc, null, 2) + '\n');
}

/**
 * Return the next available task ID string ('T1' if none exist).
 * Scans all tasks across all sections for the max numeric id.
 */
export function nextId(doc) {
  let max = 0;
  for (const section of doc.sections) {
    for (const task of section.tasks) {
      const n = parseInt(task.id.slice(1), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return `T${max + 1}`;
}

/**
 * Find a task by id across all sections.
 * Returns {task, section} or null.
 */
export function findTask(doc, id) {
  for (const section of doc.sections) {
    for (const task of section.tasks) {
      if (task.id === id) return { task, section };
    }
  }
  return null;
}

/**
 * Find all occurrences of a task id (for duplicate detection).
 * Returns array of {task, section}.
 */
export function findAll(doc, id) {
  const results = [];
  for (const section of doc.sections) {
    for (const task of section.tasks) {
      if (task.id === id) results.push({ task, section });
    }
  }
  return results;
}

/**
 * Get a section by its id.
 * Returns the section object or undefined.
 */
export function sectionById(doc, id) {
  return doc.sections.find(s => s.id === id);
}

/**
 * Return a flat array of all tasks with their section id attached.
 * Options:
 *   active: true — exclude tasks in 'archive' or 'done', and fully-checked tasks.
 * Preserves section order, then task order within each section.
 */
export function flatTasks(doc, { active } = {}) {
  const result = [];
  for (const section of doc.sections) {
    if (active && (section.id === 'archive' || section.id === 'done')) continue;
    for (const task of section.tasks) {
      if (active && task.checked) continue;
      result.push({ ...task, section: section.id });
    }
  }
  return result;
}

/**
 * Returns today's date as 'YYYY-MM-DD'.
 */
export function todayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
