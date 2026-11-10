/**
 * cli/lib/session-files.js: read Claude Code transcripts from disk and summarize them.
 * Streams each file; irrelevant line types (api-request blobs, file-history snapshots,
 * attachments, prompt snapshots...) are skipped by a cheap prefix check before JSON.parse.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { summarizeSession, summarizeHelperUsage, applyHelpers } from '../../shared/session-metrics.js';

// Bump when the summary logic changes so cached records are recomputed.
const CACHE_VERSION = 14;
const WANTED = new Set(['user', 'assistant', 'system', 'custom-title', 'pr-link', 'cost-state']);
const LEAD_TYPE_RE = /^\{"type":"([\w-]+)"/; // pr-link, cost-state, api-request-*, file-history-*... lead with type

/** Main transcripts in a Claude projects dir: [{sessionId, path, mtimeMs, size, helperCount}]. */
export function listTranscripts(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const p = path.join(dir, n);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const sessionId = n.slice(0, -'.jsonl'.length);
    let helperCount = 0;
    try {
      helperCount = fs.readdirSync(path.join(dir, sessionId, 'subagents')).length;
    } catch {
      /* no helpers */
    }
    out.push({ sessionId, path: p, mtimeMs: st.mtimeMs, size: st.size, helperCount });
  }
  return out;
}

/** Helper (subagent) transcripts of a main transcript: `<dir>/<sessionId>/subagents/agent-*.jsonl`. */
export function helperFiles(dir, sessionId) {
  const sub = path.join(dir, sessionId, 'subagents');
  let names;
  try {
    names = fs.readdirSync(sub);
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith('agent-') && n.endsWith('.jsonl')).sort().map((n) => path.join(sub, n));
}

/** Cache signature of the helper files: count, total size and newest mtime (a new helper changes it). */
export function helperSignature(files) {
  let size = 0;
  let mtime = 0;
  let n = 0;
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      n += 1;
      size += st.size;
      if (st.mtimeMs > mtime) mtime = st.mtimeMs;
    } catch { /* vanished */ }
  }
  return `${n}:${size}:${mtime}`;
}

/** Stream one helper transcript and summarize its usage; only the first line and assistant lines are parsed. */
export async function summarizeHelperFile(file, opts = {}) {
  const parsed = [];
  let first = true;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw) continue;
    if (!first && !raw.includes('"type":"assistant"')) continue;
    first = false;
    try {
      parsed.push(JSON.parse(raw));
    } catch {
      /* partial or corrupt line */
    }
  }
  return summarizeHelperUsage(parsed, opts);
}

export async function summarizeTranscriptFile(file, opts = {}) {
  const parsed = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw) continue;
    // user/assistant/system/attachment lines start with parentUuid and carry `type` later (after
    // the message body for assistants), so only skip on a leading type or an attachment key.
    const m = LEAD_TYPE_RE.exec(raw.length > 100 ? raw.slice(0, 100) : raw);
    if (m ? !WANTED.has(m[1]) : raw.slice(0, 400).includes('"attachment":{')) continue;
    try {
      parsed.push(JSON.parse(raw));
    } catch {
      /* partial or corrupt line */
    }
  }
  const rec = summarizeSession(parsed, opts);
  if (rec && !rec.sessionId) rec.sessionId = rec.key = path.basename(file, '.jsonl');
  if (rec) {
    const helpers = [];
    for (const h of helperFiles(path.dirname(file), path.basename(file, '.jsonl'))) helpers.push(await summarizeHelperFile(h, { stallMinutes: opts.stallMinutes }));
    applyHelpers(rec, helpers);
  }
  return rec;
}

/**
 * Expand `claudeProjects` entries: an entry ending in `*` matches every directory in its parent
 * whose name starts with the text before the `*` (e.g. ".../projects/-Users-me-work*").
 * Plain entries pass through unchanged; the result has no duplicates.
 */
export function expandProjectDirs(dirs) {
  const out = [];
  for (const d of dirs || []) {
    if (typeof d !== 'string') continue;
    if (!d.endsWith('*')) { out.push(d); continue; }
    const stem = d.slice(0, -1);
    const parent = path.dirname(stem);
    const prefix = path.basename(stem);
    let names = [];
    try { names = fs.readdirSync(parent, { withFileTypes: true }); } catch { /* parent missing */ }
    for (const n of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (n.isDirectory() && n.name.startsWith(prefix)) out.push(path.join(parent, n.name));
    }
  }
  return [...new Set(out)];
}

const sinceMs = (since) => {
  if (since == null) return null;
  if (typeof since === 'number') return since;
  if (since instanceof Date) return since.getTime();
  const m = /^(\d+)\s*([dhw])$/.exec(String(since));
  if (m) return Date.now() - Number(m[1]) * { h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[m[2]];
  const t = Date.parse(since);
  return Number.isNaN(t) ? null : t;
};

/**
 * Summarize every main transcript under `dirs`, re-parsing only files whose mtime/size changed.
 * `since` (ms, Date, ISO or "30d") drops sessions that ended before it.
 * Returns {records, cache}; cache is {[path]: {mtimeMs, size, record}} to pass back next time.
 */
export async function collectSessions({ dirs = [], cache = {}, since, stallMinutes = 20, midRunMinutes = 15, stopCauses = [] } = {}) {
  const cutoff = sinceMs(since);
  const next = {};
  const records = [];
  for (const dir of expandProjectDirs(dirs)) {
    const project = path.basename(dir);
    for (const t of listTranscripts(dir)) {
      if (cutoff !== null && t.mtimeMs < cutoff) continue;
      const hit = cache[t.path];
      const sig = helperSignature(helperFiles(dir, t.sessionId));
      // Recorded stop causes (stop-causes.jsonl) for this session: a change re-reads the transcript.
      const mine = stopCauses.filter((e) => e && e.sessionId === t.sessionId);
      const stopSig = mine.length ? JSON.stringify(mine.map((e) => [e.at, e.cause])) : '';
      let record;
      if (hit && hit.v === CACHE_VERSION && hit.mtimeMs === t.mtimeMs && hit.size === t.size && hit.helperSig === sig && (hit.stopSig || '') === stopSig && hit.record !== undefined) {
        record = hit.record;
      } else {
        record = await summarizeTranscriptFile(t.path, { stallMinutes, midRunMinutes, project, stopCauses: mine });
      }
      if (record) record.helpers = t.helperCount;
      next[t.path] = { v: CACHE_VERSION, mtimeMs: t.mtimeMs, size: t.size, helperSig: sig, stopSig, record };
      if (record) records.push(record);
    }
  }
  return { records, cache: next };
}
