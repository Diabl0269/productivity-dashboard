#!/usr/bin/env node
// Synthetic CH_HOME for the epic build-freshness e2e (AGE35): a temp git repo with three PR commits,
// an "installed build" pinned to the first one, and two epics in Ready for review.
//   node dashboard/e2e/build-freshness-fixture.js <dir>     (prints nothing; then CH_HOME=<dir> PORT=3141 node serve.js)
//   E-STALE  children C-OLD (PR #1, in the build) and C-NEW (PR #2, merged after it)  -> "needs a newer build ... Behind: C-NEW"
//   E-LOST   child C-GONE (PR #99, no such commit in the repo)                          -> "No build info for this change"
//   E-FRESH  child C-OLD2 (PR #1)                                                       -> "Your app: in your build"
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: build-freshness-fixture.js <dir>'); process.exit(2); }
const repo = path.join(dir, 'app-repo');
fs.mkdirSync(repo, { recursive: true });
const ident = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const git = (env, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...ident, ...env } }).trim();
git({}, 'init', '-q', '-b', 'main');
const commit = (file, msg, date) => {
  fs.writeFileSync(path.join(repo, file), msg);
  git({}, 'add', '.');
  git({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, 'commit', '-q', '-m', msg);
  return git({}, 'rev-parse', 'HEAD');
};
const old = commit('a', 'first change (#1)', '2026-01-10T12:00:00Z');
commit('b', 'second change (#2)', '2026-03-05T12:00:00Z');
fs.writeFileSync(path.join(dir, 'installed-build.txt'), `${old}\n`);
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  buildFreshness: [{
    repo,
    prPattern: 'github.com/acme/app/pull/',
    buildCommit: { file: path.join(dir, 'installed-build.txt') },
    updateCommand: 'make install',
  }],
}, null, 2));

const PLAIN = "## In plain words\n**What you'll notice:** x\n**Why it matters:** y\n**How to check it:** look\n\n## Technical detail (for Claude)\nz";
const pr = n => ({ label: `PR #${n}`, url: `https://github.com/acme/app/pull/${n}` });
const child = (id, parentId, n) => ({ id, title: `Child ${id}`, checked: true, priority: 'medium', type: 'task', parentId, subtasks: [], description: PLAIN, links: [pr(n)], created: '2026-11-01', updated: '2026-11-05' });
const epic = (id) => ({
  id, title: `Epic ${id}`, checked: true, priority: 'medium', type: 'epic', lane: 'a', subtasks: [], description: '', created: '2026-11-01', updated: '2026-11-06',
  result: { at: '2026-11-06T10:00:00Z', shipped: [`${id}: shipped something`], ci: 'all passed' },
  checks: [{ text: 'Open it and look', checked: false, addedAt: '2026-11-06T10:00:00Z' }],
});
const doc = {
  version: 1,
  meta: { dailyPlan: { date: '2026-11-06', taskIds: [], carriedIds: [] } },
  sections: [
    { id: 'review', name: 'Ready for review', tasks: [epic('E-STALE'), epic('E-LOST'), epic('E-FRESH')] },
    { id: 'done', name: 'Done', tasks: [child('C-OLD', 'E-STALE', 1), child('C-NEW', 'E-STALE', 2), child('C-GONE', 'E-LOST', 99), child('C-OLD2', 'E-FRESH', 1)] },
  ],
};
fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc, null, 2));
