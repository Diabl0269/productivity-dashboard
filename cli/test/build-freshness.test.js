/**
 * cli/test/build-freshness.test.js
 * PRO42: review cards say whether the installed app has a PR's change. A temp git repo with two
 * commits gives the ancestor yes/no; the card text and "no matching link shows nothing" are pure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { matchPr, matchTicketPr, freshnessLine, shortDay } from '../../shared/build-freshness.js';
import { cardPrLinks, rollUpFreshness } from '../../shared/build-freshness-rollup.js';
import {
  checkFreshness, findMergeCommit, readPlistKey, readBuildValue, readFreshnessRules, createFreshnessChecker,
} from '../lib/build-freshness.js';

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' },
}).trim();

/** A repo: c1 "first (#1)" on 2026-01-10, c2 "second (#2)" on 2026-03-05, tag v1.0.0 on c1. */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-fresh-test-'));
  git(dir, 'init', '-q', '-b', 'main');
  const commit = (file, msg, date) => {
    fs.writeFileSync(path.join(dir, file), msg);
    git(dir, 'add', '.');
    execFileSync('git', ['commit', '-q', '-m', msg], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    return git(dir, 'rev-parse', 'HEAD');
  };
  const c1 = commit('a', 'first (#1)', '2026-01-10T12:00:00Z');
  git(dir, 'tag', 'v1.0.0');
  const c2 = commit('b', 'second (#2)', '2026-03-05T12:00:00Z');
  return { dir, c1, c2 };
}

const plist = (dir, version) => {
  const file = path.join(dir, 'Info.plist');
  fs.writeFileSync(file, `<?xml version="1.0"?>\n<plist version="1.0"><dict>\n<key>CFBundleShortVersionString</key>\n<string>${version}</string>\n<key>Other</key><string>zzz</string></dict></plist>\n`);
  return file;
};

const PR = (n) => `https://github.com/acme/app/pull/${n}`;
const rule = (repo, buildCommit, extra = {}) => ({ repo, prPattern: 'github.com/acme/app/pull/', buildCommit, updateCommand: 'make install', ...extra });

test('findMergeCommit finds the commit whose subject ends (#N)', () => {
  const { dir, c1, c2 } = makeRepo();
  assert.equal(findMergeCommit(dir, 1)?.sha, c1);
  assert.equal(findMergeCommit(dir, 2)?.sha, c2);
  assert.equal(findMergeCommit(dir, 22), null);
  assert.equal(findMergeCommit(dir, 3), null);
});

test('checkFreshness: build at c1 has PR 1 (current) but not PR 2 (stale)', () => {
  const { dir, c1 } = makeRepo();
  const rules = [rule(dir, { file: path.join(dir, 'build.txt') })];
  fs.writeFileSync(path.join(dir, 'build.txt'), `${c1}\n`);
  const current = checkFreshness(rules, PR(1));
  assert.equal(current.state, 'current');
  const stale = checkFreshness(rules, PR(2));
  assert.equal(stale.state, 'stale');
  assert.equal(stale.updateCommand, 'make install');
  assert.match(stale.mergedAt, /^2026-03-05/);
  assert.match(stale.buildAt, /^2026-01-10/);
});

test('checkFreshness: build at c2 has both; plist + tag and command sources work', () => {
  const { dir, c2 } = makeRepo();
  const viaCommand = [rule(dir, { command: `echo ${c2}` })];
  assert.equal(checkFreshness(viaCommand, PR(1)).state, 'current');
  assert.equal(checkFreshness(viaCommand, PR(2)).state, 'current');
  const viaTag = [rule(dir, { plist: plist(dir, '1.0.0'), key: 'CFBundleShortVersionString', tag: 'v{value}' })];
  assert.equal(checkFreshness(viaTag, PR(1)).state, 'current');
  assert.equal(checkFreshness(viaTag, PR(2)).state, 'stale');
});

test('checkFreshness: a build commit with a -dirty suffix (local edits) still resolves', () => {
  const { dir, c1 } = makeRepo();
  fs.writeFileSync(path.join(dir, 'build.txt'), `${c1}-dirty\n`);
  const rules = [rule(dir, { file: path.join(dir, 'build.txt') })];
  assert.equal(checkFreshness(rules, PR(1)).state, 'current');
  assert.equal(checkFreshness(rules, PR(2)).state, 'stale');
});

test('checkFreshness: unreadable or unknown inputs give unknown, a non-matching link gives null', () => {
  const { dir, c1 } = makeRepo();
  assert.equal(checkFreshness([rule(dir, { file: path.join(dir, 'nope.txt') })], PR(1)).state, 'unknown');
  fs.writeFileSync(path.join(dir, 'build.txt'), 'deadbeefdeadbeef');
  assert.equal(checkFreshness([rule(dir, { file: path.join(dir, 'build.txt') })], PR(1)).state, 'unknown');
  fs.writeFileSync(path.join(dir, 'build.txt'), c1);
  assert.equal(checkFreshness([rule(dir, { file: path.join(dir, 'build.txt') })], PR(99)).state, 'unknown');
  assert.equal(checkFreshness([rule('/no/such/repo', { file: path.join(dir, 'build.txt') })], PR(1)).state, 'unknown');
  assert.equal(checkFreshness([rule(dir, { file: path.join(dir, 'build.txt') })], 'https://github.com/other/app/pull/1'), null);
  assert.equal(checkFreshness([], PR(1)), null);
  assert.equal(checkFreshness([rule(dir, { plist: plist(dir, '9.9.9'), key: 'CFBundleShortVersionString', tag: 'v{value}' })], PR(1)).state, 'unknown');
});

test('plist reader and rules reader', () => {
  const { dir } = makeRepo();
  assert.equal(readPlistKey(plist(dir, '2.3.4'), 'CFBundleShortVersionString'), '2.3.4');
  assert.equal(readPlistKey(path.join(dir, 'Info.plist'), 'Missing'), '');
  assert.equal(readBuildValue({ file: path.join(dir, 'missing') }), '');
  assert.deepEqual(readFreshnessRules(dir), []);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ buildFreshness: [rule(dir, { file: 'x' }), { repo: 'only' }, 'junk'] }));
  assert.equal(readFreshnessRules(dir).length, 1);
});

test('the checker caches a result for its ttl', () => {
  const { dir, c1 } = makeRepo();
  fs.writeFileSync(path.join(dir, 'build.txt'), c1);
  let t = 0;
  let calls = 0;
  const run = (cmd, args, opts) => { calls++; try { return { code: 0, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim() }; } catch (e) { return { code: e.status ?? -1, out: '' }; } };
  const check = createFreshnessChecker({ run, ttlMs: 1000, now: () => t });
  const rules = [rule(dir, { file: path.join(dir, 'build.txt') })];
  check(rules, PR(1));
  const first = calls;
  check(rules, PR(1));
  assert.equal(calls, first);
  t = 2000;
  check(rules, PR(1));
  assert.ok(calls > first);
});

test('matching: only a link containing prPattern + a number matches', () => {
  const rules = [rule('/r', { file: 'x' })];
  assert.equal(matchPr(rules, PR(12)).number, 12);
  assert.equal(matchPr(rules, 'https://github.com/acme/app/issues/12'), null);
  assert.equal(matchPr(rules, 'https://github.com/acme/app/pull/'), null);
  assert.equal(matchTicketPr(rules, { links: [{ url: 'https://claude.ai/artifact/x' }, { url: PR(7) }] }).number, 7);
  assert.equal(matchTicketPr(rules, { links: [{ url: 'https://example.com' }] }), null);
  assert.equal(matchTicketPr(rules, {}), null);
  assert.equal(matchTicketPr([], { links: [{ url: PR(7) }] }), null);
});

test('card text', () => {
  assert.deepEqual(freshnessLine({ state: 'current' }), { text: 'in your build' });
  assert.deepEqual(
    freshnessLine({ state: 'stale', mergedAt: '2026-11-07T10:00:00+02:00', buildAt: '2026-09-14T16:40:00Z', updateCommand: 'make install' }),
    { text: 'needs a newer build (merged 7 Nov, your app is from 14 Sep)', command: 'make install' },
  );
  assert.deepEqual(freshnessLine({ state: 'stale' }), { text: 'needs a newer build' });
  assert.deepEqual(freshnessLine({ state: 'unknown' }), { text: 'No build info for this change', unknown: true });
  assert.equal(freshnessLine({ state: 'bogus' }), null);
  assert.equal(freshnessLine(null), null);
  assert.equal(shortDay('nonsense'), '');
});

// ----- AGE35: an epic card rolls up its children's PRs -----

const T = (taskId, parentId, ...urls) => ({ taskId, parentId, links: urls.map(url => ({ url })) });

test('cardPrLinks: an epic gathers the PR links of its children and grandchildren, not other links', () => {
  const tasks = [
    T('E1', null, 'https://claude.ai/artifact/x'),
    T('C1', 'E1', PR(1)),
    T('C2', 'E1', PR(2), PR(2), 'https://example.com/doc'),
    T('G1', 'C2', PR(3)),
    T('X1', 'E2', PR(9)),
  ];
  const links = cardPrLinks(tasks[0], tasks);
  assert.deepEqual(links.map(l => `${l.ticketId}:${l.url.split('/').pop()}`), ['C1:1', 'C2:2', 'G1:3']);
  assert.deepEqual(cardPrLinks(tasks[1], tasks), [{ ticketId: 'C1', url: PR(1) }]);
  assert.deepEqual(cardPrLinks(null, tasks), []);
});

test('rollUpFreshness: the worst state wins and names the stale tickets', () => {
  const current = { state: 'current', mergedAt: '2026-01-10T12:00:00Z' };
  const stale = (at) => ({ state: 'stale', mergedAt: at, buildAt: '2026-01-11T00:00:00Z', updateCommand: 'make install' });
  const all = rollUpFreshness([{ ticketId: 'C1', result: current }, { ticketId: 'C2', result: current }], 'E1');
  assert.deepEqual(all, { text: 'in your build', kind: 'current' });
  const mixed = rollUpFreshness([
    { ticketId: 'C1', result: current },
    { ticketId: 'C2', result: stale('2026-03-05T12:00:00Z') },
    { ticketId: 'C3', result: stale('2026-02-01T12:00:00Z') },
    { ticketId: 'C4', result: { state: 'unknown' } },
  ], 'E1');
  assert.equal(mixed.kind, 'stale');
  assert.deepEqual(mixed.staleIds, ['C2', 'C3']);
  assert.equal(mixed.command, 'make install');
  assert.match(mixed.text, /^needs a newer build \(merged 5 Mar/);
  // A ticket's own stale PR carries no id label.
  assert.equal(rollUpFreshness([{ ticketId: 'E1', result: stale('2026-03-05T12:00:00Z') }], 'E1').staleIds, undefined);
});

test('rollUpFreshness: unknown says so; no rule or still loading shows nothing', () => {
  const unknown = rollUpFreshness([{ ticketId: 'C1', result: { state: 'current' } }, { ticketId: 'C2', result: { state: 'unknown' } }], 'E1');
  assert.deepEqual(unknown, { text: 'No build info for this change', unknown: true, kind: 'unknown' });
  assert.equal(rollUpFreshness([{ ticketId: 'C1', result: null }, { ticketId: 'C2', result: { state: null } }], 'E1'), null);
  assert.equal(rollUpFreshness([{ ticketId: 'C1', result: undefined }, { ticketId: 'C2', result: { state: 'stale' } }], 'E1'), null);
  assert.equal(rollUpFreshness([], 'E1'), null);
});

test('end to end: an epic of two children, one behind the installed build, rolls up to stale', () => {
  const { dir, c1 } = makeRepo();
  fs.writeFileSync(path.join(dir, 'build.txt'), c1);
  const rules = [rule(dir, { file: path.join(dir, 'build.txt') })];
  const tasks = [T('E1', null), T('C1', 'E1', PR(1)), T('C2', 'E1', PR(2))];
  const entries = cardPrLinks(tasks[0], tasks).map(l => ({ ticketId: l.ticketId, result: checkFreshness(rules, l.url) }));
  const line = rollUpFreshness(entries, 'E1');
  assert.equal(line.kind, 'stale');
  assert.deepEqual(line.staleIds, ['C2']);
  // A build file that cannot be read: a rule exists but the state is unknown.
  const broken = [rule(dir, { file: path.join(dir, 'missing.txt') })];
  const lost = cardPrLinks(tasks[0], tasks).map(l => ({ ticketId: l.ticketId, result: checkFreshness(broken, l.url) }));
  assert.equal(rollUpFreshness(lost, 'E1').text, 'No build info for this change');
});
