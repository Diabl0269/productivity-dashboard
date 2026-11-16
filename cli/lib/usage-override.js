/**
 * cli/lib/usage-override.js (PRO124): the percent of this week's usage the owner set by hand
 * (`ch metrics usage --set 60`). One small JSON file in $CH_HOME/metrics/: { pct, setAt, resetsAt? }.
 * shared/usage-meter.js prefers it for the week it was set in and drops it when that week is over.
 */
import fs from 'node:fs';
import path from 'node:path';
import { metricsDir } from './metrics-store.js';

const FILE = 'usage-override.json';
const file = () => path.join(metricsDir(), FILE);

/** The stored override, or null when none exists or it is unreadable. */
export function readUsageOverride() {
  try {
    const o = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return o && Number.isFinite(o.pct) && Number.isFinite(Date.parse(o.setAt)) ? o : null;
  } catch { return null; }
}

/** Store `pct` (0-100) as of `nowMs`; `resetsAt` (ISO) names the reset when it is not the usual one. */
export function writeUsageOverride({ pct, resetsAt = null, nowMs = Date.now() }) {
  const rec = { pct, setAt: new Date(nowMs).toISOString(), ...(resetsAt ? { resetsAt: new Date(resetsAt).toISOString() } : {}) };
  fs.writeFileSync(file(), `${JSON.stringify(rec)}\n`, 'utf8');
  return rec;
}

/** Remove the override; true when there was one. */
export function clearUsageOverride() {
  try { fs.unlinkSync(file()); return true; } catch { return false; }
}
