import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchForCodeChanges, RELOAD_EXIT_CODE } from '../../server/autoreload.js';

test('autoreload: a burst of code changes exits once with 75; non-code files are ignored', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-autoreload-'));
  fs.mkdirSync(path.join(root, 'server'));
  fs.writeFileSync(path.join(root, 'serve.js'), '');
  const codes = [];
  const server = { close: cb => cb(), closeIdleConnections() {} };
  const w = watchForCodeChanges({ root, server, pollMs: 50, quietMs: 150, exit: c => codes.push(c), log() {}, check: false });
  try {
    fs.writeFileSync(path.join(root, 'server', 'notes.txt'), 'x');
    await new Promise(r => setTimeout(r, 400));
    assert.deepEqual(codes, []);
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, 'server', `m${i}.js`), String(i));
    await new Promise(r => setTimeout(r, 600));
    assert.equal(codes.length, 1);
    assert.equal(codes[0], RELOAD_EXIT_CODE);
  } finally { w.close(); }
});
