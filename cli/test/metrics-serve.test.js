/**
 * cli/test/metrics-serve.test.js: GET /api/metrics and POST /api/metrics/collect on a real serve.js
 * with a throwaway CH_HOME (never ~/.productivity-dashboard).
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
import { METRICS_SCHEMA } from '../../shared/metrics-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
function request(port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serve.js: /api/metrics returns the payload; since and project are honoured; collect runs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-metrics-serve-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), path.join(dir, 'tasks.json'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{}');
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'serve.js'), String(port)], { env: { ...process.env, CH_HOME: dir }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      try { await request(port, 'GET', '/api/memory-manifest'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    const r = await request(port, 'GET', '/api/metrics?since=7d');
    assert.equal(r.status, 200, r.body);
    const p = JSON.parse(r.body);
    assert.deepEqual(Object.keys(p), ['schema', 'serverStartedAt', 'generatedAt', 'window', 'filters', 'flow', 'sessions', 'health', 'quality', 'costs', 'estimates', 'timings', 'next', 'insights', 'sources']);
    // PRO88: the payload names its shape and when the server's code was loaded, so a stale server is detectable.
    assert.equal(p.schema, METRICS_SCHEMA);
    assert.ok(Number.isFinite(Date.parse(p.serverStartedAt)));
    const days = (Date.parse(p.window.until) - Date.parse(p.window.since)) / 86400000;
    assert.ok(Math.abs(days - 7) < 0.01);
    const iso = await request(port, 'GET', '/api/metrics?since=2026-01-01T00:00:00Z');
    assert.equal(JSON.parse(iso.body).window.since, '2026-01-01T00:00:00.000Z');
    const proj = p.filters.projects[0];
    if (proj) assert.equal(JSON.parse((await request(port, 'GET', `/api/metrics?project=${proj}`)).body).filters.project, proj);
    assert.equal((await request(port, 'GET', '/api/metrics?since=soon')).status, 400);
    assert.equal((await request(port, 'GET', '/api/metrics/collect')).status, 405);
    const c = await request(port, 'POST', '/api/metrics/collect');
    assert.equal(c.status, 200, c.body);
    const out = JSON.parse(c.body);
    assert.equal(out.ok, true);
    assert.ok(Array.isArray(out.lines) && out.lines.length >= 1);
    assert.ok(fs.existsSync(path.join(dir, 'metrics')));
  } finally {
    child.kill();
  }
});
