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

// CH_PROJECTS_DIR / CH_SESSIONS_DIR / CH_GEMINI_BRAIN_DIR point the readers at fixtures (tests, a screenshot run); unset, the real folders.
export const defaultProjectsDir = () => process.env.CH_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
/** The desktop app's session files (macOS): one local_<id>.json per session, with `cliSessionId` and `isArchived`. */
export const defaultSessionsDir = () => process.env.CH_SESSIONS_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
/** Antigravity CLI (`agy`) brain directory: `<brainDir>/<conversation-id>/.system_generated/logs/transcript.jsonl`. */
export const defaultGeminiBrainDir = () => process.env.CH_GEMINI_BRAIN_DIR || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');

const metaCache = new Map(); // file -> { mtimeMs, rec }

/**
 * The desktop app's own record of each session, keyed by the transcript id (`cliSessionId`):
 * Map(id -> { archived: boolean, title, branch, worktreeName }). Returns null when the folder cannot be read
 * (not macOS, the app is not installed): the caller then marks every session's archive state 'unsure' (null).
 * Read-only; an unreadable or odd file is skipped.
 */
export function readSessionMeta({ sessionsDir = defaultSessionsDir() } = {}) {
  const out = new Map();
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return depth === 0 ? null : undefined; }
    for (const e of entries) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(f, depth + 1); continue; }
      if (!/^local_.*\.json$/.test(e.name)) continue;
      try {
        const mtimeMs = fs.statSync(f).mtimeMs;
        let hit = metaCache.get(f);
        if (!hit || hit.mtimeMs !== mtimeMs) {
          const j = JSON.parse(fs.readFileSync(f, 'utf8'));
          hit = { mtimeMs, rec: typeof j?.cliSessionId === 'string' && typeof j.isArchived === 'boolean'
            ? { id: j.cliSessionId, archived: j.isArchived, title: String(j.title || ''), branch: String(j.branch || ''), worktreeName: String(j.worktreeName || '') } : null };
          metaCache.set(f, hit);
        }
        if (hit.rec) out.set(hit.rec.id, hit.rec);
      } catch { /* skip an unreadable file */ }
    }
    return out;
  };
  return walk(sessionsDir, 0) === null ? null : out;
}

/** `/ship-task <id>` arguments in a prompt: the ticket a session was started to work on. */
const SHIP_TASK_RE = /\/ship-task\s+([A-Za-z]{1,4}\d+)\b/g;
export function shipTaskIds(text) {
  return [...new Set([...String(text ?? '').matchAll(SHIP_TASK_RE)].map(m => m[1].toUpperCase()))];
}
/** The id a session name starts with ("FRO1738 - Measure ..."). */
export function titleTicketId(title) {
  const m = /^\s*([A-Za-z]{1,4}\d+)\b/.exec(String(title ?? ''));
  return m ? [m[1].toUpperCase()] : [];
}

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
 * Live Antigravity (`agy`) sessions: `<brainDir>/<conversation-id>/.system_generated/logs/transcript.jsonl`
 * written within `liveMinutes`. Reads only `USER_INPUT` lines from the first `HEAD_BYTES`.
 */
export function readLiveGeminiSessions({ brainDir = defaultGeminiBrainDir(), liveMinutes = 20, now = Date.now(), maxPrompts = 3 } = {}) {
  const out = [];
  if (!brainDir) return out;
  let convs = [];
  try { convs = fs.readdirSync(brainDir, { withFileTypes: true }); } catch { return out; }
  for (const entry of convs) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const file = path.join(brainDir, id, '.system_generated', 'logs', 'transcript.jsonl');
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
      try { ev = JSON.parse(line); } catch { continue; }
      const ts = ev?.created_at || ev?.timestamp;
      if (startedAt === null && ts && Number.isFinite(Date.parse(ts))) startedAt = Date.parse(ts);
      if (ev?.type === 'USER_INPUT' && ev.source === 'USER_EXPLICIT' && typeof ev.content === 'string') {
        prompts.push(ev.content);
      }
    }
    const joined = prompts.join(' ');
    const working = new Set(shipTaskIds(joined));
    const mentionedIds = extractTicketIds(joined.slice(0, 2000)).filter(t => !working.has(t));
    out.push({
      id, file, mtime, startedAt,
      ticketIds: [...working], mentionedIds,
      archived: null, project: 'gemini', harness: 'gemini',
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Live sessions: a transcript <projectsDir>/<project>/<id>.jsonl written within `liveMinutes` (plus live Antigravity
 * CLI conversations unless an isolated `projectsDir` test fixture was supplied without `geminiBrainDir`). The ticket ids
 * come from the first `maxPrompts` user prompts (e.g. "/ship-task BKR12"), not the whole transcript, which names many
 * unrelated tickets. Malformed lines are skipped.
 * @returns {Array<{ id, file, mtime, startedAt, ticketIds, project }>} newest first
 */
export function readLiveSessions(opts = {}) {
  const {
    projectsDir = defaultProjectsDir(),
    geminiBrainDir = opts.projectsDir === undefined ? defaultGeminiBrainDir() : null,
    liveMinutes = 20,
    now = Date.now(),
    maxPrompts = 3,
    sessionMeta,
  } = opts;
  const out = [];
  // undefined = read the desktop app's files; null (unreadable) = every session's archive state is 'unsure'.
  const meta = sessionMeta === undefined ? readSessionMeta() : sessionMeta;
  let projects = [];
  try { projects = fs.readdirSync(projectsDir); } catch { projects = []; }
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
      // Working tickets: the /ship-task argument, the session's name, its branch and worktree name. Ids that a prompt only
      // names (a coordinator listing nine tickets) are `mentionedIds` and never counted (AGE200).
      const id = f.replace(/\.jsonl$/, '');
      const m = meta ? meta.get(parent || id) : null;
      const working = new Set([...shipTaskIds(prompts.join(' ')), ...(m ? [...titleTicketId(m.title), ...extractTicketIds(m.branch), ...extractTicketIds(m.worktreeName)] : [])]);
      const mentionedIds = extractTicketIds(prompts.join(' ').slice(0, 2000)).filter(t => !working.has(t));
      const rec = { id, file, mtime, startedAt, ticketIds: [...working], mentionedIds, archived: m ? m.archived : null, project };
      if (m?.title) rec.title = m.title;
      if (parent) rec.subagentOf = parent;
      out.push(rec);
    }
  }
  if (geminiBrainDir) {
    out.push(...readLiveGeminiSessions({ brainDir: geminiBrainDir, liveMinutes, now, maxPrompts }));
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
export async function collectRunningInputs({ repos = [], config = {}, now = Date.now(), projectsDir, gh, sessionMeta } = {}) {
  const branches = await readBranches({ repos, recentHours: config.recentCommitHours ?? 6, now });
  return {
    sessions: readLiveSessions({ projectsDir, liveMinutes: config.liveSessionMinutes ?? 20, now, maxPrompts: 3, sessionMeta }),
    branches,
    autorun: readAutorunTick({ now }),
    prs: await readPrs(branches, gh ? { gh } : {}),
    now,
  };
}
