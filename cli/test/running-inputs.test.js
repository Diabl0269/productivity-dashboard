/**
 * cli/test/running-inputs.test.js
 * PRO117: the readers behind `ch tasks running`: fake transcripts in a temp dir, a throwaway git repo with a
 * worktree and branches, gh absent or fake. Never reads the real ~/.claude or any real repo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readLiveSessions, readSessionMeta, shipTaskIds, titleTicketId, readBranches, readPrs, checksOf, clearPrCache, collectRunningInputs } from '../lib/running-inputs.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ch-running-'));
const MIN = 60e3;
const user = (text, extra = {}) => JSON.stringify({ type: 'user', timestamp: '2026-06-10T10:00:00Z', message: { role: 'user', content: text }, ...extra });

function transcript(dir, project, id, lines, ageMin, now) {
  const d = path.join(dir, project);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${id}.jsonl`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const t = new Date(now - ageMin * MIN);
  fs.utimesSync(f, t, t);
  return f;
}

test('readLiveSessions: fresh files only, ids from the first prompts, malformed lines tolerated', () => {
  const dir = tmp();
  const now = Date.now();
  transcript(dir, '-proj-a', 'fresh1', ['{not json', user('/ship-task BKR12'), JSON.stringify({ type: 'assistant', message: { content: 'ZZZ9' } }), '', '{"type":"user"'], 2, now);
  transcript(dir, '-proj-a', 'old1', [user('/ship-task BKR99')], 60, now);
  transcript(dir, '-proj-b', 'blocks', [user('meta BKR50', { isMeta: true }), JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'work on bkr13' }, { type: 'tool_result', content: 'ZZZ1' }] } })], 5, now);
  fs.writeFileSync(path.join(dir, '-proj-b', 'notes.txt'), 'BKR77');
  const out = readLiveSessions({ sessionMeta: null, projectsDir: dir, liveMinutes: 20, now });
  assert.deepEqual(out.map(s => s.id), ['fresh1', 'blocks'], 'newest first; the 60-minute-old one is skipped');
  assert.deepEqual(out[0].ticketIds, ['BKR12'], 'assistant lines and malformed lines are ignored');
  assert.deepEqual(out[1].ticketIds, [], 'a prompt that only names a ticket does not work on it');
  assert.deepEqual(out[1].mentionedIds, ['BKR13'], 'meta prompts and tool results are ignored');
  assert.equal(out[0].project, '-proj-a');
  assert.equal(out[0].startedAt, Date.parse('2026-06-10T10:00:00Z'));
  assert.equal(readLiveSessions({ sessionMeta: null, projectsDir: dir, liveMinutes: 120, now }).length, 3, 'liveMinutes is honoured');
});

test('readLiveSessions: only the first maxPrompts prompts count, and only the head of a file is read', () => {
  const dir = tmp();
  const now = Date.now();
  transcript(dir, 'p', 'many', [user('one'), user('two BKR1'), user('three'), user('four BKR2')], 1, now);
  assert.deepEqual(readLiveSessions({ sessionMeta: null, projectsDir: dir, now, maxPrompts: 3 })[0].mentionedIds, ['BKR1']);
  assert.deepEqual(readLiveSessions({ sessionMeta: null, projectsDir: dir, now, maxPrompts: 4 })[0].mentionedIds, ['BKR1', 'BKR2']);
  // An id buried past the 256 KB head is never read.
  transcript(dir, 'p', 'huge', [user('start'), JSON.stringify({ type: 'assistant', pad: 'x'.repeat(300 * 1024) }), user('late BKR3')], 1, now);
  assert.deepEqual(readLiveSessions({ sessionMeta: null, projectsDir: dir, now }).find(s => s.id === 'huge').mentionedIds, []);
});

test('readLiveSessions: a missing projects dir gives no sessions', () => {
  assert.deepEqual(readLiveSessions({ projectsDir: path.join(tmp(), 'nope') }), []);
});

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function makeRepo() {
  const root = tmp();
  const repo = path.join(root, 'demo-repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'first');
  return { root, repo };
}

test('readBranches: worktree branches, recent commits, old branches left out, missing repos skipped', async () => {
  const { root, repo } = makeRepo();
  git(repo, 'branch', 'feat/BKR1-recent');
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/BKR2-tree', path.join(root, 'tree'));
  git(repo, 'branch', 'feat/BKR3-old');
  // Back-date BKR3's only commit (a commit of its own) to 3 days ago.
  const old = new Date(Date.now() - 3 * 86400e3).toISOString();
  git(repo, 'checkout', '-q', 'feat/BKR3-old');
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'old'], { env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old } });
  git(repo, 'checkout', '-q', 'main');

  const out = await readBranches({ repos: [repo, path.join(root, 'missing'), root], recentHours: 6 });
  const by = (branch, via) => out.find(b => b.branch === branch && b.via === via);
  assert.ok(by('feat/BKR2-tree', 'worktree'), 'worktree branch');
  assert.ok(by('main', 'worktree'), 'the main checkout is a worktree too');
  assert.ok(by('feat/BKR1-recent', 'recent commit'), 'recent commit');
  assert.equal(by('feat/BKR3-old', 'recent commit'), undefined, 'a 3-day-old branch is not recent');
  assert.ok(Number.isFinite(Date.parse(by('feat/BKR2-tree', 'worktree').lastCommitAt)));
  assert.equal(out.every(b => b.repo === 'demo-repo' && b.repoPath === repo), true, 'missing and non-git paths contribute nothing');
  const wide = await readBranches({ repos: [repo], recentHours: 100 });
  assert.ok(wide.find(b => b.branch === 'feat/BKR3-old' && b.via === 'recent commit'), 'recentHours is honoured');
});

test('checksOf: pending beats failing beats passing; empty is null', () => {
  assert.equal(checksOf([]), null);
  assert.equal(checksOf(undefined), null);
  assert.equal(checksOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]), 'passing');
  assert.equal(checksOf([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'failing');
  assert.equal(checksOf([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }]), 'pending');
  assert.equal(checksOf([{ state: 'PENDING' }]), 'pending');
});

test('readPrs: gh absent gives no PR info and does not throw', async () => {
  clearPrCache();
  const { repo } = makeRepo();
  const out = await readPrs([{ repoPath: repo, branch: 'feat/BKR1-x' }], { gh: path.join(tmp(), 'no-such-gh') });
  assert.deepEqual(out, {});
});

test('readPrs: a fake gh gives url and checks; only ticket branches are looked up; failures degrade', async () => {
  clearPrCache();
  const { repo } = makeRepo();
  const bin = tmp();
  const calls = path.join(bin, 'calls.log');
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, `#!/bin/sh
echo "$@" >> "${calls}"
case "$*" in
  *BKR1-x*) echo '[{"url":"https://example.test/pull/1","state":"OPEN","statusCheckRollup":[{"status":"IN_PROGRESS"}]}]' ;;
  *BKR2-x*) echo 'not json' ;;
  *BKR4-x*) exit 1 ;;
  *) echo '[]' ;;
esac
`, { mode: 0o755 });
  const br = b => ({ repoPath: repo, branch: b });
  const out = await readPrs([br('feat/BKR1-x'), br('feat/BKR2-x'), br('feat/BKR3-x'), br('feat/BKR4-x'), br('main')], { gh, ttlMs: 60e3 });
  assert.deepEqual(out, { 'feat/BKR1-x': { url: 'https://example.test/pull/1', state: 'OPEN', checks: 'pending' } });
  const asked = fs.readFileSync(calls, 'utf8');
  assert.equal(/main/.test(asked), false, 'a branch with no ticket id is not looked up');
  await readPrs([br('feat/BKR1-x')], { gh });
  assert.equal(fs.readFileSync(calls, 'utf8').split('\n').filter(l => l.includes('BKR1-x')).length, 1, 'cached within the ttl');
});

test('collectRunningInputs composes sessions, branches, prs and autorun; gh absent degrades', async () => {
  clearPrCache();
  const { repo } = makeRepo();
  git(repo, 'branch', 'feat/BKR1-x');
  const dir = tmp();
  const now = Date.now();
  transcript(dir, 'p', 's1', [user('/ship-task BKR1')], 1, now);
  const prev = process.env.AUTORUN_STATE_DIR;
  process.env.AUTORUN_STATE_DIR = path.join(tmp(), 'none');
  try {
    const inp = await collectRunningInputs({ repos: [repo], now, projectsDir: dir, gh: path.join(tmp(), 'no-gh') });
    assert.equal(inp.sessions.length, 1);
    assert.ok(inp.branches.some(b => b.branch === 'feat/BKR1-x'));
    assert.deepEqual(inp.prs, {});
    assert.equal(inp.autorun, null);
    assert.equal(inp.now, now);
  } finally {
    if (prev === undefined) delete process.env.AUTORUN_STATE_DIR; else process.env.AUTORUN_STATE_DIR = prev;
  }
});

test('readAutorunTick: a fresh tick gives its live epics, a stale or missing one gives null', async () => {
  const { readAutorunTick } = await import('../lib/running-inputs.js');
  const dir = tmp();
  const prev = process.env.AUTORUN_STATE_DIR;
  process.env.AUTORUN_STATE_DIR = dir;
  const now = Date.parse('2026-06-10T12:00:00Z');
  try {
    assert.equal(readAutorunTick({ now }), null, 'no file');
    fs.writeFileSync(path.join(dir, 'tick.json'), JSON.stringify({ at: '2026-06-10T11:50:00Z', intervalMin: 30, liveEpics: ['BKR10'] }));
    assert.deepEqual(readAutorunTick({ now }), { at: '2026-06-10T11:50:00Z', intervalMin: 30, liveEpics: ['BKR10'] });
    fs.writeFileSync(path.join(dir, 'tick.json'), JSON.stringify({ at: '2026-06-10T10:00:00Z', intervalMin: 30, liveEpics: ['BKR10'] }));
    assert.equal(readAutorunTick({ now }), null, 'older than two intervals');
  } finally {
    if (prev === undefined) delete process.env.AUTORUN_STATE_DIR; else process.env.AUTORUN_STATE_DIR = prev;
  }
});

test('readLiveSessions: a live subagent transcript counts, tagged with its parent session', () => {
  const dir = tmp();
  const now = Date.now();
  transcript(dir, 'p', 'parent1', [user('coordinate the work')], 90, now); // the coordinator itself is quiet
  transcript(dir, path.join('p', 'parent1', 'subagents'), 'agent-a1', [user('Implement BKR7 in the worktree')], 2, now);
  const out = readLiveSessions({ sessionMeta: null, projectsDir: dir, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'agent-a1');
  assert.equal(out[0].subagentOf, 'parent1');
  assert.deepEqual(out[0].ticketIds, [], 'a subagent brief that names a ticket is a mention');
  assert.deepEqual(out[0].mentionedIds, ['BKR7']);
});

// ---- AGE200: working tickets, mentions, and the desktop app's archive flag ----

function appFile(dir, name, rec) {
  const d = path.join(dir, 'acct', 'org');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `local_${name}.json`), JSON.stringify(rec));
}

test('readSessionMeta: maps cliSessionId to archived, name and branch; odd files skipped; no folder is null', () => {
  const dir = tmp();
  appFile(dir, 'a', { sessionId: 'local_a', cliSessionId: 'cli-a', isArchived: true, title: 'BKR5 - Fix it', branch: 'claude/x' });
  appFile(dir, 'b', { sessionId: 'local_b', cliSessionId: 'cli-b', isArchived: false, title: 'Chat', worktreeName: 'bkr6-work' });
  appFile(dir, 'c', { cliSessionId: 'cli-c' }); // no isArchived: not trusted
  fs.writeFileSync(path.join(dir, 'acct', 'org', 'local_bad.json'), '{nope');
  const m = readSessionMeta({ sessionsDir: dir });
  assert.deepEqual([...m.keys()].sort(), ['cli-a', 'cli-b']);
  assert.equal(m.get('cli-a').archived, true);
  assert.equal(m.get('cli-b').archived, false);
  assert.equal(readSessionMeta({ sessionsDir: path.join(dir, 'nope') }), null, 'unreadable folder: unsure');
});

test('shipTaskIds and titleTicketId: only the argument and the leading id', () => {
  assert.deepEqual(shipTaskIds('/ship-task bkr12 auto then BKR99'), ['BKR12']);
  assert.deepEqual(shipTaskIds('see BKR12'), []);
  assert.deepEqual(titleTicketId('FRO1738 - Measure it'), ['FRO1738']);
  assert.deepEqual(titleTicketId('Measure FRO1738'), []);
});

test('readLiveSessions: one prompt naming nine ids works on none; name, branch and /ship-task do; archive state comes from the app', () => {
  const dir = tmp();
  const apps = tmp();
  const now = Date.now();
  const nine = Array.from({ length: 9 }, (_, i) => `BKR${i + 1}`).join(', ');
  transcript(dir, 'p', 'coord', [user(`Coordinate ${nine}`)], 1, now);
  transcript(dir, 'p', 'named', [user('hello')], 1, now);
  transcript(dir, 'p', 'shipped', [user('/ship-task BKR3 auto')], 1, now);
  transcript(dir, 'p', 'gone', [user('/ship-task BKR4')], 1, now);
  transcript(dir, 'p', 'noapp', [user('/ship-task BKR5')], 1, now);
  appFile(apps, 'coord', { cliSessionId: 'coord', isArchived: false, title: 'Coordinator' });
  appFile(apps, 'named', { cliSessionId: 'named', isArchived: false, title: 'BKR2 - Title', branch: 'age200-x' });
  appFile(apps, 'shipped', { cliSessionId: 'shipped', isArchived: false, title: 'x' });
  appFile(apps, 'gone', { cliSessionId: 'gone', isArchived: true, title: 'x' });
  const by = Object.fromEntries(readLiveSessions({ projectsDir: dir, now, sessionMeta: readSessionMeta({ sessionsDir: apps }) }).map(s => [s.id, s]));
  assert.deepEqual(by.coord.ticketIds, []);
  assert.equal(by.coord.mentionedIds.length, 9);
  assert.deepEqual(by.named.ticketIds.sort(), ['AGE200', 'BKR2']);
  assert.deepEqual(by.shipped.ticketIds, ['BKR3']);
  assert.equal(by.gone.archived, true);
  assert.equal(by.noapp.archived, null, 'no app record: unsure, not live-or-archived');
});
