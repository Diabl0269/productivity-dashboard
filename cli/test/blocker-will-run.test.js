/**
 * cli/test/blocker-will-run.test.js
 * PRO151: a Ready, Auto epic never reads "starts when X finishes" when X cannot start by itself (it sits in a
 * later phase, backlog, waits on a pick, or is Ready with Auto off). It says so in amber and offers to promote X.
 * Plan page text (shared/run-plan.js), `ch tasks ready` and the next-start line use one predicate (blockerWillRun).
 * Bug kind: ticket-section-mismatch. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { computeRunPlan } from '../../shared/run-plan.js';
import { blockerWillRun, unrunnableBlockers, blockerWarningText } from '../../shared/epic-ready.js';
import { computeNextStart } from '../../shared/next-start.js';

const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look at it\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane: 'mixer', description: '', labels: ['model:sonnet'], ...extra });
const mk = (bySection, pins = []) => ({
  version: 1, meta: { dailyPlan: { taskIds: pins } },
  sections: Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks })),
});

/** Follower F (Ready, Auto, lane mixer) has one free ticket and one ticket waiting on a ticket of blocker B (lane canvas). */
function world(blockerSection, blockerExtra = {}, blockerKids = {}, extra = {}) {
  const bySection = {
    todo: [
      epic('F', { labels: ['model:sonnet', 'auto'] }), task('F1', { parentId: 'F' }), task('F2', { parentId: 'F', blockedBy: ['B1'] }),
    ],
    'in-progress': [], backlog: [], done: [],
  };
  bySection[blockerSection].push(epic('B', { lane: 'canvas', ...blockerExtra }));
  bySection[blockerKids.section || blockerSection].push(task('B1', { parentId: 'B', ...blockerKids.extra }));
  Object.assign(bySection, extra);
  return mk(bySection, ['B']);
}
const laterCard = doc => computeRunPlan(doc).lanes.flatMap(l => l.later).find(c => c.id === 'F');

test('a blocker in a later phase: the card warns, no "starts when"', () => {
  const doc = world('todo', { title: 'Canvas: later' });
  const c = laterCard(doc);
  assert.equal(c.state, 'later');
  assert.ok(!/starts when/.test(c.why), c.why);
  assert.equal(c.why, 'Ready · Auto, but B will not start by itself (it is in a later phase)');
  assert.deepEqual(c.stuckBlockers, ['B']);
});

test('a blocker in backlog: the card warns and offers to promote the blocker ticket', () => {
  const c = laterCard(world('backlog'));
  assert.equal(c.why, 'Ready · Auto, but B will not start by itself (it is in backlog)');
  assert.deepEqual(c.promoteIds, ['B1']);
});

test('promoting the blocker clears the warning', () => {
  const doc = world('backlog');
  assert.match(laterCard(doc).why, /will not start by itself/);
  // The Move to To do action: B and its ticket go to todo, B turned Auto (a Ready epic with Auto starts by itself).
  const moved = world('todo', { labels: ['model:sonnet', 'auto'] });
  const c = laterCard(moved);
  assert.equal(c.why, 'Ready · Auto: starts when B finishes');
  assert.equal(c.stuckBlockers, undefined);
});

test('a blocker Ready with Auto off will not start either; Auto on does', () => {
  assert.deepEqual(blockerWillRun(world('todo'), 'B'), { runs: false, reason: 'Ready but Auto is off', promoteIds: [] });
  assert.equal(blockerWillRun(world('todo', { labels: ['model:sonnet', 'auto'] }), 'B').runs, true);
});

test('a blocker that is genuinely running keeps "starts when ... finishes"', () => {
  const doc = world('in-progress');
  assert.equal(blockerWillRun(doc, 'B').runs, true);
  assert.equal(laterCard(doc).why, 'Ready · Auto: starts when B finishes');
  const kidRunning = world('todo', {}, { section: 'in-progress' });
  assert.equal(blockerWillRun(kidRunning, 'B').runs, true);
});

test('a blocker waiting on your pick is named as such', () => {
  const doc = world('todo', {}, {}, { todo: [
    epic('F', { labels: ['model:sonnet', 'auto'] }), task('F1', { parentId: 'F' }), task('F2', { parentId: 'F', blockedBy: ['B1'] }),
    epic('B', { lane: 'canvas', labels: ['model:sonnet', 'auto'] }),
    task('P1', { parentId: 'B', title: 'Look at it', labels: ['co-task'] }), task('B1', { parentId: 'B', blockedBy: ['P1'] }),
  ] });
  const w = blockerWillRun(doc, 'B');
  assert.equal(w.runs, false);
  assert.equal(w.reason, 'waiting on your co-task P1');
});

test('transitive: an Auto blocker that waits on an epic in a later phase will not run either', () => {
  const doc = mk({
    todo: [
      epic('F', { labels: ['model:sonnet', 'auto'] }), task('F1', { parentId: 'F' }), task('F2', { parentId: 'F', blockedBy: ['B1'] }),
      epic('B', { lane: 'canvas', labels: ['model:sonnet', 'auto'], blockedBy: ['Z'] }), task('B1', { parentId: 'B' }),
      epic('Z', { lane: 'canvas', title: 'Canvas: later' }), task('Z1', { parentId: 'Z' }),
    ],
  }, ['B']);
  const w = blockerWillRun(doc, 'B');
  assert.equal(w.runs, false);
  assert.equal(w.reason, 'waiting on Z, which is in a later phase');
});

test('the CLI helpers agree with the Plan page', () => {
  const doc = world('backlog');
  const bad = unrunnableBlockers(doc, 'F');
  assert.deepEqual(bad.map(b => b.id), ['B']);
  assert.equal(`Ready · Auto, but ${blockerWarningText(bad)}`, laterCard(doc).why);
  assert.deepEqual(unrunnableBlockers(world('in-progress'), 'F'), []);
});

test('next-start mentions a blocker that will not start by itself', () => {
  const doc = world('backlog');
  const r = computeNextStart({ doc, now: Date.parse('2026-11-24T10:00:00Z') });
  assert.match(r.line, /B will not start by itself \(it is in backlog\)/);
  const ok = computeNextStart({ doc: world('in-progress'), now: Date.parse('2026-11-24T10:00:00Z') });
  assert.doesNotMatch(ok.line, /will not start by itself/);
});

const CH_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ch');
const chReady = doc => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-blocker-'));
  // The CLI validates ids as PREFIX+digits: rename the fixture's ids (T is the default prefix).
  const ids = { F: 'T1', F1: 'T2', F2: 'T3', B: 'T4', B1: 'T5' };
  const text = JSON.stringify(doc).replace(/"(F|F1|F2|B|B1)"/g, (_, id) => `"${ids[id]}"`);
  fs.writeFileSync(path.join(h, 'tasks.json'), text);
  const r = spawnSync(process.execPath, [CH_SCRIPT, 'tasks', 'ready'], { env: { ...process.env, CH_HOME: h }, encoding: 'utf8' });
  fs.rmSync(h, { recursive: true, force: true });
  return r.stdout || `ERR ${r.stderr}`;
};

test('`ch tasks ready` prints the same warning, and nothing for a running blocker', () => {
  assert.match(chReady(world('backlog')), /T1 .*\n\s+Ready · Auto, but T4 will not start by itself \(it is in backlog\)/);
  assert.doesNotMatch(chReady(world('in-progress')), /will not start by itself/);
});
