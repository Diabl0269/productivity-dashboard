/**
 * cli/lib/metrics-store.js
 * JSONL store for `ch metrics` under $CH_HOME/metrics/.
 *
 * Exports: metricsDir, readRecords, upsertRecords, appendRecord, metricsConfig
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataRoot, readConfig } from './io.js';

/** $CH_HOME/metrics, created on demand. */
export function metricsDir() {
  const dir = path.join(dataRoot(), 'metrics');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveFile(file) {
  return path.isAbsolute(file) ? file : path.join(metricsDir(), file);
}

/** Read a JSONL file (absolute, or relative to metricsDir). Bad lines are skipped. */
export function readRecords(file) {
  const p = resolveFile(file);
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === 'object') out.push(rec);
    } catch { /* skip bad line */ }
  }
  return out;
}

function writeAll(p, records) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, p);
}

/**
 * Replace records by `key` (new ones are appended), atomic write.
 * @returns {{added:number, replaced:number, total:number}}
 */
export function upsertRecords(file, records) {
  const p = resolveFile(file);
  const existing = readRecords(p);
  const index = new Map();
  existing.forEach((r, i) => { if (r.key != null) index.set(r.key, i); });
  let added = 0, replaced = 0;
  for (const rec of records) {
    if (rec.key != null && index.has(rec.key)) {
      existing[index.get(rec.key)] = rec;
      replaced++;
    } else {
      if (rec.key != null) index.set(rec.key, existing.length);
      existing.push(rec);
      added++;
    }
  }
  writeAll(p, existing);
  return { added, replaced, total: existing.length };
}

/** Append one record as a line. */
export function appendRecord(file, rec) {
  const p = resolveFile(file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(rec) + '\n', 'utf8');
}

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** config.json `metrics` block merged over defaults; leading ~ expanded in paths. */
export function metricsConfig() {
  const m = readConfig().metrics || {};
  const arr = v => (Array.isArray(v) ? v : []);
  return {
    claudeProjects: arr(m.claudeProjects).map(expandHome),
    repos: arr(m.repos).map(r => (typeof r === 'string' ? { repo: r } : r)).filter(r => r && r.repo),
    gateLogs: arr(m.gateLogs).filter(g => g && g.path).map(g => ({ ...g, path: expandHome(g.path) })),
    buildTimeLogs: arr(m.buildTimeLogs).filter(g => g && g.path).map(g => ({ ...g, path: expandHome(g.path) })),
    areas: m.areas && typeof m.areas === 'object' ? m.areas : {},
    stallMinutes: Number.isFinite(m.stallMinutes) ? m.stallMinutes : 20,
    forgottenEpicDays: Number.isFinite(m.forgottenEpicDays) ? m.forgottenEpicDays : 3,
  };
}
