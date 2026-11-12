/**
 * cli/lib/open-pr-gate.js
 * PRO70: `ch tasks review` refuses a ticket whose pull request is still open, so nobody reviews a
 * build that lacks the feature. A PR may be held open on purpose (waiting on a real-machine look):
 * `--held-pr '<why>'` lets it through and adds the check "Try on branch X, then say merge or not".
 * MERGED passes; CLOSED-unmerged refuses; gh missing/offline/unreadable warns and does not block.
 * `state` is injectable so tests need no real gh.
 */

import { spawnSync } from 'node:child_process';

const PR_LABEL = /^\s*PR\s*#\d+/i;
const PR_URL = /github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i;

/** Links that name a pull request: label 'PR #n' or a github.com/.../pull/n URL. */
export function prLinks(links) {
  return (links || []).filter(l => l && l.url && (PR_LABEL.test(l.label || '') || PR_URL.test(l.url)));
}

/** Ask gh for a PR's state. Returns { state, branch } or { error }. */
export function ghPrState(url) {
  const r = spawnSync('gh', ['pr', 'view', url, '--json', 'state,headRefName'], { encoding: 'utf8', timeout: 15000 });
  if (r.error || r.status !== 0) return { error: (r.error?.code === 'ENOENT' ? 'gh not installed' : (r.stderr || '').trim().split('\n')[0]) || 'gh failed' };
  try {
    const j = JSON.parse(r.stdout);
    return { state: String(j.state || '').toUpperCase(), branch: j.headRefName || '' };
  } catch {
    return { error: 'gh returned unreadable output' };
  }
}

/**
 * Decide what a review does about the ticket's PR links.
 * @returns {{ error: string|null, warnings: string[], checks: string[], held: object|null }}
 */
export function openPrGate({ id, links, heldPr, state = ghPrState }) {
  const out = { error: null, warnings: [], checks: [], held: null };
  const why = typeof heldPr === 'string' ? heldPr.trim() : '';
  const seen = new Set();
  for (const { url } of prLinks(links)) {
    if (seen.has(url)) continue;
    seen.add(url);
    const s = state(url);
    if (s.error) { out.warnings.push(`could not check ${url} (${s.error}); not blocking`); continue; }
    if (s.state === 'MERGED') continue;
    if (s.state === 'CLOSED') {
      out.error = `${id}: ${url} was closed without merging. Reopen or merge it, or drop the link (ch tasks update ${id} --remove-link N), then review.`;
      return out;
    }
    if (s.state !== 'OPEN') { out.warnings.push(`${url} has state "${s.state}"; not blocking`); continue; }
    if (heldPr !== undefined && !why) { out.error = '--held-pr needs a reason: --held-pr "<why the PR stays open>"'; return out; }
    if (!why) {
      out.error = `${id}: ${url} is still open, so a review would check a build without the feature. Merge it first, or if it is held open on purpose pass --held-pr "<why>" (adds the check "Try on branch ${s.branch || '<branch>'}, then say merge or not").`;
      return out;
    }
    out.checks.push(`Try on branch ${s.branch || url}, then say merge or not`);
    out.held = { reason: why, pr: url, branch: s.branch, at: new Date().toISOString() };
  }
  return out;
}
