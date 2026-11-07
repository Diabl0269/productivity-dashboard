/**
 * cli/commands/tasks-next.js
 * `ch tasks next [--n 5] [--project P] [--json]`: the best ready tickets to start next.
 * Read-only; ranking lives in shared/next-ticket.js. With session data in $CH_HOME/metrics each ticket
 * also shows its likely cost (shared/cost-estimate.js); without it nothing extra is printed.
 */

import { parse } from '../lib/args.js';
import { print, jsonOut, die } from '../lib/output.js';
import { load } from '../lib/tasks-store.js';
import { rankReadyTickets } from '../../shared/next-ticket.js';
import { formatRange } from '../../shared/cost-estimate.js';
import { estimatorForDoc } from '../lib/estimator.js';

export default async function cmdNext(argv) {
  const { values } = parse(argv, {
    n: { type: 'string' },
    project: { type: 'string' },
    json: { type: 'boolean' },
  });
  const n = values.n === undefined ? 5 : Number(values.n);
  if (!Number.isInteger(n) || n < 1) die('usage: ch tasks next [--n 5] [--project P] [--json]');
  const doc = load();
  const picks = rankReadyTickets(doc, { n, project: values.project, now: new Date() });
  let estimator = null;
  try { estimator = estimatorForDoc(doc, { project: values.project }); } catch { /* no estimate, never an error */ }
  for (const p of picks) p.estimate = estimator ? estimator.estimate(p.id) : null;
  if (values.json) { jsonOut(picks); return; }
  if (!picks.length) { print('Nothing ready to start.'); return; }
  const dim = s => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
  picks.forEach((p, i) => {
    print(`${i + 1}. ${p.id}  ${p.title}`);
    const where = p.epicId ? `${p.epicId} ${p.epicTitle}` : 'no epic';
    const cost = p.estimate ? `likely ${formatRange(p.estimate)}` : '';
    print(dim(`     ${where}${p.reasons.length ? ' - ' + p.reasons.join(', ') : ''}${cost ? ` - ${cost}` : ''}`));
  });
}
