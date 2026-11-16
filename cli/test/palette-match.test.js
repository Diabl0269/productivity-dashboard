/**
 * shared/palette-match.js (PRO125): fuzzy match and rank for the Home palette. Pure; synthetic items only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank, splitByRanges } from '../../shared/palette-match.js';

const titles = (r) => r.map(x => x.item.title);

test('an empty query keeps the given order, recent first', () => {
  const items = [{ title: 'A' }, { title: 'B', recent: 2 }, { title: 'C', recent: 1 }];
  assert.deepEqual(titles(rank('', items)), ['B', 'C', 'A']);
  assert.deepEqual(titles(rank('   ', items)), ['B', 'C', 'A']);
});

test('items that do not match are left out', () => {
  assert.deepEqual(rank('zzz', [{ title: 'Oven' }, { title: 'Counter' }]), []);
});

test('a plain substring beats a spread-out subsequence', () => {
  const r = rank('oven', [{ title: 'Over and everything nice' }, { title: 'The Oven room' }]);
  assert.equal(r[0].item.title, 'The Oven room');
});

test('the start of a word scores above the middle of one', () => {
  const r = rank('bar', [{ title: 'Cabbage barn' }, { title: 'Table bar' }, { title: 'Crowbar' }]);
  assert.deepEqual(titles(r).slice(0, 2).sort(), ['Cabbage barn', 'Table bar']);
  assert.equal(titles(r)[2], 'Crowbar');
});

test('letters in order match even when spread over the text', () => {
  const r = rank('tmln', [{ title: 'Timeline' }, { title: 'Counter' }]);
  assert.deepEqual(titles(r), ['Timeline']);
});

test('letters scattered far apart do not count as a match', () => {
  assert.deepEqual(rank('view', [{ title: 'Swap the main model (main-setting, Canvas tab, 4-entry table) with votes' }]), []);
});

test('every word of the query must match, in any order', () => {
  const items = [{ title: 'Command palette and keys' }, { title: 'Keys only' }, { title: 'Palette only' }];
  assert.deepEqual(titles(rank('keys palette', items)), ['Command palette and keys']);
});

test('an exact id comes first, whatever the titles say', () => {
  const items = [
    { id: 'BKR120', title: 'Fix BKR12 handling in the loader' },
    { id: 'BKR12', title: 'Rolls' },
    { id: 'BKR121', title: 'BKR12 again' },
  ];
  assert.equal(rank('bkr12', items)[0].item.id, 'BKR12');
  assert.equal(rank('BKR12', items)[0].item.id, 'BKR12');
});

test('an id prefix finds the ticket, and keywords match without being highlighted', () => {
  const r = rank('kitchen oven', [{ title: 'Oven', id: 'oven', keywords: 'Kitchen Oven' }, { title: 'Dough' }]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].idRanges, [[0, 4]]);
  const k = rank('kitchen', [{ title: 'Oven', keywords: 'Kitchen Oven' }])[0];
  assert.deepEqual([k.ranges, k.idRanges], [[], []]);
});

test('ranges mark what matched in the title and in the id', () => {
  const r = rank('rol', [{ title: 'Cinnamon rolls', id: 'BKR1' }])[0];
  assert.deepEqual(r.ranges, [[9, 12]]);
  const r2 = rank('bkr', [{ title: 'Cinnamon rolls', id: 'BKR1' }])[0];
  assert.deepEqual(r2.idRanges, [[0, 3]]);
  assert.deepEqual(r2.ranges, []);
  assert.deepEqual(splitByRanges('Cinnamon rolls', r.ranges).map(p => [p.text, p.hit]), [['Cinnamon ', false], ['rol', true], ['ls', false]]);
});

test('recency breaks a tie; input order breaks the rest', () => {
  const items = [{ title: 'Oven one' }, { title: 'Oven two', recent: 5 }, { title: 'Oven six', recent: 1 }];
  assert.deepEqual(titles(rank('oven', items)), ['Oven two', 'Oven six', 'Oven one']);
  const same = [{ title: 'Dough a' }, { title: 'Dough b' }];
  assert.deepEqual(titles(rank('dough', same)), ['Dough a', 'Dough b']);
});

test('limit keeps the best matches', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ title: `Oven ${i}` }));
  assert.equal(rank('oven', items, { limit: 12 }).length, 12);
});

test('3,000 items rank well inside a generous bound', () => {
  const words = ['oven', 'dough', 'timeline', 'counter', 'palette', 'running', 'lane', 'ticket', 'sync', 'import'];
  const items = Array.from({ length: 3000 }, (_, i) => ({
    id: `PRJ${i}`, title: `${words[i % 10]} ${words[(i * 7) % 10]} ${words[(i * 3) % 10]} step ${i}`,
  }));
  rank('warm up', items); // JIT warm-up
  const t = performance.now();
  for (const q of ['oven', 'tl run', 'PRJ1234', 'palette keys', 'zzzz']) rank(q, items, { limit: 50 });
  const each = (performance.now() - t) / 5;
  assert.ok(each < 50, `one ranking of 3,000 items took ${each.toFixed(1)} ms (limit 50 ms; usually under 10)`);
  assert.equal(rank('PRJ1234', items)[0].item.id, 'PRJ1234');
});
