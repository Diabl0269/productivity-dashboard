/**
 * cli/test/review-cards.test.js
 * PRO62: a ticket whose checks all passed closes on its own, its epic card keeps every ticket's
 * result, and an epic waiting in Ready for review does not hold up the next epic in its lane.
 * Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { epicReadiness, openEpicReadiness } from '../../shared/epic-ready.js';
import { computeRunPlan } from '../../shared/run-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look at the title\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane: 'a', description: '', ...extra });
const mk = (bySection) => ({
  version: 1,
  meta: { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } },
  sections: Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks })),
});
const ready = (doc, id) => openEpicReadiness(doc).find(r => r.id === id);
function home(doc) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-cards-'));
  fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc));
  return h;
}
const ch = (h, ...args) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: h }, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const read = h => JSON.parse(fs.readFileSync(path.join(h, 'tasks.json'), 'utf8'));
const find = (doc, id) => { for (const s of doc.sections) { const t = s.tasks.find(x => x.id === id); if (t) return { t, s: s.id }; } return null; };

test('PRO62: an epic waiting in Ready for review does not block (epicReadiness)', () => {
  const doc = mk({
    review: [epic('E1', { checked: true })],
    todo: [epic('E2', { blockedBy: ['E1'] }), task('T2', { parentId: 'E2' })],
  });
  assert.equal(ready(doc, 'E2').ready, true);
  assert.equal(epicReadiness(doc, doc.sections[1].tasks[0]).ready, true);
  assert.equal(openEpicReadiness(doc).some(r => r.id === 'E1'), false, 'review epics are not open epics');
});

test('PRO62: an epic in review does not block the next epic in its lane (computeRunPlan)', () => {
  const doc = mk({
    review: [epic('E1', { checked: true }), task('T1', { parentId: 'E1', checked: true })],
    todo: [epic('E2', { blockedBy: ['E1'] }), task('T2', { parentId: 'E2' })],
  });
  doc.meta.dailyPlan.taskIds = ['E1', 'E2'];
  const plan = computeRunPlan(doc);
  const lane = plan.lanes.find(l => l.lane === 'a');
  assert.deepEqual(lane.now.map(c => c.id), ['E2']);
  assert.equal(lane.now[0].state, 'ready');
  assert.equal(lane.later.length, 0);
  // Same when the review epic's own flag is missing: the section decides.
  doc.sections[0].tasks[0].checked = false;
  assert.equal(computeRunPlan(doc).lanes.find(l => l.lane === 'a').now[0].id, 'E2');
});

test('PRO62: a child reviewed with nothing unverified lands in Done; its epic card lists the result', () => {
  const doc = mk({ 'in-progress': [epic('T1', { labels: ['model:sonnet'] }), task('T2', { parentId: 'T1' }), task('T3', { parentId: 'T1' })] });
  const h = home(doc);
  const a = ch(h, 'tasks', 'review', 'T2', '--shipped', 'Built the thing', '--check', 'Open the window and look at the title');
  assert.equal(a.status, 0, a.err);
  let d = read(h);
  assert.equal(find(d, 'T2').s, 'done');
  assert.equal(find(d, 'T2').t.checked, true);
  assert.deepEqual(find(d, 'T1').t.result.shipped, ['T2: Built the thing']);
  assert.equal(find(d, 'T1').s, 'in-progress', 'the epic waits for its other child');
  assert.ok(!(find(d, 'T1').t.result.unverified || []).length, 'nothing for Tal beyond the checks');

  const b = ch(h, 'tasks', 'review', 'T3', '--shipped', 'Built the other', '--check', 'Look at the second thing');
  assert.equal(b.status, 0, b.err);
  d = read(h);
  assert.equal(find(d, 'T3').s, 'done');
  assert.equal(find(d, 'T1').s, 'review', 'with every child closed the epic card goes to Ready for review');
  assert.deepEqual(find(d, 'T1').t.result.shipped, ['T2: Built the thing', 'T3: Built the other']);
  assert.equal(find(d, 'T1').t.checks.length, 2);
});

test('PRO62: unverified lines on a child roll into the epic card too, with the ticket id', () => {
  const h = home(mk({ 'in-progress': [epic('T1', { labels: ['model:sonnet'] }), task('T2', { parentId: 'T1' })] }));
  const r = ch(h, 'tasks', 'review', 'T2', '--shipped', 'Built it', '--unverified', 'Never heard it on speakers', '--check', 'Listen to the sound');
  assert.equal(r.status, 0, r.err);
  const d = read(h);
  assert.equal(find(d, 'T2').s, 'done');
  assert.deepEqual(find(d, 'T1').t.result.unverified, ['T2: Never heard it on speakers']);
  assert.equal(find(d, 'T1').s, 'review');
});
