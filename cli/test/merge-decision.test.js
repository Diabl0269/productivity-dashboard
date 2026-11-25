/**
 * cli/test/merge-decision.test.js
 * AGE219: a held PR with nothing to see or hear is a merge decision, not a "Try on branch" check: the gate files
 * no check (it points at `ch tasks ask --merge-pr`), and the dashboard shows no Open project button for such a
 * check. Real branch checks are unchanged. Fake gh state, synthetic data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isMergeDecisionCheck, saysNothingToTry } from '../../shared/merge-decision.js';
import { openPrGate } from '../lib/open-pr-gate.js';

const PR = 'https://github.com/example/demo/pull/42';
const links = [{ url: PR, label: 'PR #42' }];
const open = () => ({ state: 'OPEN', branch: 'feat/x' });

test('isMergeDecisionCheck: true for the FRO1050#5 text, false for a real try check', () => {
  assert.equal(isMergeDecisionCheck('FRO1245: Try on branch feat/x: Not needed beyond the merge decision: the key eval and tests are in the PR; nothing to hear or see'), true);
  assert.equal(isMergeDecisionCheck('Try on branch feat/x: Nothing to see here, merge it'), true);
  assert.equal(isMergeDecisionCheck('Try on branch feat/x: open the project, press Play on the Reverb card: tail fades in 2 s'), false);
  assert.equal(isMergeDecisionCheck('Nothing to hear or see'), false); // not a Try-on-branch check
  assert.equal(isMergeDecisionCheck(undefined), false);
});

test('saysNothingToTry covers the merge-decision wordings', () => {
  for (const t of ['Not needed beyond the merge decision', 'nothing to hear', 'Nothing to hear or see', 'nothing to see']) assert.ok(saysNothingToTry(t), t);
  assert.ok(!saysNothingToTry('press Play on the Reverb card'));
});

test('the gate adds no check on "nothing to see" steps and points at the merge ask', () => {
  const r = openPrGate({ id: 'T1', links, heldPr: 'waiting', trySteps: 'Not needed beyond the merge decision: the key eval and tests are in the PR; nothing to hear or see', state: open });
  assert.deepEqual(r.checks, []);
  assert.equal(r.held, null);
  assert.match(r.error, /ch tasks ask T1/);
  assert.match(r.error, /--merge-pr/);
});

test('real branch steps still add the Try on branch check', () => {
  const r = openPrGate({ id: 'T1', links, heldPr: 'waiting', trySteps: 'Open project, in the Mixer panel press Play on the Reverb card: the tail fades out in 2 s', state: open });
  assert.equal(r.error, null);
  assert.equal(r.checks.length, 1);
  assert.match(r.checks[0], /^Try on branch feat\/x: /);
});
