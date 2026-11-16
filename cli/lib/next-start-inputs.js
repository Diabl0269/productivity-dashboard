/**
 * cli/lib/next-start-inputs.js: read everything shared/next-start.js needs from disk (read-only, no tasks lock,
 * safe in the long-running server): the tracker, $CH_HOME/autorun.json and autorun.off, the dispatcher's
 * tick.json (live runs and last tick, written by scripts/autorun/dispatch.mjs in the suite repo), spend since
 * the last weekly reset and the usage-limit hits from the metrics store.
 *   nextStartNow({ now?, overrides? }) -> computeNextStart result
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataRoot } from './io.js';
import { readRecords, metricsConfig } from './metrics-store.js';
import { readTasksDoc } from '../../shared/tasks-files.js';
import { normalizeTasksDoc } from './schema.js';
import { distinctHits } from '../../shared/plan-share.js';
import { reviewQueue } from '../../shared/review.js';
import { computeNextStart, DEFAULT_TICK_MIN } from '../../shared/next-start.js';
import { lastWeeklyReset } from '../../shared/weekly-reset.js';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The dispatcher's state folder (AUTORUN_STATE_DIR overrides, as in dispatch.mjs). */
export function autorunStateDir() {
  return process.env.AUTORUN_STATE_DIR || path.join(os.homedir(), '.local/share/agentsynth-autorun');
}

/**
 * The dispatcher's tick.json as { at, intervalMin, liveEpics[] }, or null when it is missing, unreadable or
 * older than two intervals (then the dispatcher is not running, so nobody is live).
 */
export function readAutorunTick({ now = Date.now() } = {}) {
  const tick = readJson(path.join(autorunStateDir(), 'tick.json')) || {};
  const intervalMin = Number.isFinite(tick.intervalMin) && tick.intervalMin > 0 ? tick.intervalMin : DEFAULT_TICK_MIN;
  const lastTickMs = Number.isFinite(Date.parse(tick.at)) ? Date.parse(tick.at) : null;
  const fresh = lastTickMs !== null && now - lastTickMs < 2 * intervalMin * 60e3;
  if (!fresh) return null;
  return { at: tick.at, intervalMin, liveEpics: Array.isArray(tick.liveEpics) ? tick.liveEpics : [] };
}

/** Epics with a live automatic run, from the dispatcher's tick.json (see readAutorunTick). */
export function liveEpicsNow({ now = Date.now() } = {}) {
  return readAutorunTick({ now })?.liveEpics || [];
}

export async function nextStartNow({ now = Date.now(), overrides = {} } = {}) {
  const root = dataRoot();
  const doc = normalizeTasksDoc(readTasksDoc(root));
  const tick = readJson(path.join(autorunStateDir(), 'tick.json')) || {};
  const tickMin = Number.isFinite(tick.intervalMin) && tick.intervalMin > 0 ? tick.intervalMin : DEFAULT_TICK_MIN;
  const lastTickMs = Number.isFinite(Date.parse(tick.at)) ? Date.parse(tick.at) : null;
  // A tick file older than two intervals means the dispatcher is not running: its live list is stale.
  const fresh = lastTickMs !== null && now - lastTickMs < 2 * tickMin * 60e3;

  let weekCostUSD = 0;
  let weekUSD = null;
  const weeklyReset = metricsConfig().weeklyReset;
  try {
    const { loadMetricsPayload } = await import('../commands/metrics.js');
    const hours = Math.max(1, Math.ceil((now - lastWeeklyReset(now, weeklyReset)) / 3600e3));
    const p = loadMetricsPayload({ since: `${hours}h`, now, costLimit: Infinity });
    weekCostUSD = p.costs?.total?.costUSD || 0;
    weekUSD = p.costs?.limits?.weekUSD || null;
  } catch { /* no metrics yet: no pace stop */ }

  let limitHits = [];
  try { limitHits = distinctHits(readRecords('sessions.jsonl')); } catch { /* none */ }

  return computeNextStart({
    doc,
    now,
    settings: readJson(path.join(root, 'autorun.json')) || {},
    off: fs.existsSync(path.join(root, 'autorun.off')),
    liveEpics: fresh && Array.isArray(tick.liveEpics) ? tick.liveEpics : [],
    manualBusy: fresh && Number.isFinite(tick.manualBusy) ? tick.manualBusy : 0,
    lastTickMs: fresh ? lastTickMs : null,
    tickMin,
    weekCostUSD,
    weekUSD,
    weeklyReset,
    reviewCount: reviewQueue(doc).length,
    limitHits,
    ...overrides,
  });
}
