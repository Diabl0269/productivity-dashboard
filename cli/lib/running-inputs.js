/**
 * cli/lib/running-inputs.js (PRO117): the impure readers behind shared/running.js. Read-only; every reader takes
 * explicit paths so tests use temp dirs, and none throws when its source is missing (it returns nothing).
 *
 *   readLiveSessions({ projectsDir, liveMinutes, now, maxPrompts })  live Claude Code transcripts + ticket ids
 *   readBranches({ repos, recentHours, now })                        worktree and recently committed branches
 *   readAutorunTick({ now })                                         the dispatcher's tick (null when stale)
 *   readPrs(branches, { gh, ttlMs })                                 open PR + checks per branch, via `gh`
 *   collectRunningInputs({ repos, config, now })                     all of the above, in the computeRunning shape
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { extractTicketIds } from '../../shared/running.js';
import { readAutorunTick as readTick } from './next-start-inputs.js';

const HEAD_BYTES = 256 * 1024;
const GIT_TIMEOUT_MS = 10000;
const GH_TIMEOUT_MS = 15000;

export const defaultProjectsDir = () => path.join(os.homedir(), '.claude', 'projects');

/** The text of a user prompt event, or null for anything else (assistant lines, meta lines, tool results). */
function promptText(ev) {
  if (!ev || ev.type !== 'user' || ev.isMeta) return null;
  const c = ev.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return null;
  return c.filter(p => p && p.type === 'text').map(p => p.text).join(' ');
}

/** Read only the first HEAD_BYTES of a file (never the whole transcript). */
function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString('utf8');
  } finally { fs.closeSync(fd); }
}

/**
 * Live sessions: a transcript <projectsDir>/<project>/<id>.jsonl written within `liveMinutes`. The ticket ids come
 * from the first `maxPrompts` user prompts (e.g. "/ship-task BKR12"), not the whole transcript, which names many
 * unrelated tickets. Malformed lines are skipped.
 * @returns {Array<{ id, file, mtime, startedAt, ticketIds, project }>} newest first
 */
export function readLiveSessions({ projectsDir = defaultProjectsDir(), liveMinutes = 20, now = Date.now(), maxPrompts = 3 } = {}) {
  const out = [];
  let projects = [];
  try { projects = fs.readdirSync(projectsDir); } catch { return out; }
  for (const project of projects) {
    const dir = path.join(projectsDir, project);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    // A session's own transcript, plus the transcripts of its subagents (<id>/subagents/*.jsonl): a coordinator's
    // prompt often names no ticket while the subagent it launched works on one.
    const files = names.filter(f => f.endsWith('.jsonl')).map(f => ({ f, file: path.join(dir, f), parent: null }));
    for (const n of names.filter(n => !n.endsWith('.jsonl'))) {
      let subs = [];
      try { subs = fs.readdirSync(path.join(dir, n, 'subagents')).filter(f => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of subs) files.push({ f, file: path.join(dir, n, 'subagents', f), parent: n });
    }
    for (const { f, file, parent } of files) {
      let mtime;
      try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
      if (now - mtime > liveMinutes * 60e3) continue;
      let head = '';
      try { head = readHead(file); } catch { continue; }
      const prompts = [];
      let startedAt = null;
      for (const line of head.split('\n')) {
        if (prompts.length >= maxPrompts) break;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; } // malformed or cut-off line
        if (startedAt === null && ev && Number.isFinite(Date.parse(ev.timestamp))) startedAt = Date.parse(ev.timestamp);
        const text = promptText(ev);
        if (text) prompts.push(text);
      }
      const rec = { id: f.replace(/\.jsonl$/, ''), file, mtime, startedAt, ticketIds: extractTicketIds(prompts.join(' ').slice(0, 2000)), project };
      if (parent) rec.subagentOf = parent;
      out.push(rec);
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function run(cmd, args, { cwd, timeout }) {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd, timeout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}
const git = (repo, args) => run('git', ['-C', repo, ...args], { timeout: GIT_TIMEOUT_MS });

/**
 * Branches of each repo: every live worktree's branch and every local or remote branch whose last commit is
 * within `recentHours`. A missing or non-git repo is skipped.
 * @returns {Promise<Array<{ repo, repoPath, branch, via: 'worktree'|'recent commit', lastCommitAt }>>}
 */
export async function readBranches({ repos = [], recentHours = 6, now = Date.now() } = {}) {
  const out = [];
  for (const repoPath of repos) {
    const name = path.basename(repoPath);
    const refsOut = await git(repoPath, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)\t%(committerdate:iso-strict)', 'refs/heads', 'refs/remotes']);
    if (refsOut === null) continue; // not a git repo, or git missing
    const dates = new Map(); // branch name (remote prefix dropped) -> ms of its newest commit
    for (const line of refsOut.split('\n').filter(Boolean)) {
      const [ref, date] = line.split('\t');
      const ms = Date.parse(date);
      if (!Number.isFinite(ms) || /\/HEAD$/.test(ref)) continue; // origin/HEAD is an alias, not a branch
      const key = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '');
      if (!dates.has(key) || ms > dates.get(key)) dates.set(key, ms);
    }
    const wt = (await git(repoPath, ['worktree', 'list', '--porcelain'])) || '';
    const seen = new Set();
    for (const line of wt.split('\n')) {
      if (!line.startsWith('branch ')) continue;
      const branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      seen.add(branch);
      out.push({ repo: name, repoPath, branch, via: 'worktree', lastCommitAt: dates.has(branch) ? new Date(dates.get(branch)).toISOString() : null });
    }
    for (const [branch, ms] of dates) {
      if (now - ms <= recentHours * 3600e3) out.push({ repo: name, repoPath, branch, via: 'recent commit', lastCommitAt: new Date(ms).toISOString() });
    }
  }
  return out;
}

/** The dispatcher's tick ({ at, intervalMin, liveEpics[] }) or null when it is missing or stale. */
export function readAutorunTick({ now = Date.now() } = {}) {
  return readTick({ now });
}

/** 'pending' | 'failing' | 'passing' | null from a `gh` statusCheckRollup list. */
export function checksOf(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return null;
  const pending = rollup.some(c => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED');
  if (pending) return 'pending';
  const bad = rollup.some(c => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(c.conclusion || c.state));
  return bad ? 'failing' : 'passing';
}

// Cached like serve.js's /api/pr-state (a promise per key, so concurrent callers share one `gh` call).
// TODO: serve.js keeps its own copy (prStateCached); point it at this one when serve.js is free to edit.
const prCache = new Map();
export function clearPrCache() { prCache.clear(); }

function prFor(repoPath, branch, { gh, ttlMs }) {
  const key = `${gh}\0${repoPath}\0${branch}`;
  const hit = prCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
  const promise = run(gh, ['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'url,state,statusCheckRollup'], { cwd: repoPath, timeout: GH_TIMEOUT_MS })
    .then(stdout => {
      try {
        const pr = JSON.parse(stdout)[0];
        return pr ? { url: pr.url, state: String(pr.state || '').toUpperCase() || null, checks: checksOf(pr.statusCheckRollup) } : null;
      } catch { return null; } // gh missing, failing or unreadable: no PR info
    });
  prCache.set(key, { at: Date.now(), promise });
  return promise;
}

/**
 * Open PR and check state for the branches that name a ticket (others are not looked up), keyed by branch name.
 * `gh` missing or failing gives {} and never throws.
 */
export async function readPrs(branches, { gh = 'gh', ttlMs = 60e3 } = {}) {
  const wanted = new Map();
  for (const b of branches || []) {
    if (b.repoPath && extractTicketIds(b.branch).length) wanted.set(`${b.repoPath}\0${b.branch}`, b);
  }
  const out = {};
  await Promise.all([...wanted.values()].map(async b => {
    const pr = await prFor(b.repoPath, b.branch, { gh, ttlMs }).catch(() => null);
    if (pr) out[b.branch] = pr;
  }));
  return out;
}

/** Everything computeRunning needs. `config` may carry { liveSessionMinutes, recentCommitHours }. */
export async function collectRunningInputs({ repos = [], config = {}, now = Date.now(), projectsDir, gh } = {}) {
  const branches = await readBranches({ repos, recentHours: config.recentCommitHours ?? 6, now });
  return {
    sessions: readLiveSessions({ projectsDir, liveMinutes: config.liveSessionMinutes ?? 20, now, maxPrompts: 3 }),
    branches,
    autorun: readAutorunTick({ now }),
    prs: await readPrs(branches, gh ? { gh } : {}),
    now,
  };
}
