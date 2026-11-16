import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSite, commit } from './fixtures/home-pages-site.js';

const CH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ch');
const ch = (dataRoot, args) => spawnSync('node', [CH, 'tasks', 'pages', ...args], { env: { ...process.env, CH_HOME: dataRoot }, encoding: 'utf8' });

function site() {
  const s = makeSite();
  commit(s.repo, 'till/a.js', '2026-11-01');
  commit(s.repo, 'till/b.js', '2026-11-05', 'later');
  return s;
}

test('every box: has a page / stale / missing / no page set', () => {
  const s = site();
  fs.rmSync(path.join(s.site, 'pages/oven.md'));
  const r = ch(s.dataRoot, ['--project', 'bakery']);
  assert.equal(r.status, 0, r.stderr);
  const line = (id) => r.stdout.split('\n').find(l => l.startsWith(id));
  assert.match(line('counter'), /STALE\s+stale \(1 commit, newest 2026-11-05; pages\/counter\.md\)/);
  assert.match(line('oven'), /MISSING\s+missing \(pages\/oven\.md does not exist\)/);
  assert.match(line('display'), /no page set \(add "page": "pages\/display\.md"\)/);
  assert.match(line('kitchen'), /no page set/);
});

test('--stale keeps only the stale ones; a page with no change is "has a page"', () => {
  const s = site();
  const r = ch(s.dataRoot, ['--stale']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.match(r.stdout, /^counter/);
  const all = ch(s.dataRoot, []);
  assert.match(all.stdout, /oven\s+ok\s+has a page \(pages\/oven\.md\)/);
});

test('--json prints the rows', () => {
  const s = site();
  const out = JSON.parse(ch(s.dataRoot, ['--json']).stdout);
  assert.equal(out.project, 'bakery');
  const counter = out.pages.find(p => p.box === 'counter');
  assert.equal(counter.state, 'stale');
  assert.equal(counter.count, 1);
  assert.equal(out.pages.find(p => p.box === 'display').state, 'none');
  assert.equal(JSON.parse(ch(s.dataRoot, ['--json', '--stale']).stdout).pages.length, 1);
});

test('no home config: a plain-words failure, nothing written', () => {
  const s = makeSite();
  fs.writeFileSync(path.join(s.dataRoot, 'config.json'), '{}');
  const r = ch(s.dataRoot, []);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No project has a Home config/);
});
