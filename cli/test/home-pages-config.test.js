import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';
import { allBoxes, nearestPage, pagePathProblem, PROJECT_BOX } from '../../shared/home-pages-config.js';

const base = () => ({
  version: 1, title: 'Bakery',
  groups: [{ id: 'shop', name: 'Shop', areas: [{ id: 'counter', name: 'Counter', parts: [{ id: 'till', name: 'Till' }] }, { id: 'display', name: 'Display' }] }],
});

test('page and covers on a box are kept; the pages map gives a box a page', () => {
  const raw = base();
  raw.groups[0].areas[0].page = 'pages/counter.md';
  raw.groups[0].areas[0].covers = ['shop/till/**'];
  raw.pages = { display: 'pages/display.md', shop: 'pages/shop.md' };
  const { config, errors } = normalizeHomeConfig(raw);
  assert.deepEqual(errors, []);
  const byId = Object.fromEntries(allBoxes(config).map(b => [b.id, b]));
  assert.equal(byId.counter.page, 'pages/counter.md');
  assert.deepEqual(byId.counter.covers, ['shop/till/**']);
  assert.equal(byId.display.page, 'pages/display.md');
  assert.equal(byId.shop.page, 'pages/shop.md');
  assert.equal(byId.till.page, null);
});

test('a page on the box wins over the pages map', () => {
  const raw = base();
  raw.groups[0].areas[0].page = 'pages/own.md';
  raw.pages = { counter: 'pages/other.md' };
  const { config } = normalizeHomeConfig(raw);
  assert.equal(allBoxes(config).find(b => b.id === 'counter').page, 'pages/own.md');
});

test('the older flat shape can gain pages through the map', () => {
  const { config, errors, legacy } = normalizeHomeConfig({
    groups: { app: 'App' }, areas: [{ id: 'ai', name: 'AI', group: 'app' }], pages: { app: 'pages/app.md', ai: 'pages/ai.md' },
  });
  assert.equal(legacy, true);
  assert.deepEqual(errors, []);
  assert.equal(config.groups[0].page, 'pages/app.md');
  assert.equal(config.groups[0].areas[0].page, 'pages/ai.md');
});

test('bad page values are reported and dropped', () => {
  const raw = base();
  raw.groups[0].areas[0].page = '../secret.md';
  raw.groups[0].areas[1].page = '/etc/passwd.md';
  raw.pages = { nowhere: 'pages/x.md', till: 'pages/till.txt', shop: 7 };
  const { config, errors } = normalizeHomeConfig(raw);
  const text = errors.join('\n');
  assert.match(text, /"counter": "page" must stay inside/);
  assert.match(text, /"display": "page" should be relative/);
  assert.match(text, /pages: "nowhere" is not a group/);
  assert.match(text, /"till": "page" should end in \.md/);
  assert.match(text, /pages > "shop": should be the path of a \.md file/);
  assert.equal(allBoxes(config).find(b => b.id === 'counter').page, null);
});

test('pages that is not an object is one problem', () => {
  const raw = base();
  raw.pages = ['x'];
  assert.match(normalizeHomeConfig(raw).errors.join(' '), /"pages" should be an object/);
});

test('a top-level page is kept; nearestPage walks up to a parent', () => {
  const raw = base();
  raw.page = 'pages/home.md';
  raw.pages = { shop: 'pages/shop.md' };
  const { config, errors } = normalizeHomeConfig(raw);
  assert.deepEqual(errors, []);
  assert.deepEqual(nearestPage(config, 'till'), { box: 'shop', name: 'Shop', page: 'pages/shop.md', inherited: true });
  assert.equal(nearestPage(config, 'shop').inherited, false);
  assert.equal(nearestPage(config, PROJECT_BOX).page, 'pages/home.md');
  assert.equal(nearestPage(normalizeHomeConfig(base()).config, 'till'), null);
});

test('pagePathProblem rules', () => {
  for (const ok of ['pages/a.md', 'a.MD', 'x/y/z.md']) assert.equal(pagePathProblem(ok), null, ok);
  for (const bad of ['', '/a.md', 'C:\\a.md', 'https://x.test/a.md', '../a.md', 'a/../b.md', 'a.txt', 'a\0.md', 5]) {
    assert.ok(pagePathProblem(bad), String(bad));
  }
});
