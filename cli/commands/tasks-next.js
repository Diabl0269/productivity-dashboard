/**
 * cli/commands/tasks-next.js
 * `ch tasks next [--n 5] [--project P] [--json]`: the best ready tickets to start next.
 * Read-only; ranking lives in shared/next-ticket.js.
 */

import { parse } from '../lib/args.js';
import { print, jsonOut, die } from '../lib/output.js';
import { load } from '../lib/tasks-store.js';
import { rankReadyTickets } from '../../shared/next-ticket.js';

export default async function cmdNext(argv) {
  const { values } = parse(argv, {
    n: { type: 'string' },
    project: { type: 'string' },
    json: { type: 'boolean' },
  });
  const n = values.n === undefined ? 5 : Number(values.n);
  if (!Number.isInteger(n) || n < 1) die('usage: ch tasks next [--n 5] [--project P] [--json]');
  const picks = rankReadyTickets(load(), { n, project: values.project, now: new Date() });
  if (values.json) { jsonOut(picks); return; }
  if (!picks.length) { print('Nothing ready to start.'); return; }
  const dim = s => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
  picks.forEach((p, i) => {
    print(`${i + 1}. ${p.id}  ${p.title}`);
    const where = p.epicId ? `${p.epicId} ${p.epicTitle}` : 'no epic';
    print(dim(`     ${where}${p.reasons.length ? ' - ' + p.reasons.join(', ') : ''}`));
  });
}
