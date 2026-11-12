/**
 * cli/commands/tasks-sweep-idle.js
 * `ch tasks sweep-idle [--hours 24] [--dry-run] [--no-collect] [--json]`: move back to todo every in-progress
 * ticket (epics skipped) with no session activity for --hours. Each moved ticket gets a decision saying why.
 * Session activity comes from $CH_HOME/metrics/sessions.jsonl; a real run reads the Claude Code transcripts
 * first (`ch metrics collect --sessions`) so a live session is never missed; --dry-run changes nothing,
 * so it reads the data as it is. Refuses to sweep when no session data exists at all.
 */
import { parse } from '../lib/args.js';
import { print, jsonOut, die } from '../lib/output.js';
import { load, save, sectionById, todayStr } from '../lib/tasks-store.js';
import { appendHistory } from '../lib/schema.js';
import { readRecords } from '../lib/metrics-store.js';
import { idleInProgress } from '../../shared/idle-sweep.js';

export default async function cmdSweepIdle(argv) {
  const { values } = parse(argv, {
    hours: { type: 'string', default: '24' },
    'dry-run': { type: 'boolean' },
    'no-collect': { type: 'boolean' },
    json: { type: 'boolean' },
  });
  const hours = Number(values.hours);
  if (!(hours > 0)) die('usage: ch tasks sweep-idle [--hours 24] [--dry-run] [--no-collect] [--json]');

  if (!values['dry-run'] && !values['no-collect']) {
    const { runCollect } = await import('./metrics.js');
    try { await runCollect({ sessions: true }); } catch (e) { die(`sweep-idle: could not read sessions (${e.message}); use --no-collect to sweep on the data as it is`); }
  }
  const sessions = readRecords('sessions.jsonl');
  if (!sessions.length) die('sweep-idle: no session data (run ch metrics collect --sessions first); nothing swept');

  const doc = load();
  const now = Date.now();
  const idle = idleInProgress({ doc, sessions, now, hours });
  const moved = [];
  if (!values['dry-run'] && idle.length) {
    const from = sectionById(doc, 'in-progress');
    const to = sectionById(doc, 'todo');
    if (!to) die('section "todo" not found. Try ch tasks lint --fix');
    for (const row of idle) {
      const task = from.tasks.find(t => t.id === row.id);
      if (!task) continue;
      from.tasks = from.tasks.filter(t => t.id !== row.id);
      task.updated = todayStr();
      task.checked = false;
      appendHistory(task, { event: 'moved', from: 'in-progress', to: 'todo', note: 'idle sweep' });
      const why = row.lastActivity
        ? `last session work ${row.lastActivity.slice(0, 16).replace('T', ' ')} UTC (${row.idleHours} h ago)`
        : 'no session work recorded';
      task.decisions = [...(Array.isArray(task.decisions) ? task.decisions : []),
        { at: new Date(now).toISOString(), text: `Idle sweep: moved back to todo, no session work for ${hours}+ hours (${why}). Start it again when a session picks it up.` }];
      to.tasks.push(task);
      moved.push(row.id);
    }
    save(doc);
  }
  if (values.json) { jsonOut({ hours, dryRun: !!values['dry-run'], idle, moved }); return; }
  if (!idle.length) { print(`No in-progress ticket idle for ${hours}+ hours.`); return; }
  print(`${values['dry-run'] ? 'Would move' : 'Moved'} ${idle.length} idle ticket(s) back to todo (no session work for ${hours}+ hours):`);
  for (const r of idle) print(`  ${r.id}  ${r.idleHours === null ? 'no session work' : `${r.idleHours} h`}  ${r.title}`);
}
