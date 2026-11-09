/**
 * cli/commands/tasks-ready.js
 * `ch tasks ready [--json] [--auto]`: every open epic as Ready or Not ready (with the reasons),
 * and whether Auto is on for it. Auto epics are listed in start order (priority, autoRank, plan order). `--auto` keeps only epics that run by themselves: Ready AND Auto.
 * Read-only; the rules live in shared/epic-ready.js.
 */

import { parse } from '../lib/args.js';
import { print, jsonOut } from '../lib/output.js';
import { load } from '../lib/tasks-store.js';
import { openEpicReadiness, readinessLabel, autoQueueOrder } from '../../shared/epic-ready.js';

export default async function cmdReady(argv) {
  const { values } = parse(argv, {
    json: { type: 'boolean', short: 'j' },
    auto: { type: 'boolean' },
  });
  let epics = openEpicReadiness(load());
  if (values.auto) epics = epics.filter(e => e.ready && e.auto);
  // Auto epics keep their slots but fill them in start order: priority, then autoRank, then plan order.
  const queue = autoQueueOrder(epics.filter(e => e.auto));
  let next = 0;
  epics = epics.map(e => (e.auto ? queue[next++] : e));
  if (values.json) { jsonOut({ epics }); return; }
  if (!epics.length) { print(values.auto ? 'No epic is Ready with Auto on.' : 'No open epics.'); return; }
  for (const e of epics) {
    const runnable = e.children.filter(c => c.runnable).length;
    print(`${e.ready ? '[ready]    ' : '[not ready]'} ${e.id}  ${e.title}${e.lane ? ` (${e.lane})` : ''}${e.auto ? ` [auto ${e.priority}${e.autoRank != null ? ` #${e.autoRank}` : ''}]` : ''}`);
    print(`             ${readinessLabel(e)}${e.ready ? ` - ${runnable} ticket${runnable === 1 ? '' : 's'} to run` : ''}`);
  }
}
