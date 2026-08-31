/**
 * cli/commands/tasks.js
 * Task management subcommands for the ch CLI.
 *
 * Usage: ch tasks <subcommand> [args...]
 *
 * Subcommands:
 *   list [--section S] [--priority P] [--active] [--json]
 *   get <id> [--json]
 *   add "<title>" [--section todo] [--priority medium] [--type task] [--parent T1] [--description "..."] [--color "#RRGGBB"]
 *              [--due YYYY-MM-DD] [--start YYYY-MM-DD] [--jira PROJECT-123] [--log-time 30m|2h]
 *              [--recur daily|weekly|monthly] [--recur-interval N] [--add-note "..."]
 *              [--blocked] [--waiting-on "..."] [--label L] [--link URL] [--link-label "..."] [--blocked-by T1]
 *   update <id> [--description "..."] [--add-description "..."] [--title "..."] [--priority P] [--type T] [--parent T1] [--clear-parent]
 *              [--color "#RRGGBB"] [--clear-color]
 *              [--due YYYY-MM-DD] [--clear-due] [--start YYYY-MM-DD] [--clear-start]
 *              [--jira PROJECT-123] [--clear-jira] [--log-time 30m|2h] [--set-logged 2h] [--clear-logged]
 *              [--recur daily|weekly|monthly] [--recur-interval N] [--clear-recur] [--add-note "..."]
 *              [--blocked] [--unblocked] [--waiting-on "..."] [--clear-waiting-on]
 *              [--add-label L] [--remove-label L] [--clear-labels]
 *              [--add-link URL] [--link-label "..."] [--remove-link N] [--clear-links]
 *              [--add-blocked-by T1] [--remove-blocked-by T1] [--clear-blocked-by]
 *              [--add-subtask "text"] [--check-subtask N] [--uncheck-subtask N]
 *              [--edit-subtask N --subtask-text "..."]
 *   set-priority <id> <low|medium|high>
 *   next-id
 *   dump [--active] [--json]
 *   export [--md]
 *   lint [--fix]
 *   archive-done
 */

import { parse } from '../lib/args.js';
import { print, printErr, jsonOut, ok, die } from '../lib/output.js';
import { readJson, tasksJsonPath } from '../lib/io.js';
import {
  load, save, nextId, findTask, findAll, sectionById, flatTasks, todayStr,
} from '../lib/tasks-store.js';
import {
  SECTION_IDS, PRIORITIES, DEFAULT_TICKET_TYPE_ID, normalizeTicketTypes,
  isSectionId, isPriority, isHexColor, validateTasksDoc, normalizeTasksDoc,
  appendHistory, isJiraKey, RECURRENCE_FREQS, ENERGY_VALUES, isEnergy, isHttpsUrl,
  ensureSections, normalizeMeta, defaultMeta,
} from '../lib/schema.js';
import { parseEstimate, formatEstimate } from '../lib/estimate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Prefer description; fall back to legacy note. */
function taskDescription(task) {
  if (!task) return '';
  if (task.description != null && task.description !== '') return task.description;
  return task.note || '';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TASK_ID_RE = /^T\d+$/;

function assertDueDate(value, flag) {
  if (value && !DATE_RE.test(value)) {
    die(`invalid ${flag} "${value}". Use YYYY-MM-DD`);
  }
}

function assertTaskId(value, flag) {
  if (!TASK_ID_RE.test(value)) {
    die(`invalid ${flag} "${value}". Must match T<number>`);
  }
}

function assertJiraKey(value, flag) {
  if (value && !isJiraKey(value)) {
    die(`invalid ${flag} "${value}". Use PROJECT-123`);
  }
}

function parseLoggedMinutes(value, flag) {
  const mins = parseEstimate(value);
  if (mins == null) {
    die(`invalid ${flag} "${value}". Try 30m, 2h, 1h30m, 1d, or minutes as a number`);
  }
  return mins;
}

function assertRecurrenceFreq(value, flag) {
  if (value && !RECURRENCE_FREQS.includes(value)) {
    die(`invalid ${flag} "${value}". Valid: ${RECURRENCE_FREQS.join(', ')}`);
  }
}

function formatDateYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Advance a YYYY-MM-DD date by recurrence freq × interval. */
function advanceDateByRecurrence(dateStr, recurrence) {
  if (!dateStr || !recurrence?.freq) return dateStr;
  const n = recurrence.interval > 0 ? recurrence.interval : 1;
  const d = new Date(`${dateStr}T12:00:00`);
  if (recurrence.freq === 'daily') {
    d.setDate(d.getDate() + n);
  } else if (recurrence.freq === 'weekly') {
    d.setDate(d.getDate() + 7 * n);
  } else if (recurrence.freq === 'monthly') {
    d.setMonth(d.getMonth() + n);
  }
  return formatDateYMD(d);
}

/**
 * Compute the next due date for a recurring task.
 * Base: dueDate, else startDate, else todayStr.
 */
function advanceRecurrence(task, todayStr) {
  const base = task.dueDate || task.startDate || todayStr;
  return advanceDateByRecurrence(base, task.recurrence);
}

/** Spawn the next occurrence of a completed recurring task in todo. */
function spawnRecurringNext(doc, completedTask, today) {
  if (!completedTask.recurrence?.freq) return null;

  const todoSection = sectionById(doc, 'todo');
  if (!todoSection) return null;

  const newId = nextId(doc);
  const newTask = {
    id: newId,
    title: completedTask.title,
    checked: false,
    priority: completedTask.priority,
    type: completedTask.type || DEFAULT_TICKET_TYPE_ID,
    created: today,
    updated: null,
    subtasks: (completedTask.subtasks || []).map(st => ({ text: st.text, checked: false })),
    recurrence: {
      freq: completedTask.recurrence.freq,
      interval: completedTask.recurrence.interval > 0 ? completedTask.recurrence.interval : 1,
    },
  };

  const desc = taskDescription(completedTask);
  if (desc) newTask.description = desc;
  if (completedTask.parentId) newTask.parentId = completedTask.parentId;
  if (completedTask.color) newTask.color = completedTask.color;
  if (completedTask.jiraKey) newTask.jiraKey = completedTask.jiraKey;
  if (completedTask.issueUrl) newTask.issueUrl = completedTask.issueUrl;
  if (completedTask.project) newTask.project = completedTask.project;
  if (completedTask.energy) newTask.energy = completedTask.energy;
  if (completedTask.assignee) newTask.assignee = completedTask.assignee;
  if (completedTask.estimateMinutes) newTask.estimateMinutes = completedTask.estimateMinutes;
  if (completedTask.blocked) newTask.blocked = true;
  if (completedTask.waitingOn) newTask.waitingOn = completedTask.waitingOn;
  if (Array.isArray(completedTask.labels) && completedTask.labels.length) {
    newTask.labels = [...completedTask.labels];
  }
  if (Array.isArray(completedTask.links) && completedTask.links.length) {
    newTask.links = completedTask.links.map(l => ({ ...l }));
  }
  if (Array.isArray(completedTask.blockedBy) && completedTask.blockedBy.length) {
    newTask.blockedBy = [...completedTask.blockedBy];
  }

  newTask.dueDate = advanceRecurrence(completedTask, today);
  if (completedTask.startDate) {
    newTask.startDate = advanceDateByRecurrence(completedTask.startDate, completedTask.recurrence);
  }

  appendHistory(newTask, { event: 'created', to: 'todo', note: `recurrence from ${completedTask.id}` });
  todoSection.tasks.push(newTask);
  return newTask;
}

function maybeSpawnRecurrence(doc, task, today) {
  if (!task.recurrence?.freq) return null;
  return spawnRecurringNext(doc, task, today);
}

/** Format a task for terse single-line display. */
function formatTaskLine(task, sectionId) {
  const sectionStr = sectionId ? ` [${sectionId}]` : '';
  const check = task.checked ? '[x]' : '[ ]';
  const subtaskInfo = task.subtasks && task.subtasks.length > 0
    ? ` (${task.subtasks.filter(s => s.checked).length}/${task.subtasks.length} subtasks)`
    : '';
  const desc = taskDescription(task);
  const descSuffix = desc ? ` — ${desc.split('\n')[0]}` : '';
  const due = task.dueDate ? ` due:${task.dueDate}` : '';
  const start = task.startDate ? ` start:${task.startDate}` : '';
  const jira = task.jiraKey ? ` ${task.jiraKey}` : '';
  const blocked = task.blocked ? ' [blocked]' : '';
  const labels = Array.isArray(task.labels) && task.labels.length
    ? ` {${task.labels.join(',')}}`
    : '';
  const est = task.estimateMinutes ? ` ~${formatEstimate(task.estimateMinutes)}` : '';
  const logged = task.loggedMinutes ? ` logged:${formatEstimate(task.loggedMinutes)}` : '';
  const recur = task.recurrence?.freq
    ? ` recur:${task.recurrence.freq}${task.recurrence.interval > 1 ? `x${task.recurrence.interval}` : ''}`
    : '';
  const who = task.assignee ? ` @${task.assignee}` : '';
  return `${task.id}${sectionStr} ${check} [${task.priority}] ${task.title}${descSuffix}${jira}${due}${start}${est}${logged}${recur}${who}${blocked}${labels}${subtaskInfo}`;
}

/**
 * Require exactly one match for id. If duplicates, die unless --section provided.
 * Returns {task, section} object.
 */
function resolveTask(doc, id, sectionId) {
  if (sectionId) {
    const sec = sectionById(doc, sectionId);
    if (!sec) die(`unknown section "${sectionId}". Valid: ${SECTION_IDS.join(', ')}`);
    const task = sec.tasks.find(t => t.id === id);
    if (!task) die(`task ${id} not found in section "${sectionId}". Try: ch tasks list`);
    return { task, section: sec };
  }

  const matches = findAll(doc, id);
  if (matches.length === 0) die(`task ${id} not found. Try: ch tasks list`);
  if (matches.length > 1) {
    const locations = matches.map(m => `"${m.section.id}"`).join(', ');
    die(`task ${id} appears in multiple sections: ${locations}. Use --section to disambiguate.`);
  }
  return matches[0];
}

/**
 * Convert our tasks.json doc shape into the dashboard {sections, tasks} shape
 * expected by toMarkdown().
 *
 * Dashboard task fields: title, description, checked, subtasks, created, updated,
 *   priority, taskId (maps from our .id)
 */
function docToDashboardShape(doc) {
  const sections = doc.sections.map(s => ({ id: s.id, name: s.name }));
  const tasks = {};
  for (const s of doc.sections) {
    tasks[s.id] = s.tasks.map(t => ({
      taskId: t.id,
      title: t.title,
      description: taskDescription(t),
      checked: t.checked,
      subtasks: t.subtasks || [],
      created: t.created || null,
      updated: t.updated || null,
      priority: t.priority,
      type: t.type,
      parentId: t.parentId || null,
      color: t.color || null,
      dueDate: t.dueDate || null,
      blocked: !!t.blocked,
      waitingOn: t.waitingOn || null,
      labels: Array.isArray(t.labels) ? t.labels : [],
      links: Array.isArray(t.links) ? t.links : [],
      blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy : [],
      assignee: t.assignee || null,
      estimateMinutes: t.estimateMinutes ?? null,
      startDate: t.startDate || null,
      jiraKey: t.jiraKey || null,
      issueUrl: t.issueUrl || null,
      project: t.project || null,
      energy: t.energy || null,
      snoozeUntil: t.snoozeUntil || null,
      loggedMinutes: t.loggedMinutes ?? null,
      recurrence: t.recurrence || null,
      notes: Array.isArray(t.notes) ? t.notes : [],
      decisions: Array.isArray(t.decisions) ? t.decisions : [],
      timeEntries: Array.isArray(t.timeEntries) ? t.timeEntries : [],
      history: Array.isArray(t.history) ? t.history : [],
    }));
  }
  return { sections, tasks, meta: doc.meta || defaultMeta() };
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function cmdList(argv) {
  const { values } = parse(argv, {
    section:  { type: 'string',  short: 's' },
    priority: { type: 'string',  short: 'p' },
    active:   { type: 'boolean', short: 'a' },
    json:     { type: 'boolean', short: 'j' },
  });

  if (values.section && !isSectionId(values.section)) {
    die(`unknown section "${values.section}". Valid: ${SECTION_IDS.join(', ')}`);
  }
  if (values.priority && !isPriority(values.priority)) {
    die(`unknown priority "${values.priority}". Valid: ${PRIORITIES.join(', ')}`);
  }

  const doc = load();
  let tasks = flatTasks(doc, { active: values.active || false });

  if (values.section) tasks = tasks.filter(t => t.section === values.section);
  if (values.priority) tasks = tasks.filter(t => t.priority === values.priority);

  if (values.json) {
    jsonOut(tasks);
    return;
  }

  if (tasks.length === 0) {
    print('(no tasks)');
    return;
  }
  for (const t of tasks) {
    print(formatTaskLine(t, t.section));
  }
}

function cmdGet(argv) {
  const { values, positionals } = parse(argv, {
    json:    { type: 'boolean', short: 'j' },
    section: { type: 'string',  short: 's' },
  });

  const id = positionals[0];
  if (!id) die('usage: ch tasks get <id> [--json]');

  const doc = load();
  const { task, section } = resolveTask(doc, id, values.section);

  if (values.json) {
    jsonOut({ ...task, section: section.id });
    return;
  }

  print(formatTaskLine(task, section.id));
  const desc = taskDescription(task);
  if (desc) print(`  description: ${desc}`);
  if (task.color) print(`  color: ${task.color}`);
  if (task.dueDate) print(`  due: ${task.dueDate}`);
  if (task.startDate) print(`  start: ${task.startDate}`);
  if (task.jiraKey) print(`  jira: ${task.jiraKey}`);
  if (task.issueUrl) print(`  issue: ${task.issueUrl}`);
  if (task.project) print(`  project: ${task.project}`);
  if (task.energy) print(`  energy: ${task.energy}`);
  if (task.snoozeUntil) print(`  snoozeUntil: ${task.snoozeUntil}`);
  if (task.estimateMinutes) print(`  estimate: ${formatEstimate(task.estimateMinutes)} (${task.estimateMinutes}m)`);
  if (task.loggedMinutes) print(`  logged: ${formatEstimate(task.loggedMinutes)} (${task.loggedMinutes}m)`);
  if (task.recurrence?.freq) {
    const iv = task.recurrence.interval > 1 ? ` every ${task.recurrence.interval}` : '';
    print(`  recurrence: ${task.recurrence.freq}${iv}`);
  }
  if (task.assignee) print(`  assignee: ${task.assignee}`);
  if (task.blocked) print(`  blocked: yes${task.waitingOn ? ` (waiting on: ${task.waitingOn})` : ''}`);
  else if (task.waitingOn) print(`  waiting on: ${task.waitingOn}`);
  if (Array.isArray(task.labels) && task.labels.length) print(`  labels: ${task.labels.join(', ')}`);
  if (Array.isArray(task.links) && task.links.length) {
    task.links.forEach((l, i) => {
      print(`  link ${i + 1}: ${l.label ? `${l.label} — ` : ''}${l.url}`);
    });
  }
  if (Array.isArray(task.blockedBy) && task.blockedBy.length) {
    print(`  blocked by: ${task.blockedBy.join(', ')}`);
  }
  if (Array.isArray(task.history) && task.history.length) {
    print(`  history: ${task.history.length} event(s)`);
  }
  if (Array.isArray(task.notes) && task.notes.length) {
    task.notes.forEach((n, i) => {
      const when = n.at ? n.at.split('T')[0] : 'n/a';
      print(`  note ${i + 1} (${when}): ${n.text}`);
    });
  }
  if (Array.isArray(task.decisions) && task.decisions.length) {
    task.decisions.forEach((d, i) => {
      const when = d.at ? d.at.split('T')[0] : 'n/a';
      print(`  decision ${i + 1} (${when}): ${d.text}`);
    });
  }
  if (Array.isArray(task.timeEntries) && task.timeEntries.length) {
    print(`  timeEntries: ${task.timeEntries.length} session(s)`);
  }
  if (task.subtasks && task.subtasks.length > 0) {
    task.subtasks.forEach((st, i) => {
      print(`  ${i + 1}. [${st.checked ? 'x' : ' '}] ${st.text}`);
    });
  }
  print(`  created: ${task.created || 'n/a'}  updated: ${task.updated || 'n/a'}`);
}

function cmdAdd(argv) {
  const { values, positionals } = parse(argv, {
    section:       { type: 'string', short: 's', default: 'todo' },
    priority:      { type: 'string', short: 'p', default: 'medium' },
    description:   { type: 'string', short: 'n' },
    note:          { type: 'string' }, // legacy alias
    type:          { type: 'string' },
    parent:        { type: 'string' },
    color:         { type: 'string' },
    due:           { type: 'string' },
    start:         { type: 'string' },
    jira:          { type: 'string' },
    issue:         { type: 'string' },
    project:       { type: 'string' },
    energy:        { type: 'string' },
    snooze:        { type: 'string' },
    decision:      { type: 'string' },
    'log-time':    { type: 'string' },
    recur:         { type: 'string' },
    'recur-interval': { type: 'string' },
    'add-note':    { type: 'string' },
    blocked:       { type: 'boolean' },
    'waiting-on':  { type: 'string' },
    label:         { type: 'string', multiple: true },
    link:          { type: 'string', multiple: true },
    'link-label':  { type: 'string', multiple: true },
    'blocked-by':  { type: 'string', multiple: true },
    assignee:      { type: 'string' },
    estimate:      { type: 'string' },
    json:          { type: 'boolean', short: 'j' },
  });

  const title = positionals[0];
  if (!title) die('usage: ch tasks add "<title>" [--due YYYY-MM-DD] [--estimate 2h] [--assignee name] [--blocked] ...');

  if (!isSectionId(values.section)) {
    die(`unknown section "${values.section}". Valid: ${SECTION_IDS.join(', ')}`);
  }
  if (!isPriority(values.priority)) {
    die(`unknown priority "${values.priority}". Valid: ${PRIORITIES.join(', ')}`);
  }

  const doc = load();
  ensureSections(doc);
  if (!doc.meta) doc.meta = defaultMeta();
  doc.meta = normalizeMeta(doc.meta);
  const typeIds = new Set(normalizeTicketTypes(doc.ticketTypes).map(t => t.id));
  const ticketType = values.type || DEFAULT_TICKET_TYPE_ID;
  if (!typeIds.has(ticketType)) {
    die(`unknown type "${ticketType}". Valid: ${[...typeIds].join(', ')}`);
  }
  if (values.parent) {
    if (!findTask(doc, values.parent)) {
      die(`parent task ${values.parent} not found. Try: ch tasks list`);
    }
  }
  if (values.color && !isHexColor(values.color)) {
    die(`invalid color "${values.color}". Use #RRGGBB`);
  }
  assertDueDate(values.due, '--due');
  assertDueDate(values.start, '--start');
  assertJiraKey(values.jira, '--jira');
  if (values.issue && !isHttpsUrl(values.issue)) {
    die(`invalid --issue "${values.issue}". Must be an HTTPS URL`);
  }
  if (values.energy && !isEnergy(values.energy)) {
    die(`invalid --energy "${values.energy}". Valid: ${ENERGY_VALUES.join(', ')}`);
  }
  assertDueDate(values.snooze, '--snooze');
  assertRecurrenceFreq(values.recur, '--recur');

  let estimateMinutes = null;
  if (values.estimate !== undefined) {
    estimateMinutes = parseEstimate(values.estimate);
    if (estimateMinutes == null) {
      die(`invalid --estimate "${values.estimate}". Try 30m, 2h, 1h30m, 1d, or minutes as a number`);
    }
  }

  const blockedByIds = values['blocked-by'] || [];
  for (const depId of blockedByIds) {
    assertTaskId(depId, '--blocked-by');
    if (!findTask(doc, depId)) {
      die(`blocked-by task ${depId} not found. Try: ch tasks list`);
    }
  }

  let loggedMinutes = null;
  if (values['log-time'] !== undefined) {
    loggedMinutes = parseLoggedMinutes(values['log-time'], '--log-time');
  }

  const id = nextId(doc);
  const description = values.description ?? values.note;

  const task = {
    id,
    title,
    checked: false,
    priority: values.priority,
    type: ticketType,
    created: todayStr(),
    updated: null,
    subtasks: [],
  };
  if (description) task.description = description;
  if (values.parent) task.parentId = values.parent;
  if (values.color) task.color = values.color;
  if (values.due) task.dueDate = values.due;
  if (values.start) task.startDate = values.start;
  if (values.jira) task.jiraKey = values.jira.trim().toUpperCase();
  if (values.issue) task.issueUrl = values.issue.trim();
  if (values.project) task.project = values.project.trim();
  if (values.energy) task.energy = values.energy;
  if (values.snooze) task.snoozeUntil = values.snooze;
  if (values.decision) {
    task.decisions = [{ at: new Date().toISOString(), text: values.decision.trim() }];
  }
  if (loggedMinutes != null) task.loggedMinutes = loggedMinutes;
  if (values.recur) {
    const interval = values['recur-interval'] != null
      ? parseInt(values['recur-interval'], 10)
      : 1;
    if (values['recur-interval'] != null && (isNaN(interval) || interval < 1)) {
      die(`invalid --recur-interval "${values['recur-interval']}". Must be a positive integer`);
    }
    task.recurrence = { freq: values.recur, interval: interval > 0 ? interval : 1 };
  }
  if (values['add-note']) {
    task.notes = [{ at: new Date().toISOString(), text: values['add-note'].trim() }];
  }
  if (values.blocked) task.blocked = true;
  if (values['waiting-on']) task.waitingOn = values['waiting-on'];
  if (values.label && values.label.length) task.labels = [...new Set(values.label.map(l => l.trim()).filter(Boolean))];
  if (values.link && values.link.length) {
    const labels = values['link-label'] || [];
    task.links = values.link.map((url, i) => {
      const row = { url };
      if (labels[i]) row.label = labels[i];
      return row;
    });
  }
  if (blockedByIds.length) task.blockedBy = [...new Set(blockedByIds)];
  if (values.assignee) task.assignee = values.assignee.trim();
  if (estimateMinutes != null) task.estimateMinutes = estimateMinutes;
  appendHistory(task, { event: 'created', to: values.section });

  let sec = sectionById(doc, values.section);
  if (!sec) {
    // Shouldn't happen since we validated isSectionId, but be safe
    die(`section "${values.section}" not found in document. Try 'ch tasks lint --fix'`);
  }
  sec.tasks.push(task);
  save(doc);

  if (values.json) {
    jsonOut({ id, section: values.section, type: ticketType, parentId: values.parent || null });
    return;
  }
  ok(`added ${id} to ${values.section}`);
}

function cmdMove(argv) {
  const { values, positionals } = parse(argv, {
    section: { type: 'string',  short: 's' },
    json:    { type: 'boolean', short: 'j' },
  });

  const [id, targetSectionId] = positionals;
  if (!id || !targetSectionId) die('usage: ch tasks move <id> <section>');

  if (!isSectionId(targetSectionId)) {
    die(`unknown section "${targetSectionId}". Valid: ${SECTION_IDS.join(', ')}`);
  }

  const doc = load();
  const { task, section: fromSection } = resolveTask(doc, id, values.section);

  if (fromSection.id === targetSectionId) {
    ok(`${id} is already in ${targetSectionId}`);
    return;
  }

  const toSection = sectionById(doc, targetSectionId);
  if (!toSection) die(`section "${targetSectionId}" not found in document. Try 'ch tasks lint --fix'`);

  // Remove from source
  fromSection.tasks = fromSection.tasks.filter(t => t.id !== id);
  // Update
  const today = todayStr();
  if (targetSectionId === 'done') {
    task.checked = true;
  }
  task.updated = today;
  appendHistory(task, { event: 'moved', from: fromSection.id, to: targetSectionId });
  // Add to target
  toSection.tasks.push(task);

  let spawned = null;
  if (targetSectionId === 'done') {
    spawned = maybeSpawnRecurrence(doc, task, today);
  }
  save(doc);

  if (values.json) {
    jsonOut({ id, from: fromSection.id, to: targetSectionId, spawned: spawned?.id || null });
    return;
  }
  ok(`moved ${id} ${fromSection.id} -> ${targetSectionId}${spawned ? ` (spawned ${spawned.id})` : ''}`);
}

function cmdDone(argv) {
  const { values, positionals } = parse(argv, {
    section: { type: 'string',  short: 's' },
    json:    { type: 'boolean', short: 'j' },
  });

  const id = positionals[0];
  if (!id) die('usage: ch tasks done <id>');

  const doc = load();
  const { task, section: fromSection } = resolveTask(doc, id, values.section);

  const doneSection = sectionById(doc, 'done');
  if (!doneSection) die('section "done" not found in document. Try \'ch tasks lint --fix\'');

  const alreadyDone = fromSection.id === 'done';

  // Mark checked
  task.checked = true;
  const today = todayStr();
  task.updated = today;

  if (!alreadyDone) {
    fromSection.tasks = fromSection.tasks.filter(t => t.id !== id);
    appendHistory(task, { event: 'moved', from: fromSection.id, to: 'done' });
    doneSection.tasks.push(task);
  }

  const spawned = !alreadyDone ? maybeSpawnRecurrence(doc, task, today) : null;
  save(doc);

  if (values.json) {
    jsonOut({ id, section: 'done', checked: true, spawned: spawned?.id || null });
    return;
  }
  ok(`done ${id}${alreadyDone ? ' (already in done)' : ` moved from ${fromSection.id}`}${spawned ? ` (spawned ${spawned.id})` : ''}`);
}

function cmdUpdate(argv) {
  const { values, positionals } = parse(argv, {
    description:     { type: 'string' },
    'add-description': { type: 'string' },
    note:            { type: 'string' }, // legacy alias for description
    'add-note':      { type: 'string' },
    title:           { type: 'string', short: 't' },
    priority:        { type: 'string', short: 'p' },
    type:            { type: 'string' },
    parent:          { type: 'string' },
    'clear-parent':  { type: 'boolean' },
    color:           { type: 'string' },
    'clear-color':   { type: 'boolean' },
    due:             { type: 'string' },
    'clear-due':     { type: 'boolean' },
    start:           { type: 'string' },
    'clear-start':   { type: 'boolean' },
    jira:            { type: 'string' },
    'clear-jira':    { type: 'boolean' },
    issue:           { type: 'string' },
    'clear-issue':   { type: 'boolean' },
    project:         { type: 'string' },
    'clear-project': { type: 'boolean' },
    energy:          { type: 'string' },
    'clear-energy':  { type: 'boolean' },
    snooze:          { type: 'string' },
    'clear-snooze':  { type: 'boolean' },
    decision:        { type: 'string' },
    'log-time':      { type: 'string' },
    'clear-logged':  { type: 'boolean' },
    'set-logged':    { type: 'string' },
    recur:           { type: 'string' },
    'recur-interval': { type: 'string' },
    'clear-recur':   { type: 'boolean' },
    blocked:         { type: 'boolean' },
    unblocked:       { type: 'boolean' },
    'waiting-on':    { type: 'string' },
    'clear-waiting-on': { type: 'boolean' },
    'add-label':     { type: 'string', multiple: true },
    'remove-label':  { type: 'string', multiple: true },
    'clear-labels':  { type: 'boolean' },
    'add-link':      { type: 'string', multiple: true },
    'link-label':    { type: 'string', multiple: true },
    'remove-link':   { type: 'string' },
    'clear-links':   { type: 'boolean' },
    'add-blocked-by': { type: 'string', multiple: true },
    'remove-blocked-by': { type: 'string', multiple: true },
    'clear-blocked-by': { type: 'boolean' },
    assignee:        { type: 'string' },
    'clear-assignee': { type: 'boolean' },
    estimate:        { type: 'string' },
    'clear-estimate': { type: 'boolean' },
    'add-subtask':   { type: 'string' },
    'check-subtask': { type: 'string' },  // N (1-based) as string
    'uncheck-subtask': { type: 'string' },
    'edit-subtask':  { type: 'string' },  // N (1-based); pairs with --subtask-text
    'subtask-text':  { type: 'string' },
    section:         { type: 'string',  short: 's' },
    uncheck:         { type: 'boolean' }, // reopen a task that was marked done
    check:           { type: 'boolean' }, // mark task checked (triggers recurrence spawn)
    json:            { type: 'boolean', short: 'j' },
  });

  const id = positionals[0];
  if (!id) die('usage: ch tasks update <id> [--title "..."] [--due YYYY-MM-DD] [--blocked] [--add-label L] [--add-link URL] [--add-blocked-by T1] ...');

  if (values.priority && !isPriority(values.priority)) {
    die(`unknown priority "${values.priority}". Valid: ${PRIORITIES.join(', ')}`);
  }
  if (values.color && !isHexColor(values.color)) {
    die(`invalid color "${values.color}". Use #RRGGBB`);
  }
  assertDueDate(values.due, '--due');
  assertDueDate(values.start, '--start');
  assertJiraKey(values.jira, '--jira');
  if (values.issue && !isHttpsUrl(values.issue)) {
    die(`invalid --issue "${values.issue}". Must be an HTTPS URL`);
  }
  if (values.energy && !isEnergy(values.energy)) {
    die(`invalid --energy "${values.energy}". Valid: ${ENERGY_VALUES.join(', ')}`);
  }
  assertDueDate(values.snooze, '--snooze');
  assertRecurrenceFreq(values.recur, '--recur');

  const doc = load();
  const { task } = resolveTask(doc, id, values.section);

  const wasChecked = task.checked;
  let changed = false;

  if (values.title !== undefined) {
    task.title = values.title;
    changed = true;
  }
  const newDesc = values.description ?? values.note;
  if (newDesc !== undefined) {
    task.description = newDesc;
    delete task.note;
    changed = true;
  }
  const addDesc = values['add-description'] ?? (values.note !== undefined ? values.note : undefined);
  if (addDesc !== undefined) {
    const existing = taskDescription(task);
    task.description = existing ? existing + '\n' + addDesc : addDesc;
    delete task.note;
    changed = true;
  }
  if (values.priority !== undefined) {
    const prev = task.priority;
    task.priority = values.priority;
    if (prev !== values.priority) {
      appendHistory(task, { event: 'priority', from: prev, to: values.priority });
    }
    changed = true;
  }
  if (values.type !== undefined) {
    const typeIds = new Set(normalizeTicketTypes(doc.ticketTypes).map(t => t.id));
    if (!typeIds.has(values.type)) {
      die(`unknown type "${values.type}". Valid: ${[...typeIds].join(', ')}`);
    }
    task.type = values.type;
    changed = true;
  }
  if (values['clear-parent']) {
    delete task.parentId;
    changed = true;
  } else if (values.parent !== undefined) {
    if (values.parent === id) die('parent cannot be the task itself');
    if (!findTask(doc, values.parent)) {
      die(`parent task ${values.parent} not found. Try: ch tasks list`);
    }
    task.parentId = values.parent;
    changed = true;
  }
  if (values.uncheck) {
    task.checked = false;
    changed = true;
  }
  if (values.check) {
    task.checked = true;
    changed = true;
  }
  if (values['clear-color']) {
    delete task.color;
    changed = true;
  } else if (values.color !== undefined) {
    task.color = values.color;
    changed = true;
  }

  if (values['clear-due']) {
    delete task.dueDate;
    changed = true;
  } else if (values.due !== undefined) {
    task.dueDate = values.due;
    changed = true;
  }

  if (values['clear-start']) {
    delete task.startDate;
    changed = true;
  } else if (values.start !== undefined) {
    task.startDate = values.start;
    changed = true;
  }

  if (values['clear-jira']) {
    delete task.jiraKey;
    changed = true;
  } else if (values.jira !== undefined) {
    task.jiraKey = values.jira.trim().toUpperCase();
    changed = true;
  }

  if (values['clear-issue']) {
    delete task.issueUrl;
    changed = true;
  } else if (values.issue !== undefined) {
    task.issueUrl = values.issue.trim();
    changed = true;
  }

  if (values['clear-project']) {
    delete task.project;
    changed = true;
  } else if (values.project !== undefined) {
    task.project = values.project.trim();
    if (!task.project) delete task.project;
    changed = true;
  }

  if (values['clear-energy']) {
    delete task.energy;
    changed = true;
  } else if (values.energy !== undefined) {
    task.energy = values.energy;
    changed = true;
  }

  if (values['clear-snooze']) {
    delete task.snoozeUntil;
    changed = true;
  } else if (values.snooze !== undefined) {
    task.snoozeUntil = values.snooze;
    changed = true;
  }

  if (values.decision !== undefined) {
    if (!Array.isArray(task.decisions)) task.decisions = [];
    task.decisions.push({ at: new Date().toISOString(), text: values.decision.trim() });
    changed = true;
  }

  if (values['clear-logged']) {
    delete task.loggedMinutes;
    changed = true;
  } else if (values['set-logged'] !== undefined) {
    task.loggedMinutes = parseLoggedMinutes(values['set-logged'], '--set-logged');
    changed = true;
  } else if (values['log-time'] !== undefined) {
    const addMins = parseLoggedMinutes(values['log-time'], '--log-time');
    task.loggedMinutes = (task.loggedMinutes || 0) + addMins;
    changed = true;
  }

  if (values['clear-recur']) {
    delete task.recurrence;
    changed = true;
  } else if (values.recur !== undefined) {
    const interval = values['recur-interval'] != null
      ? parseInt(values['recur-interval'], 10)
      : (task.recurrence?.interval || 1);
    if (values['recur-interval'] != null && (isNaN(interval) || interval < 1)) {
      die(`invalid --recur-interval "${values['recur-interval']}". Must be a positive integer`);
    }
    task.recurrence = { freq: values.recur, interval: interval > 0 ? interval : 1 };
    changed = true;
  } else if (values['recur-interval'] !== undefined) {
    if (!task.recurrence?.freq) {
      die('--recur-interval requires an existing --recur frequency');
    }
    const interval = parseInt(values['recur-interval'], 10);
    if (isNaN(interval) || interval < 1) {
      die(`invalid --recur-interval "${values['recur-interval']}". Must be a positive integer`);
    }
    task.recurrence.interval = interval;
    changed = true;
  }

  if (values['add-note'] !== undefined) {
    if (!Array.isArray(task.notes)) task.notes = [];
    task.notes.push({ at: new Date().toISOString(), text: values['add-note'].trim() });
    changed = true;
  }

  if (values.unblocked) {
    if (task.blocked) appendHistory(task, { event: 'unblocked' });
    delete task.blocked;
    changed = true;
  } else if (values.blocked) {
    if (!task.blocked) appendHistory(task, { event: 'blocked', to: values['waiting-on'] || '' });
    task.blocked = true;
    changed = true;
  }

  if (values['clear-waiting-on']) {
    delete task.waitingOn;
    changed = true;
  } else if (values['waiting-on'] !== undefined) {
    task.waitingOn = values['waiting-on'];
    changed = true;
  }

  if (values['clear-labels']) {
    delete task.labels;
    changed = true;
  } else {
    if (values['add-label'] && values['add-label'].length) {
      if (!Array.isArray(task.labels)) task.labels = [];
      for (const lab of values['add-label']) {
        const trimmed = lab.trim();
        if (trimmed && !task.labels.includes(trimmed)) task.labels.push(trimmed);
      }
      changed = true;
    }
    if (values['remove-label'] && values['remove-label'].length) {
      if (Array.isArray(task.labels)) {
        const remove = new Set(values['remove-label'].map(l => l.trim()));
        task.labels = task.labels.filter(l => !remove.has(l));
        if (task.labels.length === 0) delete task.labels;
      }
      changed = true;
    }
  }

  if (values['clear-links']) {
    delete task.links;
    changed = true;
  } else {
    if (values['add-link'] && values['add-link'].length) {
      if (!Array.isArray(task.links)) task.links = [];
      const labels = values['link-label'] || [];
      values['add-link'].forEach((url, i) => {
        const row = { url };
        if (labels[i]) row.label = labels[i];
        task.links.push(row);
      });
      changed = true;
    }
    if (values['remove-link'] !== undefined) {
      const n = parseInt(values['remove-link'], 10);
      if (!Array.isArray(task.links) || isNaN(n) || n < 1 || n > task.links.length) {
        die(`--remove-link N must be between 1 and ${(task.links || []).length}`);
      }
      task.links.splice(n - 1, 1);
      if (task.links.length === 0) delete task.links;
      changed = true;
    }
  }

  if (values['clear-blocked-by']) {
    delete task.blockedBy;
    changed = true;
  } else {
    if (values['add-blocked-by'] && values['add-blocked-by'].length) {
      if (!Array.isArray(task.blockedBy)) task.blockedBy = [];
      for (const depId of values['add-blocked-by']) {
        assertTaskId(depId, '--add-blocked-by');
        if (depId === id) die('blocked-by cannot be the task itself');
        if (!findTask(doc, depId)) {
          die(`blocked-by task ${depId} not found. Try: ch tasks list`);
        }
        if (!task.blockedBy.includes(depId)) task.blockedBy.push(depId);
      }
      changed = true;
    }
    if (values['remove-blocked-by'] && values['remove-blocked-by'].length) {
      if (Array.isArray(task.blockedBy)) {
        const remove = new Set(values['remove-blocked-by']);
        task.blockedBy = task.blockedBy.filter(d => !remove.has(d));
        if (task.blockedBy.length === 0) delete task.blockedBy;
      }
      changed = true;
    }
  }

  if (values['clear-assignee']) {
    if (task.assignee) appendHistory(task, { event: 'assignee', from: task.assignee, to: '' });
    delete task.assignee;
    changed = true;
  } else if (values.assignee !== undefined) {
    const prev = task.assignee || '';
    task.assignee = values.assignee.trim();
    if (!task.assignee) delete task.assignee;
    appendHistory(task, { event: 'assignee', from: prev, to: task.assignee || '' });
    changed = true;
  }

  if (values['clear-estimate']) {
    if (task.estimateMinutes) {
      appendHistory(task, { event: 'estimate', from: formatEstimate(task.estimateMinutes), to: '' });
    }
    delete task.estimateMinutes;
    changed = true;
  } else if (values.estimate !== undefined) {
    const mins = parseEstimate(values.estimate);
    if (mins == null) {
      die(`invalid --estimate "${values.estimate}". Try 30m, 2h, 1h30m, 1d, or minutes as a number`);
    }
    const prev = task.estimateMinutes ? formatEstimate(task.estimateMinutes) : '';
    task.estimateMinutes = mins;
    appendHistory(task, { event: 'estimate', from: prev, to: formatEstimate(mins) });
    changed = true;
  }

  if (values['add-subtask'] !== undefined) {
    if (!Array.isArray(task.subtasks)) task.subtasks = [];
    task.subtasks.push({ text: values['add-subtask'], checked: false });
    changed = true;
  }
  if (values['check-subtask'] !== undefined) {
    const n = parseInt(values['check-subtask'], 10);
    if (isNaN(n) || n < 1 || n > (task.subtasks || []).length) {
      die(`--check-subtask N must be between 1 and ${(task.subtasks || []).length}`);
    }
    task.subtasks[n - 1].checked = true;
    changed = true;
  }
  if (values['uncheck-subtask'] !== undefined) {
    const n = parseInt(values['uncheck-subtask'], 10);
    if (isNaN(n) || n < 1 || n > (task.subtasks || []).length) {
      die(`--uncheck-subtask N must be between 1 and ${(task.subtasks || []).length}`);
    }
    task.subtasks[n - 1].checked = false;
    changed = true;
  }
  if (values['edit-subtask'] !== undefined) {
    if (values['subtask-text'] === undefined) {
      die('--edit-subtask N requires --subtask-text "new text"');
    }
    const n = parseInt(values['edit-subtask'], 10);
    if (isNaN(n) || n < 1 || n > (task.subtasks || []).length) {
      die(`--edit-subtask N must be between 1 and ${(task.subtasks || []).length}`);
    }
    task.subtasks[n - 1].text = values['subtask-text'];
    changed = true;
  } else if (values['subtask-text'] !== undefined) {
    die('--subtask-text requires --edit-subtask N');
  }

  if (!changed) {
    die('no update flags provided. See: ch tasks update --help');
  }

  const today = todayStr();
  task.updated = today;

  let spawned = null;
  if (values.check && !wasChecked && task.checked && task.recurrence?.freq) {
    spawned = maybeSpawnRecurrence(doc, task, today);
  }
  save(doc);

  if (values.json) {
    jsonOut(spawned ? { ...task, spawned: spawned.id } : task);
    return;
  }
  ok(`updated ${id}${spawned ? ` (spawned ${spawned.id})` : ''}`);
}

function cmdSetPriority(argv) {
  const { values, positionals } = parse(argv, {
    section: { type: 'string',  short: 's' },
    json:    { type: 'boolean', short: 'j' },
  });

  const [id, priority] = positionals;
  if (!id || !priority) die('usage: ch tasks set-priority <id> <low|medium|high>');

  if (!isPriority(priority)) {
    die(`unknown priority "${priority}". Valid: ${PRIORITIES.join(', ')}`);
  }

  const doc = load();
  const { task } = resolveTask(doc, id, values.section);

  const prev = task.priority;
  task.priority = priority;
  task.updated = todayStr();
  if (prev !== priority) {
    appendHistory(task, { event: 'priority', from: prev, to: priority });
  }
  save(doc);

  if (values.json) {
    jsonOut({ id, priority, prev });
    return;
  }
  ok(`${id} priority ${prev} -> ${priority}`);
}

function cmdNextId(argv) {
  const { values } = parse(argv, {
    json: { type: 'boolean', short: 'j' },
  });

  const doc = load();
  const id = nextId(doc);

  if (values.json) {
    jsonOut({ nextId: id });
    return;
  }
  print(id);
}

function cmdDump(argv) {
  const { values } = parse(argv, {
    active: { type: 'boolean', short: 'a' },
    json:   { type: 'boolean', short: 'j' },
  });

  const doc = load();
  const tasks = flatTasks(doc, { active: values.active || false });

  // Compact dump: id, title, section, priority, checked, description, due, blocked, labels, links, deps
  const out = tasks.map(t => ({
    id: t.id,
    section: t.section,
    title: t.title,
    description: taskDescription(t),
    priority: t.priority,
    checked: t.checked,
    dueDate: t.dueDate || null,
    startDate: t.startDate || null,
    jiraKey: t.jiraKey || null,
    issueUrl: t.issueUrl || null,
    project: t.project || null,
    energy: t.energy || null,
    snoozeUntil: t.snoozeUntil || null,
    blocked: !!t.blocked,
    waitingOn: t.waitingOn || null,
    labels: Array.isArray(t.labels) ? t.labels : [],
    links: Array.isArray(t.links) ? t.links : [],
    blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy : [],
    assignee: t.assignee || null,
    estimateMinutes: t.estimateMinutes ?? null,
    estimate: t.estimateMinutes ? formatEstimate(t.estimateMinutes) : null,
    loggedMinutes: t.loggedMinutes ?? null,
    logged: t.loggedMinutes ? formatEstimate(t.loggedMinutes) : null,
    timeEntries: Array.isArray(t.timeEntries) ? t.timeEntries.length : 0,
    decisions: Array.isArray(t.decisions) ? t.decisions.length : 0,
    recurrence: t.recurrence || null,
    notes: Array.isArray(t.notes) ? t.notes.length : 0,
    subtasks: (t.subtasks || []).length,
    subtasksDone: (t.subtasks || []).filter(s => s.checked).length,
  }));

  // dump always outputs JSON (compact)
  jsonOut(out);
}

async function cmdExport(argv) {
  const { values } = parse(argv, {
    md:   { type: 'boolean' },
    json: { type: 'boolean', short: 'j' },
  });

  const doc = load();

  // Import toMarkdown from dashboard (ESM — dynamic import to keep errors clean)
  let toMarkdown;
  try {
    const mod = await import('../../dashboard/js/tasks-parser.js');
    toMarkdown = mod.toMarkdown;
  } catch (e) {
    die(`failed to load dashboard/js/tasks-parser.js: ${e.message}`, 2);
  }

  const { sections, tasks } = docToDashboardShape(doc);
  const md = toMarkdown(sections, tasks);

  if (values.json) {
    jsonOut({ markdown: md });
    return;
  }
  print(md.trimEnd());
}

function cmdLint(argv) {
  const { values } = parse(argv, {
    fix:  { type: 'boolean' },
    json: { type: 'boolean', short: 'j' },
  });

  // Use readJson directly — lint must work even when load() would throw
  let doc;
  try {
    doc = normalizeTasksDoc(readJson(tasksJsonPath()));
  } catch (e) {
    if (values.json) {
      jsonOut({ valid: false, errors: [e.message], duplicateIds: [] });
    } else {
      printErr(`lint: cannot read tasks.json: ${e.message}`);
    }
    process.exit(2);
  }

  let sectionsAdded = [];
  if (values.fix) {
    const ensured = ensureSections(doc);
    sectionsAdded = ensured.added || [];
    doc.meta = normalizeMeta(doc.meta);
  }

  const result = validateTasksDoc(doc);

  if (result.valid) {
    // Persist note→description, missing sections, meta when --fix is set
    if (values.fix) {
      save(doc);
      if (values.json) {
        jsonOut({
          valid: true,
          errors: [],
          duplicateIds: [],
          migrated: true,
          sectionsAdded,
        });
        return;
      }
      const extra = sectionsAdded.length
        ? ` (added sections: ${sectionsAdded.join(', ')})`
        : '';
      ok(`lint: valid (normalized legacy fields)${extra}`);
      return;
    }
    if (values.json) {
      jsonOut({ valid: true, errors: [], duplicateIds: [] });
      return;
    }
    ok('lint: valid (no errors)');
    return;
  }

  // Report errors
  const nonDupErrors = result.errors.filter(e => !e.startsWith('duplicate task id'));
  const dupIds = result.duplicateIds;

  if (!values.json) {
    if (nonDupErrors.length > 0) {
      printErr(`lint errors (${nonDupErrors.length}):`);
      nonDupErrors.forEach(e => printErr(`  - ${e}`));
    }
    if (dupIds.length > 0) {
      printErr(`\nduplicate task ids (${dupIds.length}): ${dupIds.join(', ')}`);
    }
  }

  // Handle --fix for duplicates: keep the most "complete" copy, remove stragglers.
  // Section preference order (highest to lowest): done > in-progress > todo > backlog > archive > inbox.
  // Tiebreak: prefer copies with a valid title string.
  if (values.fix && dupIds.length > 0) {
    let fixedCount = 0;
    for (const dupId of dupIds) {
      const matches = findAll(doc, dupId);
      const sectionPriority = ['done', 'in-progress', 'todo', 'backlog', 'inbox', 'archive'];
      // Score each match: lower score = higher priority to keep
      const scored = matches.map(m => {
        const sIdx = sectionPriority.indexOf(m.section.id);
        const sectionRank = sIdx === -1 ? sectionPriority.length : sIdx;
        // 0 = has valid title (good), 1 = no title (bad)
        const missingTitle = typeof m.task.title === 'string' ? 0 : 1;
        return { m, sectionRank, missingTitle };
      });
      // Primary: prefer copies with a valid title. Secondary: prefer section (done > in-progress > todo...).
      scored.sort((a, b) => a.missingTitle - b.missingTitle || a.sectionRank - b.sectionRank);
      const keep = scored[0].m;
      void keep;

      // Remove all others
      for (const { m } of scored.slice(1)) {
        m.section.tasks = m.section.tasks.filter(t => t.id !== dupId);
        fixedCount++;
      }
    }

    ensureSections(doc);
    doc.meta = normalizeMeta(doc.meta);

    // Re-validate after fix
    const recheck = validateTasksDoc(doc);
    if (!recheck.valid && recheck.duplicateIds.length === 0) {
      // Still invalid for other reasons
      if (values.json) {
        jsonOut({ valid: false, errors: recheck.errors, duplicateIds: [], fixed: fixedCount });
      } else {
        printErr(`\nremaining errors after fix (${recheck.errors.length}):`);
        recheck.errors.forEach(e => printErr(`  - ${e}`));
      }
      process.exit(2);
    }

    if (recheck.valid) {
      save(doc);
      if (values.json) {
        jsonOut({ valid: true, errors: [], duplicateIds: [], fixed: fixedCount, sectionsAdded });
      } else {
        ok(`fixed: removed ${fixedCount} duplicate task(s). Document is now valid.`);
      }
      return;
    }

    // Still dupes or other errors
    if (values.json) {
      jsonOut({ valid: false, errors: recheck.errors, duplicateIds: recheck.duplicateIds, fixed: fixedCount });
    } else {
      printErr('\nfix incomplete — remaining errors:');
      recheck.errors.forEach(e => printErr(`  - ${e}`));
    }
    process.exit(2);
  }

  if (values.json) {
    jsonOut({ valid: false, errors: result.errors, duplicateIds: dupIds });
  } else if (dupIds.length > 0 && !values.fix) {
    printErr('\nHint: run with --fix to auto-remove duplicate task copies (keeps copy in "done")');
  }

  process.exit(2);
}

/** Capture: shorthand add into inbox. */
function cmdCapture(argv) {
  const { values, positionals } = parse(argv, {
    priority: { type: 'string', short: 'p', default: 'medium' },
    json:     { type: 'boolean', short: 'j' },
  });
  const title = positionals[0];
  if (!title) die('usage: ch tasks capture "<title>"');

  // Reuse add with --section inbox
  const rest = [title, '--section', 'inbox'];
  if (values.priority) rest.push('--priority', values.priority);
  if (values.json) rest.push('--json');
  return cmdAdd(rest);
}

/** Today plan: show / pin / unpin / carry unfinished pins. */
function cmdPlan(argv) {
  const { values } = parse(argv, {
    pin:    { type: 'string', multiple: true },
    unpin:  { type: 'string', multiple: true },
    carry:  { type: 'boolean' },
    json:   { type: 'boolean', short: 'j' },
  });

  const doc = load();
  if (!doc.meta) doc.meta = defaultMeta();
  doc.meta = normalizeMeta(doc.meta);

  const today = todayStr();
  let plan = doc.meta.dailyPlan;
  let changed = false;

  // Date rollover: unfinished pins → carriedIds, then re-pin
  if (plan.date && plan.date !== today) {
    const unfinished = (plan.taskIds || []).filter(id => {
      const found = findTask(doc, id);
      if (!found) return false;
      if (found.task.checked) return false;
      if (found.section.id === 'done' || found.section.id === 'archive') return false;
      return true;
    });
    plan = {
      date: today,
      taskIds: unfinished,
      carriedIds: unfinished,
    };
    doc.meta.dailyPlan = plan;
    changed = true;
  } else if (!plan.date) {
    plan.date = today;
    changed = true;
  }

  if (values.carry) {
    const unfinished = (plan.taskIds || []).filter(id => {
      const found = findTask(doc, id);
      if (!found) return false;
      if (found.task.checked) return false;
      if (found.section.id === 'done' || found.section.id === 'archive') return false;
      return true;
    });
    plan.taskIds = unfinished;
    plan.carriedIds = unfinished;
    plan.date = today;
    changed = true;
  }

  if (values.pin && values.pin.length) {
    if (!Array.isArray(plan.taskIds)) plan.taskIds = [];
    for (const id of values.pin) {
      assertTaskId(id, '--pin');
      if (!findTask(doc, id)) die(`task ${id} not found. Try: ch tasks list`);
      if (!plan.taskIds.includes(id)) plan.taskIds.push(id);
    }
    plan.date = today;
    changed = true;
  }

  if (values.unpin && values.unpin.length) {
    const remove = new Set(values.unpin);
    plan.taskIds = (plan.taskIds || []).filter(id => !remove.has(id));
    plan.carriedIds = (plan.carriedIds || []).filter(id => !remove.has(id));
    changed = true;
  }

  doc.meta.dailyPlan = plan;
  if (changed) save(doc);

  const rows = (plan.taskIds || []).map(id => {
    const found = findTask(doc, id);
    return {
      id,
      title: found?.task?.title || '(missing)',
      section: found?.section?.id || null,
      estimateMinutes: found?.task?.estimateMinutes ?? null,
      carried: (plan.carriedIds || []).includes(id),
    };
  });

  if (values.json) {
    jsonOut({ date: plan.date, taskIds: plan.taskIds, carriedIds: plan.carriedIds || [], tasks: rows });
    return;
  }

  print(`Today plan (${plan.date}):`);
  if (rows.length === 0) {
    print('  (empty — pin with: ch tasks plan --pin T1)');
    return;
  }
  for (const r of rows) {
    const est = r.estimateMinutes ? ` ~${formatEstimate(r.estimateMinutes)}` : '';
    const carried = r.carried ? ' [carried]' : '';
    print(`  ${r.id} [${r.section || '?'}] ${r.title}${est}${carried}`);
  }
}

function cmdArchiveDone(argv) {
  const { values } = parse(argv, {
    json: { type: 'boolean', short: 'j' },
  });

  const ARCHIVE_DAYS = 7;
  const doc = load();

  const doneSection = sectionById(doc, 'done');
  if (!doneSection || doneSection.tasks.length === 0) {
    if (values.json) { jsonOut({ archived: 0 }); return; }
    ok('archive-done: nothing to archive');
    return;
  }

  const now = new Date();
  const toMove = [];
  const toKeep = [];

  for (const task of doneSection.tasks) {
    const dateStr = task.updated || task.created;
    if (!dateStr) {
      toKeep.push(task);
      continue;
    }
    const taskDate = new Date(dateStr + 'T00:00:00');
    const diffDays = (now - taskDate) / (1000 * 60 * 60 * 24);
    if (diffDays >= ARCHIVE_DAYS) {
      toMove.push(task);
    } else {
      toKeep.push(task);
    }
  }

  if (toMove.length === 0) {
    if (values.json) { jsonOut({ archived: 0 }); return; }
    ok(`archive-done: 0 tasks archived (none older than ${ARCHIVE_DAYS} days)`);
    return;
  }

  // Ensure archive section exists
  let archiveSection = sectionById(doc, 'archive');
  if (!archiveSection) {
    archiveSection = { id: 'archive', name: 'Archive', tasks: [] };
    doc.sections.push(archiveSection);
  }

  // Move tasks
  doneSection.tasks = toKeep;
  for (const task of toMove) {
    task.updated = todayStr();
    archiveSection.tasks.push(task);
  }

  save(doc);

  if (values.json) {
    jsonOut({ archived: toMove.length, ids: toMove.map(t => t.id) });
    return;
  }
  ok(`archive-done: archived ${toMove.length} task(s) -> archive`);
}

// ---------------------------------------------------------------------------
// Usage / dispatch
// ---------------------------------------------------------------------------

const USAGE = `ch tasks <subcommand> [args...]

Subcommands:
  list [--section S] [--priority P] [--active] [--json]
  get <id> [--json]
  capture "<title>" [--priority medium] [--json]
  plan [--pin T1] [--unpin T1] [--carry] [--json]
  add "<title>" [--section todo] [--priority medium] [--description "..."] [--color "#RRGGBB"]
      [--due YYYY-MM-DD] [--start YYYY-MM-DD] [--jira PROJECT-123] [--issue URL]
      [--project slug] [--energy deep|shallow|errands|creative] [--snooze YYYY-MM-DD]
      [--decision "..."] [--log-time 30m|2h]
      [--recur daily|weekly|monthly] [--recur-interval N] [--add-note "..."]
      [--estimate 2h|30m|1d] [--assignee name] [--blocked] [--waiting-on "..."]
      [--label L] [--link URL] [--blocked-by T1]
  move <id> <section>
  done <id>
  update <id> [--title "..."] [--description "..."] [--add-description "..."] [--priority P]
             [--color "#RRGGBB"] [--clear-color]
             [--due YYYY-MM-DD] [--clear-due] [--start YYYY-MM-DD] [--clear-start]
             [--jira PROJECT-123] [--clear-jira] [--issue URL] [--clear-issue]
             [--project slug] [--clear-project] [--energy E] [--clear-energy]
             [--snooze YYYY-MM-DD] [--clear-snooze] [--decision "..."]
             [--log-time 30m|2h] [--set-logged 2h] [--clear-logged]
             [--recur daily|weekly|monthly] [--recur-interval N] [--clear-recur] [--add-note "..."]
             [--estimate 2h] [--clear-estimate]
             [--assignee name] [--clear-assignee] [--check] [--uncheck]
             [--blocked] [--unblocked] [--waiting-on "..."] [--clear-waiting-on]
             [--add-label L] [--remove-label L] [--clear-labels]
             [--add-link URL] [--link-label "..."] [--remove-link N] [--clear-links]
             [--add-blocked-by T1] [--remove-blocked-by T1] [--clear-blocked-by]
             [--add-subtask "text"] [--check-subtask N] [--uncheck-subtask N]
  set-priority <id> <low|medium|high>
  next-id
  dump [--active]
  export [--md]
  lint [--fix]
  archive-done`;

const SUBCOMMANDS = {
  list:          cmdList,
  get:           cmdGet,
  capture:       cmdCapture,
  plan:          cmdPlan,
  add:           cmdAdd,
  move:          cmdMove,
  done:          cmdDone,
  update:        cmdUpdate,
  'set-priority': cmdSetPriority,
  'next-id':     cmdNextId,
  dump:          cmdDump,
  export:        cmdExport,
  lint:          cmdLint,
  'archive-done': cmdArchiveDone,
};

export default async function tasks(argv) {
  const sub = argv[0];

  if (!sub || sub === '--help' || sub === 'help') {
    print(USAGE);
    process.exit(0);
  }

  const handler = SUBCOMMANDS[sub];
  if (!handler) {
    die(`unknown subcommand: ${sub}\n${USAGE}`);
  }

  await handler(argv.slice(1));
}
