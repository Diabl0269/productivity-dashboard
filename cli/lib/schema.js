/**
 * cli/lib/schema.js
 * Schema definitions and validation for tasks.json documents.
 *
 * Exports:
 *   SECTIONS: [{id, name}]
 *   SECTION_IDS: string[]
 *   PRIORITIES: string[]
 *   DEFAULT_TICKET_TYPES: [{id, name, color}]
 *   DEFAULT_TICKET_TYPE_ID: string
 *   normalizeTicketTypes(types): [{id, name, color}]
 *   isSectionId(id): boolean
 *   isPriority(p): boolean
 *   isHexColor(c): boolean
 *   normalizeTask(task): task
 *   normalizeTasksDoc(doc): doc
 *   validateTasksDoc(doc): {valid: boolean, errors: string[], duplicateIds: string[]}
 */

/** Canonical section definitions (order = board column order). */
export const SECTIONS = [
  { id: 'inbox',       name: 'Inbox' },
  { id: 'backlog',     name: 'Backlog' },
  { id: 'todo',        name: 'Todo' },
  { id: 'in-progress', name: 'In Progress' },
  { id: 'done',        name: 'Done' },
  { id: 'archive',     name: 'Archive' },
];

/** Canonical section IDs. */
export const SECTION_IDS = SECTIONS.map(s => s.id);

/** Valid priority values. */
export const PRIORITIES = ['low', 'medium', 'high'];

/** Valid energy contexts for solo focus filtering. */
export const ENERGY_VALUES = ['deep', 'shallow', 'errands', 'creative'];

/** Max timeEntries kept per task. */
export const TIME_ENTRIES_MAX = 100;

/** Max decisions kept per task. */
export const DECISIONS_MAX = 50;

/** Empty / default meta for tasks.json. */
export function defaultMeta() {
  return {
    dailyPlan: { date: null, taskIds: [], carriedIds: [] },
    weeklyCapacityMinutes: 600,
    projects: [],
    ideas: [],
    review: { weeklyDate: null, checks: {} },
  };
}

/**
 * Normalize top-level meta object (daily plan, capacity, projects, ideas, review).
 * @param {any} meta
 * @returns {object}
 */
export function normalizeMeta(meta) {
  const base = defaultMeta();
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return base;

  const dailyPlan = meta.dailyPlan && typeof meta.dailyPlan === 'object'
    ? meta.dailyPlan
    : {};
  const date = (typeof dailyPlan.date === 'string' && DATE_RE.test(dailyPlan.date))
    ? dailyPlan.date
    : null;
  const taskIds = Array.isArray(dailyPlan.taskIds)
    ? dailyPlan.taskIds.map(id => String(id).trim()).filter(id => TASK_ID_RE.test(id))
    : [];
  const carriedIds = Array.isArray(dailyPlan.carriedIds)
    ? dailyPlan.carriedIds.map(id => String(id).trim()).filter(id => TASK_ID_RE.test(id))
    : [];

  let weeklyCapacityMinutes = base.weeklyCapacityMinutes;
  if (typeof meta.weeklyCapacityMinutes === 'number' && Number.isFinite(meta.weeklyCapacityMinutes) && meta.weeklyCapacityMinutes > 0) {
    weeklyCapacityMinutes = Math.round(meta.weeklyCapacityMinutes);
  }

  const projects = Array.isArray(meta.projects)
    ? meta.projects
      .filter(p => p && typeof p === 'object' && typeof p.id === 'string' && p.id.trim())
      .map(p => {
        const row = {
          id: String(p.id).trim(),
          name: String(p.name || p.id).trim() || String(p.id).trim(),
        };
        if (typeof p.color === 'string' && COLOR_RE.test(p.color)) row.color = p.color;
        return row;
      })
    : [];

  const ideas = Array.isArray(meta.ideas)
    ? meta.ideas.map(i => String(i).trim()).filter(Boolean)
    : [];

  const reviewIn = meta.review && typeof meta.review === 'object' ? meta.review : {};
  const weeklyDate = (typeof reviewIn.weeklyDate === 'string' && DATE_RE.test(reviewIn.weeklyDate))
    ? reviewIn.weeklyDate
    : null;
  const checks = (reviewIn.checks && typeof reviewIn.checks === 'object' && !Array.isArray(reviewIn.checks))
    ? { ...reviewIn.checks }
    : {};

  return {
    dailyPlan: { date, taskIds, carriedIds },
    weeklyCapacityMinutes,
    projects,
    ideas,
    review: { weeklyDate, checks },
  };
}

export function isEnergy(value) {
  return ENERGY_VALUES.includes(value);
}

export function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Default ticket-type hierarchy (order = hierarchy level, top first). */
export const DEFAULT_TICKET_TYPES = [
  { id: 'epic', name: 'Epic', color: '#8B5CF6' },
  { id: 'task', name: 'Task', color: '#3B82F6' },
  { id: 'subtask', name: 'Subtask', color: '#14B8A6' },
];

/** Default type assigned when a task omits `type`. */
export const DEFAULT_TICKET_TYPE_ID = 'task';

/** Returns true if id is a valid section id. */
export function isSectionId(id) {
  return SECTION_IDS.includes(id);
}

/** Returns true if p is a valid priority. */
export function isPriority(p) {
  return PRIORITIES.includes(p);
}

/** Returns true if c is a hex color like #RRGGBB. */
export function isHexColor(c) {
  return typeof c === 'string' && COLOR_RE.test(c);
}

/** Max history entries kept per task. */
export const HISTORY_MAX = 50;

/** Max notes kept per task. */
export const NOTES_MAX = 100;

/** Valid recurrence frequencies. */
export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'];

/** Jira-style key: PROJECT-123 */
export const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

export function isJiraKey(value) {
  return typeof value === 'string' && JIRA_KEY_RE.test(value.trim().toUpperCase());
}

export function isRecurrenceFreq(freq) {
  return RECURRENCE_FREQS.includes(freq);
}

/**
 * Append a history entry to a task (mutates). Caps at HISTORY_MAX.
 * @param {any} task
 * @param {{ event: string, from?: string, to?: string, note?: string, at?: string }} entry
 */
export function appendHistory(task, entry) {
  if (!task || !entry || !entry.event) return;
  if (!Array.isArray(task.history)) task.history = [];
  const row = {
    at: entry.at || new Date().toISOString(),
    event: String(entry.event),
  };
  if (entry.from != null && entry.from !== '') row.from = String(entry.from);
  if (entry.to != null && entry.to !== '') row.to = String(entry.to);
  if (entry.note != null && entry.note !== '') row.note = String(entry.note);
  task.history.push(row);
  if (task.history.length > HISTORY_MAX) {
    task.history = task.history.slice(-HISTORY_MAX);
  }
}

/**
 * Normalize a single task in-place:
 *   - migrate legacy `note` → `description`
 *   - drop empty optional fields that should be absent
 * @param {any} task
 * @returns {any}
 */
export function normalizeTask(task) {
  if (!task || typeof task !== 'object') return task;
  if ((task.description === undefined || task.description === null || task.description === '')
      && task.note != null && task.note !== '') {
    task.description = task.note;
  }
  if ('note' in task) delete task.note;
  if (task.description === '') delete task.description;
  if (task.color === '' || task.color == null) delete task.color;
  if (task.parentId === '' || task.parentId == null) delete task.parentId;
  if (!task.type) task.type = DEFAULT_TICKET_TYPE_ID;

  if (task.dueDate === '' || task.dueDate == null) delete task.dueDate;

  if (task.startDate === '' || task.startDate == null) delete task.startDate;

  if (task.jiraKey === '' || task.jiraKey == null) delete task.jiraKey;
  else if (typeof task.jiraKey === 'string') task.jiraKey = task.jiraKey.trim().toUpperCase();

  if (task.issueUrl === '' || task.issueUrl == null) delete task.issueUrl;
  else if (typeof task.issueUrl === 'string') task.issueUrl = task.issueUrl.trim();

  if (task.project === '' || task.project == null) delete task.project;
  else if (typeof task.project === 'string') task.project = task.project.trim();

  if (task.energy === '' || task.energy == null) delete task.energy;
  else if (typeof task.energy === 'string' && !ENERGY_VALUES.includes(task.energy)) delete task.energy;

  if (task.snoozeUntil === '' || task.snoozeUntil == null) delete task.snoozeUntil;

  if (Array.isArray(task.timeEntries)) {
    task.timeEntries = task.timeEntries
      .filter(e => e && typeof e === 'object' && typeof e.minutes === 'number' && e.minutes > 0)
      .map(e => {
        const row = {
          at: String(e.at || new Date().toISOString()),
          minutes: Math.round(e.minutes),
        };
        if (typeof e.note === 'string' && e.note.trim()) row.note = e.note.trim();
        return row;
      })
      .slice(-TIME_ENTRIES_MAX);
    if (task.timeEntries.length === 0) delete task.timeEntries;
  } else if (task.timeEntries != null) {
    delete task.timeEntries;
  }

  if (Array.isArray(task.decisions)) {
    task.decisions = task.decisions
      .filter(d => d && typeof d === 'object' && typeof d.text === 'string' && d.text.trim())
      .map(d => ({
        at: String(d.at || new Date().toISOString()),
        text: String(d.text).trim(),
      }))
      .slice(-DECISIONS_MAX);
    if (task.decisions.length === 0) delete task.decisions;
  } else if (task.decisions != null) {
    delete task.decisions;
  }

  if (task.blocked === false || task.blocked == null) delete task.blocked;
  if (task.waitingOn === '' || task.waitingOn == null) delete task.waitingOn;
  if (!task.blocked && task.waitingOn) {
    // waitingOn without blocked is fine; keep it
  }

  if (Array.isArray(task.labels)) {
    task.labels = task.labels
      .map(l => (typeof l === 'string' ? l.trim() : ''))
      .filter(Boolean);
    if (task.labels.length === 0) delete task.labels;
  } else if (task.labels != null) {
    delete task.labels;
  }

  if (Array.isArray(task.links)) {
    task.links = task.links
      .filter(l => l && typeof l === 'object' && typeof l.url === 'string' && l.url.trim())
      .map(l => {
        const row = { url: l.url.trim() };
        if (typeof l.label === 'string' && l.label.trim()) row.label = l.label.trim();
        return row;
      });
    if (task.links.length === 0) delete task.links;
  } else if (task.links != null) {
    delete task.links;
  }

  if (Array.isArray(task.blockedBy)) {
    task.blockedBy = [...new Set(
      task.blockedBy
        .map(id => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean)
    )];
    if (task.blockedBy.length === 0) delete task.blockedBy;
  } else if (task.blockedBy != null) {
    delete task.blockedBy;
  }

  if (task.assignee === '' || task.assignee == null) delete task.assignee;

  if (task.estimateMinutes == null || task.estimateMinutes === '' || task.estimateMinutes === 0) {
    delete task.estimateMinutes;
  } else if (typeof task.estimateMinutes === 'number') {
    task.estimateMinutes = Math.round(task.estimateMinutes);
    if (task.estimateMinutes <= 0) delete task.estimateMinutes;
  }

  if (task.loggedMinutes == null || task.loggedMinutes === '' || task.loggedMinutes === 0) {
    delete task.loggedMinutes;
  } else if (typeof task.loggedMinutes === 'number') {
    task.loggedMinutes = Math.round(task.loggedMinutes);
    if (task.loggedMinutes <= 0) delete task.loggedMinutes;
  }

  // recurrence: { freq: daily|weekly|monthly, interval?: number >= 1 }
  if (task.recurrence != null) {
    const r = task.recurrence;
    const FREQS = new Set(['daily', 'weekly', 'monthly']);
    if (!r || typeof r !== 'object' || !FREQS.has(r.freq)) {
      delete task.recurrence;
    } else {
      const interval = r.interval == null ? 1 : Math.round(Number(r.interval));
      task.recurrence = { freq: r.freq, interval: interval > 0 ? interval : 1 };
    }
  }

  // notes: [{ at, text }] — newest last, cap at NOTES_MAX
  if (Array.isArray(task.notes)) {
    task.notes = task.notes
      .filter(n => n && typeof n === 'object' && typeof n.text === 'string' && n.text.trim())
      .map(n => ({
        at: String(n.at || new Date().toISOString()),
        text: String(n.text).trim(),
      }))
      .slice(-NOTES_MAX);
    if (task.notes.length === 0) delete task.notes;
  } else if (task.notes != null) {
    delete task.notes;
  }

  if (Array.isArray(task.history)) {
    task.history = task.history
      .filter(h => h && typeof h === 'object' && typeof h.event === 'string' && h.event.trim())
      .map(h => {
        const row = { at: String(h.at || ''), event: String(h.event).trim() };
        if (h.from != null && h.from !== '') row.from = String(h.from);
        if (h.to != null && h.to !== '') row.to = String(h.to);
        if (h.note != null && h.note !== '') row.note = String(h.note);
        return row;
      })
      .slice(-HISTORY_MAX);
    if (task.history.length === 0) delete task.history;
  } else if (task.history != null) {
    delete task.history;
  }

  return task;
}

/**
 * Ensure all canonical sections exist (incl. inbox). Mutates doc.
 * Inserts missing sections in canonical order without reordering existing ones
 * beyond placing new ones at the correct relative position.
 * @param {any} doc
 * @returns {{ added: string[] }}
 */
export function ensureSections(doc) {
  if (!doc || typeof doc !== 'object') return { added: [] };
  if (!Array.isArray(doc.sections)) doc.sections = [];

  const byId = new Map(doc.sections.map(s => [s.id, s]));
  const added = [];
  for (const def of SECTIONS) {
    if (!byId.has(def.id)) {
      const sec = { id: def.id, name: def.name, tasks: [] };
      byId.set(def.id, sec);
      added.push(def.id);
    } else {
      const existing = byId.get(def.id);
      if (!existing.name) existing.name = def.name;
      if (!Array.isArray(existing.tasks)) existing.tasks = [];
    }
  }

  // Rebuild in canonical order, then append any unknown sections
  const ordered = [];
  for (const def of SECTIONS) {
    ordered.push(byId.get(def.id));
  }
  for (const s of doc.sections) {
    if (!SECTION_IDS.includes(s.id) && !ordered.includes(s)) ordered.push(s);
  }
  doc.sections = ordered;
  return { added };
}

/**
 * Normalize all tasks in a document (legacy note → description, etc.).
 * Also normalizes top-level meta.
 * @param {any} doc
 * @returns {any}
 */
export function normalizeTasksDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  if (!Array.isArray(doc.sections)) return doc;
  for (const section of doc.sections) {
    if (!Array.isArray(section?.tasks)) continue;
    for (const task of section.tasks) normalizeTask(task);
  }
  doc.meta = normalizeMeta(doc.meta);
  return doc;
}

/**
 * Normalize ticketTypes: use defaults when missing/empty, deep-clone.
 * @param {any} types
 * @returns {{id: string, name: string, color: string}[]}
 */
export function normalizeTicketTypes(types) {
  if (!Array.isArray(types) || types.length === 0) {
    return DEFAULT_TICKET_TYPES.map(t => ({ ...t }));
  }
  return types.map(t => ({
    id: String(t.id || ''),
    name: String(t.name || t.id || ''),
    color: String(t.color || '#888888'),
  }));
}

const TASK_ID_RE = /^T\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const TYPE_ID_RE = /^[a-z][a-z0-9-]*$/;

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
 *       type (optional) is a known ticket-type id (defaults to "task")
 *       parentId (optional) is a task id that exists and is not self
 *       description (optional) free-text; legacy `note` is also accepted
 *       color (optional) #RRGGBB override for the ticket
 *       dueDate (optional) YYYY-MM-DD
 *       blocked (optional) boolean
 *       waitingOn (optional) free-text person/thing
 *       labels (optional) string[]
 *       links (optional) [{label?: string, url: string}]
 *       blockedBy (optional) string[] of peer task ids
 *   - doc.ticketTypes (optional): array of {id, name, color}
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

  // ticketTypes (optional — missing means defaults)
  const typeIds = new Set();
  if (doc.ticketTypes !== undefined) {
    if (!Array.isArray(doc.ticketTypes)) {
      errors.push('doc.ticketTypes must be an array');
    } else if (doc.ticketTypes.length === 0) {
      errors.push('doc.ticketTypes must not be empty');
    } else {
      for (let i = 0; i < doc.ticketTypes.length; i++) {
        const tt = doc.ticketTypes[i];
        const ref = `ticketTypes[${i}]`;
        if (!tt || typeof tt !== 'object') {
          errors.push(`${ref} must be an object`);
          continue;
        }
        if (typeof tt.id !== 'string' || !TYPE_ID_RE.test(tt.id)) {
          errors.push(`${ref}.id "${tt.id}" must match /^[a-z][a-z0-9-]*$/`);
        } else if (typeIds.has(tt.id)) {
          errors.push(`${ref}.id "${tt.id}" is duplicated`);
        } else {
          typeIds.add(tt.id);
        }
        if (typeof tt.name !== 'string' || !tt.name.trim()) {
          errors.push(`${ref}.name must be a non-empty string`);
        }
        if (typeof tt.color !== 'string' || !COLOR_RE.test(tt.color)) {
          errors.push(`${ref}.color "${tt.color}" must be a hex color like #RRGGBB`);
        }
      }
    }
  } else {
    for (const t of DEFAULT_TICKET_TYPES) typeIds.add(t.id);
  }

  // sections
  if (!Array.isArray(doc.sections)) {
    errors.push('doc.sections must be an array');
    return { valid: errors.length === 0, errors, duplicateIds };
  }

  const seenIds = new Map(); // id -> first section id
  const parentRefs = []; // { ref, taskId, parentId }
  const blockedByRefs = []; // { ref, taskId, blockedById }

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

      // type (optional — default "task")
      if (task.type !== undefined && task.type !== null && task.type !== '') {
        if (typeof task.type !== 'string' || !typeIds.has(task.type)) {
          const known = [...typeIds].join(', ') || '(none)';
          errors.push(`${ref} (id=${task.id ?? '?'}) .type "${task.type}" must be one of ${known}`);
        }
      }

      // parentId (optional)
      if (task.parentId !== undefined && task.parentId !== null && task.parentId !== '') {
        if (typeof task.parentId !== 'string' || !TASK_ID_RE.test(task.parentId)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .parentId "${task.parentId}" must match /^T\\d+$/`);
        } else if (task.id && task.parentId === task.id) {
          errors.push(`${ref} (id=${task.id}) .parentId cannot reference itself`);
        } else if (task.id) {
          parentRefs.push({ ref, taskId: task.id, parentId: task.parentId });
        }
      }

      // description (optional); legacy `note` accepted until migrated
      const desc = task.description !== undefined ? task.description : task.note;
      if (desc !== undefined && desc !== null && typeof desc !== 'string') {
        errors.push(`${ref} (id=${task.id ?? '?'}) .description must be a string`);
      }

      // color (optional per-ticket override)
      if (task.color !== undefined && task.color !== null && task.color !== '') {
        if (!isHexColor(task.color)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .color "${task.color}" must be a hex color like #RRGGBB`);
        }
      }

      // dueDate (optional)
      if (task.dueDate !== undefined && task.dueDate !== null && task.dueDate !== '') {
        if (typeof task.dueDate !== 'string' || !DATE_RE.test(task.dueDate)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .dueDate "${task.dueDate}" must be YYYY-MM-DD`);
        }
      }

      // startDate (optional)
      if (task.startDate !== undefined && task.startDate !== null && task.startDate !== '') {
        if (typeof task.startDate !== 'string' || !DATE_RE.test(task.startDate)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .startDate "${task.startDate}" must be YYYY-MM-DD`);
        }
      }

      // jiraKey (optional)
      if (task.jiraKey !== undefined && task.jiraKey !== null && task.jiraKey !== '') {
        if (typeof task.jiraKey !== 'string' || !JIRA_KEY_RE.test(String(task.jiraKey).trim().toUpperCase())) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .jiraKey "${task.jiraKey}" must match PROJECT-123`);
        }
      }

      // issueUrl (optional HTTPS URL)
      if (task.issueUrl !== undefined && task.issueUrl !== null && task.issueUrl !== '') {
        if (typeof task.issueUrl !== 'string' || !isHttpsUrl(task.issueUrl)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .issueUrl must be an HTTPS URL`);
        }
      }

      // project (optional slug)
      if (task.project !== undefined && task.project !== null && typeof task.project !== 'string') {
        errors.push(`${ref} (id=${task.id ?? '?'}) .project must be a string`);
      }

      // energy (optional)
      if (task.energy !== undefined && task.energy !== null && task.energy !== '') {
        if (!isEnergy(task.energy)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .energy "${task.energy}" must be one of ${ENERGY_VALUES.join(', ')}`);
        }
      }

      // snoozeUntil (optional)
      if (task.snoozeUntil !== undefined && task.snoozeUntil !== null && task.snoozeUntil !== '') {
        if (typeof task.snoozeUntil !== 'string' || !DATE_RE.test(task.snoozeUntil)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .snoozeUntil "${task.snoozeUntil}" must be YYYY-MM-DD`);
        }
      }

      // timeEntries (optional)
      if (task.timeEntries !== undefined && task.timeEntries !== null) {
        if (!Array.isArray(task.timeEntries)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .timeEntries must be an array`);
        } else {
          for (let ei = 0; ei < task.timeEntries.length; ei++) {
            const e = task.timeEntries[ei];
            const eref = `${ref}.timeEntries[${ei}]`;
            if (!e || typeof e !== 'object') {
              errors.push(`${eref} must be an object`);
              continue;
            }
            if (typeof e.minutes !== 'number' || !Number.isFinite(e.minutes) || e.minutes <= 0) {
              errors.push(`${eref}.minutes must be a positive number`);
            }
            if (e.at !== undefined && e.at !== null && typeof e.at !== 'string') {
              errors.push(`${eref}.at must be a string`);
            }
            if (e.note !== undefined && e.note !== null && typeof e.note !== 'string') {
              errors.push(`${eref}.note must be a string`);
            }
          }
        }
      }

      // decisions (optional)
      if (task.decisions !== undefined && task.decisions !== null) {
        if (!Array.isArray(task.decisions)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .decisions must be an array`);
        } else {
          for (let di = 0; di < task.decisions.length; di++) {
            const d = task.decisions[di];
            const dref = `${ref}.decisions[${di}]`;
            if (!d || typeof d !== 'object') {
              errors.push(`${dref} must be an object`);
              continue;
            }
            if (typeof d.text !== 'string' || !d.text.trim()) {
              errors.push(`${dref}.text must be a non-empty string`);
            }
            if (d.at !== undefined && d.at !== null && typeof d.at !== 'string') {
              errors.push(`${dref}.at must be a string`);
            }
          }
        }
      }

      // blocked (optional)
      if (task.blocked !== undefined && task.blocked !== null && typeof task.blocked !== 'boolean') {
        errors.push(`${ref} (id=${task.id ?? '?'}) .blocked must be a boolean`);
      }

      // waitingOn (optional)
      if (task.waitingOn !== undefined && task.waitingOn !== null && typeof task.waitingOn !== 'string') {
        errors.push(`${ref} (id=${task.id ?? '?'}) .waitingOn must be a string`);
      }

      // labels (optional)
      if (task.labels !== undefined && task.labels !== null) {
        if (!Array.isArray(task.labels)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .labels must be an array`);
        } else {
          for (let li = 0; li < task.labels.length; li++) {
            if (typeof task.labels[li] !== 'string' || !task.labels[li].trim()) {
              errors.push(`${ref} (id=${task.id ?? '?'}) .labels[${li}] must be a non-empty string`);
            }
          }
        }
      }

      // links (optional)
      if (task.links !== undefined && task.links !== null) {
        if (!Array.isArray(task.links)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .links must be an array`);
        } else {
          for (let li = 0; li < task.links.length; li++) {
            const link = task.links[li];
            const lref = `${ref}.links[${li}]`;
            if (!link || typeof link !== 'object') {
              errors.push(`${lref} must be an object`);
              continue;
            }
            if (typeof link.url !== 'string' || !link.url.trim()) {
              errors.push(`${lref}.url must be a non-empty string`);
            }
            if (link.label !== undefined && link.label !== null && typeof link.label !== 'string') {
              errors.push(`${lref}.label must be a string`);
            }
          }
        }
      }

      // blockedBy (optional peer deps)
      if (task.blockedBy !== undefined && task.blockedBy !== null) {
        if (!Array.isArray(task.blockedBy)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .blockedBy must be an array`);
        } else {
          for (let bi = 0; bi < task.blockedBy.length; bi++) {
            const depId = task.blockedBy[bi];
            if (typeof depId !== 'string' || !TASK_ID_RE.test(depId)) {
              errors.push(`${ref} (id=${task.id ?? '?'}) .blockedBy[${bi}] "${depId}" must match /^T\\d+$/`);
            } else if (task.id && depId === task.id) {
              errors.push(`${ref} (id=${task.id}) .blockedBy cannot reference itself`);
            } else if (task.id) {
              blockedByRefs.push({ ref, taskId: task.id, blockedById: depId });
            }
          }
        }
      }

      // assignee (optional free-text / slug)
      if (task.assignee !== undefined && task.assignee !== null && typeof task.assignee !== 'string') {
        errors.push(`${ref} (id=${task.id ?? '?'}) .assignee must be a string`);
      }

      // estimateMinutes (optional — integer minutes; NOT story points)
      if (task.estimateMinutes !== undefined && task.estimateMinutes !== null && task.estimateMinutes !== '') {
        if (typeof task.estimateMinutes !== 'number' || !Number.isFinite(task.estimateMinutes) || task.estimateMinutes < 0) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .estimateMinutes must be a non-negative number (minutes)`);
        }
      }

      // loggedMinutes (optional — time actually spent)
      if (task.loggedMinutes !== undefined && task.loggedMinutes !== null && task.loggedMinutes !== '') {
        if (typeof task.loggedMinutes !== 'number' || !Number.isFinite(task.loggedMinutes) || task.loggedMinutes < 0) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .loggedMinutes must be a non-negative number (minutes)`);
        }
      }

      // recurrence (optional)
      if (task.recurrence !== undefined && task.recurrence !== null) {
        if (typeof task.recurrence !== 'object' || Array.isArray(task.recurrence)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .recurrence must be an object`);
        } else {
          if (!isRecurrenceFreq(task.recurrence.freq)) {
            errors.push(`${ref} (id=${task.id ?? '?'}) .recurrence.freq must be one of ${RECURRENCE_FREQS.join(', ')}`);
          }
          if (task.recurrence.interval !== undefined && task.recurrence.interval !== null) {
            const iv = task.recurrence.interval;
            if (typeof iv !== 'number' || !Number.isFinite(iv) || iv < 1) {
              errors.push(`${ref} (id=${task.id ?? '?'}) .recurrence.interval must be a positive number`);
            }
          }
        }
      }

      // notes (optional discussion thread)
      if (task.notes !== undefined && task.notes !== null) {
        if (!Array.isArray(task.notes)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .notes must be an array`);
        } else {
          for (let ni = 0; ni < task.notes.length; ni++) {
            const n = task.notes[ni];
            const nref = `${ref}.notes[${ni}]`;
            if (!n || typeof n !== 'object') {
              errors.push(`${nref} must be an object`);
              continue;
            }
            if (typeof n.text !== 'string' || !n.text.trim()) {
              errors.push(`${nref}.text must be a non-empty string`);
            }
            if (n.at !== undefined && n.at !== null && typeof n.at !== 'string') {
              errors.push(`${nref}.at must be a string`);
            }
          }
        }
      }

      // history (optional activity log)
      if (task.history !== undefined && task.history !== null) {
        if (!Array.isArray(task.history)) {
          errors.push(`${ref} (id=${task.id ?? '?'}) .history must be an array`);
        } else {
          for (let hi = 0; hi < task.history.length; hi++) {
            const h = task.history[hi];
            const href = `${ref}.history[${hi}]`;
            if (!h || typeof h !== 'object') {
              errors.push(`${href} must be an object`);
              continue;
            }
            if (typeof h.event !== 'string' || !h.event.trim()) {
              errors.push(`${href}.event must be a non-empty string`);
            }
            if (h.at !== undefined && h.at !== null && typeof h.at !== 'string') {
              errors.push(`${href}.at must be a string`);
            }
          }
        }
      }
    }
  }

  for (const { ref, parentId } of parentRefs) {
    if (!seenIds.has(parentId)) {
      errors.push(`${ref}.parentId "${parentId}" does not exist`);
    }
  }

  for (const { ref, blockedById } of blockedByRefs) {
    if (!seenIds.has(blockedById)) {
      errors.push(`${ref}.blockedBy "${blockedById}" does not exist`);
    }
  }

  // meta (optional — missing is fine; if present, shape-check lightly)
  if (doc.meta !== undefined && doc.meta !== null) {
    if (typeof doc.meta !== 'object' || Array.isArray(doc.meta)) {
      errors.push('doc.meta must be an object');
    } else {
      if (doc.meta.dailyPlan != null) {
        const dp = doc.meta.dailyPlan;
        if (typeof dp !== 'object' || Array.isArray(dp)) {
          errors.push('doc.meta.dailyPlan must be an object');
        } else {
          if (dp.date != null && dp.date !== '' && (typeof dp.date !== 'string' || !DATE_RE.test(dp.date))) {
            errors.push('doc.meta.dailyPlan.date must be YYYY-MM-DD or null');
          }
          if (dp.taskIds != null && !Array.isArray(dp.taskIds)) {
            errors.push('doc.meta.dailyPlan.taskIds must be an array');
          }
          if (dp.carriedIds != null && !Array.isArray(dp.carriedIds)) {
            errors.push('doc.meta.dailyPlan.carriedIds must be an array');
          }
        }
      }
      if (doc.meta.weeklyCapacityMinutes != null) {
        const w = doc.meta.weeklyCapacityMinutes;
        if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) {
          errors.push('doc.meta.weeklyCapacityMinutes must be a positive number');
        }
      }
      if (doc.meta.projects != null && !Array.isArray(doc.meta.projects)) {
        errors.push('doc.meta.projects must be an array');
      }
      if (doc.meta.ideas != null && !Array.isArray(doc.meta.ideas)) {
        errors.push('doc.meta.ideas must be an array');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    duplicateIds,
  };
}
