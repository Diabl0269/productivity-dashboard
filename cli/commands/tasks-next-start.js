/**
 * cli/commands/tasks-next-start.js
 * `ch tasks next-start [--json] [--live A,B] [--manual-busy N] [--now <iso>]`: which Ready Auto epic the
 * autorun dispatcher starts next and when (or why none). Read-only; the rules live in shared/next-start.js.
 * --live / --manual-busy / --now override what is read from the dispatcher's state (for the dispatcher and tests).
 */
import { parse } from '../lib/args.js';
import { print, jsonOut, die } from '../lib/output.js';
import { nextStartNow } from '../lib/next-start-inputs.js';

export default async function cmdNextStart(argv) {
  const { values } = parse(argv, {
    json: { type: 'boolean', short: 'j' },
    live: { type: 'string' },
    'manual-busy': { type: 'string' },
    now: { type: 'string' },
  });
  const overrides = {};
  if (values.live !== undefined) overrides.liveEpics = values.live.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (values['manual-busy'] !== undefined) {
    const n = Number(values['manual-busy']);
    if (!Number.isInteger(n) || n < 0) die('usage: ch tasks next-start [--json] [--live A,B] [--manual-busy N] [--now <iso>]');
    overrides.manualBusy = n;
  }
  let now = Date.now();
  if (values.now !== undefined) { now = Date.parse(values.now); if (!Number.isFinite(now)) die(`bad --now "${values.now}"`); }
  const out = await nextStartNow({ now, overrides });
  if (values.json) { jsonOut(out); return; }
  print(out.line);
}
