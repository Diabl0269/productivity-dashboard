/**
 * cli/commands/tasks-notes-prep.js
 * `ch tasks notes prep [--ticket ID] [--json]`: routing, flags and duplicate hints for every unsent note (run before `notes send`).
 * `ch tasks notes report --since <ISO> [--apply-auto] [--json]`: after `notes send`, one line per filed note, the tickets still
 * carrying a raw title, and which epics are Ready and could take `auto` (--apply-auto adds the label).
 * Rules: shared/notes-prep.js (PRO105).
 */

import { parse } from '../lib/args.js';
import { print, jsonOut, die } from '../lib/output.js';
import { load, save } from '../lib/tasks-store.js';
import { prepNotes, roundReport, applyAuto } from '../../shared/notes-prep.js';

export function cmdNotesPrep(argv) {
  const { values } = parse(argv, { ticket: { type: 'string' }, json: { type: 'boolean', short: 'j' } });
  const res = prepNotes(load(), { ticket: values.ticket });
  if (values.json) { jsonOut(res); return; }
  if (!res.items.length) { print('No new review notes.'); return; }
  for (const i of res.items) {
    const where = i.epic ? (i.epic.isNew ? `new epic "${i.epic.title}"` : `${i.epic.id} ${i.epic.title} (${i.epic.section})`) : 'no epic';
    print(`${i.handle} [${i.kind}] ${i.title}`.trimEnd());
    print(`  -> ${where}${i.flags.length ? `  FLAGS: ${i.flags.join(', ')}` : ''}`);
    for (const d of i.dupes) print(`  maybe duplicate of ${d.kind === 'ticket' ? d.id : d.handle} (${d.score}): ${d.title}`);
  }
  print(`${res.counts.notes} note(s), ${res.counts.flagged} flagged, ${res.counts.withDupes} with duplicate hints`);
}

export function cmdNotesReport(argv) {
  const { values } = parse(argv, {
    since: { type: 'string' }, 'apply-auto': { type: 'boolean' }, json: { type: 'boolean', short: 'j' },
  });
  if (!values.since) die('usage: ch tasks notes report --since <ISO date or time> [--apply-auto] [--json]');
  const doc = load();
  const report = roundReport(doc, values.since);
  const labelled = values['apply-auto'] ? applyAuto(doc, report) : [];
  if (labelled.length) save(doc);
  if (values.json) { jsonOut({ ...report, labelled }); return; }
  if (!report.lines.length) { print('No notes were filed since then.'); return; }
  for (const l of report.lines) print(`${l.handle} -> ${l.id}, model:${l.model}, ${l.epic || 'no epic'}${l.raw ? '  (title still raw: rewrite it)' : ''}`);
  for (const e of report.epics) {
    const state = labelled.includes(e.id) ? 'auto added' : e.auto ? 'auto already' : e.ready ? 'ready, auto not set (run with --apply-auto)' : `not ready: ${e.reasons.join('; ')}`;
    print(`${e.id} ${e.title} [model:${e.model}, ${e.children} new] ${state}`);
  }
}
