// AGE240: 'Hide finished' also applies to the For you review list (shared 'finished' predicate on reviewQueue rows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewQueue, hiddenAsFinished, isFinishedReview } from '../../shared/review.js';

const chk = (checked) => ({ text: 'look', checked, addedAt: '2026-11-10T10:00:00.000Z' });
const tk = (id, over = {}) => ({ id, title: `Ticket ${id}`, type: 'epic', ...over });
const doc = (tasks) => ({ sections: [{ id: 'review', tasks }] });
const byId = (rows, id) => rows.find(r => r.id === id);

test('reviewQueue flags an epic whose checks are all ticked as finished', () => {
  const rows = reviewQueue(doc([tk('A', { checks: [chk(true), chk(true)] }), tk('B', { checks: [chk(true), chk(false)] })]));
  assert.equal(byId(rows, 'A').finished, true);
  assert.equal(byId(rows, 'B').finished, false);
});

test('0 checks is not finished (moving it to Done is the action)', () => {
  assert.equal(byId(reviewQueue(doc([tk('A')])), 'A').finished, false);
});

test('an unsent note, an open ask or a needs-tal line keeps it in the list', () => {
  const notes = [{ n: 1, text: 'file later', state: 'new', at: '2026-11-05T10:00:00Z' }];
  const rows = reviewQueue(doc([
    tk('N', { checks: [chk(true)], reviewNotes: notes }),
    tk('Q', { checks: [chk(true)], asks: [{ state: 'open', text: 'pick' }] }),
    tk('L', { checks: [chk(true)], result: { unverified: ['needs-tal: taste: sounds right'] } }),
  ]));
  for (const id of ['N', 'Q', 'L']) assert.equal(byId(rows, id).finished, false, id);
  assert.equal(isFinishedReview(tk('X', { checks: [chk(true)] })), true);
});

test('hiddenAsFinished keeps a finished row that has its own decision card', () => {
  const item = { id: 'a1', finished: true };
  assert.equal(hiddenAsFinished(item, []), true);
  assert.equal(hiddenAsFinished(item, [{ members: [{ id: 'A1' }] }]), false);
  assert.equal(hiddenAsFinished({ id: 'B', finished: false }, []), false);
});
