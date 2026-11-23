/**
 * cli/commands/tasks-running.js (PRO117)
 * `ch tasks running [--json] [--repo <path>]... [--project <slug>]`: which tickets have live work right now
 * (live Claude Code sessions, worktrees, recent commits, autorun), with state, age, epic, source and PR; then the
 * stale and idle epics. Read-only (no tasks lock); the rules live in shared/running.js, the readers in
 * cli/lib/running-inputs.js.
 *
 * Without --repo the repos come from the project's home config (config.json `home.<slug>` -> a config file with
 * `repos`, resolved by server/home/repos.js), else the current git repo.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from '../lib/args.js';
import { print, jsonOut } from '../lib/output.js';
import { dataRoot } from '../lib/io.js';
import { loadProjectHomeConfig } from '../../server/home/project-config.js';
import { resolveRepos } from '../../server/home/repos.js';
import { readTasksDoc } from '../../shared/tasks-files.js';
import { normalizeTasksDoc } from '../lib/schema.js';
import { computeRunning } from '../../shared/running.js';
import { projectScope } from '../../shared/home-scope.js';
import { collectRunningInputs } from '../lib/running-inputs.js';

/** Absolute repo paths of a project's home config (the shared loader and resolver), or [] when there is none. */
function homeConfigRepos(slug) {
  if (!slug) return [];
  const home = loadProjectHomeConfig(dataRoot(), slug);
  return home.config ? resolveRepos(home.config, home.path).map(r => r.path) : [];
}

function currentRepo() {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

/** '42m', '3h', '2d' for an ISO time, or '-' when unknown. */
export function ago(sinceIso, now) {
  const ms = Date.parse(sinceIso);
  if (!Number.isFinite(ms)) return '-';
  const min = Math.max(0, Math.round((now - ms) / 60e3));
  if (min < 60) return `${min}m`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

export function runningLines(result, doc, now) {
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  for (const r of result.running) {
    lines.push(`${pad(r.id, 8)}  ${pad(r.state, 11)}  ${pad(ago(r.since, now), 4)}  ${pad(r.epicId || 'loose', 8)}  ${r.sources.join('+')}${r.pr ? `  ${r.pr}` : ''}`);
  }
  if (!lines.length) lines.push('Nothing is running.');
  // Sessions first (AGE200): "4 sessions on 13 tickets", the same words as the Home page.
  const n = (result.sessions || []).length;
  if (result.sessions) lines.unshift(`${n} ${n === 1 ? 'session' : 'sessions'} on ${result.running.filter(r => r.state !== 'idle').length} tickets`, '');
  const titles = new Map();
  for (const s of doc.sections || []) for (const t of s.tasks || []) titles.set(t.id, t.title);
  for (const [label, state] of [['Stale epics (in progress, nothing running, untouched)', 'stale'], ['Idle epics (in progress, nothing running)', 'idle']]) {
    const ids = Object.keys(result.epics).filter(id => result.epics[id].state === state);
    if (!ids.length) continue;
    lines.push('', `${label}:`);
    for (const id of ids) lines.push(`  ${pad(id, 8)}  last touched ${result.epics[id].lastTouched || '-'}  ${titles.get(id) || ''}${result.epics[id].idleWhy ? `  (${result.epics[id].idleWhy})` : ''}`);
  }
  return lines;
}

export default async function cmdRunning(argv) {
  const { values } = parse(argv, {
    json: { type: 'boolean', short: 'j' },
    repo: { type: 'string', multiple: true },
    project: { type: 'string' },
  });
  let repos = (values.repo || []).map(r => path.resolve(r));
  if (!repos.length) repos = homeConfigRepos(values.project);
  if (!repos.length) { const here = currentRepo(); repos = here ? [here] : []; }

  const now = Date.now();
  const doc = normalizeTasksDoc(readTasksDoc(dataRoot()));
  const inputs = await collectRunningInputs({ repos, now });
  // The Home page's scope rule (shared/home-scope.js), so this list and Home's running numbers agree.
  const scope = values.project ? projectScope(loadProjectHomeConfig(dataRoot(), values.project).config, doc, values.project) : null;
  const result = computeRunning(doc, inputs, values.project ? { project: values.project, scope } : {});
  if (values.json) { jsonOut(result); return; }
  for (const line of runningLines(result, doc, now)) print(line);
}
