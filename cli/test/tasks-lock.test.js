/**
 * PRO38: concurrent `ch` writers must not overwrite each other (lost updates).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { acquireTasksLock, releaseTasksLock, withTasksLock, LOCK_FILE } from '../../shared/tasks-files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');

test('several CLI writers at once all land (no lost updates, unique ids)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-lock-test-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(dir, 'tasks.json'));
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).sections.reduce((n, s) => n + s.tasks.length, 0);
  const N = 16;
  const runs = Array.from({ length: N }, (_, i) => new Promise((resolve) => {
    const p = spawn(process.execPath, [CH_SCRIPT, 'tasks', 'add', '--no-project', `Writer ${i}`, '--json'], { env: { ...process.env, CH_HOME: dir } });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, err }));
  }));
  const results = await Promise.all(runs);
  for (const r of results) assert.equal(r.code, 0, r.err);
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
  const all = doc.sections.flatMap(s => s.tasks);
  assert.equal(all.length, before + N, 'every added ticket is in the file');
  assert.equal(new Set(all.map(t => t.id)).size, all.length, 'ids are unique');
  assert.equal(fs.existsSync(path.join(dir, LOCK_FILE)), false, 'lock released');
});

test('a stale lock is taken over; a fresh one makes acquire time out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-lock-test-'));
  const lock = path.join(dir, LOCK_FILE);
  fs.writeFileSync(lock, '999999');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  acquireTasksLock(dir);
  releaseTasksLock(dir);
  assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, '999999'); // fresh, held by "someone else"
  assert.throws(() => acquireTasksLock(dir, { waitMs: 50 }), /locked by another/);
  fs.rmSync(lock);
});

test('withTasksLock is re-entrant and releases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-lock-test-'));
  const out = withTasksLock(dir, () => withTasksLock(dir, () => 7));
  assert.equal(out, 7);
  assert.equal(fs.existsSync(path.join(dir, LOCK_FILE)), false);
});
