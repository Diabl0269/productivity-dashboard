/**
 * cli/lib/schema.js
 * Schema definitions and validation for tasks.json documents.
 *
 * Exports:
 *   SECTIONS: [{id, name}]
 *   SECTION_IDS: string[]
 *   PRIORITIES: string[]
 *   isSectionId(id): boolean
 *   isPriority(p): boolean
 *   validateTasksDoc(doc): {valid: boolean, errors: string[], duplicateIds: string[]}
 */

/** Canonical section definitions. */
export const SECTIONS = [
  { id: 'backlog',    name: 'Backlog' },
  { id: 'todo',       name: 'Todo' },
  { id: 'in-progress', name: 'In Progress' },
  { id: 'done',       name: 'Done' },
  { id: 'archive',    name: 'Archive' },
];

/** Canonical section IDs. */
export const SECTION_IDS = SECTIONS.map(s => s.id);

/** Valid priority values. */
export const PRIORITIES = ['low', 'medium', 'high'];

/** Returns true if id is a valid section id. */
export function isSectionId(id) {
  return SECTION_IDS.includes(id);
}

/** Returns true if p is a valid priority. */
export function isPriority(p) {
  return PRIORITIES.includes(p);
}

const TASK_ID_RE = /^T\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a tasks document (parsed JSON).
 *
 * Checks:
 *   - doc.version is a number
 *   - doc.sections is an array
 *   - each section.id is in SECTION_IDS
 *   - each task:
 *       id matches /^T\d+$/ and is unique across ALL sections (collect dups)
 *       title is a string
 *       checked is boolean
 *       priority is in PRIORITIES
 *       created is 'YYYY-MM-DD' or null/undefined/empty (should be set — warned, not errored)
 *       updated is 'YYYY-MM-DD' or null/undefined/empty
 *       subtasks is array of {text:string, checked:boolean}
 *
 * @param {any} doc
 * @returns {{valid: boolean, errors: string[], duplicateIds: string[]}}
 */
export function validateTasksDoc(doc) {
  const errors = [];
  const duplicateIds = [];

  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: ['doc must be an object'], duplicateIds: [] };
  }

  // version
  if (typeof doc.version !== 'number') {
    errors.push('doc.version must be a number');
  }

  // sections
  if (!Array.isArray(doc.sections)) {
    errors.push('doc.sections must be an array');
    return { valid: errors.length === 0, errors, duplicateIds };
  }

  const seenIds = new Map(); // id -> first section id

  for (let si = 0; si < doc.sections.length; si++) {
    const section = doc.sections[si];

    if (!section || typeof section !== 'object') {
      errors.push(`sections[${si}] must be an object`);
      continue;
    }

    if (!isSectionId(section.id)) {
      errors.push(`sections[${si}].id "${section.id}" is not a valid section id (${SECTION_IDS.join(', ')})`);
    }

    if (!Array.isArray(section.tasks)) {
      errors.push(`sections[${si}] (${section.id}) .tasks must be an array`);
      continue;
    }

    for (let ti = 0; ti < section.tasks.length; ti++) {
      const task = section.tasks[ti];
      const ref = `sections[${si}](${section.id}).tasks[${ti}]`;

      if (!task || typeof task !== 'object') {
        errors.push(`${ref} must be an object`);
        continue;
      }

      // id
      if (typeof task.id !== 'string' || !TASK_ID_RE.test(task.id)) {
        errors.push(`${ref}.id "${task.id}" must match /^T\\d+$/`);
      } else {
        if (seenIds.has(task.id)) {
          if (!duplicateIds.includes(task.id)) {
            duplicateIds.push(task.id);
          }
          errors.push(`duplicate task id ${task.id} (also in section "${seenIds.get(task.id)}")`);
        } else {
          seenIds.set(task.id, section.id);
        }
      }

      // title
      if (typeof task.title !== 'string') {
        errors.push(`${ref} (id=${task.id ?? '?'}) .title must be a string`);
      }

      // checked
      if (typeof task.checked !== 'boolean') {
        errors.push(`${ref} (id=${task.id ?? '?'}) .checked must be a boolean`);
      }

      // priority
      if (!isPriority(task.priority)) {
        errors.push(`${ref} (id=${task.id ?? '?'}) .priority "${task.priority}" must be one of ${PRIORITIES.join(', ')}`);
      }

      // created: should be set; must be valid date string if present
      if (task.created && typeof task.created === 'string' && !DATE_RE.test(task.created)) {
        errors.push(`${ref} (id=${task.id ?? '?'}) .created "${task.created}" must be YYYY-MM-DD`);
      }

      // updated: optional, but must be valid if present
      if (task.updated && typeof task.updated === 'string' && !DATE_RE.test(task.updated)) {
        errors.push(`${ref} (id=${task.id ?? '?'}) .updated "${task.updated}" must be YYYY-MM-DD or null`);
      }

      // subtasks
      if (!Array.isArray(task.subtasks)) {
        errors.push(`${ref} (id=${task.id ?? '?'}) .subtasks must be an array`);
      } else {
        for (let sti = 0; sti < task.subtasks.length; sti++) {
          const st = task.subtasks[sti];
          if (!st || typeof st !== 'object') {
            errors.push(`${ref}.subtasks[${sti}] must be an object`);
            continue;
          }
          if (typeof st.text !== 'string') {
            errors.push(`${ref}.subtasks[${sti}].text must be a string`);
          }
          if (typeof st.checked !== 'boolean') {
            errors.push(`${ref}.subtasks[${sti}].checked must be a boolean`);
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    duplicateIds,
  };
}
