/**
 * cli/test/autorun-serve.test.js: GET/POST /api/autorun on a real serve.js with a throwaway CH_HOME
 * (never ~/.productivity-dashboard).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { 'Content-Type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)));
  });
}

test('serve.js: /api/autorun reads defaults, validates, merge-writes autorun.json and toggles autorun.off', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-autorun-serve-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), path.join(dir, 'tasks.json'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{}');
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'serve.js'), String(port)], { env: { ...process.env, CH_HOME: dir }, stdio: 'ignore' });
  const file = path.join(dir, 'autorun.json');
  const offFile = path.join(dir, 'autorun.off');
  try {
    for (let i = 0; i < 50; i++) {
      try { await request(port, 'GET', '/api/memory-manifest'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    // Missing file: all defaults, switch on.
    let r = await request(port, 'GET', '/api/autorun');
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(JSON.parse(r.body), { settings: { maxRuns: 6, maxTotal: 8, paceStop: 0.85, reviewCap: 8, maxStarts: 2, finishedIdleMin: 90 }, off: false });
    assert.equal(fs.existsSync(file), false);

    // Invalid input: 400, nothing written.
    for (const bad of [{ maxRuns: 0 }, { paceStop: 2 }, { maxTotal: 'x' }, { off: 'yes' }, '{not json']) {
      r = await request(port, 'POST', '/api/autorun', bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.ok(JSON.parse(r.body).error);
    }
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(offFile), false);

    // Merge-write keeps unknown keys; null maxTotal = no manual cap.
    fs.writeFileSync(file, JSON.stringify({ maxRuns: 4, keepMe: { a: 1 } }));
    r = await request(port, 'POST', '/api/autorun', { maxTotal: null, reviewCap: 0 });
    assert.equal(r.status, 200, r.body);
    const out = JSON.parse(r.body);
    assert.equal(out.settings.maxRuns, 4);
    assert.equal(out.settings.maxTotal, null);
    assert.equal(out.settings.reviewCap, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { maxRuns: 4, keepMe: { a: 1 }, maxTotal: null, reviewCap: 0 });
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);

    // Kill switch.
    r = await request(port, 'POST', '/api/autorun', { off: true });
    assert.equal(JSON.parse(r.body).off, true);
    assert.equal(fs.existsSync(offFile), true);
    r = await request(port, 'GET', '/api/autorun');
    assert.equal(JSON.parse(r.body).off, true);
    r = await request(port, 'POST', '/api/autorun', { off: false, maxRuns: 2 });
    assert.equal(JSON.parse(r.body).off, false);
    assert.equal(JSON.parse(r.body).settings.maxRuns, 2);
    assert.equal(fs.existsSync(offFile), false);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
