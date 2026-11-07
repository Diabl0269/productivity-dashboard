/**
 * cli/test/next-ticket.test.js
 * shared/next-ticket.js on synthetic docs, plus `ch tasks next --json` against a temp CH_HOME.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rankReadyTickets } from '../../shared/next-ticket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const NOW = new Date('2026-11-07T12:00:00.000Z');

function task(id, over = {}) {
  return {
    id, title: `T ${id}`, type: 'task', project: 'p1', priority: 'medium', labels: [], blockedBy: [],
    created: '2026-11-06T00:00:00.000Z', history: [], ...over,
  };
}
function epic(id, lane, over = {}) {
  return task(id, { type: 'epic', lane, ...over });
}
function docOf(map, pinned = []) {
  return { sections: Object.entries(map).map(([id, tasks]) => ({ id, tasks })), meta: { dailyPlan: { taskIds: pinned } } };
}
const ids = doc => rankReadyTickets(doc, { now: NOW, n: 20 }).map(r => r.id);

test('blocked tickets are excluded; a blocker in review or done counts as unblocked', () => {
  const doc = docOf({
    todo: [task('A1', { blockedBy: ['B1'] }), task('A2', { blockedBy: ['B2'] }), task('A3', { blockedBy: ['B3'] }), task('B1')],
    'in-progress': [task('B2')],
    review: [task('B3')],
  });
  assert.deepEqual(ids(doc).sort(), ['A3', 'B1']);
});

test('gates are never picked: Co-task, Design:, design label; epics and non-todo are not ready', () => {
  const doc = docOf({
    todo: [
      task('G1', { title: 'Co-task: connect the account' }),
      task('G2', { title: 'Design: new panel' }),
      task('G3', { labels: ['design'] }),
      task('G4', { labels: ['co-task'] }),
      task('OK1'),
      epic('E9', 'timeline'),
    ],
    backlog: [task('BL1')],
  });
  assert.deepEqual(ids(doc), ['OK1']);
});

test('a ticket under a done epic is skipped', () => {
  const doc = docOf({ todo: [task('K1', { parentId: 'E1' }), task('K2')], done: [epic('E1', 'timeline')] });
  assert.deepEqual(ids(doc), ['K2']);
});

test('an epic already in progress comes first, then first in its lane', () => {
  const doc = docOf({
    todo: [
      task('X1', { parentId: 'E1', priority: 'urgent' }),
      task('Y1', { parentId: 'E2', priority: 'low' }),
      task('Z1', { parentId: 'E3', priority: 'urgent' }),
    ],
    'in-progress': [epic('E2', 'timeline'), epic('E1', 'timeline'), epic('E3', 'mod')],
  }, ['E1', 'E2', 'E3']);
  // E1 is first in lane "timeline" but E2 and E3 are in progress too; E1 beats E2 by lane position.
  const r = rankReadyTickets(doc, { now: NOW });
  assert.deepEqual(r.map(x => x.id), ['X1', 'Z1', 'Y1']);
  assert.ok(r[0].reasons.includes('epic already in progress'));
  assert.ok(r[0].reasons.includes('first in lane timeline'));
  assert.equal(r[0].epicId, 'E1');
  assert.equal(r[0].epicTitle, 'T E1');
});

test('lane position beats priority for epics not in progress', () => {
  const doc = docOf({
    todo: [task('P1', { parentId: 'E1', priority: 'low' }), task('P2', { parentId: 'E2', priority: 'urgent' })],
    backlog: [epic('E1', 'timeline'), epic('E2', 'timeline')],
  }, ['E1', 'E2']);
  assert.deepEqual(ids(doc), ['P1', 'P2']);
});

test('priority, then due date, then age order the rest, and reasons say why', () => {
  const doc = docOf({
    todo: [
      task('L1', { priority: 'low' }),
      task('M1', { priority: 'medium', created: '2026-10-01T00:00:00.000Z' }),
      task('M2', { priority: 'medium', due: '2026-11-09' }),
      task('M3', { priority: 'medium', created: '2026-10-20T00:00:00.000Z' }),
      task('H1', { priority: 'high' }),
      task('U1', { priority: 'urgent' }),
    ],
  });
  assert.deepEqual(ids(doc), ['U1', 'H1', 'M2', 'M1', 'M3', 'L1']);
  const r = rankReadyTickets(doc, { now: NOW, n: 20 });
  const by = Object.fromEntries(r.map(x => [x.id, x]));
  assert.ok(by.U1.reasons.includes('priority urgent'));
  assert.ok(by.M2.reasons.includes('due in 2 days'));
  assert.ok(by.M1.reasons.includes('waiting 37 days'));
  assert.ok(by.U1.score > by.H1.score && by.H1.score > by.L1.score);
  assert.equal(rankReadyTickets(doc, { now: NOW, n: 2 }).length, 2);
});

test('flagged blocked or waiting-on tickets are skipped; lanes are spread so each lane shows its best first', () => {
  const doc = docOf({
    'in-progress': [epic('E1', 'alpha'), epic('E2', 'beta')],
    todo: [
      task('A1', { parentId: 'E1', priority: 'high' }), task('A2', { parentId: 'E1', priority: 'high' }),
      task('A3', { parentId: 'E1', priority: 'medium' }), task('B1', { parentId: 'E2', priority: 'low' }),
      task('X1', { parentId: 'E1', blocked: true }), task('X2', { parentId: 'E1', waitingOn: 'vendor' }),
    ],
  }, ['E1', 'E2']);
  assert.deepEqual(ids(doc), ['A1', 'B1', 'A2', 'A3']);
  assert.deepEqual(rankReadyTickets(doc, { now: NOW, n: 20, spread: false }).map(r => r.id), ['A1', 'A2', 'A3', 'B1']);
});

test('project filter', () => {
  const doc = docOf({ todo: [task('P1', { project: 'a' }), task('P2', { project: 'b' })] });
  assert.deepEqual(rankReadyTickets(doc, { now: NOW, project: 'b' }).map(r => r.id), ['P2']);
});

test('ch tasks next --json lists ready tickets from a temp CH_HOME', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-next-test-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(tmp, 'tasks.json'));
  const run = args => spawnSync(process.execPath, [CH_SCRIPT, ...args], {
    env: { ...process.env, CH_HOME: tmp }, encoding: 'utf8',
  });
  const r = run(['tasks', 'next', '--json', '--n', '3']);
  assert.equal(r.status, 0, r.stderr);
  const picks = JSON.parse(r.stdout);
  assert.ok(Array.isArray(picks) && picks.length <= 3);
  for (const p of picks) {
    assert.ok(p.id && 'reasons' in p && 'score' in p);
  }
  const human = run(['tasks', 'next']);
  assert.equal(human.status, 0, human.stderr);
  if (picks.length) assert.match(human.stdout, /^1\. /);
  assert.notEqual(run(['tasks', 'next', '--n', '0']).status, 0);
});
