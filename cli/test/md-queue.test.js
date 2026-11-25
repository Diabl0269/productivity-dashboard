/**
 * shared/md-queue.js (PRO152): parse, move, edit and drop on a markdown queue; every byte an operation
 * does not have to touch stays identical. Fixtures are synthetic (a made-up bakery's menu ideas).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQueue, listItems, moveItem, editItem, dropItem, QueueError } from '../../shared/md-queue.js';

const FILE = `# Bakery menu ideas

Some free text here.
  Indented line stays.

## Sourdough starter
- status: idea
- length: 5 min
Note: feed it twice a day.

## Rye loaf
- length: 8 min

## Croissant
- status: made
- length: 3 min

## Rye loaf
- status: planned

## Cinnamon roll
- status: skipped

## Baguette
- length: 4 min
`;

const titles = (text, o) => listItems(parseQueue(text), o).visible.map(i => i.id);

test('parse: preamble, sections, fields, repeated titles get an occurrence index', () => {
  const p = parseQueue(FILE);
  assert.match(p.preamble, /^# Bakery menu ideas\n\nSome free text here\.\n {2}Indented line stays\.\n\n$/);
  assert.deepEqual(p.sections.map(s => s.id), ['Sourdough starter#0', 'Rye loaf#0', 'Croissant#0', 'Rye loaf#1', 'Cinnamon roll#0', 'Baguette#0']);
  assert.deepEqual(p.sections[0].fields.map(f => [f.key, f.value]), [['status', 'idea'], ['length', '5 min']]);
  assert.equal(p.sections[0].lines.at(-2), 'Note: feed it twice a day.\n');
  const re = [...p.sections.map(s => s.lines.join(''))].join('');
  assert.equal(p.preamble + re, FILE);
});

test('hidden statuses are not listed (default skipped and made); a custom list replaces it', () => {
  const l = listItems(parseQueue(FILE));
  assert.deepEqual(l.visible.map(i => i.id), ['Sourdough starter#0', 'Rye loaf#0', 'Rye loaf#1', 'Baguette#0']);
  assert.equal(l.hidden, 2);
  assert.deepEqual(titles(FILE, { hiddenStatuses: [] }).length, 6);
  assert.deepEqual(titles(FILE, { hiddenStatuses: ['IDEA'] }).includes('Sourdough starter#0'), false);
});

test('"- see https://x" and ### lines are not fields or sections; fenced ## is ignored', () => {
  const t = '## A\n- see https://x\n### sub\n```\n## not a section\n```\n- k: v\n';
  const p = parseQueue(t);
  assert.equal(p.sections.length, 1);
  assert.deepEqual(p.sections[0].fields.map(f => f.key), ['k']);
});

test('move swaps positions among visible sections; hidden ones stay where they are', () => {
  const out = moveItem(FILE, 'Baguette#0', 0);
  assert.deepEqual(titles(out), ['Baguette#0', 'Sourdough starter#0', 'Rye loaf#0', 'Rye loaf#1']);
  const p = parseQueue(out).sections.map(s => s.id);
  assert.equal(p[2], 'Croissant#0'); // hidden stays in slot 2
  assert.equal(p[4], 'Cinnamon roll#0'); // hidden stays in slot 4
  assert.equal(out.length, FILE.length);
  assert.equal(moveItem(moveItem(FILE, 'Baguette#0', 0), 'Baguette#0', 3), FILE, 'moving back restores the exact bytes');
});

test('move to the same place or past the end is clamped and returns the text unchanged when nothing moves', () => {
  assert.equal(moveItem(FILE, 'Sourdough starter#0', 0), FILE);
  assert.equal(moveItem(FILE, 'Baguette#0', 99), FILE);
  assert.deepEqual(titles(moveItem(FILE, 'Sourdough starter#0', 99)).at(-1), 'Sourdough starter#0');
});

test('move: hidden or unknown items and bad targets are plain-words errors', () => {
  assert.throws(() => moveItem(FILE, 'Croissant#0', 0), e => e instanceof QueueError && e.status === 400 && /hidden/.test(e.message));
  assert.throws(() => moveItem(FILE, 'Nope#0', 0), e => e.status === 404);
  assert.throws(() => moveItem(FILE, 'Baguette#0', 'x'), e => e.status === 400);
});

test('move keeps a file without a final newline without one (and the glue newline in the middle)', () => {
  const t = '## A\n- k: 1\n\n## B\n- k: 2';
  const out = moveItem(t, 'B#0', 0);
  assert.equal(out, '## B\n- k: 2\n\n## A\n- k: 1');
  assert.equal(moveItem('## A\n## B\n- k: 2', 'B#0', 0), '## B\n- k: 2\n## A\n'.replace(/\n$/, ''), 'no final newline in, none out');
});

test('edit: replaces only the value, keeps spacing prefix and every other byte', () => {
  const { text, id } = editItem(FILE, 'Sourdough starter#0', 'length', '6 min');
  assert.equal(id, 'Sourdough starter#0');
  assert.equal(text, FILE.replace('- length: 5 min', '- length: 6 min'));
  const spaced = '## A\n-   k:    old   \n';
  assert.equal(editItem(spaced, 'A#0', 'k', 'new').text, '## A\n-   k: new\n');
});

test('edit: a new key is added after the last field line; an empty value keeps the key', () => {
  const t = editItem(FILE, 'Rye loaf#1', 'length', '9 min').text;
  assert.equal(t, FILE.replace('## Rye loaf\n- status: planned\n', '## Rye loaf\n- status: planned\n- length: 9 min\n'));
  assert.equal(editItem('## A\n', 'A#0', 'k', 'v').text, '## A\n- k: v\n');
  assert.equal(editItem('## A\n- k: v\n', 'A#0', 'k', '').text, '## A\n- k:\n');
  assert.equal(editItem('## A\n- k: v', 'A#0', 'j', 'w').text, '## A\n- k: v\n- j: w');
});

test('edit: the title is a field; a repeat of a title changes the occurrence id', () => {
  const r = editItem(FILE, 'Rye loaf#1', 'title', 'Pumpernickel');
  assert.equal(r.id, 'Pumpernickel#0');
  assert.equal(r.text, FILE.replace('## Rye loaf\n- status: planned', '## Pumpernickel\n- status: planned'));
  assert.throws(() => editItem(FILE, 'Baguette#0', 'title', '  '), e => e.status === 400);
});

test('edit: newlines, bad keys and unknown items are refused', () => {
  assert.throws(() => editItem(FILE, 'Baguette#0', 'length', 'a\nb'), /one line/);
  assert.throws(() => editItem(FILE, 'Baguette#0', 'length', 'a\rb'), /one line/);
  assert.throws(() => editItem(FILE, 'Baguette#0', 'bad: key', 'x'), e => e.status === 400);
  assert.throws(() => editItem(FILE, 'Baguette#0', 'length', 5), e => e.status === 400);
  assert.throws(() => editItem(FILE, 'Ghost#0', 'length', 'x'), e => e.status === 404);
});

test('drop deletes the whole section (blank lines included) and nothing else', () => {
  const out = dropItem(FILE, 'Rye loaf#0');
  assert.equal(out, FILE.replace('## Rye loaf\n- length: 8 min\n\n', ''));
  assert.deepEqual(titles(out), ['Sourdough starter#0', 'Rye loaf#0', 'Baguette#0']);
});

test('drop with dropAs "skipped" sets or inserts the status line and the item leaves the list', () => {
  const a = dropItem(FILE, 'Sourdough starter#0', { dropAs: 'skipped' });
  assert.equal(a, FILE.replace('- status: idea', '- status: skipped'));
  const b = dropItem(FILE, 'Baguette#0', { dropAs: 'skipped' });
  assert.equal(b, FILE.replace('- length: 4 min\n', '- length: 4 min\n- status: skipped\n'));
  assert.equal(titles(b).includes('Baguette#0'), false);
});

test('CRLF files keep their line ends through every operation', () => {
  const t = '## A\r\n- k: 1\r\n\r\n## B\r\n- k: 2\r\n';
  assert.equal(moveItem(t, 'B#0', 0), '## B\r\n- k: 2\r\n\r\n## A\r\n- k: 1\r\n');
  assert.equal(editItem(t, 'A#0', 'k', '9').text, '## A\r\n- k: 9\r\n\r\n## B\r\n- k: 2\r\n');
  assert.equal(editItem(t, 'A#0', 'j', '7').text, '## A\r\n- k: 1\r\n- j: 7\r\n\r\n## B\r\n- k: 2\r\n');
});

test('an empty file and a file with no sections round-trip', () => {
  assert.equal(parseQueue('').sections.length, 0);
  assert.equal(dropItem('## A\n', 'A#0'), '');
  assert.deepEqual(listItems(parseQueue('just text\n')).visible, []);
});

test('PRO152: moving the last section up keeps a blank line between sections and none after the new last one', async () => {
  const { moveItem } = await import('../../shared/md-queue.js');
  const text = '# Q\n\n## A\n- status: planned\n\n## B\n- status: planned\n\n## C\n- status: planned\n';
  const out = moveItem(text, 'C#0', 0);
  assert.equal(out, '# Q\n\n## C\n- status: planned\n\n## A\n- status: planned\n\n## B\n- status: planned\n');
});
