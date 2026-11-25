/**
 * cli/lib/usage-override.js (PRO124): the percent of this week's usage the owner set by hand
 * (`ch metrics usage --set 60`). One small JSON file in $CH_HOME/metrics/: { pct, setAt, resetsAt?, source? }; `source: 'claude'` marks a percent
 * read from Claude itself (`ch metrics usage --from-claude`, AGE201), trusted for 15 minutes.
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
export function writeUsageOverride({ pct, resetsAt = null, nowMs = Date.now(), source = null }) {
  const rec = { pct, setAt: new Date(nowMs).toISOString(), ...(resetsAt ? { resetsAt: new Date(resetsAt).toISOString() } : {}), ...(source ? { source } : {}) };
  fs.writeFileSync(file(), `${JSON.stringify(rec)}\n`, 'utf8');
  return rec;
}

/** Remove the override; true when there was one. */
export function clearUsageOverride() {
  try { fs.unlinkSync(file()); return true; } catch { return false; }
}

/**
 * The weekly percent out of what Claude hands over, or null when it carries none. Two shapes:
 * Claude Code's statusline JSON `{ rate_limits: { seven_day: { used_percentage, resets_at } } }` (resets_at in epoch
 * seconds; field names assumed from the statusline docs, not yet confirmed against a live dump), or the flat
 * `{ pct, resetsAt }` (resetsAt ISO) a script can write by hand.
 */
export function parseClaudeUsage(input) {
  const week = input?.rate_limits?.seven_day;
  if (week && Number.isFinite(Number(week.used_percentage))) {
    const at = Number(week.resets_at);
    const ok = week.resets_at != null && week.resets_at !== '' && Number.isFinite(at);
    return { pct: Number(week.used_percentage), resetsAt: ok ? new Date(at < 1e11 ? at * 1000 : at).toISOString() : null };
  }
  if (Number.isFinite(input?.pct)) return { pct: input.pct, resetsAt: input.resetsAt || null };
  return null;
}
