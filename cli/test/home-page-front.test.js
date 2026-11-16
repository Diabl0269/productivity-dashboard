import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePageFile, isIsoDate } from '../../shared/home-page-front.js';

test('a full front matter: quoted title with a colon, inline covers list, body without the block', () => {
  const r = parsePageFile('---\ntitle: "Counter: how a sale works"\nupdated: 2026-11-03\ncovers: [shop/till/**, "shop/a, b.js", shop/x.js]\n---\n\n## Hello\n');
  assert.equal(r.title, 'Counter: how a sale works');
  assert.equal(r.updated, '2026-11-03');
  assert.deepEqual(r.covers, ['shop/till/**', 'shop/a, b.js', 'shop/x.js']);
  assert.equal(r.body, '\n## Hello\n');
  assert.deepEqual(r.problems, []);
});

test('an unquoted title with a colon and single quotes are kept whole', () => {
  const r = parsePageFile("---\ntitle: Oven: baking\nupdated: '2026-01-02'\ncovers: []\n---\nbody");
  assert.equal(r.title, 'Oven: baking');
  assert.equal(r.updated, '2026-01-02');
  assert.deepEqual(r.covers, []);
});

test('a block list of covers works too', () => {
  const r = parsePageFile('---\ntitle: T\nupdated: 2026-02-03\ncovers:\n  - a/b/**\n  - a/c.js\n---\nx');
  assert.deepEqual(r.covers, ['a/b/**', 'a/c.js']);
});

test('missing fields are reported in plain words, never thrown', () => {
  const r = parsePageFile('---\ntitle: Only a title\n---\nbody');
  assert.equal(r.updated, null);
  assert.deepEqual(r.covers, []);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems.join(' '), /updated/);
  assert.match(r.problems.join(' '), /covers/);
});

test('no front matter at all: the whole text is the body', () => {
  const r = parsePageFile('## Just text\n');
  assert.equal(r.hasFrontMatter, false);
  assert.equal(r.body, '## Just text\n');
  assert.match(r.problems[0], /no front matter/);
});

test('a bad date is dropped with a problem; CRLF and a BOM are fine', () => {
  const r = parsePageFile('\uFEFF---\r\ntitle: T\r\nupdated: 2026-13-45\r\ncovers: [a/b]\r\n---\r\nbody\r\n');
  assert.equal(r.updated, null);
  assert.match(r.problems.join(' '), /should be a date/);
  assert.equal(r.title, 'T');
  assert.equal(r.body, 'body\n');
});

test('covers that is not a list is a problem', () => {
  const r = parsePageFile('---\ntitle: T\nupdated: 2026-02-03\ncovers: a/b\n---\nx');
  assert.match(r.problems.join(' '), /should be a list/);
});

test('isIsoDate checks real calendar days', () => {
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('26-02-03'), false);
});
