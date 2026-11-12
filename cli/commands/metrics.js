/**
 * cli/commands/metrics.js
 * Development metrics. Spec: docs/metrics.md.
 *
 *   ch metrics collect [--sessions] [--ci] [--gates] [--since 30d] [--json]
 *   ch metrics flow [--project P] [--lane L] [--since 30d] [--json]
 *   ch metrics report [--project P] [--since 30d] [--json]
 *   ch metrics cost [<ticket-id>] [--project P] [--since 30d] [--json]   cost at API prices per ticket / epic
 *   ch metrics estimate [<ticket-id>] [--project P] [--json]   likely cost from similar shipped tickets (no AI)
 *   ch metrics estimate --accuracy [--project P] [--json]      backtest of those estimates against real cost
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
import { limitsLine } from '../../shared/plan-share.js';
import { formatRange, usd, MIN_SAMPLES, estimatesSummary, accuracyReport } from '../../shared/cost-estimate.js';
import { estimatorForDoc } from '../lib/estimator.js';
import { splitInProgress } from '../../shared/time-split.js';

const KINDS = ['gate', 'build', 'test', 'ci', 'other'];
const TIMINGS = 'timings.jsonl';
const SESSIONS = 'sessions.jsonl';
const MAX_JOB_FETCHES = 100; // failed-run job lookups per collect, so collect stays fast
const GH_PR_FIELDS = 'number,headRefName,state,mergedAt,closedAt';
const GH_FIELDS = 'databaseId,workflowName,headBranch,headSha,event,status,conclusion,createdAt,startedAt,updatedAt,attempt';

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
      // cancelled/skipped: neither pass nor failure (ok null), see docs/metrics.md
      ok: r.conclusion === 'cancelled' || r.conclusion === 'skipped' ? null : r.conclusion === 'success',
      conclusion: r.conclusion,
      attempt: Number(r.attempt) || 1,
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

/** Default gh PR runner: returns parsed JSON array of PRs (any state). Throws when gh is missing/fails. */
export function ghPrList(repo) {
  const out = execFileSync('gh', ['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '300', '--json', GH_PR_FIELDS], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

/** Map `gh pr list` JSON rows to kind 'pr' records (used by redTime to end a red span when the PR closes). */
export function prRecordsFromList(repo, prs) {
  return (prs || []).map(p => ({
    key: `gh-pr:${repo}:${p.number}`,
    kind: 'pr',
    repo,
    branch: p.headRefName,
    pr: p.number,
    state: p.state,
    mergedAt: p.mergedAt || null,
    closedAt: p.closedAt || null,
    at: p.mergedAt || p.closedAt || null,
    source: 'gh',
  }));
}

/** Names of the jobs that failed in one run. Throws when gh is missing/fails. */
export function ghFailedJobs(repo, runId) {
  const out = execFileSync('gh', ['run', 'view', String(runId), '--repo', repo, '--json', 'jobs'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  return (JSON.parse(out).jobs || []).filter(j => j.conclusion === 'failure').map(j => j.name);
}

/**
 * Give each failed run a `failedJobs` list: reuse the one already stored (`existing` records, same key),
 * else fetch it with `fetcher(repo, runId)`, newest runs first, at most `max` fetches. A failed fetch
 * leaves the field unset so the next collect retries. Mutates and returns `records`.
 */
export function attachFailedJobs(records, { existing = [], fetcher = ghFailedJobs, max = MAX_JOB_FETCHES } = {}) {
  const stored = new Map();
  for (const e of existing) if (e.key != null && Array.isArray(e.failedJobs)) stored.set(e.key, e.failedJobs);
  let fetched = 0;
  const failed = records.filter(r => r.ok === false).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const r of failed) {
    if (stored.has(r.key)) { r.failedJobs = stored.get(r.key); continue; }
    if (fetched >= max) continue;
    fetched++;
    try { r.failedJobs = fetcher(r.repo, r.runId); } catch { /* retry next collect */ }
  }
  return records;
}

/** Collect CI runs and PRs. `runner(repo, workflow)`, `prRunner(repo)` and `jobFetcher(repo, runId)` are injectable for tests. */
export function collectCi({ cfg, sinceMs = null, runner = ghRunList, prRunner = ghPrList, existing = [], jobFetcher = ghFailedJobs, maxJobFetches = MAX_JOB_FETCHES } = {}) {
  const cutoff = sinceCutoff(sinceMs);
  const records = [];
  const prRecords = [];
  const repos = new Set();
  for (const entry of cfg.repos) {
    try {
      prRecords.push(...prRecordsFromList(entry.repo, prRunner(entry.repo)));
    } catch (e) {
      printErr(`ci: ${entry.repo}: gh pr list failed, skipped (${String(e.message).split('\n')[0]})`);
    }
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
  const kept = records.filter(r => !cutoff || Date.parse(r.at) >= cutoff);
  attachFailedJobs(kept, { existing, fetcher: jobFetcher, max: maxJobFetches });
  return { records: [...kept, ...prRecords], repos: repos.size, prs: prRecords.length };
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
    // A suite script writes why sessions stopped to $CH_HOME/stop-causes.jsonl; a missing file changes nothing.
    stopCauses: readRecords(path.join(dataRoot(), 'stop-causes.jsonl')),
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
      const { records, repos, prs } = collectCi({ cfg, sinceMs, existing: readRecords(TIMINGS) });
      upsertRecords(TIMINGS, records);
      const runs = records.length - prs;
      summary.ci = { runs, prs, repos };
      lines.push(`ci: ${runs} runs, ${prs} PRs from ${repos} repos`);
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
export function loadMetricsPayload({ since, project, now, costLimit } = {}) {
  const nowMs = typeof now === 'number' ? now : now instanceof Date ? now.getTime() : now ? Date.parse(now) : Date.now();
  return buildMetricsPayload({
    doc: readDoc(),
    sessions: readRecords(SESSIONS),
    timings: readRecords(TIMINGS),
    cfg: metricsConfig(),
    now: nowMs,
    since: resolveSince(since, nowMs) ?? undefined,
    project: project || undefined,
    costLimit,
  });
}

/** Estimator over the sessions store and the current tracker; null without sessions data. */
function loadEstimator(project) {
  return estimatorForDoc(readDoc(), { project: project || undefined });
}

/** For GET /api/metrics/ticket-cost: state, cost so far (last 90 days) and the estimate of one ticket. */
export function ticketCostInfo(id) {
  const est = loadEstimator();
  if (!est) return { state: null, cost: null, estimate: null };
  const row = est.costs.byTicket.find(t => t.ticket === id) || null;
  const epic = est.costs.byEpic.find(e => e.epic === id) || null;
  return {
    state: est.stateOf(id),
    cost: row || epic ? { costUSD: (epic ?? row).costUSD, sessions: row ? row.sessions : null } : null,
    estimate: est.estimate(id),
  };
}

/** For GET /api/metrics/estimates: {id: estimate|null}; epics carry the sum of their open tickets. */
export function estimatesFor(ids) {
  const est = loadEstimator();
  const out = {};
  for (const id of ids) {
    const e = est ? est.estimate(id) : null;
    out[id] = e ? { typicalUSD: e.typicalUSD, highUSD: e.highUSD, n: e.n, basis: e.basis, ...(e.spentUSD !== undefined ? { spentUSD: e.spentUSD } : {}) } : null;
  }
  return out;
}

function cliSince(v, nowMs) {
  try { return resolveSince(v, nowMs); } catch (e) { return die(e.message); }
}

const STAGE_NAMES = { todo: 'To do', 'in-progress': 'In progress', review: 'Review' };
const hrs = v => (v === null || v === undefined ? '-' : fmtHours(v));
const pad = (v, n) => String(v).padEnd(n);
const day = iso => String(iso).slice(0, 10);

/** The in-progress time split: one total line, then the 5 tickets with the most idle time. */
function printSplit(sp) {
  const t = sp.total;
  print('');
  if (!(t.hours > 0)) { print('In-progress time: none in the window'); return; }
  const p = x => `${Math.round((x || 0) * 100)}%`;
  const ty = sp.typical;
  if (ty && ty.n) print(`Average ticket (${ty.n} that left in progress, median ${hrs(ty.medianHours)}): working ${p(ty.shares.working)}, CI ${p(ty.shares.ci)}, waiting on you ${p(ty.shares.you)}, nobody working on it ${p(ty.shares.idle)}`);
  print(`All in-progress hours ${hrs(t.hours)} (forgotten stays left out): working ${hrs(t.workingH)} (${p(t.shares.working)}), CI ${hrs(t.ciH)} (${p(t.shares.ci)}), waiting on you ${hrs(t.youH)} (${p(t.shares.you)}), nobody working on it ${hrs(t.idleH)} (${p(t.shares.idle)})`);
  const fg = sp.forgotten;
  if (fg && fg.n) print(`Forgotten stays (${fg.n}, ${hrs(fg.hours)}, in progress over 72 h with no session work; left out above): ${fg.tickets.map(g => `${g.ticket} ${hrs(g.hours)}`).join(', ')}`);
  if (!sp.sessionsWithIntervals) print('  (no session intervals yet: run ch metrics collect --sessions)');
  const rows = sp.byTicket.slice(0, 5);
  if (rows.length) print(`  ${pad('Ticket', 10)}${pad('total', 10)}${pad('working', 10)}${pad('CI', 10)}${pad('you', 10)}nothing`);
  for (const r of rows) print(`  ${pad(r.ticket, 10)}${pad(hrs(r.hours), 10)}${pad(hrs(r.workingH), 10)}${pad(hrs(r.ciH), 10)}${pad(hrs(r.youH), 10)}${hrs(r.idleH)}`);
}

function flowCmd(argv) {
  const { values } = parse(argv, {
    project: { type: 'string' }, lane: { type: 'string' }, since: { type: 'string' }, json: { type: 'boolean' },
  });
  const now = Date.now();
  const sinceMs = cliSince(values.since, now);
  const cfg = metricsConfig();
  const doc = readDoc();
  const split = splitInProgress({
    doc, sessions: readRecords(SESSIONS), timings: readRecords(TIMINGS), now, since: sinceMs ?? undefined,
    project: values.project, areas: cfg.areas,
  });
  const m = flowMetrics(doc, {
    now, since: sinceMs ?? undefined, project: values.project, lane: values.lane,
    areas: cfg.areas, forgottenEpicDays: cfg.forgottenEpicDays, skipStays: new Set(split.forgottenStays),
  });
  m.inProgressSplit = split;
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
  printSplit(m.inProgressSplit);
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
  print(`  Sessions ${s.n} (${s.withTicket} with a ticket): median ${s.medianActiveMin ?? '-'} min active, ${s.autonomousShare === null ? '-' : Math.round(s.autonomousShare * 100) + '%'} autonomous, ${s.waitUserHours} h waiting on you${s.helperWaits ? `, ${s.helperWaits} waits on a running helper, not counted as stuck` : ''}, $${s.costUSD}`);
  const ci = p.timings.ci.byRepo;
  const c = p.costs;
  if (c && c.total.costUSD > 0) {
    print(`  Cost ${money(c.total.costUSD)} at API prices (helpers ${money(c.total.helperCostUSD)}${c.plan ? `; a month is about ${money(c.plan.apiEquivalentPer30d)}, ${c.plan.multiple}x the ${money(c.plan.usdPerMonth)} plan` : ''})`);
    for (const t of c.byTicket.slice(0, 5)) print(`    ${pad(t.ticket, 10)}${pad(money(t.costUSD), 10)}${t.title ?? ''}`);
    for (const e of c.byEpic.slice(0, 3)) print(`    epic ${pad(e.epic, 9)}${pad(money(e.costUSD), 10)}${e.title ?? ''}`);
  }
  print(`  CI ${ci.reduce((a, r) => a + r.runs, 0)} runs; ${p.timings.series.length} timing series; red branches ${p.timings.redTime.summary.branches}`);
  print(`  Next up: ${p.next.length ? p.next.slice(0, 3).map(t => t.id).join(', ') : 'nothing ready'}`);
}

const money = n => `$${(Number(n) || 0).toFixed(2)}`;
const tok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const weekPct = r => (r.weekShare === undefined ? '' : `${(r.weekShare * 100).toFixed(1)}%`);
const tokSum = t => (t ? (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) : 0);

/** The "Cost by part" and "Main-thread context per call" lines of `ch metrics cost`. */
function partLines(t) {
  const lines = [];
  const label = { cacheRead: 'cache reads', cacheWrite: 'cache writes', output: 'output', input: 'input' };
  if (t.byPart?.some(x => x.costUSD > 0)) {
    lines.push(`Cost by part: ${t.byPart.map(x => `${label[x.part]} ${money(x.costUSD)} (${Math.round(x.share * 100)}%: main ${money(x.mainUSD)}, helpers ${money(x.helpersUSD)})`).join(', ')}`);
  }
  const x = t.context;
  if (x && x.calls > 0) {
    lines.push(`Main-thread context per call: median ${tok(x.median)}, p90 ${tok(x.p90)} (${x.calls.toLocaleString('en-US')} calls${x.sessionsWithout ? ` in ${x.sessions} of ${x.sessions + x.sessionsWithout} sessions; the rest have none recorded, run ch metrics collect --sessions` : ''})`);
  } else if (x && x.sessionsWithout > 0) {
    lines.push(`Main-thread context per call: not recorded for these ${x.sessionsWithout} sessions (run ch metrics collect --sessions)`);
  }
  return lines;
}

/** `ch metrics cost [<ticket-id>]`: the byTicket table, or one ticket's (an epic's: per child) cost. */
function costCmd(argv) {
  const { values, positionals } = parse(argv, { project: { type: 'string' }, since: { type: 'string' }, json: { type: 'boolean' } });
  const now = Date.now();
  const sinceMs = cliSince(values.since, now);
  const p = loadMetricsPayload({ since: sinceMs ?? undefined, project: values.project, now, costLimit: Infinity });
  const c = p.costs;
  const id = positionals[0] ? String(positionals[0]).toUpperCase() : null;
  if (!id) {
    if (values.json) { jsonOut(c); return; }
    print(`Cost ${day(p.window.since)} to ${day(p.window.until)}: ${money(c.total.costUSD)} at API prices (helpers ${money(c.total.helperCostUSD)}, ${tok(tokSum(c.total.tokens))} tokens)`);
    print(limitsLine(c.limits));
    for (const line of partLines(c.total)) print(line);
    if (!c.byTicket.length) { print('  no cost recorded in this range'); return; }
    const cal = c.limits.weekUSD > 0;
    print(`${pad('Ticket', 10)}${pad('Cost', 10)}${pad('Share', 7)}${cal ? pad('% wk', 7) : ''}${pad('Tokens', 9)}${pad('Tools', 7)}${pad('Sess', 6)}Title`);
    for (const t of c.byTicket) print(`${pad(t.ticket, 10)}${pad(money(t.costUSD), 10)}${pad(Math.round(t.share * 100) + '%', 7)}${cal ? pad(weekPct(t), 7) : ''}${pad(tok(t.tokens), 9)}${pad(t.toolCalls, 7)}${pad(t.sessions, 6)}${t.title ?? ''}`);
    return;
  }
  const epic = c.byEpic.find(e => e.epic === id);
  const one = c.byTicket.find(t => t.ticket === id);
  if (!epic && !one) die(`no cost recorded for ${id} in this range`);
  if (values.json) { jsonOut({ ticket: one ?? null, epic: epic ?? null }); return; }
  if (one) print(`${id}  ${money(one.costUSD)}${one.weekShare === undefined ? '' : ` (${weekPct(one)} of a week)`}  ${tok(one.tokens)} tokens, ${one.toolCalls} tool calls, ${one.sessions} session${one.sessions === 1 ? '' : 's'}, ${one.activeMin} min active${one.title ? `  ${one.title}` : ''}`);
  if (one) {
    const sp = splitInProgress({ doc: readDoc(), sessions: readRecords(SESSIONS), timings: readRecords(TIMINGS), now, since: sinceMs ?? undefined, only: id }).total;
    if (sp.hours > 0) print(`  In progress ${hrs(sp.hours)}: working ${hrs(sp.workingH)}, CI ${hrs(sp.ciH)}, you ${hrs(sp.youH)}, nothing ${hrs(sp.idleH)}`);
  }
  if (epic) {
    print(`Epic ${id}  ${money(epic.costUSD)} in all${epic.weekShare === undefined ? '' : ` (${weekPct(epic)} of a week)`}, ${Math.round(epic.share * 100)}% of the total${epic.title ? `  ${epic.title}` : ''}`);
    for (const k of epic.children) print(`  ${pad(k.ticket, 10)}${pad(money(k.costUSD), 10)}${k.own ? '(its own sessions) ' : ''}${k.title ?? ''}`);
  }
}

/** `ch metrics estimate --accuracy`: backtest of Likely cost against what shipped tickets really cost. */
function accuracyCmd(est, values) {
  const rows = est ? est.backtest() : [];
  const rep = accuracyReport(rows);
  if (values.json) { jsonOut({ ...rep, rows }); return; }
  if (!rows.length) { print(`no backtest: needs ${MIN_SAMPLES} shipped tickets with cost in the last 90 days (run ch metrics collect --sessions)`); return; }
  const pctOf = v => (v === null ? '-' : `${Math.round(v * 100)}%`);
  const line = g => `${pad(g.label ?? 'all', 14)}${pad(g.n, 9)}${pad(pctOf(g.underHighShare), 14)}${pad(g.medianRatio === null ? '-' : `${g.medianRatio}x`, 12)}${pad(money(g.medianMissUSD ?? 0), 8)}${g.verdict}`;
  print('Likely cost backtest: each shipped ticket estimated without itself, against what it really cost');
  print(`${pad('Model label', 14)}${pad('Tickets', 9)}${pad('At/under high', 14)}${pad('Actual/typ', 12)}${pad('Miss', 8)}Verdict`);
  print(line({ ...rep.overall, label: 'all' }));
  for (const g of rep.byLabel) print(line(g));
  print('Close = at least 70% at or under the high end and actual/typical between 0.7x and 1.4x; a label needs 8 tickets to be judged.');
}

/** `ch metrics estimate [<ticket-id>]`: likely cost of a ticket (an epic: per open child and the sum), or the sample summary. */
function estimateCmd(argv) {
  const { values, positionals } = parse(argv, { project: { type: 'string' }, json: { type: 'boolean' }, accuracy: { type: 'boolean' } });
  const est = loadEstimator(values.project);
  if (values.accuracy) { accuracyCmd(est, values); return; }
  const id = positionals[0] ? String(positionals[0]).toUpperCase() : null;
  const none = `no estimate: needs ${MIN_SAMPLES} shipped tickets with cost in the last 90 days (run ch metrics collect --sessions)`;
  if (!id) {
    const sum = est ? estimatesSummary(est) : { sampleWindowDays: 90, samples: 0, byLabel: [] };
    if (values.json) { jsonOut(sum); return; }
    print(`Estimate samples: ${sum.samples} shipped tickets with cost in the last ${sum.sampleWindowDays} days`);
    if (!sum.byLabel.length) { print(`  ${none}`); return; }
    print(`${pad('Model label', 14)}${pad('Tickets', 9)}${pad('Median', 10)}p75`);
    for (const g of sum.byLabel) print(`${pad(g.label, 14)}${pad(g.n, 9)}${pad(money(g.medianUSD), 10)}${money(g.p75USD)}`);
    return;
  }
  if (est && !est.stateOf(id)) die(`no such ticket ${id}`);
  const e = est ? est.estimate(id) : null;
  if (values.json) { jsonOut({ ticket: id, state: est ? est.stateOf(id) : null, estimate: e }); return; }
  if (!est) { print(none); return; }
  if (!e) { print(`${id}: ${est.samples < MIN_SAMPLES ? none : 'no estimate for this ticket'}`); return; }
  if (e.perChild) {
    print(`Epic ${id}: ${formatRange(e)} still to do (${e.basis}); ${money(e.spentUSD)} spent so far`);
    for (const k of e.perChild) print(`  ${pad(k.ticket, 10)}${pad(formatRange(k), 20)}${k.title ?? ''}`);
    if (!e.perChild.length) print('  no open tickets with an estimate');
    return;
  }
  print(`${id}: ${formatRange(e)}  typical ${usd(e.typicalUSD)}, up to ${usd(e.highUSD)} (p75)`);
  print(`  from ${e.n} similar shipped tickets: ${e.basis}`);
  const spent = est.spentUSD(id);
  if (spent > 0) print(`  spent so far: ${money(spent)}`);
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
  cost [<ticket-id>] [--project P] [--since 30d] [--json]
  estimate [<ticket-id>] [--project P] [--json]
  estimate --accuracy [--project P] [--json]   backtest: how close Likely cost was to real cost
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
    case 'cost': return costCmd(rest);
    case 'estimate': return estimateCmd(rest);
    case undefined: case '--help': case 'help': print(USAGE); return;
    default: die(`unknown metrics subcommand: ${sub}\n${USAGE}`);
  }
}
