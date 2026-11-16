/**
 * cli/lib/usage-live.js (PRO124): read what shared/usage-meter.js needs, fresher than the last
 * `ch metrics collect`. The stored sessions.jsonl is only as new as that collect, so transcripts written
 * since then are re-read and priced IN MEMORY (the metrics store is never written). Stats first: only
 * transcripts modified since the last collect and since this week's start are read, newest first, with a
 * cap on files and time; when the cap hits, `capped` is true and `asOf` is the last collect (honest age).
 *
 *   usageNow({ project?, now?, budgetMs?, maxReads?, projectDirs? }) -> usage-meter result
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataRoot } from './io.js';
import { metricsDir, readRecords, metricsConfig } from './metrics-store.js';
import { expandProjectDirs, summarizeTranscriptFile, helperFiles, helperSignature } from './session-files.js';
import { readUsageOverride } from './usage-override.js';
import { readTasksDoc } from '../../shared/tasks-files.js';
import { normalizeTasksDoc } from './schema.js';
import { limitsBlock, distinctHits } from '../../shared/plan-share.js';
import { computeUsageMeter } from '../../shared/usage-meter.js';
import { lastWeeklyReset, WEEK_MS } from '../../shared/weekly-reset.js';

const LIVE_MIN = 20; // a transcript written within this many minutes is a running session (as in the Running now strip)
const memo = new Map(); // transcript path -> { mtimeMs, size, helperSig, record } (priced in memory, reused while unchanged)
let stored = null; // { key, records } the parsed sessions.jsonl, reused while the file is unchanged

const mtimeOf = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

function storedSessions(dir) {
  const f = path.join(dir, 'sessions.jsonl');
  let st;
  try { st = fs.statSync(f); } catch { return []; }
  const key = `${f}:${st.mtimeMs}:${st.size}`;
  if (!stored || stored.key !== key) stored = { key, records: readRecords(f) };
  return stored.records;
}

/** Transcripts under the configured dirs as [{ sessionId, file, dir, mtimeMs, size }] modified at or after `cutoffMs`. */
function recentTranscripts(dirs, cutoffMs) {
  const out = [];
  for (const dir of expandProjectDirs(dirs)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const file = path.join(dir, n);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (st.isFile() && st.mtimeMs >= cutoffMs) out.push({ sessionId: n.slice(0, -6), file, dir, mtimeMs: st.mtimeMs, size: st.size });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function usageNow({ project = null, now = Date.now(), budgetMs = 700, maxReads = 40, projectDirs } = {}) {
  const t0 = Date.now();
  const cfg = metricsConfig();
  const dir = metricsDir();
  const override = readUsageOverride();
  const weekStart = lastWeeklyReset(now, cfg.weeklyReset);
  const overrideStart = override?.resetsAt ? Date.parse(override.resetsAt) - WEEK_MS : NaN;
  const cutoff = Number.isFinite(overrideStart) ? Math.min(weekStart, overrideStart) : weekStart;
  const lastCollect = Math.max(mtimeOf(path.join(dir, '.sessions-cache.json')), mtimeOf(path.join(dir, 'sessions.jsonl')));

  const bySession = new Map(storedSessions(dir).map(r => [r.sessionId || r.key, r]));
  const recent = recentTranscripts(projectDirs || cfg.claudeProjects, cutoff);
  const liveIds = recent.filter(t => now - t.mtimeMs <= LIVE_MIN * 60e3).map(t => t.sessionId);

  let reads = 0;
  let capped = false;
  for (const t of recent) {
    if (t.mtimeMs <= lastCollect - 1000) continue; // already in the store as of the last collect
    const sig = helperSignature(helperFiles(t.dir, t.sessionId));
    const hit = memo.get(t.file);
    if (hit && hit.mtimeMs === t.mtimeMs && hit.size === t.size && hit.helperSig === sig) {
      if (hit.record) bySession.set(t.sessionId, hit.record);
      continue;
    }
    if (reads >= maxReads || Date.now() - t0 > budgetMs) { capped = true; break; }
    reads += 1;
    let record = null;
    try { record = await summarizeTranscriptFile(t.file, { stallMinutes: cfg.stallMinutes, project: path.basename(t.dir) }); } catch { /* unreadable: keep the stored record */ }
    memo.set(t.file, { mtimeMs: t.mtimeMs, size: t.size, helperSig: sig, record });
    if (record) bySession.set(t.sessionId, record);
  }

  const sessions = [...bySession.values()];
  let doc = null; // no tracker file yet: the meter still shows dollars, just no epics
  try { doc = normalizeTasksDoc(readTasksDoc(dataRoot())); } catch { /* none */ }
  const weekUSD = limitsBlock({ sessions, sinceMs: now - 30 * 86400e3, nowMs: now }).weekUSD;
  const meter = computeUsageMeter({
    sessions, doc, nowMs: now, reset: cfg.weeklyReset, weekUSD, override, project, liveIds,
    asOfMs: capped ? lastCollect : now, capped,
    limitHit: distinctHits(sessions).filter(h => h.kind === 'weekly' && h.resetsAtMs && h.resetsAtMs > now).sort((x, y) => y.atMs - x.atMs)[0] || null,
  });
  return { ...meter, tookMs: Date.now() - t0, transcriptsRead: reads };
}
