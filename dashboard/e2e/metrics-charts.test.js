// Pure-helper tests for dashboard/js/metrics-charts.js (no DOM). Run: node --test dashboard/e2e/metrics-charts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtHours, fmtMinutes, fmtSeconds, fmtPct, niceTicks, SECOND_STEPS, HOUR_STEPS } from '../js/metrics-charts.js';

const plain = (s) => s.replace(/ /g, ' ');

test('fmtHours picks min / h / d', () => {
  assert.equal(plain(fmtHours(0.25)), '15 min');
  assert.equal(plain(fmtHours(6.5)), '6.5 h');
  assert.equal(plain(fmtHours(19)), '19 h');
  assert.equal(plain(fmtHours(96)), '4 d');
  assert.equal(fmtHours(0), '0');
  assert.equal(fmtHours(null), '–');
});

test('fmtMinutes and fmtSeconds', () => {
  assert.equal(plain(fmtMinutes(90)), '1.5 h');
  assert.equal(plain(fmtSeconds(42)), '42 s');
  assert.equal(plain(fmtSeconds(468)), '7m 48s');
  assert.equal(plain(fmtSeconds(612)), '10 min');
  assert.equal(plain(fmtSeconds(4320)), '1h 12m');
  assert.equal(fmtPct(0.583), '58%');
});

test('niceTicks covers the range with round steps', () => {
  assert.deepEqual(niceTicks(0, 14, 4), [0, 5, 10, 15]);
  assert.deepEqual(niceTicks(0, 1, 4), [0, 0.25, 0.5, 0.75, 1]);
  const t = niceTicks(0, 780, 4, SECOND_STEPS);
  assert.ok(t.every(v => v % 60 === 0) && t[t.length - 1] >= 780, t.join());
  const h = niceTicks(0, 9, 4, HOUR_STEPS);
  assert.ok(h[h.length - 1] >= 9 && h.length <= 6, h.join());
});
