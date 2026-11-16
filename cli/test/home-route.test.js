/**
 * GET /api/home (server/home-routes.js + server/home/config-route.js): config found, missing,
 * invalid, and paths that are not allowed; then once through a real serve.js on a throwaway CH_HOME.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleHomeRoute, homeRoutes } from '../../server/home-routes.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXAMPLE = path.join(REPO_ROOT, 'home.config.example.json');

function tmpHome(homeMap) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-home-route-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(homeMap === undefined ? {} : { home: homeMap }));
  return dir;
}

/** Call the route table with a fake request/response; resolves { handled, status, body }. */
function call(dataRoot, urlPath, method = 'GET') {
  return new Promise((resolve) => {
    const url = new URL(urlPath, 'http://localhost');
    const res = {
      headersSent: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
      end(text) { resolve({ handled: true, status: this.status, headers: this.headers, body: text ? JSON.parse(text) : null }); },
    };
    const handled = handleHomeRoute({ method }, res, url, { dataRoot, corsHeaders: { 'Access-Control-Allow-Origin': '*' } });
    if (!handled) resolve({ handled: false });
  });
}

test('the route table lists GET /api/home', () => {
  assert.deepEqual(homeRoutes(), [{ method: 'GET', path: '/api/home' }]);
});

test('config found: the project config, validated, with no errors', async () => {
  const dir = tmpHome({ bakery: EXAMPLE });
  const r = await call(dir, '/api/home?project=bakery');
  assert.equal(r.status, 200);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(r.body.project, 'bakery');
  assert.deepEqual(r.body.projects, ['bakery']);
  assert.equal(r.body.path, EXAMPLE);
  assert.equal(r.body.missing, false);
  assert.deepEqual(r.body.errors, []);
  assert.equal(r.body.config.title, 'Corner Bakery');
  // No project asked: the first configured one.
  const first = await call(dir, '/api/home');
  assert.equal(first.body.project, 'bakery');
  assert.equal(first.body.config.groups.length, 2);
});

test('config missing: no home key, or no entry for the project', async () => {
  for (const [map, query] of [[undefined, ''], [{}, '?project=bakery'], [{ bakery: EXAMPLE }, '?project=cafe']]) {
    const r = await call(tmpHome(map), `/api/home${query}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.missing, true, JSON.stringify(map));
    assert.equal(r.body.config, null);
    assert.deepEqual(r.body.errors, []);
  }
  const noConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-home-route-'));
  assert.equal((await call(noConfig, '/api/home?project=bakery')).body.missing, true);
});

test('config invalid: bad JSON, a missing file, or bad keys come back as plain-words errors', async () => {
  const dir = tmpHome({});
  const bad = path.join(dir, 'broken.json');
  fs.writeFileSync(bad, '{ "version": 1, ');
  const partial = path.join(dir, 'partial.json');
  fs.writeFileSync(partial, JSON.stringify({ version: 1, groups: [{ id: 'shop', name: 'Shop', areas: [{ id: 'till', name: 'Till', box: 'big' }] }] }));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ home: { broken: bad, gone: path.join(dir, 'gone.json'), partial } }));

  let r = await call(dir, '/api/home?project=broken');
  assert.equal(r.body.config, null);
  assert.match(r.body.errors[0], /broken\.json is not valid JSON/);

  r = await call(dir, '/api/home?project=gone');
  assert.equal(r.body.config, null);
  assert.match(r.body.errors[0], /points at .*gone\.json, which does not exist/);

  r = await call(dir, '/api/home?project=partial');
  assert.equal(r.body.config.groups[0].areas[0].box, null);
  assert.equal(r.body.errors.length, 1);
  assert.match(r.body.errors[0], /area "till": "box" should be four numbers/);

  fs.writeFileSync(path.join(dir, 'config.json'), '{ nope');
  r = await call(dir, '/api/home?project=partial');
  assert.equal(r.body.missing, true);
  assert.match(r.body.errors[0], /tracker config\.json could not be read/);
});

test('paths that are not allowed: relative, not .json, and a slug that is not a slug', async () => {
  const dir = tmpHome({ rel: 'home.config.json', up: '../../etc/passwd', notjson: '/etc/passwd', blank: '' });
  for (const slug of ['rel', 'up', 'notjson', 'blank']) {
    const r = await call(dir, `/api/home?project=${slug}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.config, null, slug);
    assert.equal(r.body.path, null, slug);
    assert.match(r.body.errors[0], /config\.json "home" > ".*" should/, slug);
  }
  for (const slug of ['../etc', 'a/b', '%2e%2e', '.hidden']) {
    const r = await call(dir, `/api/home?project=${encodeURIComponent(slug)}`);
    assert.equal(r.status, 400, slug);
    assert.match(r.body.error, /is not a project slug/);
  }
});

test('other methods get a 405 and unknown /api/home paths are left to serve.js', async () => {
  const dir = tmpHome({ bakery: EXAMPLE });
  assert.equal((await call(dir, '/api/home', 'POST')).status, 405);
  assert.deepEqual(await call(dir, '/api/home/nothing-here'), { handled: false });
});

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const get = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
  }).on('error', reject);
});

test('serve.js hands /api/home to the route table', async () => {
  const dir = tmpHome({ bakery: EXAMPLE });
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'serve.js'), String(port)], { env: { ...process.env, CH_HOME: dir }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      try { await get(port, '/api/memory-manifest'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    const r = await get(port, '/api/home?project=bakery');
    assert.equal(r.status, 200, r.body);
    assert.equal(JSON.parse(r.body).config.title, 'Corner Bakery');
    assert.equal((await get(port, '/api/home?project=..%2Fx')).status, 400);
    assert.equal((await get(port, '/api/home/nothing-here')).status, 404);
  } finally {
    child.kill();
  }
});
