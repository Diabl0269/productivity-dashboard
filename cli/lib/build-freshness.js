/**
 * cli/lib/build-freshness.js
 * Does the installed app contain a PR's merge commit? Local git only (no network at render time):
 * find the PR's squash/merge commit with `git log --grep "(#N)"`, read the installed build's commit
 * from the configured source, and decide with `git merge-base --is-ancestor`. Anything unreadable
 * gives state "unknown" (the card shows nothing). Rules come from config.json `buildFreshness`
 * (see shared/build-freshness.js). `run` is injectable so tests need no real shell.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { matchPr, validRules } from '../../shared/build-freshness.js';

const expandHome = (p) => (p === '~' || String(p).startsWith('~/') ? path.join(os.homedir(), String(p).slice(1)) : String(p));

/** Run a program, returning { code, out } (never throws). */
export function defaultRun(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, ...opts });
    return { code: 0, out: out.trim() };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : -1, out: '' };
  }
}

/** config.json `buildFreshness` rules (empty when unset or unreadable). */
export function readFreshnessRules(dataRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dataRoot, 'config.json'), 'utf8'));
    return validRules(cfg.buildFreshness);
  } catch { return []; }
}

/** Value of `key` in an XML Info.plist ('' when absent); binary plists fall back to plutil. */
export function readPlistKey(file, key, run = defaultRun) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  if (text.startsWith('<?xml') || text.includes('<plist')) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`<key>${esc}</key>\\s*<string>([^<]*)</string>`).exec(text);
    return m ? m[1].trim() : '';
  }
  const r = run('plutil', ['-extract', key, 'raw', '-o', '-', file]);
  return r.code === 0 ? r.out : '';
}

/** The raw build identifier (a sha, a tag-ish version...) from a buildCommit source, or ''. */
export function readBuildValue(source, run = defaultRun) {
  if (typeof source.plist === 'string') return readPlistKey(expandHome(source.plist), String(source.key || ''), run);
  if (typeof source.file === 'string') {
    try { return fs.readFileSync(expandHome(source.file), 'utf8').trim().split(/\s+/)[0] || ''; } catch { return ''; }
  }
  if (typeof source.command === 'string') {
    const r = run('sh', ['-c', source.command]);
    return r.code === 0 ? r.out.split(/\s+/)[0] || '' : '';
  }
  return '';
}

/** { sha, at } of a commit-ish in `repo` (committer date, ISO), or null when it is not a commit there. */
export function commitInfo(repo, ref, run = defaultRun) {
  const r = run('git', ['-C', repo, 'log', '-1', '--format=%H%x09%cI', `${ref}^{commit}`, '--']);
  if (r.code !== 0 || !r.out) return null;
  const [sha, at] = r.out.split('\t');
  return sha ? { sha, at } : null;
}

/** The merge commit of PR #n: the newest commit whose subject ends "(#n)", else null. */
export function findMergeCommit(repo, number, run = defaultRun) {
  for (const scope of [['HEAD'], ['--all']]) {
    const r = run('git', ['-C', repo, 'log', '-1', '--fixed-strings', `--grep=(#${number})`, '--format=%H%x09%cI', ...scope]);
    if (r.code === 0 && r.out) {
      const [sha, at] = r.out.split('\t');
      if (sha) return { sha, at };
    }
  }
  return null;
}

/** The installed build's commit in `repo`: a sha, or (with source.tag "v{value}") the commit of that tag. */
export function resolveBuildCommit(repo, source, run = defaultRun) {
  // A build made with uncommitted edits records "<sha>-dirty": compare its base commit.
  const value = readBuildValue(source, run).replace(/-dirty$/, '');
  if (!value) return null;
  const ref = typeof source.tag === 'string' && source.tag.includes('{value}') ? source.tag.replace('{value}', value) : value;
  if (!/^[\w./+-]+$/.test(ref) || ref.startsWith('-')) return null;
  return commitInfo(repo, ref, run);
}

/**
 * Freshness of one PR link against `rules`: null (no rule matches), or
 * { state: 'current'|'stale'|'unknown', mergedAt?, buildAt?, updateCommand? }.
 */
export function checkFreshness(rules, url, run = defaultRun) {
  const hit = matchPr(rules, url);
  if (!hit) return null;
  const { rule, number } = hit;
  const repo = expandHome(rule.repo);
  const unknown = { state: 'unknown' };
  const merge = findMergeCommit(repo, number, run);
  if (!merge) return unknown;
  const build = resolveBuildCommit(repo, rule.buildCommit, run);
  if (!build) return unknown;
  const r = run('git', ['-C', repo, 'merge-base', '--is-ancestor', merge.sha, build.sha]);
  const base = { mergedAt: merge.at, buildAt: build.at };
  if (r.code === 0) return { state: 'current', ...base };
  if (r.code === 1) return { state: 'stale', ...base, ...(rule.updateCommand ? { updateCommand: String(rule.updateCommand) } : {}) };
  return unknown;
}

/** checkFreshness with a short cache (default 30 s), so the Plan page can poll without spawning git each time. */
export function createFreshnessChecker({ run = defaultRun, ttlMs = 30000, now = Date.now } = {}) {
  const cache = new Map();
  return (rules, url) => {
    const key = `${url}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = checkFreshness(rules, url, run);
    cache.set(key, { at: now(), value });
    return value;
  };
}
