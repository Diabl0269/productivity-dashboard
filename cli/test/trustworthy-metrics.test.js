/**
 * cli/test/trustworthy-metrics.test.js (PRO76): per-shipped cost covers the archive and says its coverage, cost per closed
 * epic, review wait per kind and the ready-to-first-look distribution, one cost total, plan hint, reopened by fix ticket.
 * Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowMetrics } from '../../shared/flow-metrics.js';
import { buildMetricsPayload } from '../../shared/metrics-payload.js';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const at = (day, hh = 0, mm = 0) => `2026-11-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;
const mv = (when, from, to) => ({ at: when, event: 'moved', from, to });
const task = (id, over = {}) => ({ id, title: `T ${id}`, type: 'task', project: 'p1', created: at(1), labels: [], history: [], ...over });
const docOf = map => ({ sections: Object.entries(map).map(([id, tasks]) => ({ id, tasks })), meta: {} });
const ses = (key, ticket, costUSD, byTicket, over = {}) => ({
  key, sessionId: key, ticket, start: at(10, 10), activeMin: 10, wallMin: 10, costUSD, byTicket,
  byModel: { 'claude-opus-5': { costUSD } }, tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, helperTokens: {}, ...over,
});

test('per shipped ticket includes archived tickets, reports coverage, and costs closed epics', () => {
  const doc = docOf({
    archive: [task('A1', { labels: ['model:sonnet'], parentId: 'E1', history: [mv(at(5), 'review', 'archive')] }), task('A2', { history: [mv(at(6), 'review', 'archive')] }),
      task('E1', { type: 'epic', history: [mv(at(7), 'review', 'archive')] })],
    done: [task('D1', { labels: ['model:sonnet'], history: [mv(at(8), 'in-progress', 'done')] }), task('Old', { history: [mv('2026-06-01T00:00:00.000Z', 'in-progress', 'done')] })],
    todo: [task('T1')],
  });
  const sessions = [
    ses('s1', 'A1', 4, { A1: { costUSD: 4 } }),
    ses('s2', 'D1', 2, { D1: { costUSD: 2 } }),
    ses('s3', 'T1', 9, { T1: { costUSD: 9 } }),
  ];
  const c = buildMetricsPayload({ doc, sessions, cfg: {}, now: NOW }).costs;
  const sonnet = c.perShipped.find(g => g.label === 'model:sonnet');
  assert.deepEqual([sonnet.n, sonnet.totalUSD], [2, 6]); // the archived A1 counts
  assert.deepEqual(c.perShippedCoverage, { withCost: 2, shipped: 3 }); // A1, A2, D1 shipped in range ('Old' is before it); T1 is open
  assert.deepEqual(c.perClosedEpic, { n: 1, withCost: 1, of: 1, medianUSD: 4, p75USD: 4, totalUSD: 4 });
});

test('plan multiple: no planUSDPerMonth gives a plain hint, never a guessed value', () => {
  const c = buildMetricsPayload({ doc: docOf({ todo: [task('T1')] }), sessions: [ses('s1', 'T1', 1, { T1: { costUSD: 1 } })], cfg: { planUSDPerMonth: null }, now: NOW }).costs;
  assert.equal(c.plan, undefined);
  assert.equal(c.planHint, 'set planUSDPerMonth in config.json');
});

test('sessions and cost agree on the total and the session count', () => {
  const doc = docOf({ todo: [task('T1')] });
  const since = at(8);
  // 'early' started before the window but spent $5 inside it; 'zero' started inside and cost nothing in it.
  const sessions = [
    ses('a', 'T1', 3, { T1: { costUSD: 3 } }),
    ses('early', 'T1', 5, { T1: { costUSD: 5 } }, { start: at(7, 23), costByHour: { [Date.parse(at(9, 10)) / 3600000]: 5 } }),
    ses('zero', 'T1', 0, {}, { start: at(9), costByHour: { [Date.parse(at(1, 10)) / 3600000]: 1 } }),
  ];
  const p = buildMetricsPayload({ doc, sessions, cfg: {}, now: NOW, since });
  assert.equal(p.sessions.summary.costUSD, p.costs.total.costUSD);
  assert.equal(p.sessions.summary.costSessions, p.costs.total.sessions);
  assert.equal(p.costs.total.costUSD, 8);
});

test('review wait is split into epic cards and ticket cards; waiting now and p90', () => {
  const e1 = task('E1', { type: 'epic', history: [mv(at(5), 'in-progress', 'review'), mv(at(5, 10), 'review', 'done')] }); // 10 h
  const e2 = task('E2', { type: 'epic', history: [mv(at(6), 'in-progress', 'review'), mv(at(6, 20), 'review', 'done')] }); // 20 h
  const e3 = task('E3', { type: 'epic', history: [mv(at(11), 'in-progress', 'review')] }); // open, 36 h at NOW
  const t1 = task('T1', { history: [mv(at(2), 'todo', 'in-progress'), mv(at(3), 'in-progress', 'review'), mv(at(3, 2), 'review', 'done')] }); // 2 h
  const f = flowMetrics(docOf({ done: [e1, e2, t1], review: [e3] }), { now: NOW, since: at(1) });
  const ep = f.reviewWait.epics;
  assert.deepEqual([ep.n, ep.median, ep.p90, ep.open.n, ep.open.oldestHours], [2, 15, 19, 1, 36]);
  assert.deepEqual([f.reviewWait.tickets.n, f.reviewWait.tickets.median], [1, 2]);
});

test('ready to first look: until the next move or the first review note, bucketed; still waiting counted', () => {
  const moved = task('M1', { history: [mv(at(3), 'in-progress', 'review'), mv(at(3, 5), 'review', 'done')] }); // 5 h
  const noted = task('N1', { history: [mv(at(3), 'in-progress', 'review')], reviewNotes: [{ n: 1, at: at(4), text: 'x', kind: 'fix', state: 'new' }] }); // 24 h
  const noted2 = task('N2', { history: [mv(at(3), 'in-progress', 'review'), mv(at(8), 'review', 'done')], reviewNotes: [{ n: 1, at: at(3, 1, 30), text: 'x', kind: 'fix', state: 'new' }] }); // note first: 1.5 h
  const waiting = task('W1', { history: [mv(at(11), 'in-progress', 'review')] });
  const f = flowMetrics(docOf({ review: [moved, noted, noted2, waiting] }), { now: NOW, since: at(1) });
  const rr = f.reviewWait.readyToReviewed;
  assert.deepEqual([rr.n, rr.median, rr.waiting], [3, 5, 1]);
  assert.deepEqual(rr.buckets.filter(b => b.n).map(b => [b.label, b.n]), [['1-4 h', 1], ['4-12 h', 1], ['1-3 days', 1]]);
});

test('reopened also counts a fix ticket opened from a shipped ticket within 14 days, split by model label', () => {
  const shipped = task('S1', { labels: ['model:haiku'], history: [mv(at(2), 'todo', 'in-progress'), mv(at(4), 'in-progress', 'done')] });
  const shippedB = task('S2', { labels: ['model:opus'], history: [mv(at(2), 'todo', 'in-progress'), mv(at(4), 'in-progress', 'done')] });
  const fixReviewOf = task('F1', { created: at(8), reviewOf: 'S1' });
  const fixParent = task('F2', { created: at(9), parentId: 'S1' });
  const tooLate = task('F3', { created: at(30), reviewOf: 'S2' }); // outside the window and 14 days
  const before = task('F4', { created: at(3), reviewOf: 'S2' }); // opened before it shipped: not a fix of shipped work
  const f = flowMetrics(docOf({ done: [shipped, shippedB], todo: [fixReviewOf, fixParent, tooLate, before] }), { now: NOW, since: at(1) });
  assert.equal(f.counts.reopenedMoves, 0);
  assert.equal(f.counts.reopenedFixes, 2);
  assert.equal(f.counts.reopened, 2);
  assert.deepEqual(f.reopenedByLabel, [{ label: 'model:haiku', moves: 0, fixes: 2 }]);
});

test('reopened adds moves back and fix tickets together', () => {
  const back = task('B1', { labels: ['model:opus'], history: [mv(at(2), 'todo', 'in-progress'), mv(at(3), 'in-progress', 'review'), mv(at(4), 'review', 'in-progress')] });
  const f = flowMetrics(docOf({ 'in-progress': [back], todo: [task('F1', { created: at(6), reviewOf: 'B1' })] }), { now: NOW, since: at(1) });
  assert.deepEqual([f.counts.reopenedMoves, f.counts.reopenedFixes, f.counts.reopened], [1, 1, 2]);
});
