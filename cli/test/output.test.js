/**
 * cli/test/output.test.js
 * A reader that closes the pipe early (`ch ... | head -1`) must not crash ch
 * with an unhandled EPIPE stack trace.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const FIXTURE = path.join(__dirname, 'fixtures/tasks.sample.json');

test('ch output piped into head exits quietly (no EPIPE crash)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-epipe-'));
  const data = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  // Output far larger than a pipe buffer, so writes continue after head exits.
  const task = data.sections[0].tasks[0];
  task.description = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join('\n');
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(data));

  const r = spawnSync('/bin/sh', ['-c', `"${process.execPath}" "${CH_SCRIPT}" tasks get ${task.id} | head -1`], {
    env: { ...process.env, CH_HOME: home },
    encoding: 'utf8',
  });
  fs.rmSync(home, { recursive: true, force: true });

  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1);
  assert.doesNotMatch(r.stderr, /EPIPE|Unhandled 'error'/);
});
