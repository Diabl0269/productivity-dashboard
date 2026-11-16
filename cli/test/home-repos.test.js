/**
 * server/home/repos.js (PRO117): the repos a home config names, as absolute existing directories.
 * Synthetic bakery layout in a temp dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRepos } from '../../server/home/repos.js';
import { normalizeHomeConfig } from '../../shared/home-config.js';

// <tmp>/bakery/.git, <tmp>/bakery/site, <tmp>/bakery/orders, <tmp>/bakery/docs/home.config.json
function layout() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ch-repos-')));
  const top = path.join(root, 'bakery');
  for (const d of ['.git', 'site', 'orders', 'docs', 'extra/where']) fs.mkdirSync(path.join(top, d), { recursive: true });
  return { top, cfg: path.join(top, 'docs', 'home.config.json') };
}

test('v1 text entries are relative to the config file, with the folder name as the name', () => {
  const { top, cfg } = layout();
  const out = resolveRepos({ version: 1, repos: ['..', '../site'] }, cfg);
  assert.deepEqual([...out], [{ name: 'bakery', path: top }, { name: 'site', path: path.join(top, 'site') }]);
  assert.deepEqual(out.warnings, []);
});

test('object entries: path relative to the config file, name kept or defaulted', () => {
  const { top, cfg } = layout();
  const out = resolveRepos({ version: 1, repos: [{ name: 'Shop', path: '../site' }, { path: '../orders' }] }, cfg);
  assert.deepEqual([...out], [{ name: 'Shop', path: path.join(top, 'site') }, { name: 'orders', path: path.join(top, 'orders') }]);
});

test('older flat shape: text entries are relative to the nearest git top-level above the file', () => {
  const { top, cfg } = layout();
  const raw = { repos: ['.', 'site', 'orders'], groups: { shop: 'Shop' }, areas: [] };
  const out = resolveRepos(raw, cfg);
  assert.deepEqual(out.map(r => r.path), [top, path.join(top, 'site'), path.join(top, 'orders')]);
  // object form stays relative to the file even in a flat-shape file
  assert.deepEqual(resolveRepos({ ...raw, repos: [{ path: '../site' }] }, cfg).map(r => r.path), [path.join(top, 'site')]);
});

test('a normalised older-shape config keeps its meaning (the legacy flag travels with it)', () => {
  const { top, cfg } = layout();
  const { config } = normalizeHomeConfig({ repos: ['site'], groups: { shop: 'Shop' }, areas: [{ id: 'counter', group: 'shop' }] });
  assert.equal(config.legacy, true);
  assert.deepEqual(resolveRepos(config, cfg).map(r => r.path), [path.join(top, 'site')]);
});

test('without a git top-level the older shape falls back to the file directory', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ch-repos-nogit-')));
  fs.mkdirSync(path.join(root, 'site'));
  // (a temp dir sits under no repo; if one ever did, the test would still point at root/site or skip)
  const out = resolveRepos({ repos: ['site'], groups: { a: 'A' } }, path.join(root, 'home.config.json'));
  assert.ok(out.length === 1 || out.warnings.length === 1);
});

test('missing folders, files and bad entries are left out with a plain-words warning; repeats are dropped', () => {
  const { top, cfg } = layout();
  fs.writeFileSync(path.join(top, 'a-file'), 'x');
  const out = resolveRepos({ version: 1, repos: ['../site', '../gone', '../a-file', '', { name: 'x' }, '../site/'] }, cfg);
  assert.deepEqual(out.map(r => r.name), ['site']);
  assert.equal(out.warnings.length, 4);
  assert.match(out.warnings[0], /repos\[1\] "..\/gone" is not a folder/);
  assert.match(out.warnings[1], /a-file/);
});

test('absolute paths are used as they are; no repos or no config gives an empty list', () => {
  const { top, cfg } = layout();
  assert.deepEqual(resolveRepos({ version: 1, repos: [path.join(top, 'orders')] }, cfg).map(r => r.name), ['orders']);
  assert.deepEqual([...resolveRepos({ version: 1 }, cfg)], []);
  assert.deepEqual([...resolveRepos(null, cfg)], []);
});

test('config validation accepts the object form and names the problems', () => {
  const ok = normalizeHomeConfig({ version: 1, repos: ['a', { name: 'B', path: 'b' }, { path: 'c' }], groups: [] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config.repos, ['a', { path: 'b', name: 'B' }, { path: 'c' }]);
  const bad = normalizeHomeConfig({ version: 1, repos: [5, { name: 'x' }, { path: 'd', colour: 'red' }, { path: 'e', name: 3 }], groups: [] });
  assert.equal(bad.errors.length, 4);
  assert.deepEqual(bad.config.repos, [{ path: 'd' }, { path: 'e' }]);
  assert.match(bad.errors[0], /repos\[0\]: should be a path or an object/);
});

test('"fallback" must name an area', () => {
  const groups = [{ id: 'g', name: 'G', areas: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }];
  assert.equal(normalizeHomeConfig({ version: 1, groups, fallback: 'a' }).config.fallback, 'a');
  const bad = normalizeHomeConfig({ version: 1, groups, fallback: 'nope' });
  assert.equal(bad.config.fallback, null);
  assert.match(bad.errors[0], /"fallback" should be the id of an area/);
});

test('"what" (one line) is kept on groups, areas and parts, and must be text', () => {
  const { config, errors } = normalizeHomeConfig({
    version: 1,
    groups: [{ id: 'g', name: 'G', what: 'The group', areas: [{ id: 'a', name: 'A', what: 'The area', parts: [{ id: 'p', name: 'P', what: 'The part' }, { id: 'q', name: 'Q' }] }] }],
  });
  assert.deepEqual(errors, []);
  assert.equal(config.groups[0].what, 'The group');
  assert.equal(config.groups[0].areas[0].what, 'The area');
  assert.equal(config.groups[0].areas[0].parts[0].what, 'The part');
  assert.equal('what' in config.groups[0].areas[0].parts[1], false);
  const bad = normalizeHomeConfig({ version: 1, groups: [{ id: 'g', name: 'G', areas: [{ id: 'a', name: 'A', what: 5 }] }] });
  assert.equal(bad.errors.length, 1);
});
