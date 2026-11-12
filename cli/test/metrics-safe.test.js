// safe(): one throwing Metrics section must not stop the others (dashboard/js/metrics-safe.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safe } from '../../dashboard/js/metrics-safe.js';

function quiet(fn) {
  const orig = console.error;
  const calls = [];
  console.error = (...a) => calls.push(a);
  try { return [fn(), calls]; } finally { console.error = orig; }
}

test('safe returns the renderer result when it works', () => {
  const [v, calls] = quiet(() => safe('Cost', () => 42));
  assert.equal(v, 42);
  assert.equal(calls.length, 0);
});

test('safe logs and returns the fallback when the renderer throws', () => {
  const boom = new TypeError('x is null');
  const [v, calls] = quiet(() => safe('Cost', () => { throw boom; }, (name, err) => `${name}: ${err.message}`));
  assert.equal(v, 'Cost: x is null');
  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /"Cost" section failed/);
  assert.equal(calls[0][1], boom);
});

test('safe returns null without a fallback, and survives a throwing fallback', () => {
  const [a] = quiet(() => safe('A', () => { throw new Error('a'); }));
  assert.equal(a, null);
  const [b, calls] = quiet(() => safe('B', () => { throw new Error('b'); }, () => { throw new Error('fallback'); }));
  assert.equal(b, null);
  assert.equal(calls.length, 2);
});
