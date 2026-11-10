/** cli/test/autorun-settings.test.js: defaults, validation and merge of shared/autorun-settings.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, validateSettings, normalizeSettings, mergeSettings } from '../../shared/autorun-settings.js';

test('normalizeSettings: missing or junk input gives the defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULTS);
  assert.deepEqual(normalizeSettings([1]), DEFAULTS);
  assert.deepEqual(normalizeSettings({ maxRuns: 'x', paceStop: 2, maxStarts: 0 }), DEFAULTS);
});

test('normalizeSettings: valid keys override, maxTotal null is kept', () => {
  const s = normalizeSettings({ maxRuns: 3, maxTotal: null, paceStop: 0.5, reviewCap: 0, extra: 1 });
  assert.equal(s.maxRuns, 3);
  assert.equal(s.maxTotal, null);
  assert.equal(s.paceStop, 0.5);
  assert.equal(s.reviewCap, 0);
  assert.equal(s.maxStarts, DEFAULTS.maxStarts);
  assert.equal('extra' in s, false);
});

test('validateSettings: accepts boundaries', () => {
  const r = validateSettings({ maxRuns: 1, maxTotal: null, paceStop: 1, reviewCap: 0, maxStarts: 1, finishedIdleMin: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.values.maxTotal, null);
  assert.deepEqual(validateSettings({}), { ok: true, values: {} });
});

test('validateSettings: rejects bad numbers', () => {
  for (const bad of [
    { maxRuns: 0 }, { maxRuns: 1.5 }, { maxRuns: '3' }, { maxRuns: null }, { maxRuns: NaN },
    { maxTotal: 0 }, { maxTotal: 2.2 }, { paceStop: -0.1 }, { paceStop: 1.01 },
    { reviewCap: -1 }, { reviewCap: 1.5 }, { maxStarts: 0 }, { finishedIdleMin: 0 }, { finishedIdleMin: Infinity },
  ]) {
    const r = validateSettings(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error, /must|cannot/);
  }
  assert.equal(validateSettings(null).ok, false);
});

test('mergeSettings: keeps unknown keys and only overwrites given ones', () => {
  const merged = mergeSettings({ maxRuns: 4, note: 'keep', nested: { a: 1 } }, { maxTotal: 9 });
  assert.deepEqual(merged, { maxRuns: 4, note: 'keep', nested: { a: 1 }, maxTotal: 9 });
  assert.deepEqual(mergeSettings(null, { maxRuns: 2 }), { maxRuns: 2 });
});
