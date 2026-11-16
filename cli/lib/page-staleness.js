/**
 * Is a handbook page out of date? (node only: runs git.)
 *
 * A page's `covers` are `<repo name>/<glob>` entries. The page is "stale" when commits touched one
 * of them after the day the page says it was `updated` (compared from the END of that day, so commits
 * made earlier the same day, before the page was written, do not flag it). Repos come from
 * resolveRepos() in server/home/repos.js. A repo that is missing, or an entry that names no known repo,
 * is a notice, never an error.
 *
 *   const s = await pageStaleness({ updated: '2026-11-03', covers: ['shop/till/**'], repos });
 *   // { count, newest, commits: [{ hash, date, subject, repo }], capped, notices, since }
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';

export const MAX_COMMITS = 30;
export const CACHE_MS = 10 * 60 * 1000;
const GIT_TIMEOUT_MS = 8000;

const cache = new Map(); // key -> { at, value }

export function clearStalenessCache() { cache.clear(); }

/** The day after `updated` (YYYY-MM-DD) at 00:00 local time, in a form git's --since accepts. */
export function sinceOf(updated) {
  const [y, m, d] = updated.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  const pad = n => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T00:00:00`;
}

/** Split `covers` into per-repo glob lists; entries naming no known repo become notices. */
export function groupCovers(covers, repos) {
  const byRepo = new Map(repos.map(r => [r.name, { repo: r, globs: [] }]));
  const notices = [];
  for (const entry of covers) {
    const slash = entry.indexOf('/');
    const name = slash > 0 ? entry.slice(0, slash) : '';
    const rest = slash > 0 ? entry.slice(slash + 1) : '';
    const hit = byRepo.get(name);
    if (!hit) {
      notices.push(slash > 0
        ? `"${entry}" names a repo "${name}" that this project's config does not list.`
        : `"${entry}" should start with a repo name, like <repo>/<glob>.`);
    } else hit.globs.push(rest || '**');
  }
  return { groups: [...byRepo.values()].filter(g => g.globs.length), notices };
}

function git(repoPath, args) {
  return new Promise(resolve => {
    execFile('git', ['-C', repoPath, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? { error: err } : { stdout });
    });
  });
}

async function repoCommits({ repo, globs }, since) {
  if (!fs.existsSync(repo.path)) return { notice: `The repo "${repo.name}" is not at ${repo.path}, so its commits were not checked.` };
  const args = ['log', '--no-merges', `--since=${since}`, `-n${MAX_COMMITS + 1}`,
    '--format=%ct%x09%h%x09%cs%x09%s', '--', ...globs.map(g => `:(glob)${g}`)];
  const r = await git(repo.path, args);
  if (r.error) {
    return { notice: r.error.killed
      ? `git took too long in "${repo.name}", so its commits were not checked.`
      : `git could not read "${repo.name}" (${(r.error.stderr || r.error.message || '').toString().split('\n')[0].slice(0, 120)}).` };
  }
  const commits = r.stdout.split('\n').filter(Boolean).map(line => {
    const [ts, hash, date, ...subject] = line.split('\t');
    return { ts: Number(ts), hash, date, subject: subject.join('\t'), repo: repo.name };
  });
  return { commits };
}

/**
 * @param {{ updated: string|null, covers: string[], repos: {name:string,path:string}[], now?: number, key?: string }} input
 *   `key` (any string naming the page) turns on the 10-minute cache.
 * @returns {Promise<{ count: number, newest: string|null, commits: object[], capped: boolean, notices: string[], since: string|null }>}
 */
export async function pageStaleness({ updated, covers, repos, now = Date.now(), key = null }) {
  const cacheKey = key && JSON.stringify([key, updated, covers, repos]);
  const hit = cacheKey && cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const out = { count: 0, newest: null, commits: [], capped: false, notices: [], since: null };
  if (!updated) out.notices.push('The page has no "updated" date, so its age was not checked.');
  else if (!covers.length) out.notices.push('The page has no "covers", so its age was not checked.');
  else {
    out.since = sinceOf(updated);
    const { groups, notices } = groupCovers(covers, repos);
    out.notices.push(...notices);
    const results = await Promise.all(groups.map(g => repoCommits(g, out.since)));
    const seen = new Set();
    const all = [];
    for (const r of results) {
      if (r.notice) out.notices.push(r.notice);
      for (const c of r.commits || []) {
        const k = `${c.repo}:${c.hash}`;
        if (!seen.has(k)) { seen.add(k); all.push(c); }
      }
    }
    all.sort((a, b) => b.ts - a.ts);
    out.capped = all.length > MAX_COMMITS;
    out.commits = all.slice(0, MAX_COMMITS).map(({ ts, ...c }) => c);
    out.count = out.commits.length;
    out.newest = out.commits[0]?.date || null;
  }
  if (cacheKey) cache.set(cacheKey, { at: now, value: out });
  return out;
}
