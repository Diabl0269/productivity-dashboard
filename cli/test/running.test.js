/**
 * cli/test/running.test.js
 * PRO117: shared/running.js (which tickets have live work). Synthetic tickets only. Every rule has a case that
 * fails when the rule is removed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRunning, extractTicketIds } from '../../shared/running.js';

const NOW = Date.parse('2026-06-10T12:00:00Z');
const MIN = 60e3;
const HOUR = 3600e3;
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, type: 'task', created: '2026-06-09', ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', ...extra });
const mk = bySection => ({ version: 1, meta: {}, sections: Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks })) });
const session = (ticketIds, ageMin = 1, extra = {}) => ({ id: 's1', file: '/x/s1.jsonl', mtime: NOW - ageMin * MIN, ticketIds, ...extra });
const wt = (branch, extra = {}) => ({ repo: 'repo-a', branch, via: 'worktree', ...extra });
const recent = (branch, ageH, extra = {}) => ({ repo: 'repo-a', branch, via: 'recent commit', lastCommitAt: new Date(NOW - ageH * HOUR).toISOString(), ...extra });
const run = (doc, inputs = {}, opts = {}) => computeRunning(doc, { now: NOW, sessions: [], branches: [], autorun: null, prs: {}, ...inputs }, opts);

test('ticket ids: the regex edge cases', () => {
  assert.deepEqual(extractTicketIds('feat/BKR12-thing'), ['BKR12']);
  assert.deepEqual(extractTicketIds('feat/bkr12-thing'), ['BKR12']);
  assert.deepEqual(extractTicketIds('/ship-task AB7 then cd9'), ['AB7', 'CD9']);
  assert.deepEqual(extractTicketIds('fix BKR12 and BKR12'), ['BKR12']);
  assert.deepEqual(extractTicketIds('main'), []);
  assert.deepEqual(extractTicketIds('ABCDE12'), [], 'five letters is not an id');
  assert.deepEqual(extractTicketIds('release_BKR12'), [], 'an underscore glues the id to the word');
  assert.deepEqual(extractTicketIds('BKR'), [], 'no digits, no id');
  assert.deepEqual(extractTicketIds(null), []);
});

test('a live session names a ticket: it runs, working, with its start time', () => {
  const doc = mk({ 'in-progress': [task('BKR1')] });
  const r = run(doc, { sessions: [session(['BKR1'], 2, { startedAt: NOW - 42 * MIN })] });
  assert.equal(r.running.length, 1);
  assert.equal(r.byTicket.BKR1.state, 'working');
  assert.deepEqual(r.byTicket.BKR1.sources, ['session']);
  assert.equal(r.byTicket.BKR1.since, new Date(NOW - 42 * MIN).toISOString());
});

test('session liveness boundary: 20 minutes live, older is not', () => {
  const doc = mk({ todo: [task('BKR1')] });
  assert.ok(run(doc, { sessions: [session(['BKR1'], 20)] }).byTicket.BKR1);
  assert.equal(run(doc, { sessions: [session(['BKR1'], 21)] }).byTicket.BKR1, undefined);
  assert.ok(run(doc, { sessions: [session(['BKR1'], 40)] }, { liveSessionMinutes: 60 }).byTicket.BKR1, 'threshold comes from opts');
});

test('recent commit boundary: 6 hours; a worktree has no age limit', () => {
  const doc = mk({ todo: [task('BKR1'), task('BKR2')] });
  assert.ok(run(doc, { branches: [recent('feat/BKR1-x', 6)] }).byTicket.BKR1);
  assert.equal(run(doc, { branches: [recent('feat/BKR1-x', 6.1)] }).byTicket.BKR1, undefined);
  assert.equal(run(doc, { branches: [recent('feat/BKR1-x', 7)] }, { recentCommitHours: 8 }).byTicket.BKR1.state, 'idle');
  const old = run(doc, { branches: [wt('feat/BKR2-x', { lastCommitAt: new Date(NOW - 99 * HOUR).toISOString() })] });
  assert.deepEqual(old.byTicket.BKR2.sources, ['worktree']);
  assert.equal(old.byTicket.BKR2.repo, 'repo-a');
  assert.equal(old.byTicket.BKR2.branch, 'feat/BKR2-x');
});

test('only inbox/backlog/todo/in-progress count: review, done, archive and unknown ids are ignored', () => {
  const doc = mk({ inbox: [task('BKR1')], backlog: [task('BKR2')], todo: [task('BKR3')], 'in-progress': [task('BKR4')],
    review: [task('BKR5')], done: [task('BKR6')], archive: [task('BKR7')] });
  const r = run(doc, { sessions: [session(['BKR1', 'BKR2', 'BKR3', 'BKR4', 'BKR5', 'BKR6', 'BKR7', 'ZZZ9'])] });
  assert.deepEqual(r.running.map(i => i.id).sort(), ['BKR1', 'BKR2', 'BKR3', 'BKR4']);
});

test('running work attaches to the ticket\'s open epic; no open epic means loose', () => {
  const doc = mk({
    'in-progress': [epic('BKR10'), task('BKR11', { parentId: 'BKR10' }), task('BKR20')],
    done: [epic('BKR30')], todo: [task('BKR31', { parentId: 'BKR30' })],
  });
  const r = run(doc, { sessions: [session(['BKR11', 'BKR20', 'BKR31'])] });
  assert.equal(r.byTicket.BKR11 && r.running.find(i => i.id === 'BKR11').epicId, 'BKR10');
  assert.deepEqual(r.epics.BKR10.running, ['BKR11']);
  assert.equal(r.epics.BKR10.state, 'running');
  assert.deepEqual(r.loose.map(i => i.id).sort(), ['BKR20', 'BKR31'], 'no epic, or only a closed epic');
  assert.ok(r.running.some(i => i.id === 'BKR20'), 'loose items are also in running');
});

test('a running epic attaches to itself, and a grandchild to the epic above its parent', () => {
  const doc = mk({ 'in-progress': [epic('BKR10'), task('BKR11', { parentId: 'BKR10' }), task('BKR12', { parentId: 'BKR11' })] });
  const r = run(doc, { branches: [wt('BKR10-epic'), wt('x/BKR12')] });
  assert.deepEqual(r.epics.BKR10.running.sort(), ['BKR10', 'BKR12']);
  assert.equal(r.loose.length, 0);
});

test('state precedence: waiting-you > waiting-ci > working > idle', () => {
  const ask = { n: 1, state: 'open', text: 'Which one?', at: '2026-06-10' };
  const doc = mk({ 'in-progress': [
    task('BKR1', { asks: [ask] }), task('BKR2'), task('BKR3'), task('BKR4'), task('BKR5', { waitingOn: 'Tal' }),
  ] });
  const pending = { url: 'https://example.test/pr/1', state: 'OPEN', checks: 'pending' };
  const r = run(doc, {
    sessions: [session(['BKR1', 'BKR2', 'BKR3', 'BKR5'])],
    branches: [wt('BKR1-a'), wt('BKR2-a'), wt('BKR4-a'), wt('BKR5-a')],
    prs: { 'BKR1-a': pending, 'BKR2-a': pending },
  });
  assert.equal(r.byTicket.BKR1.state, 'waiting-you', 'an ask beats pending CI and a live session');
  assert.equal(r.byTicket.BKR5.state, 'waiting-you', 'waitingOn naming the user counts');
  assert.equal(r.byTicket.BKR2.state, 'waiting-ci', 'pending CI beats a live session');
  assert.equal(r.byTicket.BKR3.state, 'working');
  assert.equal(r.byTicket.BKR4.state, 'idle', 'worktree only, no live session');
  assert.deepEqual(r.running.map(i => i.id), ['BKR1', 'BKR5', 'BKR2', 'BKR3', 'BKR4'], 'listed by state');
});

test('an open ask on the epic makes its running child wait on you; passing or failing CI does not', () => {
  const doc = mk({ 'in-progress': [epic('BKR10', { asks: [{ n: 1, state: 'open', text: 'Ship it?', at: '2026-06-10' }] }), task('BKR11', { parentId: 'BKR10' }), task('BKR20')] });
  const r = run(doc, { sessions: [session(['BKR11', 'BKR20'])], branches: [wt('BKR20-a')], prs: { 'BKR20-a': { url: 'u', state: 'OPEN', checks: 'failing' } } });
  assert.equal(r.byTicket.BKR11.state, 'waiting-you');
  assert.equal(r.byTicket.BKR20.state, 'working');
  assert.equal(r.byTicket.BKR20.pr, 'u', 'the PR url is reported whatever its checks');
});

test('an answered ask does not make a ticket wait on you', () => {
  const doc = mk({ 'in-progress': [task('BKR1', { asks: [{ n: 1, state: 'answered', text: 'Which?', at: '2026-06-10' }] })] });
  assert.equal(run(doc, { sessions: [session(['BKR1'])] }).byTicket.BKR1.state, 'working');
});

test('autorun live epics run as working, with the autorun source', () => {
  const doc = mk({ 'in-progress': [epic('BKR10')] });
  const r = run(doc, { autorun: { at: '2026-06-10T11:59:00Z', intervalMin: 30, liveEpics: ['bkr10', 'NOPE1'] } });
  assert.equal(r.byTicket.BKR10.state, 'working');
  assert.deepEqual(r.byTicket.BKR10.sources, ['autorun']);
  assert.equal(r.epics.BKR10.state, 'running');
});

test('sources merge and since is the earliest evidence', () => {
  const doc = mk({ todo: [task('BKR1')] });
  const r = run(doc, {
    sessions: [session(['BKR1'], 1, { startedAt: NOW - 30 * MIN }), session(['BKR1'], 3, { startedAt: NOW - 50 * MIN })],
    branches: [wt('BKR1-a', { lastCommitAt: new Date(NOW - 20 * MIN).toISOString() }), recent('BKR1-a', 1)],
  });
  assert.deepEqual(r.byTicket.BKR1.sources, ['session', 'worktree', 'recent commit']);
  assert.equal(r.byTicket.BKR1.since, new Date(NOW - 60 * MIN).toISOString(), 'a commit an hour ago is the earliest');
  const none = run(doc, { branches: [wt('BKR1-a')] });
  assert.equal(none.byTicket.BKR1.since, null, 'unknown when nothing says');
});

test('stale vs idle: in-progress epic with nothing running, boundary at staleDays', () => {
  const midnight = Date.parse('2026-06-10T00:00:00Z'); // dates are whole days, so measure from a midnight
  const doc = mk({ 'in-progress': [epic('BKR1', { created: '2026-06-03' }), epic('BKR2', { created: '2026-06-02' }),
    epic('BKR3', { created: '2026-05-01' }), task('BKR4', { parentId: 'BKR3', created: '2026-06-09' })] });
  const r = run(doc, { now: midnight });
  assert.equal(r.epics.BKR1.state, 'idle', 'exactly seven days is not over');
  assert.equal(r.epics.BKR2.state, 'stale', 'eight days is');
  assert.equal(r.epics.BKR3.state, 'idle', 'a recently created child keeps the epic alive');
  assert.equal(run(doc, { now: midnight }, { staleDays: 3 }).epics.BKR1.state, 'stale', 'threshold comes from opts');
});

test('a column move counts as a touch; a text edit does not', () => {
  const old = { created: '2026-05-01' };
  const moved = epic('BKR1', { ...old, history: [{ event: 'moved', to: 'in-progress', at: '2026-06-09T08:00:00Z' }] });
  const edited = epic('BKR2', { ...old, history: [{ event: 'updated', at: '2026-06-09T08:00:00Z' }] });
  const r = run(mk({ 'in-progress': [moved, edited] }));
  assert.equal(r.epics.BKR1.state, 'idle');
  assert.equal(r.epics.BKR1.inProgressSince, '2026-06-09T08:00:00Z');
  assert.equal(r.epics.BKR2.state, 'stale');
  assert.equal(r.epics.BKR2.lastTouched, '2026-05-01');
});

test('running beats stale; only in-progress epics are idle or stale', () => {
  const doc = mk({ 'in-progress': [epic('BKR1', { created: '2026-01-01' }), task('BKR2', { parentId: 'BKR1', created: '2026-01-01' })],
    todo: [epic('BKR3', { created: '2026-01-01' })], review: [epic('BKR4', { created: '2026-01-01' })], done: [epic('BKR5')] });
  const r = run(doc, { sessions: [session(['BKR2'])] });
  assert.equal(r.epics.BKR1.state, 'running');
  assert.equal(r.epics.BKR3.state, null);
  assert.equal(r.epics.BKR4.state, null);
  assert.equal(r.epics.BKR5, undefined, 'closed epics are not listed');
});

test('--project: other projects\' tickets and epics are left out', () => {
  const doc = mk({ 'in-progress': [task('BKR1', { project: 'alpha' }), task('BKR2', { project: 'beta' }), epic('BKR3', { project: 'beta', created: '2020-01-01' })] });
  const r = run(doc, { sessions: [session(['BKR1', 'BKR2'])] }, { project: 'alpha' });
  assert.deepEqual(r.running.map(i => i.id), ['BKR1']);
  assert.deepEqual(Object.keys(r.epics), []);
});

test('empty and odd inputs never throw', () => {
  const doc = mk({ todo: [task('BKR1')] });
  assert.deepEqual(computeRunning(doc, {}, {}).running, []);
  assert.deepEqual(computeRunning({ sections: [] }, { now: NOW }).epics, {});
  assert.deepEqual(run(doc, { sessions: [{ mtime: 'nonsense', ticketIds: ['BKR1'] }] }).running, []);
});
