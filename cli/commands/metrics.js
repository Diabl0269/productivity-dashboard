/**
 * cli/commands/metrics.js
 * Development metrics. Spec: docs/metrics.md.
 *
 *   ch metrics collect [--sessions] [--ci] [--gates] [--since 30d] [--json]
 *   ch metrics flow [--project P] [--lane L] [--since 30d] [--json]
 *   ch metrics report [--project P] [--since 30d] [--json]
 *   ch metrics time <name> [--repo R] [--kind K] -- <command...>
 *   ch metrics record --name N --seconds S [--ok|--failed] [--repo R] [--kind K] [--at ISO]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from '../lib/args.js';
import { print, printErr, die, jsonOut } from '../lib/output.js';
import { metricsDir, readRecords, upsertRecords, appendRecord, metricsConfig } from '../lib/metrics-store.js';
import { dataRoot } from '../lib/io.js';
import { collectSessions } from '../lib/session-files.js';
import { readTasksDoc } from '../../shared/tasks-files.js';
import { normalizeTasksDoc } from '../lib/schema.js';
import { flowMetrics } from '../../shared/flow-metrics.js';
import { buildMetricsPayload } from '../../shared/metrics-payload.js';
import { fmtHours } from '../../shared/insights.js';

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
  const args = ['run', 'list', '--repo', repo, '--limit', '1000', '--json', GH_FIELDS];
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
      if (!r.steps || !Object.keys(r.steps).length) continue; // --help or bad-flag run
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
  const cachePath = path.join(metricsDir(), '.sessions-cache.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { /* none yet */ }
  const res = await collectSessions({
    dirs: cfg.claudeProjects, cache, since: sinceMs ? sinceCutoff(sinceMs) : null, stallMinutes: cfg.stallMinutes,
  });
  const st = upsertRecords(SESSIONS, res.records);
  fs.writeFileSync(cachePath, JSON.stringify(res.cache ?? cache));
  return { changed: res.records.length, ...st };
}

/**
 * Run the collectors (all three when none is selected). Shared by `ch metrics collect` and
 * serve.js. Returns {summary, lines}; never prints and never exits.
 */
export async function runCollect({ ci, gates, sessions, sinceMs = null } = {}) {
  const all = !ci && !gates && !sessions;
  const cfg = metricsConfig();
  const summary = {};
  const lines = [];
  if (all || ci) {
    if (!cfg.repos.length) {
      lines.push('ci: no repos configured (metrics.repos), skipped');
    } else {
      const { records, repos } = collectCi({ cfg, sinceMs });
      upsertRecords(TIMINGS, records);
      summary.ci = { runs: records.length, repos };
      lines.push(`ci: ${records.length} runs from ${repos} repos`);
    }
  }
  if (all || gates) {
    const { records } = collectGates({ cfg, sinceMs });
    upsertRecords(TIMINGS, records);
    summary.gates = { runs: records.length };
    lines.push(`gates: ${records.length} runs`);
  }
  if (all || sessions) {
    if (!cfg.claudeProjects.length) {
      lines.push('sessions: no transcript dirs configured (metrics.claudeProjects), skipped');
    } else {
      const res = await collectSessionsStep(cfg, sinceMs);
      summary.sessions = res;
      lines.push(`sessions: ${res.changed} read, ${res.added} new, ${res.replaced} updated`);
    }
  }
  return { summary, lines };
}

async function collect(argv) {
  const { values } = parse(argv, {
    ci: { type: 'boolean' }, gates: { type: 'boolean' }, sessions: { type: 'boolean' },
    since: { type: 'string' }, json: { type: 'boolean' },
  });
  const { summary, lines } = await runCollect({
    ci: values.ci, gates: values.gates, sessions: values.sessions, sinceMs: parseSince(values.since),
  });
  if (values.json) jsonOut(summary); else lines.forEach(print);
}

/** "30d" / "12h" / "2w" or an ISO date -> ms since epoch; null when absent. Throws on bad input. */
export function resolveSince(since, nowMs = Date.now()) {
  if (since === undefined || since === null || since === '') return null;
  if (typeof since === 'number') return since;
  const m = /^(\d+(?:\.\d+)?)([hdw])$/.exec(String(since));
  if (m) return nowMs - Number(m[1]) * { h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[m[2]];
  const t = Date.parse(since);
  if (Number.isNaN(t)) throw new Error(`bad since "${since}" (use e.g. 30d, 12h, 2w or an ISO date)`);
  return t;
}

/** Tasks document without taking the tasks lock (read-only, safe in a long-running server). */
function readDoc() {
  return normalizeTasksDoc(readTasksDoc(dataRoot()));
}

/** Everything the report and the dashboard need, from the tracker and $CH_HOME/metrics/. */
export function loadMetricsPayload({ since, project, now } = {}) {
  const nowMs = typeof now === 'number' ? now : now instanceof Date ? now.getTime() : now ? Date.parse(now) : Date.now();
  return buildMetricsPayload({
    doc: readDoc(),
    sessions: readRecords(SESSIONS),
    timings: readRecords(TIMINGS),
    cfg: metricsConfig(),
    now: nowMs,
    since: resolveSince(since, nowMs) ?? undefined,
    project: project || undefined,
  });
}

function cliSince(v, nowMs) {
  try { return resolveSince(v, nowMs); } catch (e) { return die(e.message); }
}

const STAGE_NAMES = { todo: 'To do', 'in-progress': 'In progress', review: 'Review' };
const hrs = v => (v === null || v === undefined ? '-' : fmtHours(v));
const pad = (v, n) => String(v).padEnd(n);
const day = iso => String(iso).slice(0, 10);

function flowCmd(argv) {
  const { values } = parse(argv, {
    project: { type: 'string' }, lane: { type: 'string' }, since: { type: 'string' }, json: { type: 'boolean' },
  });
  const now = Date.now();
  const sinceMs = cliSince(values.since, now);
  const cfg = metricsConfig();
  const m = flowMetrics(readDoc(), {
    now, since: sinceMs ?? undefined, project: values.project, lane: values.lane,
    areas: cfg.areas, forgottenEpicDays: cfg.forgottenEpicDays,
  });
  if (values.json) { jsonOut(m); return; }
  const filt = [values.project && `project ${values.project}`, values.lane && `lane ${values.lane}`].filter(Boolean).join(', ');
  print(`Flow ${day(m.window.since)} to ${day(m.window.until)}${filt ? ` (${filt})` : ''}`);
  const c = m.counts;
  print(`Tickets: ${c.started} started, ${c.shipped} shipped, ${c.reopened} reopened, ${c.closedWithoutWork} closed without work`);
  print(`Cycle time: median ${hrs(m.cycle.median)}, p90 ${hrs(m.cycle.p90)} (${m.cycle.n} tickets)`);
  print(`Lead time:  median ${hrs(m.lead.median)}, p90 ${hrs(m.lead.p90)} (${m.lead.n} tickets)`);
  print(`Backlog: ${m.backlog.openTodo} open in To do, ${m.backlog.growthPerWeek >= 0 ? '+' : ''}${m.backlog.growthPerWeek} a week`);
  print('');
  print(`${pad('Stage', 13)}${pad('stays', 7)}${pad('median', 10)}${pad('p75', 10)}${pad('total', 10)}now waiting`);
  for (const [k, v] of Object.entries(m.stages)) {
    const open = v.open.n ? `${v.open.n}, oldest ${hrs(v.open.oldestHours)}` : '-';
    print(`${pad(STAGE_NAMES[k] || k, 13)}${pad(v.n, 7)}${pad(hrs(v.median), 10)}${pad(hrs(v.p75), 10)}${pad(hrs(v.totalHours), 10)}${open}`);
  }
  print('');
  const b = m.bottleneck;
  print(b ? `Bottleneck: ${STAGE_NAMES[b.stage] || b.stage}, ${Math.round(b.share * 100)}% of build and review time (${hrs(b.totalHours)})` : 'Bottleneck: none (no build or review time in the window)');
  if (m.forgottenEpics.length) {
    print(`Forgotten epics (${m.forgottenEpics.length}):`);
    for (const e of m.forgottenEpics) print(`  ${e.id}  idle ${e.idleDays} days  ${e.title}`);
  } else {
    print('Forgotten epics: none');
  }
}

function reportCmd(argv) {
  const { values } = parse(argv, { project: { type: 'string' }, since: { type: 'string' }, json: { type: 'boolean' } });
  const now = Date.now();
  const sinceMs = cliSince(values.since, now);
  const p = loadMetricsPayload({ since: sinceMs ?? undefined, project: values.project, now });
  if (values.json) { jsonOut(p); return; }
  const f = p.flow;
  print(`Metrics ${day(p.window.since)} to ${day(p.window.until)}${p.filters.project ? ` (project ${p.filters.project})` : ''}`);
  print('');
  print('Insights');
  if (!p.insights.length) print('  nothing to report yet');
  for (const i of p.insights) {
    print(`  [${i.kind}] ${i.title}`);
    if (i.detail) print(`      ${i.detail}`);
  }
  print('');
  print('Headline numbers');
  print(`  Shipped ${f.counts.shipped} tickets, started ${f.counts.started}; cycle median ${hrs(f.cycle.median)}, lead median ${hrs(f.lead.median)}, review wait median ${hrs(f.stages.review.median)}`);
  const s = p.sessions.summary;
  print(`  Sessions ${s.n} (${s.withTicket} with a ticket): median ${s.medianActiveMin ?? '-'} min active, ${s.autonomousShare === null ? '-' : Math.round(s.autonomousShare * 100) + '%'} autonomous, ${s.waitUserHours} h waiting on you, $${s.costUSD}`);
  const ci = p.timings.ci.byRepo;
  print(`  CI ${ci.reduce((a, r) => a + r.runs, 0)} runs; ${p.timings.series.length} timing series; red branches ${p.timings.redTime.summary.branches}`);
  print(`  Next up: ${p.next.length ? p.next.slice(0, 3).map(t => t.id).join(', ') : 'nothing ready'}`);
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
    case 'flow': return flowCmd(rest);
    case 'report': return reportCmd(rest);
    case undefined: case '--help': case 'help': print(USAGE); return;
    default: die(`unknown metrics subcommand: ${sub}\n${USAGE}`);
  }
}
