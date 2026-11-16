import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageUrl, pagePathOf, pageStateFor } from '../../dashboard/js/home-pages-data.js';

const path = (u) => decodeURIComponent(new URL(u, 'http://x').searchParams.get('path'));

test('image urls: relative to the page folder, folded, on the file route', () => {
  assert.equal(path(imageUrl('pages', 'img/a.svg')), 'pages/img/a.svg');
  assert.equal(path(imageUrl('pages', './img/../img/a.svg')), 'pages/img/a.svg');
  assert.equal(path(imageUrl('.', 'a.svg')), 'a.svg');
  assert.equal(path(imageUrl('docs/pages', '../shared/b.png')), 'docs/shared/b.png');
  assert.match(imageUrl('pages', 'a.svg'), /^\/api\/home\/page-file\?/);
});

test('image urls: external, absolute and escaping sources are not made into urls', () => {
  for (const bad of ['https://x.test/a.svg', 'data:image/svg+xml,<svg/>', '/etc/a.svg', '//x.test/a.svg', '../../a.svg', '', null]) {
    assert.equal(imageUrl('pages', bad), null, String(bad));
  }
});

test('a relative page link becomes the config-relative path of the page', () => {
  assert.equal(pagePathOf('pages', 'oven.md'), 'pages/oven.md');
  assert.equal(pagePathOf('pages', 'oven.md#steps'), 'pages/oven.md');
  assert.equal(pagePathOf('pages', 'https://example.com/oven.md'), null);
  assert.equal(pagePathOf('pages', '../../oven.md'), null);
});

test('pageStateFor is "none" until the summary has arrived (never throws without a browser)', () => {
  globalThis.fetch = () => Promise.reject(new Error('offline'));
  assert.equal(pageStateFor('oven'), 'none');
});
