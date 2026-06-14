/**
 * cli/commands/tasks.js
 * Task management subcommands for the ch CLI.
 *
 * Usage: ch tasks <subcommand> [args...]
 *
 * Subcommands:
 *   list [--section S] [--priority P] [--active] [--json]
 *   get <id> [--json]
 *   add "<title>" [--section todo] [--priority medium] [--note "..."]
 *   move <id> <section>
 *   done <id>
 *   update <id> [--note "..."] [--add-note "..."] [--title "..."] [--priority P]
 *              [--add-subtask "text"] [--check-subtask N] [--uncheck-subtask N]
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
  SECTION_IDS, PRIORITIES, isSectionId, isPriority, validateTasksDoc,
} from '../lib/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a task for terse single-line display. */
function formatTaskLine(task, sectionId) {
  const sectionStr = sectionId ? ` [${sectionId}]` : '';
  const check = task.checked ? '[x]' : '[ ]';
  const subtaskInfo = task.subtasks && task.subtasks.length > 0
    ? ` (${task.subtasks.filter(s => s.checked).length}/${task.subtasks.length} subtasks)`
    : '';
  const note = task.note ? ` — ${task.note.split('\n')[0]}` : '';
  return `${task.id}${sectionStr} ${check} [${task.priority}] ${task.title}${note}${subtaskInfo}`;
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
 * Dashboard task fields: title, note, checked, subtasks, created, updated,
 *   priority, taskId (maps from our .id)
 */
function docToDashboardShape(doc) {
  const sections = doc.sections.map(s => ({ id: s.id, name: s.name }));
  const tasks = {};
  for (const s of doc.sections) {
    tasks[s.id] = s.tasks.map(t => ({
      taskId: t.id,
      title: t.title,
      note: t.note || '',
      checked: t.checked,
      subtasks: t.subtasks || [],
      created: t.created || null,
      updated: t.updated || null,
      priority: t.priority,
    }));
  }
  return { sections, tasks };
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
  if (task.note) print(`  note: ${task.note}`);
  if (task.subtasks && task.subtasks.length > 0) {
    task.subtasks.forEach((st, i) => {
      print(`  ${i + 1}. [${st.checked ? 'x' : ' '}] ${st.text}`);
    });
  }
  print(`  created: ${task.created || 'n/a'}  updated: ${task.updated || 'n/a'}`);
}

function cmdAdd(argv) {
  const { values, positionals } = parse(argv, {
    section:  { type: 'string', short: 's', default: 'todo' },
    priority: { type: 'string', short: 'p', default: 'medium' },
    note:     { type: 'string', short: 'n' },
    json:     { type: 'boolean', short: 'j' },
  });

  const title = positionals[0];
  if (!title) die('usage: ch tasks add "<title>" [--section todo] [--priority medium] [--note "..."]');

  if (!isSectionId(values.section)) {
    die(`unknown section "${values.section}". Valid: ${SECTION_IDS.join(', ')}`);
  }
  if (!isPriority(values.priority)) {
    die(`unknown priority "${values.priority}". Valid: ${PRIORITIES.join(', ')}`);
  }

  const doc = load();
  const id = nextId(doc);

  const task = {
    id,
    title,
    checked: false,
    priority: values.priority,
    created: todayStr(),
    updated: null,
    subtasks: [],
  };
  if (values.note) task.note = values.note;

  let sec = sectionById(doc, values.section);
  if (!sec) {
    // Shouldn't happen since we validated isSectionId, but be safe
    die(`section "${values.section}" not found in document. Try 'ch tasks lint --fix'`);
  }
  sec.tasks.push(task);
  save(doc);

  if (values.json) {
    jsonOut({ id, section: values.section });
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
  task.updated = todayStr();
  // Add to target
  toSection.tasks.push(task);
  save(doc);

  if (values.json) {
    jsonOut({ id, from: fromSection.id, to: targetSectionId });
    return;
  }
  ok(`moved ${id} ${fromSection.id} -> ${targetSectionId}`);
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

  // Mark checked
  task.checked = true;
  task.updated = todayStr();

  const alreadyDone = fromSection.id === 'done';
  if (!alreadyDone) {
    fromSection.tasks = fromSection.tasks.filter(t => t.id !== id);
    doneSection.tasks.push(task);
  }
  save(doc);

  if (values.json) {
    jsonOut({ id, section: 'done', checked: true });
    return;
  }
  ok(`done ${id}${alreadyDone ? ' (already in done)' : ` moved from ${fromSection.id}`}`);
}

function cmdUpdate(argv) {
  const { values, positionals } = parse(argv, {
    note:            { type: 'string' },
    'add-note':      { type: 'string' },
    title:           { type: 'string', short: 't' },
    priority:        { type: 'string', short: 'p' },
    'add-subtask':   { type: 'string' },
    'check-subtask': { type: 'string' },  // N (1-based) as string
    'uncheck-subtask': { type: 'string' },
    section:         { type: 'string',  short: 's' },
    json:            { type: 'boolean', short: 'j' },
  });

  const id = positionals[0];
  if (!id) die('usage: ch tasks update <id> [--title "..."] [--note "..."] [--add-note "..."] [--priority P] [--add-subtask "text"] [--check-subtask N] [--uncheck-subtask N]');

  if (values.priority && !isPriority(values.priority)) {
    die(`unknown priority "${values.priority}". Valid: ${PRIORITIES.join(', ')}`);
  }

  const doc = load();
  const { task } = resolveTask(doc, id, values.section);

  let changed = false;

  if (values.title !== undefined) {
    task.title = values.title;
    changed = true;
  }
  if (values.note !== undefined) {
    task.note = values.note;
    changed = true;
  }
  if (values['add-note'] !== undefined) {
    const existing = task.note || '';
    task.note = existing ? existing + '\n' + values['add-note'] : values['add-note'];
    changed = true;
  }
  if (values.priority !== undefined) {
    task.priority = values.priority;
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

  if (!changed) {
    die('no update flags provided. See: ch tasks update --help');
  }

  task.updated = todayStr();
  save(doc);

  if (values.json) {
    jsonOut(task);
    return;
  }
  ok(`updated ${id}`);
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

  // Compact dump: id, title, section, priority, checked, note, subtask counts
  const out = tasks.map(t => ({
    id: t.id,
    section: t.section,
    title: t.title,
    note: t.note || '',
    priority: t.priority,
    checked: t.checked,
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
    doc = readJson(tasksJsonPath());
  } catch (e) {
    if (values.json) {
      jsonOut({ valid: false, errors: [e.message], duplicateIds: [] });
    } else {
      printErr(`lint: cannot read tasks.json: ${e.message}`);
    }
    process.exit(2);
  }
  const result = validateTasksDoc(doc);

  if (result.valid) {
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
  // Section preference order (highest to lowest): done > in-progress > todo > backlog > archive.
  // Tiebreak: prefer copies with a valid title string.
  if (values.fix && dupIds.length > 0) {
    let fixedCount = 0;
    for (const dupId of dupIds) {
      const matches = findAll(doc, dupId);
      const sectionPriority = ['done', 'in-progress', 'todo', 'backlog', 'archive'];
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

      // Remove all others
      for (const { m } of scored.slice(1)) {
        m.section.tasks = m.section.tasks.filter(t => t.id !== dupId);
        fixedCount++;
      }
    }

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
        jsonOut({ valid: true, errors: [], duplicateIds: [], fixed: fixedCount });
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
  add "<title>" [--section todo] [--priority medium] [--note "..."]
  move <id> <section>
  done <id>
  update <id> [--title "..."] [--note "..."] [--add-note "..."] [--priority P]
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
