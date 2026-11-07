/**
 * cli/commands/metrics.js
 * Development metrics. Spec: docs/metrics.md.
 *
 *   ch metrics collect [--sessions] [--ci] [--gates] [--since 30d] [--json]
 *   ch metrics flow | report            (need shared/flow-metrics.js / shared/insights.js)
 *   ch metrics time <name> [--repo R] [--kind K] -- <command...>
 *   ch metrics record --name N --seconds S [--ok|--failed] [--repo R] [--kind K] [--at ISO]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from '../lib/args.js';
import { print, printErr, die, jsonOut } from '../lib/output.js';
import { metricsDir, readRecords, upsertRecords, appendRecord, metricsConfig } from '../lib/metrics-store.js';

const KINDS = ['gate', 'build', 'test', 'ci', 'other'];
const TIMINGS = 'timings.jsonl';
const SESSIONS = 'sessions.jsonl';
const GH_FIELDS = 'databaseId,workflowName,headBranch,headSha,event,status,conclusion,createdAt,startedAt,updatedAt';

/** "30d" / "12h" / "2w" -> ms (null when absent/invalid). */
export function parseSince(s) {
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)([hdw])$/.exec(String(s));
  if (!m) die(`bad --since "${s}" (use e.g. 30d, 12h, 2w)`);
  return Number(m[1]) * { h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[m[2]];
}

function sinceCutoff(sinceMs) {
  return sinceMs ? Date.now() - sinceMs : 0;
}

function sec(a, b) {
  const d = (Date.parse(b) - Date.parse(a)) / 1000;
  return Number.isFinite(d) && d >= 0 ? d : 0;
}

/** Map `gh run list` JSON rows to timing records (completed runs only). */
export function ciRecordsFromRuns(repo, runs) {
  const out = [];
  for (const r of runs || []) {
    if (r.status !== 'completed') continue;
    const started = r.startedAt || r.createdAt;
    out.push({
      key: `gh:${repo}:${r.databaseId}`,
      at: started,
      kind: 'ci',
      host: 'ci',
      name: r.workflowName,
      workflow: r.workflowName,
      repo,
      branch: r.headBranch,
      sha: r.headSha,
      seconds: sec(started, r.updatedAt),
      queuedSeconds: sec(r.createdAt, started),
      ok: r.conclusion === 'success',
      conclusion: r.conclusion,
      event: r.event,
      runId: r.databaseId,
      source: 'gh',
    });
  }
  return out;
}

/** Default gh runner: returns parsed JSON array. Throws when gh is missing/fails. */
export function ghRunList(repo, workflow) {
  const args = ['run', 'list', '--repo', repo, '--limit', '300', '--json', GH_FIELDS];
  if (workflow) args.push('--workflow', workflow);
  const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

/** Collect CI runs. `runner(repo, workflow)` is injectable for tests. */
export function collectCi({ cfg, sinceMs = null, runner = ghRunList } = {}) {
  const cutoff = sinceCutoff(sinceMs);
  const records = [];
  const repos = new Set();
  for (const entry of cfg.repos) {
    const workflows = entry.workflows && entry.workflows.length ? entry.workflows : [null];
    for (const wf of workflows) {
      try {
        const runs = ciRecordsFromRuns(entry.repo, runner(entry.repo, wf));
        records.push(...runs);
        repos.add(entry.repo);
      } catch (e) {
        printErr(`ci: ${entry.repo}${wf ? ` (${wf})` : ''}: gh failed, skipped (${String(e.message).split('\n')[0]})`);
      }
    }
  }
  return { records: records.filter(r => !cutoff || Date.parse(r.at) >= cutoff), repos: repos.size };
}

function readJsonl(file) {
  return readRecords(file);
}

/** Map gate-run logs and build-time TSV logs to timing records. */
export function collectGates({ cfg, sinceMs = null } = {}) {
  const cutoff = sinceCutoff(sinceMs);
  const records = [];
  for (const g of cfg.gateLogs) {
    if (!fs.existsSync(g.path)) { printErr(`gates: ${g.path} not found, skipped`); continue; }
    for (const r of readJsonl(g.path)) {
      if (!r.at) continue;
      records.push({
        key: `gate:${g.repo}:${r.at}:${r.worktree ?? ''}`,
        at: r.at, kind: 'gate', host: 'local',
        name: r.name || 'gate', repo: g.repo, branch: r.branch, sha: r.sha,
        seconds: Number(r.seconds) || 0, ok: r.ok !== false,
        ...(r.steps ? { steps: r.steps } : {}),
        ...(r.flags ? { flags: r.flags } : {}),
        source: 'gate-log',
      });
    }
  }
  for (const g of cfg.buildTimeLogs) {
    if (!fs.existsSync(g.path)) { printErr(`gates: ${g.path} not found, skipped`); continue; }
    for (const line of fs.readFileSync(g.path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const [ts, worktree, edges, wait, build, slots] = line.split('\t');
      const buildSeconds = Number(build);
      if (!ts || !(buildSeconds > 0) || !Number.isFinite(Date.parse(ts))) continue;
      records.push({
        key: `build:${g.repo}:${ts}:${worktree}`,
        at: new Date(ts).toISOString(), kind: 'build', host: 'local',
        name: 'build', repo: g.repo, worktree,
        seconds: buildSeconds, ok: true,
        steps: { wait: Number(wait) || 0, build: buildSeconds },
        edges: Number(edges) || 0, slotsBusy: Number(slots) || 0,
        source: 'gate-log',
      });
    }
  }
  return { records: records.filter(r => !cutoff || Date.parse(r.at) >= cutoff) };
}

async function collectSessionsStep(cfg, sinceMs) {
  let mod;
  try {
    mod = await import('../lib/session-files.js');
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw e;
  }
  const cachePath = path.join(metricsDir(), '.sessions-cache.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { /* none yet */ }
  const res = await mod.collectSessions({
    dirs: cfg.claudeProjects, cache, since: sinceMs ? sinceCutoff(sinceMs) : null, stallMinutes: cfg.stallMinutes,
  });
  const st = upsertRecords(SESSIONS, res.records);
  fs.writeFileSync(cachePath, JSON.stringify(res.cache ?? cache));
  return { changed: res.records.length, ...st };
}

async function collect(argv) {
  const { values } = parse(argv, {
    ci: { type: 'boolean' }, gates: { type: 'boolean' }, sessions: { type: 'boolean' },
    since: { type: 'string' }, json: { type: 'boolean' },
  });
  const all = !values.ci && !values.gates && !values.sessions;
  const cfg = metricsConfig();
  const sinceMs = parseSince(values.since);
  const summary = {};
  const lines = [];

  if (all || values.ci) {
    if (!cfg.repos.length) {
      lines.push('ci: no repos configured (metrics.repos), skipped');
    } else {
      const { records, repos } = collectCi({ cfg, sinceMs });
      upsertRecords(TIMINGS, records);
      summary.ci = { runs: records.length, repos };
      lines.push(`ci: ${records.length} runs from ${repos} repos`);
    }
  }
  if (all || values.gates) {
    const { records } = collectGates({ cfg, sinceMs });
    upsertRecords(TIMINGS, records);
    summary.gates = { runs: records.length };
    lines.push(`gates: ${records.length} runs`);
  }
  if (all || values.sessions) {
    const res = await collectSessionsStep(cfg, sinceMs);
    if (!res) {
      lines.push('sessions: skipped (cli/lib/session-files.js not available yet)');
    } else {
      summary.sessions = res;
      lines.push(`sessions: ${res.changed} new/changed`);
    }
  }
  if (values.json) jsonOut(summary); else lines.forEach(print);
}

function gitOut(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch { return undefined; }
}

function checkKind(kind) {
  if (!KINDS.includes(kind)) die(`bad --kind "${kind}" (${KINDS.join(' | ')})`);
  return kind;
}

async function timeCmd(argv) {
  const dd = argv.indexOf('--');
  if (dd < 0 || dd === argv.length - 1) die('usage: ch metrics time <name> [--repo R] [--kind K] -- <command...>');
  const { values, positionals } = parse(argv.slice(0, dd), {
    repo: { type: 'string' }, kind: { type: 'string' },
  });
  const name = positionals[0];
  if (!name) die('usage: ch metrics time <name> [--repo R] [--kind K] -- <command...>');
  const kind = checkKind(values.kind || 'other');
  const [cmd, ...args] = argv.slice(dd + 1);
  const at = new Date().toISOString();
  const t0 = Date.now();
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  const seconds = Math.round((Date.now() - t0)) / 1000;
  const code = res.error ? 127 : (res.status ?? 1);
  if (res.error) printErr(`ch metrics time: ${res.error.message}`);
  appendRecord(TIMINGS, {
    key: `manual:${name}:${at}`, at, kind, host: 'local', name,
    repo: values.repo, branch: gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), sha: gitOut(['rev-parse', '--short', 'HEAD']),
    seconds, ok: code === 0, source: 'manual',
  });
  process.exit(code);
}

async function recordCmd(argv) {
  const { values } = parse(argv, {
    name: { type: 'string' }, seconds: { type: 'string' }, ok: { type: 'boolean' }, failed: { type: 'boolean' },
    repo: { type: 'string' }, kind: { type: 'string' }, at: { type: 'string' },
  });
  if (!values.name || values.seconds == null) die('usage: ch metrics record --name N --seconds S [--ok|--failed] [--repo R] [--kind K] [--at ISO]');
  const seconds = Number(values.seconds);
  if (!Number.isFinite(seconds) || seconds < 0) die(`bad --seconds "${values.seconds}"`);
  if (values.ok && values.failed) die('use only one of --ok / --failed');
  let at = new Date().toISOString();
  if (values.at) {
    if (!Number.isFinite(Date.parse(values.at))) die(`bad --at "${values.at}"`);
    at = new Date(values.at).toISOString();
  }
  const rec = {
    key: `manual:${values.name}:${at}`, at, kind: checkKind(values.kind || 'other'), host: 'local',
    name: values.name, repo: values.repo, seconds, ok: !values.failed, source: 'manual',
  };
  appendRecord(TIMINGS, rec);
  print(`recorded ${rec.name} ${seconds}s ${rec.ok ? 'ok' : 'failed'}`);
}

async function lazy(path, what) {
  try {
    return await import(path);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') die(`ch metrics ${what}: not built yet`, 2);
    throw e;
  }
}

const USAGE = `ch metrics <subcommand>

  collect [--sessions] [--ci] [--gates] [--since 30d] [--json]   (no flag = all)
  flow    [--project P] [--lane L] [--since 30d] [--json]
  report  [--project P] [--since 30d] [--json]
  time <name> [--repo R] [--kind K] -- <command...>
  record --name N --seconds S [--ok|--failed] [--repo R] [--kind K] [--at ISO]`;

export default async function metrics(argv) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'collect': return collect(rest);
    case 'time': return timeCmd(rest);
    case 'record': return recordCmd(rest);
    case 'flow': {
      const mod = await lazy('../../shared/flow-metrics.js', 'flow');
      if (typeof mod.runFlowCli !== 'function') die('ch metrics flow: not built yet', 2);
      return mod.runFlowCli(rest);
    }
    case 'report': {
      const mod = await lazy('../../shared/insights.js', 'report');
      if (typeof mod.runReportCli !== 'function') die('ch metrics report: not built yet', 2);
      return mod.runReportCli(rest);
    }
    case undefined: case '--help': case 'help': print(USAGE); return;
    default: die(`unknown metrics subcommand: ${sub}\n${USAGE}`);
  }
}
