/**
 * cli/lib/session-files.js: read Claude Code transcripts from disk and summarize them.
 * Streams each file; irrelevant line types (api-request blobs, file-history snapshots,
 * attachments, prompt snapshots...) are skipped by a cheap prefix check before JSON.parse.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { summarizeSession } from '../../shared/session-metrics.js';

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
  return rec;
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
export async function collectSessions({ dirs = [], cache = {}, since, stallMinutes = 20, midRunMinutes = 15 } = {}) {
  const cutoff = sinceMs(since);
  const next = {};
  const records = [];
  for (const dir of dirs) {
    const project = path.basename(dir);
    for (const t of listTranscripts(dir)) {
      if (cutoff !== null && t.mtimeMs < cutoff) continue;
      const hit = cache[t.path];
      let record;
      if (hit && hit.mtimeMs === t.mtimeMs && hit.size === t.size && hit.record !== undefined) {
        record = hit.record;
      } else {
        record = await summarizeTranscriptFile(t.path, { stallMinutes, midRunMinutes, project });
      }
      if (record) record.helpers = t.helperCount;
      next[t.path] = { mtimeMs: t.mtimeMs, size: t.size, record };
      if (record) records.push(record);
    }
  }
  return { records, cache: next };
}
