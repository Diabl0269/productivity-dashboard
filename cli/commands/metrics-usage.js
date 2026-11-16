/**
 * cli/commands/metrics-usage.js (PRO124): `ch metrics usage [--set <pct> [--resets <iso>]] [--clear] [--json]`
 * Shows this week's usage meter (the Home chip's numbers), or sets / clears the percent you read off the
 * plan's own usage page. Spec: docs/metrics.md "Usage meter".
 */
import { parse } from '../lib/args.js';
import { print, die, jsonOut } from '../lib/output.js';
import { usageNow } from '../lib/usage-live.js';
import { writeUsageOverride, clearUsageOverride } from '../lib/usage-override.js';
import { chipText, paceSentence, fmtMoney, resetLabel } from '../../shared/usage-meter.js';

const hm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export default async function usageCmd(argv) {
  const { values } = parse(argv, {
    set: { type: 'string' }, resets: { type: 'string' }, clear: { type: 'boolean' },
    project: { type: 'string' }, json: { type: 'boolean' },
  });
  if (values.resets && values.set === undefined) die('--resets goes with --set <pct>');
  if (values.set !== undefined && values.clear) die('use either --set or --clear');
  if (values.clear) {
    const had = clearUsageOverride();
    if (!values.json) print(had ? 'cleared the percent you set' : 'no percent was set');
  }
  if (values.set !== undefined) {
    const pct = Number(values.set);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) die(`bad --set "${values.set}" (a percent of the week used, 0 to 100)`);
    if (values.resets && !Number.isFinite(Date.parse(values.resets))) die(`bad --resets "${values.resets}" (an ISO date and time)`);
    writeUsageOverride({ pct, resetsAt: values.resets || null });
  }
  const m = await usageNow({ project: values.project || null });
  if (values.json) { jsonOut(m); return; }
  print(chipText(m));
  print(`  ${m.source === 'set by you' ? `set by you at ${hm(Date.parse(m.setAt))}` : m.source === 'estimated' ? 'estimated from cost this week and the calibrated limit' : 'no percent'}; as of ${hm(Date.parse(m.asOf))}${m.capped ? ' (capped: run ch metrics collect)' : ''}`);
  print(`  cost this week ${fmtMoney(m.costThisWeekUSD)} at API prices${m.weekUSD ? ` of about ${fmtMoney(m.weekUSD)}` : ''}; the week resets ${resetLabel(Date.parse(m.resetsAt))}`);
  print(`  ${paceSentence(m)}`);
  for (const d of m.perDay) print(`  ${d.date}  ${fmtMoney(d.usd)}`);
  for (const e of m.perEpic) print(`  epic ${e.id}  ${fmtMoney(e.usd)}${e.title ? `  ${e.title}` : ''}`);
  for (const r of m.perRunning) print(`  running ${r.ticketId || r.sessionId.slice(0, 8)}  ${fmtMoney(r.usd)}`);
}
