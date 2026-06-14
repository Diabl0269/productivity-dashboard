/**
 * cli/migrate/md-to-json.js
 * One-time migration: TASKS.md (markdown) -> tasks.json (canonical JSON).
 *
 * - Preserves all tasks, notes, subtasks, dates, and priorities.
 * - Assigns sequential ids to any id-less task (e.g. legacy Archive entries),
 *   continuing from the current max id so existing ids are never reused.
 * - Resolves duplicate ids by keeping the copy in the most-complete section
 *   (archive > done > in-progress > todo > backlog) and dropping the rest.
 *
 * Reuses the dashboard's existing parser so the markdown interpretation is
 * identical to what the dashboard always produced.
 *
 * Usage:
 *   node cli/migrate/md-to-json.js [--dry-run] [--out <path>]
 *
 * All diagnostics go to stderr; with --dry-run the resulting JSON is printed
 * to stdout and nothing is written.
 */

import { parseTaskMarkdown } from '../../dashboard/js/tasks-parser.js';
import { SECTIONS, validateTasksDoc } from '../lib/schema.js';
import { tasksMdPath, tasksJsonPath, readText, atomicWrite, exists } from '../lib/io.js';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const outIdx = argv.indexOf('--out');
const outPath = outIdx !== -1 ? argv[outIdx + 1] : tasksJsonPath();

// Higher rank = more "complete" stage; on duplicate id we keep the higher rank.
const SECTION_RANK = { archive: 4, done: 3, 'in-progress': 2, todo: 1, backlog: 0 };

function main() {
  const mdPath = tasksMdPath();
  if (!exists(mdPath)) {
    console.error(`TASKS.md not found at ${mdPath}`);
    process.exit(2);
  }
  const md = readText(mdPath);
  const parsed = parseTaskMarkdown(md); // { sections:[{id,name}], tasks:{[sectionId]:[...]} }

  // 1. Max existing numeric id (so assigned ids never collide).
  let maxId = 0;
  for (const sid in parsed.tasks) {
    for (const t of parsed.tasks[sid]) {
      if (t.taskId) {
        const n = parseInt(t.taskId.slice(1), 10);
        if (!Number.isNaN(n) && n > maxId) maxId = n;
      }
    }
  }

  // 2. Build canonical sections; assign ids to id-less tasks.
  const assigned = [];
  const sections = SECTIONS.map(sec => {
    const srcTasks = parsed.tasks[sec.id] || [];
    const tasks = srcTasks.map(t => {
      let id = t.taskId;
      if (!id) {
        maxId += 1;
        id = `T${maxId}`;
        assigned.push({ id, section: sec.id });
      }
      return {
        id,
        title: t.title,
        note: t.note || '',
        checked: !!t.checked,
        priority: t.priority || 'medium',
        created: t.created || null,
        updated: t.updated || null,
        subtasks: (t.subtasks || []).map(s => ({ text: s.text, checked: !!s.checked })),
        _rank: SECTION_RANK[sec.id] ?? 0,
      };
    });
    return { id: sec.id, name: sec.name, tasks };
  });

  // 3. Resolve duplicate ids — keep the highest-rank (most-complete) copy.
  const byId = new Map(); // id -> { si, ti, rank }
  const dropped = [];
  sections.forEach((sec, si) => {
    sec.tasks.forEach((t, ti) => {
      const prev = byId.get(t.id);
      if (!prev) {
        byId.set(t.id, { si, ti, rank: t._rank });
        return;
      }
      if (t._rank > prev.rank) {
        dropped.push({ id: t.id, section: sections[prev.si].id });
        sections[prev.si].tasks[prev.ti] = null;
        byId.set(t.id, { si, ti, rank: t._rank });
      } else {
        dropped.push({ id: t.id, section: sec.id });
        sec.tasks[ti] = null;
      }
    });
  });

  // Strip dropped (null) entries and the internal _rank field.
  for (const sec of sections) {
    sec.tasks = sec.tasks.filter(Boolean).map(t => {
      const { _rank, ...rest } = t;
      return rest;
    });
  }

  const doc = { version: 1, sections };

  // 4. Validate + report.
  const res = validateTasksDoc(doc);
  const counts = sections.map(s => `${s.id}:${s.tasks.length}`).join('  ');
  console.error(`Parsed TASKS.md -> ${counts}`);
  if (assigned.length) {
    console.error(`Assigned ids to ${assigned.length} id-less task(s): ${assigned.map(a => a.id).join(', ')}`);
  }
  if (dropped.length) {
    console.error(`Resolved ${dropped.length} duplicate-id copy(ies) (kept most-complete section):`);
    for (const d of dropped) console.error(`  dropped ${d.id} from "${d.section}"`);
  }
  if (!res.valid) {
    console.error('VALIDATION FAILED:');
    res.errors.forEach(e => console.error('  ' + e));
    process.exit(2);
  }
  console.error('Validation: OK');

  if (dryRun) {
    console.error('(dry-run — not writing)');
    console.log(JSON.stringify(doc, null, 2));
    return;
  }
  atomicWrite(outPath, JSON.stringify(doc, null, 2) + '\n');
  console.error(`Wrote ${outPath}`);
}

main();
