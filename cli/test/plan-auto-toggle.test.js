/**
 * cli/test/plan-auto-toggle.test.js
 * PRO64: the Plan page's Auto switch label/state, the `auto` label write, and the Not-ready fold counts.
 * Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAutoLabel, autoToggleView, foldReadiness, isAuto } from '../../shared/epic-ready.js';

test('withAutoLabel adds auto once, keeps other labels, never mutates', () => {
  const before = ['model:sonnet'];
  assert.deepEqual(withAutoLabel(before, true), ['model:sonnet', 'auto']);
  assert.deepEqual(before, ['model:sonnet']);
  assert.deepEqual(withAutoLabel(['auto', 'x'], true), ['x', 'auto']);
  assert.deepEqual(withAutoLabel(undefined, true), ['auto']);
});

test('withAutoLabel off removes auto in any case or spacing', () => {
  assert.deepEqual(withAutoLabel(['x', ' Auto '], false), ['x']);
  assert.deepEqual(withAutoLabel(null, false), []);
  assert.equal(isAuto({ labels: withAutoLabel([], true) }), true);
  assert.equal(isAuto({ labels: withAutoLabel(['auto'], false) }), false);
});

test('autoToggleView: Ready epic reads plain Auto, names the epic for screen readers', () => {
  const v = autoToggleView({ id: 'E1', ready: true, auto: true });
  assert.equal(v.checked, true);
  assert.equal(v.text, 'Auto');
  assert.match(v.ariaLabel, /E1/);
  assert.doesNotMatch(v.ariaLabel + v.title, /waits/);
});

test('autoToggleView: Not-ready epic says it waits until Ready', () => {
  const v = autoToggleView({ id: 'E2', ready: false, auto: false });
  assert.equal(v.checked, false);
  assert.equal(v.text, 'Auto (waits until Ready)');
  assert.match(v.title, /E2.*waits until the epic is Ready/);
  assert.match(v.ariaLabel, /E2.*waits until Ready/);
});

test('foldReadiness splits Ready from Not ready and counts the fold line', () => {
  const rs = [{ id: 'A', ready: true }, { id: 'B', ready: false }, { id: 'C', ready: false }];
  const f = foldReadiness(rs);
  assert.deepEqual(f.ready.map(r => r.id), ['A']);
  assert.deepEqual(f.notReady.map(r => r.id), ['B', 'C']);
  assert.equal(f.buttonLabel, '2 not ready');
  assert.equal(foldReadiness([]).buttonLabel, '0 not ready');
  assert.equal(foldReadiness(undefined).notReady.length, 0);
});
