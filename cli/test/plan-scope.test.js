/**
 * cli/test/plan-scope.test.js
 * PRO118: Home's Lanes view narrows the run plan to the selected place's epics (shared/plan-scope.js):
 * which rows stay, the count line, the ?hmEpics= link hook, and Auto queue moves made among the shown
 * rows keep the hidden epics in their places. Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scopeTest, scopePlan, scopeForYou, scopeLine, epicsFromSearch, fullQueueTarget, scopedQueue,
} from '../../shared/plan-scope.js';
import { computeRunPlan } from '../../shared/run-plan.js';
import { moveInQueue, stepTarget } from '../../shared/auto-queue.js';

const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, type: 'task', description: PLAIN, ...extra });
const epic = (id, lane, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane, description: '', labels: ['auto', 'model:sonnet'], ...extra });
const doc = () => ({
  meta: { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } },
  sections: [
    { id: 'todo', tasks: [
      epic('E1', 'bread'), task('E1a', { parentId: 'E1' }), task('E1b', { parentId: 'E1a' }),
      epic('E2', 'bread'), task('E2a', { parentId: 'E2' }),
      epic('E3', 'cakes'), task('E3a', { parentId: 'E3' }),
      task('LONE'),
    ] },
  ],
});

test('scopeTest: a ticket is in scope when it or any ticket above it is in the set', () => {
  const t = scopeTest(doc(), new Set(['E1']));
  assert.equal(t('E1'), true);
  assert.equal(t('E1a'), true);
  assert.equal(t('E1b'), true, 'grandchild');
  assert.equal(t('E2'), false);
  assert.equal(t('LONE'), false);
  assert.equal(t('NOPE'), false);
  assert.equal(scopeTest(doc(), null)('anything'), true, 'no scope: everything passes');
});

test('scopeTest: a parent loop does not hang', () => {
  const d = { sections: [{ id: 'todo', tasks: [task('A', { parentId: 'B' }), task('B', { parentId: 'A' })] }] };
  assert.equal(scopeTest(d, new Set(['X']))('A'), false);
});

test('scopePlan: no scope keeps every row and numbers the lanes', () => {
  const d = doc();
  const plan = computeRunPlan(d);
  const out = scopePlan(plan, d, null);
  assert.equal(out.lanes.length, plan.lanes.length);
  assert.deepEqual(out.lanes.map(l => l.index), plan.lanes.map((_, i) => i));
  assert.equal(out.readiness, plan.readiness);
});

test('scopePlan: only the set\'s epics stay; empty lanes go; lanes keep their place (colour)', () => {
  const d = doc();
  const plan = computeRunPlan(d);
  const cakesAt = plan.lanes.findIndex(l => l.lane === 'cakes');
  assert.ok(cakesAt >= 0);
  const out = scopePlan(plan, d, new Set(['E3']));
  assert.deepEqual(out.lanes.map(l => l.lane), ['cakes']);
  assert.equal(out.lanes[0].index, cakesAt);
  assert.deepEqual(out.readiness.map(r => r.id), ['E3']);
  assert.deepEqual([...out.lanes[0].now, ...out.lanes[0].later].map(c => c.id), ['E3']);
  assert.equal(out.totals, plan.totals, 'totals stay those of the whole plan');
  assert.equal(plan.lanes.length >= 2, true, 'the whole plan is not changed');
});

test('scopePlan: a design-lane card keeps only the scope\'s pick tickets', () => {
  const plan = {
    lanes: [{ lane: 'design', now: [{ id: 'co-tasks', ticketIds: ['E1a', 'E2a'], openTickets: 2 }], later: [], laterEpics: [] }],
    readiness: [], review: [], openChecks: [], doneEpics: [], picks: [{ id: 'E1a' }, { id: 'E2a' }],
  };
  const out = scopePlan(plan, doc(), new Set(['E2']));
  assert.deepEqual(out.lanes[0].now[0].ticketIds, ['E2a']);
  assert.equal(out.lanes[0].now[0].openTickets, 1);
  assert.deepEqual(out.picks.map(p => p.id), ['E2a']);
  assert.equal(scopePlan(plan, doc(), new Set(['E3'])).lanes.length, 0, 'nothing left: the lane goes');
});

test('scopePlan: review items, open checks and done epics follow the scope', () => {
  const plan = {
    lanes: [], readiness: [], picks: [],
    review: [{ id: 'E1a' }, { id: 'LONE' }], openChecks: [{ id: 'E2' }], doneEpics: ['E1', 'E3'],
  };
  const out = scopePlan(plan, doc(), new Set(['E1']));
  assert.deepEqual(out.review.map(x => x.id), ['E1a']);
  assert.deepEqual(out.openChecks, []);
  assert.deepEqual(out.doneEpics, ['E1']);
});

test('scopeForYou: a decision stays when any of its tickets is in scope', () => {
  const asks = [{ ids: ['E1a', 'E3a'] }, { ids: ['E2a'] }];
  const interps = [{ id: 'E1b' }, { id: 'LONE' }];
  const out = scopeForYou(doc(), new Set(['E3']), asks, interps);
  assert.deepEqual(out.asks, [asks[0]]);
  assert.deepEqual(out.interps, []);
  assert.deepEqual(scopeForYou(doc(), null, asks, interps), { asks, interps });
});

test('scopeLine says in words what is shown', () => {
  assert.equal(scopeLine({ place: 'Mixer', shown: 4, total: 61 }), 'Showing Mixer: 4 of 61 epics.');
  assert.equal(scopeLine({ place: '', shown: 1, total: 1 }), 'Showing the chosen epics: 1 of 1 epic.');
});

test('epicsFromSearch reads ?hmEpics=', () => {
  assert.deepEqual([...epicsFromSearch('?hmEpics=E1,%20E2,,&where=x')], ['E1', 'E2']);
  assert.equal(epicsFromSearch('?where=x'), null);
  assert.equal(epicsFromSearch('?hmEpics='), null);
  assert.equal(epicsFromSearch(''), null);
});

// --- Auto queue moves among the shown rows -----------------------------------------------

const row = (id, priority, autoRank) => ({ id, priority, autoRank, auto: true });
const FULL = () => [row('H1', 'high', 1), row('N1', 'normal', 1), row('N2', 'normal', 2), row('N3', 'normal', 3), row('N4', 'normal', 4), row('L1', 'low', 1)];

/** Apply a step made in the shown queue to the whole queue; returns the new whole order. */
function stepShown(full, shownIds, id, dir) {
  const shown = full.filter(r => shownIds.includes(r.id));
  const target = stepTarget(shown, id, dir);
  const at = fullQueueTarget(full, new Set(shownIds), id, target);
  return moveInQueue(full, id, at).order;
}

test('fullQueueTarget: Alt+Up past a shown row lands just before it; hidden rows keep their places', () => {
  // shown: N2, N4. Moving N4 up puts it just before N2; N1 and N3 stay where they were.
  assert.deepEqual(stepShown(FULL(), ['N2', 'N4'], 'N4', -1), ['H1', 'N1', 'N4', 'N2', 'N3', 'L1']);
});

test('fullQueueTarget: Alt+Down past a shown row lands just after it', () => {
  assert.deepEqual(stepShown(FULL(), ['N1', 'N3'], 'N1', 1), ['H1', 'N2', 'N3', 'N1', 'N4', 'L1']);
});

test('fullQueueTarget: up out of a group with no shown row above goes to the end of that group', () => {
  assert.deepEqual(stepShown(FULL(), ['N2'], 'N2', -1), ['H1', 'N2', 'N1', 'N3', 'N4', 'L1']);
});

test('fullQueueTarget: down into a group with no shown row goes to its start', () => {
  const full = FULL();
  const target = stepTarget(full.filter(r => r.id === 'N4'), 'N4', 1);
  const at = fullQueueTarget(full, new Set(['N4']), 'N4', target);
  assert.deepEqual(at, { priority: 'low', index: 0 });
  const { order, changes } = moveInQueue(full, 'N4', at);
  assert.deepEqual(order, ['H1', 'N1', 'N2', 'N3', 'N4', 'L1']);
  assert.deepEqual(changes.find(c => c.id === 'N4'), { id: 'N4', priority: 'low', autoRank: 1 });
});

test('fullQueueTarget: a drop at the end of the shown rows lands after the last shown one', () => {
  const full = FULL();
  const at = fullQueueTarget(full, new Set(['N1', 'N2', 'N4']), 'N1', { priority: 'normal', index: 2 });
  assert.deepEqual(moveInQueue(full, 'N1', at).order, ['H1', 'N2', 'N3', 'N4', 'N1', 'L1']);
});

test('scopedQueue: the whole queue and the shown part, same order', () => {
  const readiness = [{ id: 'E1', auto: true, priority: 'normal' }, { id: 'E3', auto: true, priority: 'normal' }, { id: 'E2', auto: false }];
  const { full, shown } = scopedQueue(readiness, doc(), new Set(['E3']));
  assert.deepEqual(full.map(r => r.id), ['E1', 'E3']);
  assert.deepEqual(shown.map(r => r.id), ['E3']);
});
