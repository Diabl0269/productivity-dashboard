/** `queues` in home.config.json (PRO152): defaults, every bad input a plain-words line, nothing throws. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeHomeConfig } from '../../shared/home-config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const norm = queues => normalizeHomeConfig({ version: 1, groups: [], queues });

test('a minimal queue gets the defaults', () => {
  const { config, errors } = norm([{ id: 'menu', title: 'Next bakes', file: 'docs/menu.md' }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(config.queues, [{
    id: 'menu', title: 'Next bakes', file: 'docs/menu.md', show: 4, dropAs: null, hiddenStatuses: ['skipped', 'made'], check: null,
  }]);
});

test('no queues key gives an empty list (the panel does not render)', () => {
  assert.deepEqual(normalizeHomeConfig({ version: 1, groups: [] }).config.queues, []);
});

test('every option is read', () => {
  const { config, errors } = norm([{
    id: 'menu', title: 'T', file: '../up/menu.md', show: 7, dropAs: 'skipped', hiddenStatuses: ['done'],
    check: { command: ['node', 'check.js', '--strict'], cwd: 'tools' },
  }]);
  assert.deepEqual(errors, []);
  const q = config.queues[0];
  assert.deepEqual([q.show, q.dropAs, q.hiddenStatuses, q.check], [7, 'skipped', ['done'], { command: ['node', 'check.js', '--strict'], cwd: 'tools' }]);
});

test('bad queues are skipped with a reason; bad options fall back', () => {
  const { config, errors } = norm([
    'text',
    { title: 'no id', file: 'a.md' },
    { id: 'a', file: 'a.md' },
    { id: 'a', file: 'b.md' },
    { id: 'abs', file: '/etc/passwd.md' },
    { id: 'txt', file: 'notes.txt' },
    { id: 'nofile' },
    { id: 'b', file: 'b.md', show: 0, dropAs: 'archive', hiddenStatuses: 'x', check: { command: 'node x' }, extra: 1 },
    { id: 'c', file: 'c.md', show: 99, check: 'node' },
  ]);
  assert.deepEqual(config.queues.map(q => q.id), ['a', 'b', 'c']);
  const text = errors.join('\n');
  for (const part of ['should be an object', '"id" is missing', 'used twice', '.md path relative', '"show"', '"dropAs"', '"hiddenStatuses"', 'check "command"', 'unknown key "extra"', '"check"']) {
    assert.ok(text.includes(part), `expected a problem mentioning ${part}\n${text}`);
  }
  const b = config.queues[1];
  assert.deepEqual([b.show, b.dropAs, b.check], [4, null, null]);
  assert.equal(b.title, 'b', 'the id stands in for a missing title');
});

test('"queues" that is not a list is one problem, not a throw', () => {
  const { config, errors } = normalizeHomeConfig({ version: 1, groups: [], queues: { id: 'x' } });
  assert.deepEqual(config.queues, []);
  assert.match(errors.join('\n'), /"queues" should be a list/);
});

test('the shipped example config has a valid bakery queue', () => {
  const { config, errors } = normalizeHomeConfig(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'home.config.example.json'), 'utf8')));
  assert.deepEqual(errors, []);
  assert.equal(config.queues.length, 1);
  assert.equal(config.queues[0].id, 'next-bakes');
});
