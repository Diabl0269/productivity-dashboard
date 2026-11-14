/**
 * cli/commands/tasks-interpret.js
 * `ch tasks interpret <id> "<reading>" [--json]` (PRO96): a run records how it read a vague ticket as an
 * `Interpretation: <reading>` line in the description. The Plan page's "For you" list shows it as a card
 * (OK / Not this). It never blocks: no ask, no waitingOn; the ticket stays runnable. Rules: shared/interpretations.js.
 */

import { parse } from '../lib/args.js';
import { jsonOut, ok, die } from '../lib/output.js';
import { load, save, findTask, todayStr } from '../lib/tasks-store.js';
import { addInterpretation } from '../../shared/interpretations.js';

export async function cmdInterpret(argv) {
  const { values, positionals } = parse(argv, { json: { type: 'boolean', short: 'j' } });
  const [id, reading] = positionals;
  if (!id || reading === undefined) die('usage: ch tasks interpret <id> "<how you read the ticket>" [--json]');
  const doc = load();
  const found = findTask(doc, id);
  if (!found) die(`task ${id} not found. Try: ch tasks list`);
  let added;
  try { added = addInterpretation(found.task, reading); } catch (e) { die(`interpret: ${e.message}`); }
  if (added) { found.task.updated = todayStr(); save(doc); }
  if (values.json) { jsonOut({ id: found.task.id, added }); return; }
  ok(added ? `interpret ${found.task.id}: recorded (shows in the Plan page's For you list; the ticket stays runnable)` : `interpret ${found.task.id}: already recorded`);
}
