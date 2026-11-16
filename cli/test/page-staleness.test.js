import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pageStaleness, sinceOf, groupCovers, clearStalenessCache, MAX_COMMITS, CACHE_MS } from '../lib/page-staleness.js';
import { git, commit } from './fixtures/home-pages-site.js';

function repoWithHistory() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-stale-'));
  git(repo, ['init', '-q', '-b', 'main']);
  commit(repo, 'till/a.js', '2026-11-01', 'before the page');
  commit(repo, 'till/b.js', '2026-11-03', 'same day as the page');
  commit(repo, 'till/c.js', '2026-11-04', 'after, in till');
  commit(repo, 'other/x.js', '2026-11-05', 'after, elsewhere');
  commit(repo, 'receipts.js', '2026-11-06', 'after, receipts');
  return { repo, repos: [{ name: 'shop', path: repo }] };
}

test('sinceOf is the start of the day after `updated`', () => {
  assert.equal(sinceOf('2026-11-03'), '2026-11-04T00:00:00');
  assert.equal(sinceOf('2026-12-31'), '2027-01-01T00:00:00');
});

test('commits before the page, or on its day, do not flag it; later ones in the globs do', async () => {
  const { repos } = repoWithHistory();
  const s = await pageStaleness({ updated: '2026-11-03', covers: ['shop/till/**'], repos });
  assert.equal(s.count, 1);
  assert.equal(s.commits[0].subject, 'after, in till');
  assert.equal(s.commits[0].repo, 'shop');
  assert.equal(s.commits[0].date, '2026-11-04');
  assert.match(s.commits[0].hash, /^[0-9a-f]{7,}$/);
  assert.equal(s.newest, '2026-11-04');
  assert.equal(s.capped, false);
  const fresh = await pageStaleness({ updated: '2026-11-06', covers: ['shop/till/**', 'shop/receipts.js'], repos });
  assert.equal(fresh.count, 0, 'a page updated on the newest commit\'s day is not stale');
  assert.equal(fresh.newest, null);
});

test('globs: ** crosses folders, * does not, several globs merge newest first', async () => {
  const { repos } = repoWithHistory();
  const both = await pageStaleness({ updated: '2026-11-03', covers: ['shop/till/**', 'shop/receipts.js'], repos });
  assert.deepEqual(both.commits.map(c => c.subject), ['after, receipts', 'after, in till']);
  assert.equal(both.newest, '2026-11-06');
  const star = await pageStaleness({ updated: '2026-11-03', covers: ['shop/*.js'], repos });
  assert.deepEqual(star.commits.map(c => c.subject), ['after, receipts'], '* stays in the top folder');
  const dir = await pageStaleness({ updated: '2026-11-03', covers: ['shop/till/'], repos });
  assert.equal(dir.count, 1, 'a folder path covers what is in it');
  const none = await pageStaleness({ updated: '2026-11-03', covers: ['shop/nothing/**'], repos });
  assert.equal(none.count, 0);
});

test('merge commits are ignored', async () => {
  const { repo, repos } = repoWithHistory();
  git(repo, ['checkout', '-q', '-b', 'feature']);
  commit(repo, 'till/d.js', '2026-11-07', 'feature work');
  git(repo, ['checkout', '-q', 'main']);
  commit(repo, 'till/e.js', '2026-11-08', 'main work');
  git(repo, ['merge', '--no-ff', '-q', '-m', 'merge feature', 'feature'], { GIT_COMMITTER_DATE: '2026-11-09T12:00:00' });
  const s = await pageStaleness({ updated: '2026-11-03', covers: ['shop/till/**'], repos });
  assert.deepEqual(s.commits.map(c => c.subject), ['main work', 'feature work', 'after, in till']);
});

test('more than 30 commits: the newest 30, capped is true', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-stale-cap-'));
  git(repo, ['init', '-q', '-b', 'main']);
  for (let i = 0; i < MAX_COMMITS + 5; i++) commit(repo, 'a/f.js', `2026-12-${String((i % 28) + 1).padStart(2, '0')}`, `c${i}`);
  const s = await pageStaleness({ updated: '2026-11-01', covers: ['r/a/**'], repos: [{ name: 'r', path: repo }] });
  assert.equal(s.count, MAX_COMMITS);
  assert.equal(s.commits.length, MAX_COMMITS);
  assert.equal(s.capped, true);
});

test('a missing repo, an unknown repo name and a missing date are notices, not errors', async () => {
  const gone = await pageStaleness({ updated: '2026-11-03', covers: ['shop/till/**'], repos: [{ name: 'shop', path: '/nonexistent/repo-xyz' }] });
  assert.equal(gone.count, 0);
  assert.match(gone.notices.join(' '), /"shop" is not at \/nonexistent\/repo-xyz/);
  const { repos } = repoWithHistory();
  const unknown = await pageStaleness({ updated: '2026-11-03', covers: ['warehouse/x/**', 'noslash'], repos });
  assert.equal(unknown.count, 0);
  assert.match(unknown.notices.join(' '), /repo "warehouse"/);
  assert.match(unknown.notices.join(' '), /should start with a repo name/);
  const undated = await pageStaleness({ updated: null, covers: ['shop/x'], repos });
  assert.match(undated.notices[0], /no "updated" date/);
  const notRepo = await pageStaleness({ updated: '2026-11-03', covers: ['shop/x'], repos: [{ name: 'shop', path: os.tmpdir() }] });
  assert.equal(notRepo.count, 0);
});

test('results are cached for 10 minutes per page key', async () => {
  clearStalenessCache();
  const { repo, repos } = repoWithHistory();
  const input = { updated: '2026-11-03', covers: ['shop/till/**'], repos, key: 'page-a', now: 1_000_000 };
  const first = await pageStaleness(input);
  assert.equal(first.count, 1);
  commit(repo, 'till/z.js', '2026-11-10', 'late');
  assert.equal((await pageStaleness({ ...input, now: input.now + CACHE_MS - 1000 })).count, 1, 'still cached');
  assert.equal((await pageStaleness({ ...input, now: input.now + CACHE_MS + 1000 })).count, 2, 'recomputed after 10 minutes');
  assert.equal((await pageStaleness({ ...input, key: 'page-b' })).count, 2, 'another page key is its own entry');
  clearStalenessCache();
});

test('groupCovers splits entries per repo', () => {
  const { groups, notices } = groupCovers(['a/x/**', 'b/y', 'a/z', 'c/q', 'a'], [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }]);
  assert.deepEqual(groups.map(g => [g.repo.name, g.globs]), [['a', ['x/**', 'z']], ['b', ['y']]]);
  assert.equal(notices.length, 2);
});
