/**
 * cli/commands/tasks-ready.js
 * `ch tasks ready [--json] [--auto] [--apply-auto [--dry-run]]`: every open epic as Ready or Not ready (with the reasons),
 * and whether Auto is on for it. Auto epics are listed in start order (priority, autoRank, plan order). `--auto` keeps only epics that run by themselves: Ready AND Auto.
 * Read-only except `--apply-auto` (PRO138): under every open epic (todo or in-progress, not a later bucket) it moves
 * parked backlog tickets to todo, then adds `auto` to every Ready epic without it (never one labelled `no-auto`);
 * `--dry-run` prints the same lines and writes nothing. The rules live in shared/epic-ready.js.
 */

import { parse } from '../lib/args.js';
import { print, jsonOut } from '../lib/output.js';
import { load, save, sectionById, todayStr } from '../lib/tasks-store.js';
import { pickWithoutBoard } from '../../shared/pick-without-board.js';
import { appendHistory } from '../lib/schema.js';
import { closeIfReviewComplete, reviewReadyToClose } from '../../shared/review.js';
import { openEpicReadiness, readinessLabel, autoQueueOrder, withAutoLabel, isAuto, LATER_TITLE, unrunnableBlockers, blockerWarningText } from '../../shared/epic-ready.js';

/** PRO138: can a backlog ticket under this epic move to todo (the epic is open and not a later bucket)? Mirrors PRO108 in shared/review-filing.js. */
export function epicIsOpenForWork(epicTask, epicSectionId) {
  return ['todo', 'in-progress'].includes(epicSectionId) && !LATER_TITLE.test(String(epicTask?.title || ''));
}

/** Move `task` from `from` (a section) to todo, with a history event and optional note, the same way `ch tasks move` does. */
export function moveTicketToTodo(doc, task, from, note) {
  const todo = sectionById(doc, 'todo');
  from.tasks = from.tasks.filter(t => t.id !== task.id);
  task.updated = todayStr();
  appendHistory(task, { event: 'moved', from: from.id, to: 'todo', note });
  if (note) { if (!Array.isArray(task.notes)) task.notes = []; task.notes.push({ at: new Date().toISOString(), text: note }); }
  todo.tasks.push(task);
}

function applyAuto(doc, { dryRun }) {
  const lines = [];
  const find = id => { for (const sec of doc.sections) { const t = sec.tasks.find(x => x.id === id); if (t) return { t, sec }; } return null; };
  // Finished reviews first: every check ticked and nothing else held (the tick paths close these too; this sweeps old ones).
  for (const sec of doc.sections.filter(x => x.id === 'review')) {
    for (const t of [...sec.tasks]) {
      if (!reviewReadyToClose(t, 'review')) continue;
      if (dryRun) { lines.push(`closed ${t.id}: every check ticked`); continue; }
      const c = closeIfReviewComplete(doc, t, { note: 'every check ticked (ready --apply-auto)' });
      if (!c) continue;
      lines.push(`closed ${t.id}: every check ticked`);
      for (const e of c.epics) lines.push(`closed ${e.id}: last open ticket closed (now ${e.to})`);
    }
  }
  for (const r of openEpicReadiness(doc)) {
    // Only under an auto epic: a parked ticket under a hand-run epic is parked on purpose (BAC1 staging waits on a
    // first paying customer), and promoting it would make that epic look Ready and take `auto` below.
    if (!r.auto || !epicIsOpenForWork({ title: r.title }, r.section) || !r.promotable.length) continue;
    for (const id of r.promotable) {
      const f = find(id);
      if (!f || f.sec.id !== 'backlog') continue;
      if (!dryRun) moveTicketToTodo(doc, f.t, f.sec, `Promoted from backlog: parked under open epic ${r.id} (ready --apply-auto)`);
      lines.push(`promoted ${id} under ${r.id}`);
    }
  }
  const after = dryRun ? simulate(doc, lines) : doc;
  for (const r of openEpicReadiness(after)) {
    const f = find(r.id);
    if (!f || !r.ready || isAuto(f.t) || (f.t.labels || []).some(l => String(l).trim().toLowerCase() === 'no-auto')) continue;
    if (!dryRun) { f.t.labels = withAutoLabel(f.t.labels, true); f.t.updated = todayStr(); }
    lines.push(`auto added ${r.id}`);
  }
  return lines;
}

/** A copy of the doc with the planned promotions applied, so a dry run reports the same "auto added" lines as a real run. */
function simulate(doc, lines) {
  const copy = JSON.parse(JSON.stringify(doc));
  for (const id of lines.map(l => /^promoted (\S+)/.exec(l)?.[1]).filter(Boolean)) {
    for (const sec of copy.sections) {
      const t = sec.tasks.find(x => x.id === id);
      if (t) moveTicketToTodo(copy, t, sec);
    }
  }
  return copy;
}

export default async function cmdReady(argv) {
  const { values } = parse(argv, {
    json: { type: 'boolean', short: 'j' },
    auto: { type: 'boolean' },
    'apply-auto': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    'check-picks': { type: 'boolean' },
  });
  if (values['apply-auto']) {
    const doc = load();
    const lines = applyAuto(doc, { dryRun: !!values['dry-run'] });
    if (!values['dry-run'] && lines.length) save(doc);
    if (values.json) { jsonOut({ dryRun: !!values['dry-run'], changes: lines }); return; }
    for (const l of lines) print(values['dry-run'] ? `dry run: ${l}` : l);
    if (!lines.length) print('Nothing to promote or label.');
    return;
  }
  const doc = load();
  // PRO151: a Ready, Auto epic whose blocker will not start by itself says so, the same words as the Plan page.
  let epics = openEpicReadiness(doc).map(e => (e.ready && e.auto ? { ...e, stuckBlockers: unrunnableBlockers(doc, e.id) } : e));
  if (values.auto) epics = epics.filter(e => e.ready && e.auto);
  // Auto epics keep their slots but fill them in start order: priority, then autoRank, then plan order.
  const queue = autoQueueOrder(epics.filter(e => e.auto));
  let next = 0;
  epics = epics.map(e => (e.auto ? queue[next++] : e));
  // FRO2329: open design picks with no board link (`--check-picks` exits 1 when any, for the daily job).
  const picks = pickWithoutBoard(doc);
  if (picks.length && values['check-picks']) process.exitCode = 1;
  if (values.json) { jsonOut({ epics, pickWithoutBoard: picks }); return; }
  if (values['check-picks']) { print(picks.length ? picksText(picks) : 'Every open pick has a board.'); return; }
  if (!epics.length) { print(values.auto ? 'No epic is Ready with Auto on.' : 'No open epics.'); if (picks.length) print(picksText(picks)); return; }
  for (const e of epics) {
    const runnable = e.children.filter(c => c.runnable).length;
    print(`${e.ready ? '[ready]    ' : '[not ready]'} ${e.id}  ${e.title}${e.lane ? ` (${e.lane})` : ''}${e.auto ? ` [auto ${e.priority}${e.autoRank != null ? ` #${e.autoRank}` : ''}]` : ''}`);
    if (e.softBlockers?.length) print(`             Runs now: ${e.softBlockers.join(', ')} only wait on you`);
    if (e.stuckBlockers?.length) print(`             Ready · Auto, but ${blockerWarningText(e.stuckBlockers)}`);
    print(`             ${readinessLabel(e)}${e.ready ? ` - ${runnable} ticket${runnable === 1 ? '' : 's'} to run` : ''}`);
  }
  if (picks.length) print(picksText(picks));
}

function picksText(picks) {
  return ['Pick without board:', ...picks.map(p => `${p.id} ${p.title}`)].join('\n');
}
