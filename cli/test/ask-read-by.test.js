/**
 * cli/test/ask-read-by.test.js
 * MAR38: an ask read by a job (`readBy`) keeps typed answers as decisions (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAsk, addAsk, nextStep, cleanAsks, askErrors } from '../../shared/asks.js';

const DETAILS = 'The weekly card on the Plan page: go, change or skip the next short; synthetic test data only.';
const NOW = '2026-03-02T10:00:00.000Z';
const ask = (extra = {}) => ({ n: 1, at: '2026-03-01T10:00:00.000Z', text: 'Next short is a demo. Go?', state: 'open', ...extra });
const ticket = (extra = {}) => ({ id: 'T1', title: 'Weekly short', checked: false, asks: [ask()], ...extra });

test('readBy ask in backlog with no live run: a typed answer is a decision, no note, nothing filed', () => {
  const t = ticket({ asks: [ask({ readBy: 'short-production' })] });
  const r = resolveAsk(t, '1', { action: 'answer', reply: 'go, but shorter', now: NOW, section: 'backlog', isLive: () => false });
  assert.equal(r.note, null);
  assert.equal(r.file, false);
  assert.match(r.decision.text, /go, but shorter/);
  assert.equal(t.asks[0].filedAs, undefined);
  assert.equal(t.reviewNotes, undefined);
});

test('same ask without readBy: still a note', () => {
  const t = ticket();
  const r = resolveAsk(t, '1', { action: 'answer', reply: 'go, but shorter', now: NOW, section: 'backlog', isLive: () => false });
  assert.ok(r.note);
  assert.equal(r.decision, null);
});

test('readBy ask on a done ticket keeps the note behaviour', () => {
  const t = ticket({ asks: [ask({ readBy: 'short-production' })] });
  assert.ok(resolveAsk(t, '1', { action: 'answer', reply: 'blue', now: NOW, section: 'done' }).note);
});

test('nextStep for a readBy ask names the job', () => {
  const t = ticket({ asks: [ask({ readBy: 'short-production' })] });
  const line = nextStep({ readBy: 'short-production', options: [] }, { task: t, section: 'backlog', isLive: () => false });
  assert.match(line, /short-production job reads your answer/);
  assert.match(line, /skip moves it back/);
  assert.doesNotMatch(line, /notes run/);
});

test('addAsk stores readBy, cleanAsks keeps it, a bad slug throws', () => {
  const t = { id: 'T1', asks: [] };
  const a = addAsk(t, { text: 'Go?', details: DETAILS, readBy: 'short-production', now: NOW });
  assert.equal(a.readBy, 'short-production');
  assert.equal(cleanAsks(t).asks[0].readBy, 'short-production');
  assert.throws(() => addAsk(t, { text: 'Go again?', details: DETAILS, readBy: 'Not A Slug', now: NOW }), /--read-by/);
  assert.deepEqual(askErrors({ asks: [ask({ readBy: 'short-production' })] }, 'T1').filter(e => /readBy/.test(e)), []);
});
