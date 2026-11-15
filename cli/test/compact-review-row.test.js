/**
 * cli/test/compact-review-row.test.js
 * AGE80: an epic in review with no checks, notes or asks is one compact row on the Plan page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCompactReview } from '../../shared/review.js';

const item = (over = {}) => ({ id: 'AGE68', checks: { done: 0, total: 0 }, notes: 0, lines: [], ...over });

test('no checks, notes, lines or asks: compact', () => {
  assert.equal(isCompactReview(item()), true);
  assert.equal(isCompactReview(item({ lines: undefined }), [{ members: [{ id: 'AGE99' }] }]), true);
});

test('any check, note, needs-tal line or ask on the epic keeps the full card', () => {
  assert.equal(isCompactReview(item({ checks: { done: 1, total: 2 } })), false);
  assert.equal(isCompactReview(item({ notes: 1 })), false);
  assert.equal(isCompactReview(item({ lines: [{ text: 'x' }] })), false);
  assert.equal(isCompactReview(item(), [{ members: [{ id: 'age68' }] }]), false);
  assert.equal(isCompactReview(null), false);
});
