/**
 * cli/test/flow-metrics.test.js
 * shared/flow-metrics.js on small synthetic docs (no real tracker data).
 * Calendar: 2026-11-01 is a Sunday, so Monday of the week of Nov 4 is Nov 2.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketStays, flowMetrics, percentile, median } from '../../shared/flow-metrics.js';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const at = (day, hh = 0) => `2026-11-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:00:00.000Z`;
const mv = (when, from, to) => ({ at: when, event: 'moved', from, to });

function task(id, over = {}) {
  return { id, title: `T ${id}`, type: 'task', project: 'p1', lane: 'timeline', created: at(1), labels: [], blockedBy: [], history: [], ...over };
}
function docOf(map) {
  return { sections: Object.entries(map).map(([id, tasks]) => ({ id, tasks })), meta: {} };
}

test('percentile and median', () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([10, 20], 75), 17.5);
});

test('ticketStays: closed stays then an open one; no history gives none', () => {
  const t = task('A1', { history: [mv(at(2), 'todo', 'in-progress'), mv(at(3), 'in-progress', 'review')] });
  assert.deepEqual(ticketStays(t, { now: NOW }).map(s => [s.stage, s.from, s.to, s.open]), [
    ['todo', at(1), at(2), false],
    ['in-progress', at(2), at(3), false],
    ['review', at(3), NOW.toISOString(), true],
  ]);
  assert.deepEqual(ticketStays(task('A2'), { now: NOW }), []);
  const created = task('A3', { history: [{ at: at(1), event: 'created', to: 'todo' }] });
  assert.deepEqual(ticketStays(created, { now: NOW }).map(s => [s.stage, s.open]), [['todo', true]]);
});

// A1: todo 24h, in-progress 48h, then review (open since Nov 4). A2: todo 12h, in-progress 24h, done.
const a1 = () => task('A1', { history: [mv(at(2), 'todo', 'in-progress'), mv(at(4), 'in-progress', 'review')] });
const a2 = () => task('A2', { created: at(3), history: [mv(at(3, 12), 'todo', 'in-progress'), mv(at(4, 12), 'in-progress', 'done')] });

test('cycle and lead time, counts, stage dwell with an open stay', () => {
  const m = flowMetrics(docOf({ review: [a1()], done: [a2()] }), { now: NOW });
  assert.deepEqual(m.counts, { started: 2, shipped: 2, reopened: 0, closedWithoutWork: 0 });
  assert.equal(m.cycle.n, 2);
  assert.equal(m.cycle.median, 36);
  assert.equal(m.lead.median, 54); // 72h and 36h
  assert.equal(m.stages.todo.n, 2);
  assert.equal(m.stages.todo.median, 18);
  assert.equal(m.stages.todo.totalHours, 36);
  assert.equal(m.stages['in-progress'].totalHours, 72);
  assert.equal(m.stages.review.n, 0); // open stays are reported separately
  assert.deepEqual(m.stages.review.open, { n: 1, oldestHours: 84 });
  assert.equal(m.stages.review.totalHours, 84);
  assert.equal(m.bottleneck.stage, 'review');
  assert.equal(m.bottleneck.totalHours, 84);
  assert.ok(Math.abs(m.bottleneck.share - 84 / 192) < 0.001);
  assert.deepEqual(m.window, { since: '2026-10-08T12:00:00.000Z', until: NOW.toISOString() });
  const week = m.cycleByWeek.find(w => w.week === '2026-11-02');
  assert.deepEqual(week, { week: '2026-11-02', n: 2, median: 36 });
});

test('an open stay is clipped to the window but oldest is not', () => {
  const t = task('O1', { history: [mv(at(1), 'todo', 'review')] });
  const m = flowMetrics(docOf({ review: [t] }), { now: NOW, since: at(6, 12) });
  assert.equal(m.stages.review.totalHours, 24);
  assert.equal(m.stages.review.open.oldestHours, 156);
  assert.equal(m.counts.shipped, 0); // finished before the window
});

test('reopened and closedWithoutWork', () => {
  const r1 = task('R1', {
    history: [mv(at(2), 'todo', 'in-progress'), mv(at(3), 'in-progress', 'review'),
      mv(at(5), 'review', 'in-progress'), mv(at(6), 'in-progress', 'review')],
  });
  const c1 = task('C1', { history: [mv(at(5), 'todo', 'done')] });
  const doc = docOf({ review: [r1], done: [c1] });
  const all = flowMetrics(doc, { now: NOW });
  assert.deepEqual(all.counts, { started: 1, shipped: 1, reopened: 1, closedWithoutWork: 1 });
  assert.equal(all.cycle.n, 1);
  assert.equal(all.cycle.median, 24);
  assert.equal(all.lead.n, 1); // the bookkeeping move is not lead time either
  const late = flowMetrics(doc, { now: NOW, since: at(5) });
  assert.deepEqual(late.counts, { started: 0, shipped: 0, reopened: 1, closedWithoutWork: 1 });
});

test('bottleneck is the stage with the largest total dwell, not the largest median', () => {
  // todo: three 4h stays (total 12, median 4); in-progress: one 10h stay (total 10).
  const todos = [1, 2, 3].map(i => task(`B${i}`, { history: [mv(at(1, 4), 'todo', 'in-progress'), mv(at(1, 4), 'in-progress', 'done')] }));
  const slow = task('B4', { history: [mv(at(1, 0), 'todo', 'in-progress'), mv(at(1, 10), 'in-progress', 'done')] });
  const m = flowMetrics(docOf({ done: [...todos, slow] }), { now: NOW });
  assert.equal(m.stages.todo.totalHours, 12);
  assert.equal(m.stages['in-progress'].totalHours, 10);
  assert.equal(m.bottleneck.stage, 'todo');
});

test('forgotten epics: idle epic and children, most idle first; epics skip cycle numbers', () => {
  const ev = day => [{ at: at(day), event: 'created', to: 'todo' }];
  const e1 = task('E1', { type: 'epic', lane: 'timeline', history: ev(1) });
  const k1 = task('K1', { parentId: 'E1', history: ev(2) });
  const e2 = task('E2', { type: 'epic', lane: 'mod', history: ev(1) });
  const k2 = task('K2', { parentId: 'E2', history: ev(6) });
  const e3 = task('E3', { type: 'epic', history: ev(1) }); // in todo: not forgotten
  const e4 = task('E4', { type: 'epic', lane: 'mod', history: ev(1) });
  const doc = docOf({ 'in-progress': [e1, e2, e4], todo: [k1, k2, e3] });
  const m = flowMetrics(doc, { now: NOW });
  assert.deepEqual(m.forgottenEpics.map(e => [e.id, e.idleDays, e.lane]), [['E4', 6.5, 'mod'], ['E1', 5.5, 'timeline']]);
  assert.equal(flowMetrics(doc, { now: NOW, forgottenEpicDays: 7 }).forgottenEpics.length, 0);
  assert.deepEqual(m.counts, { started: 0, shipped: 0, reopened: 0, closedWithoutWork: 0 });
});

test('wip: end-of-day in-progress per day, tickets and epics counted separately', () => {
  const w1 = task('W1', { history: [mv(at(3, 12), 'todo', 'in-progress'), mv(at(5, 12), 'in-progress', 'review')] });
  const e1 = task('E1', { type: 'epic', history: [mv(at(4), 'todo', 'in-progress')] });
  const m = flowMetrics(docOf({ review: [w1], 'in-progress': [e1] }), { now: NOW, since: at(3) });
  assert.deepEqual(m.wip.map(d => d.date), ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.deepEqual(m.wip.map(d => d.tickets), [1, 1, 0, 0, 0]);
  assert.deepEqual(m.wip.map(d => d.epics), [0, 1, 1, 1, 1]);
});

test('grouping by project, lane (own or epic lane) and area; project/lane filters', () => {
  const ship = (id, over) => task(id, { history: [mv(at(2), 'todo', 'in-progress'), mv(at(3), 'in-progress', 'done')], ...over });
  const e = task('E1', { type: 'epic', lane: 'mod' });
  const doc = docOf({
    done: [
      ship('G1', { project: 'p1', lane: 'timeline' }),
      ship('G2', { project: 'p2', lane: 'mod' }),
      ship('G3', { project: 'p2', lane: undefined, parentId: 'E1' }), // inherits the epic's lane
      ship('G4', { project: 'p1', lane: undefined }),
    ],
    todo: [e],
  });
  const areas = { timeline: 'Editor', mod: 'Sound' };
  const m = flowMetrics(doc, { now: NOW, areas });
  assert.equal(m.groups.project.p1.counts.shipped, 2);
  assert.equal(m.groups.project.p2.counts.shipped, 2);
  assert.equal(m.groups.lane.mod.counts.shipped, 2);
  assert.equal(m.groups.lane.timeline.counts.shipped, 1);
  assert.equal(m.groups.lane.unassigned.counts.shipped, 1);
  assert.equal(m.groups.area.Sound.counts.shipped, 2);
  assert.equal(m.groups.area.Editor.cycle.median, 24);
  assert.equal(m.groups.area.other.counts.shipped, 1);
  assert.deepEqual(Object.keys(m.groups.project.p1), ['counts', 'cycle', 'stages', 'bottleneck']);
  assert.equal(flowMetrics(doc, { now: NOW, project: 'p2' }).counts.shipped, 2);
  assert.equal(flowMetrics(doc, { now: NOW, lane: 'timeline' }).counts.shipped, 1);
});
