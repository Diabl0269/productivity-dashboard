// PRO143: the Checks tab's data (shared/open-checks.js), on synthetic docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCheckTickets, checksPageCounts } from '../../shared/open-checks.js';

const NOW = '2026-11-20T12:00:00.000Z';
const chk = (checked, addedAt = '2026-11-10T10:00:00.000Z', extra = {}) => ({ text: 'look', checked, addedAt, ...extra });
const tk = (id, over = {}) => ({ id, title: `Ticket ${id}`, type: 'task', ...over });
const doc = (sections) => ({ sections: Object.entries(sections).map(([id, tasks]) => ({ id, tasks })) });
const ids = (rows) => rows.map(r => r.id);

test('an unticked check on a review ticket shows with the Plan row shape', () => {
  const rows = openCheckTickets(doc({ review: [tk('A', { checks: [chk(true), chk(false)], result: { at: '2026-11-10T09:00:00.000Z' } })] }), { now: NOW });
  assert.deepEqual(ids(rows), ['A']);
  assert.deepEqual(rows[0].checks, { done: 1, total: 2 });
  assert.equal(rows[0].finished, false);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['checks', 'enteredAt', 'finished', 'followUps', 'id', 'lines', 'notes', 'parentId', 'project', 'result', 'reviewOf', 'title']);
});

test('all ticked in review: hidden by default, shown as finished when hideAllTicked is false', () => {
  const d = doc({ review: [tk('A', { checks: [chk(true)] })] });
  assert.deepEqual(openCheckTickets(d, { now: NOW }), []);
  const rows = openCheckTickets(d, { now: NOW, hideAllTicked: false });
  assert.deepEqual(ids(rows), ['A']);
  assert.equal(rows[0].finished, true);
});

test('an in-progress ticket with an unticked check shows', () => {
  assert.deepEqual(ids(openCheckTickets(doc({ 'in-progress': [tk('E', { type: 'epic', checks: [chk(false)] })] }), { now: NOW })), ['E']);
});

test('a needs-tal line on an open epic counts as an open check', () => {
  const child = tk('C1', { parentId: 'E1', result: { at: '2026-11-10T10:00:00.000Z', shipped: ['x'], ci: 'ok', unverified: ['needs-tal: hardware: works on a real keyboard'] } });
  const rows = openCheckTickets(doc({ 'in-progress': [tk('E1', { type: 'epic' })], done: [child] }), { now: NOW });
  assert.deepEqual(ids(rows), ['E1']);
  assert.deepEqual(rows[0].checks, { done: 0, total: 1 });
  assert.equal(rows[0].lines.length, 1);
  assert.equal(rows[0].finished, false);
});

test('a done ticket shows only within 7 days and only with hide off', () => {
  const recent = tk('R', { checks: [chk(true)], history: [{ from: 'review', to: 'done', at: '2026-11-18T12:00:00.000Z' }] });
  const old = tk('O', { checks: [chk(true)], history: [{ from: 'review', to: 'done', at: '2026-10-21T12:00:00.000Z' }] });
  const d = doc({ done: [recent, old] });
  assert.deepEqual(openCheckTickets(d, { now: NOW }), []);
  assert.deepEqual(ids(openCheckTickets(d, { now: NOW, hideAllTicked: false })), ['R']);
});

test('a ticket with no checks never shows', () => {
  const d = doc({ review: [tk('A')], 'in-progress': [tk('B', { checks: [] })], done: [tk('D', { history: [{ to: 'done', at: NOW }] })] });
  assert.deepEqual(openCheckTickets(d, { now: NOW, hideAllTicked: false }), []);
});

test('a check handed to another ticket counts as ticked', () => {
  const d = doc({ review: [tk('A', { checks: [chk(true), chk(false, undefined, { handedTo: 'B' })] })] });
  assert.deepEqual(openCheckTickets(d, { now: NOW }), []);
  const rows = openCheckTickets(d, { now: NOW, hideAllTicked: false });
  assert.equal(rows[0].finished, true);
  assert.deepEqual(rows[0].checks, { done: 2, total: 2 });
});

test('oldest first by the earliest unticked check, ties by id', () => {
  const d = doc({
    review: [
      tk('C', { checks: [chk(false, '2026-11-12T00:00:00.000Z')] }),
      tk('B', { checks: [chk(false, '2026-11-05T00:00:00.000Z')] }),
      tk('A', { checks: [chk(false, '2026-11-12T00:00:00.000Z')] }),
      tk('D', { checks: [chk(true, '2026-11-01T00:00:00.000Z'), chk(false, '2026-11-20T00:00:00.000Z')] }),
    ],
  });
  assert.deepEqual(ids(openCheckTickets(d, { now: NOW })), ['B', 'A', 'C', 'D']);
});

test('checksPageCounts: tickets and checks still to tick', () => {
  const rows = openCheckTickets(doc({ review: [tk('A', { checks: [chk(true), chk(false), chk(false)] }), tk('B', { checks: [chk(false)] })] }), { now: NOW });
  assert.deepEqual(checksPageCounts(rows), { tickets: 2, open: 3 });
  assert.deepEqual(checksPageCounts([]), { tickets: 0, open: 0 });
});
