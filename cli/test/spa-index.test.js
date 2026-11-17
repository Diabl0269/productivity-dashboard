/**
 * PRO127: a nested dashboard route (/dashboard/home/map) is served the page with its <base> already in the HTML,
 * so the preload scanner fetches ./styles and ./js from /dashboard/ instead of 404ing under /dashboard/home/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baseHrefFor, withBase } from '../../server/spa-index.js';

test('baseHrefFor: the /dashboard segment, keeping any prefix', () => {
  assert.equal(baseHrefFor('/dashboard/home/map'), '/dashboard/');
  assert.equal(baseHrefFor('/dashboard'), '/dashboard/');
  assert.equal(baseHrefFor('/proxy/dashboard/home'), '/proxy/dashboard/');
  assert.equal(baseHrefFor('/dashboards/x'), '/dashboard/');
  assert.equal(baseHrefFor(''), '/dashboard/');
});

test('withBase: the <base> is the first thing in <head>, before any stylesheet', () => {
  const html = readFileSync(new URL('../../dashboard/index.html', import.meta.url), 'utf8');
  const out = withBase(html, '/dashboard/home/where/area/x');
  const base = out.indexOf('<base href="/dashboard/">');
  assert.ok(base > 0);
  assert.ok(base < out.indexOf('<link rel="stylesheet"'));
  assert.equal(withBase(out, '/dashboard/x'), out); // never two
  assert.ok(withBase('<head></head>', '/a"b/dashboard/').includes('href="/a&quot;b/dashboard/"'));
});
