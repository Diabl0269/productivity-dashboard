/** dashboard/js/home-queue-data.js (PRO152): where moves and drops land, the chips, and the requests (fake fetch). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchQueue, putQueue, moveTarget, reordered, dropIndex, chipsOf, sameItems, plainError, droppedText,
} from '../../dashboard/js/home-queue-data.js';

const items = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id, fields: [] }));

test('moveTarget: one step, clamped to the window, null when nothing moves', () => {
  assert.equal(moveTarget(items, 'b', -1), 0);
  assert.equal(moveTarget(items, 'b', 1), 2);
  assert.equal(moveTarget(items, 'a', -1), null);
  assert.equal(moveTarget(items, 'd', 1), null);
  assert.equal(moveTarget(items, 'c', 1, 3), null, 'the window ends at 3 rows');
  assert.equal(moveTarget(items, 'zz', 1), null);
});

test('reordered returns a new list and leaves the old one alone', () => {
  const out = reordered(items, 0, 2);
  assert.deepEqual(out.map(i => i.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(items.map(i => i.id), ['a', 'b', 'c', 'd']);
});

test('dropIndex counts the row middles above the pointer, ignoring the dragged row', () => {
  const mids = [10, 30, 50, 70];
  assert.equal(dropIndex(mids, 5, 2), 0);
  assert.equal(dropIndex(mids, 31, 0), 1);
  assert.equal(dropIndex(mids, 200, 0), 3);
  assert.equal(dropIndex(mids, 50, 2), 2);
});

test('chipsOf shows the first two fields that have a value', () => {
  const f = [{ key: 'a', value: '' }, { key: 'b', value: 'x' }, { key: 'c', value: ' ' }, { key: 'd', value: 'y' }, { key: 'e', value: 'z' }];
  assert.deepEqual(chipsOf(f).map(c => c.key), ['b', 'd']);
  assert.deepEqual(chipsOf(f, 3).map(c => c.key), ['b', 'd', 'e']);
});

test('sameItems: equal lists change nothing, a different order or field does', () => {
  const x = [{ id: 'a', fields: [{ key: 'k', value: '1' }] }];
  assert.equal(sameItems(x, [{ id: 'a', fields: [{ key: 'k', value: '1' }] }]), true);
  assert.equal(sameItems(x, [{ id: 'a', fields: [{ key: 'k', value: '2' }] }]), false);
  assert.equal(sameItems(items, items.slice().reverse()), false);
});

test('plain words for errors and for the undo line', () => {
  assert.equal(plainError(Object.assign(new Error('The file changed.'), { status: 409 })), 'The file changed.');
  assert.match(plainError(new Error('fetch failed')), /could not be reached \(fetch failed\)/);
  assert.equal(droppedText('Rye', 'skipped'), 'Skipped “Rye”.');
  assert.equal(droppedText('Rye', null), 'Dropped “Rye”.');
});

test('requests: GET and PUT go to /api/home/queue with the project, and errors carry the status and message', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push([url, opts]);
    if (String(url).includes('id=bad')) return { ok: false, status: 409, json: async () => ({ error: 'Stale.' }) };
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };
  await fetchQueue('bakery shop', 'next bakes');
  assert.equal(calls[0][0], '/api/home/queue?project=bakery%20shop&id=next%20bakes');
  await putQueue('bakery', { id: 'q', etag: 'e', op: 'drop', itemId: 'a#0' });
  assert.equal(calls[1][0], '/api/home/queue?project=bakery');
  assert.equal(calls[1][1].method, 'PUT');
  assert.deepEqual(JSON.parse(calls[1][1].body), { id: 'q', etag: 'e', op: 'drop', itemId: 'a#0' });
  await assert.rejects(() => fetchQueue(null, 'bad'), e => e.status === 409 && e.message === 'Stale.');
});
