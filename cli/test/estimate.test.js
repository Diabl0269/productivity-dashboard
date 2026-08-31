/**
 * cli/test/estimate.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEstimate, formatEstimate } from '../lib/estimate.js';

test('parseEstimate: minutes hours days', () => {
  assert.equal(parseEstimate('30m'), 30);
  assert.equal(parseEstimate('2h'), 120);
  assert.equal(parseEstimate('1h30m'), 90);
  assert.equal(parseEstimate('1.5h'), 90);
  assert.equal(parseEstimate('1d'), 480);
  assert.equal(parseEstimate('1d2h'), 600);
  assert.equal(parseEstimate('2d'), 960);
  assert.equal(parseEstimate('90'), 90);
  assert.equal(parseEstimate(45), 45);
});

test('parseEstimate: invalid returns null', () => {
  assert.equal(parseEstimate(''), null);
  assert.equal(parseEstimate('abc'), null);
  assert.equal(parseEstimate(null), null);
  assert.equal(parseEstimate('3sp'), null);
  assert.equal(parseEstimate('-1h'), null);
});

test('formatEstimate: compact display', () => {
  assert.equal(formatEstimate(30), '30m');
  assert.equal(formatEstimate(120), '2h');
  assert.equal(formatEstimate(90), '1h30m');
  assert.equal(formatEstimate(480), '1d');
  assert.equal(formatEstimate(510), '1d30m');
});
