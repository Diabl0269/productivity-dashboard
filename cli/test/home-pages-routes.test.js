/**
 * The page routes (server/home/page-route.js, pages-route.js, page-file-route.js) and the path
 * rules behind them (server/home/page-paths.js): what is served, what is refused, and the headers
 * that keep a diagram from running script. A real serve.js answers the encoded-traversal cases.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleHomeRoute, homeRoutes } from '../../server/home-routes.js';
import { resolveInside, PAGE_EXTS, IMAGE_EXTS } from '../../server/home/page-paths.js';
import { clearStalenessCache } from '../lib/page-staleness.js';
import { makeSite, commit } from './fixtures/home-pages-site.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function call(dataRoot, urlPath) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, 'http://localhost');
    const res = {
      headersSent: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
      end(data) {
        const text = data == null ? '' : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        let body = null;
        try { body = JSON.parse(text); } catch { /* an image */ }
        resolve({ status: this.status, headers: this.headers, body, text });
      },
    };
    if (!handleHomeRoute({ method: 'GET' }, res, url, { dataRoot, corsHeaders: {} })) resolve({ handled: false });
  });
}

function siteWithHistory() {
  const s = makeSite();
  commit(s.repo, 'till/a.js', '2026-11-01');
  commit(s.repo, 'till/b.js', '2026-11-05', 'a later till change');
  commit(s.repo, 'receipts.js', '2026-11-06', 'a later receipt change');
  clearStalenessCache();
  return s;
}
const pageUrl = (box) => `/api/home/page?project=bakery&box=${box}`;
const fileUrl = (p) => `/api/home/page-file?project=bakery&path=${encodeURIComponent(p)}`;

test('the route table lists the three page routes', () => {
  const list = homeRoutes().map(r => `${r.method} ${r.path}`);
  for (const r of ['GET /api/home/page', 'GET /api/home/pages', 'GET /api/home/page-file']) assert.ok(list.includes(r), r);
});

test('a page: front matter split off, covers, image base and staleness with its commits', async () => {
  const { dataRoot } = siteWithHistory();
  const r = await call(dataRoot, pageUrl('counter'));
  assert.equal(r.status, 200);
  assert.equal(r.body.box, 'counter');
  assert.equal(r.body.title, 'Counter and till: how a sale is rung up');
  assert.equal(r.body.updated, '2026-11-03');
  assert.deepEqual(r.body.covers, ['bakery-orders/till/**', 'bakery-orders/receipts.js']);
  assert.equal(r.body.imageBase, 'pages');
  assert.ok(r.body.markdown.startsWith('\n## What it is'));
  assert.doesNotMatch(r.body.markdown, /^---/m);
  assert.equal(r.body.stale.count, 2);
  assert.equal(r.body.stale.newest, '2026-11-06');
  assert.deepEqual(r.body.stale.commits.map(c => c.subject), ['a later receipt change', 'a later till change']);
  assert.deepEqual(r.body.problems, []);
});

test('a page nobody changed code under is not stale; the pages map gave "oven" its page', async () => {
  const { dataRoot } = siteWithHistory();
  const r = await call(dataRoot, pageUrl('oven'));
  assert.equal(r.status, 200);
  assert.equal(r.body.page, 'pages/oven.md');
  assert.equal(r.body.stale, null);
});

test('a box with no page says so and names the file and the template; a missing file says where it expected it', async () => {
  const s = siteWithHistory();
  const none = await call(s.dataRoot, pageUrl('display'));
  assert.equal(none.body.none, true);
  assert.equal(none.body.expectedPath, 'pages/display.md');
  assert.equal(none.body.template, 'pages/_template.md');
  fs.rmSync(path.join(s.site, 'pages', 'oven.md'));
  const gone = await call(s.dataRoot, pageUrl('oven'));
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body.missing, { expectedPath: 'pages/oven.md' });
});

test('bad requests: no box, unknown box, bad slug, no config', async () => {
  const { dataRoot } = siteWithHistory();
  assert.equal((await call(dataRoot, '/api/home/page?project=bakery')).status, 400);
  assert.equal((await call(dataRoot, pageUrl('nope'))).status, 404);
  assert.equal((await call(dataRoot, '/api/home/page?project=../x&box=oven')).status, 400);
  assert.equal((await call(dataRoot, '/api/home/page?project=other&box=oven')).status, 404);
});

test('the summary: one row per box with its state', async () => {
  const s = siteWithHistory();
  fs.rmSync(path.join(s.site, 'pages', 'oven.md'));
  const r = await call(s.dataRoot, '/api/home/pages?project=bakery');
  const by = Object.fromEntries(r.body.pages.map(p => [p.box, p]));
  assert.equal(by.counter.state, 'stale');
  assert.equal(by.counter.count, 2);
  assert.equal(by.oven.state, 'missing');
  assert.equal(by.display.state, 'none');
  assert.equal(by.proofing.state, 'none');
  assert.equal(by.shop.state, 'none');
  assert.equal(by.proofing.parent, 'oven');
});

// ----- images -----

test('an image: served with the headers that keep an SVG from running anything', async () => {
  const { dataRoot, site } = siteWithHistory();
  const r = await call(dataRoot, fileUrl('pages/img/counter-sale.svg'));
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'image/svg+xml');
  assert.equal(r.headers['Content-Security-Policy'], "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(r.text, fs.readFileSync(path.join(site, 'pages/img/counter-sale.svg'), 'utf8'));
  fs.writeFileSync(path.join(site, 'pages/img/p.png'), Buffer.from([137, 80, 78, 71]));
  assert.equal((await call(dataRoot, fileUrl('pages/img/p.png'))).headers['Content-Type'], 'image/png');
});

test('path safety: ..  absolute  backslash  NUL  hidden  wrong type  directory  missing', async () => {
  const s = siteWithHistory();
  fs.writeFileSync(path.join(s.root, 'secret.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>'); // beside the site folder
  fs.writeFileSync(path.join(s.site, 'pages/img/.hidden.svg'), '<svg/>');
  fs.mkdirSync(path.join(s.site, 'pages/img/dir.svg'));
  const status = async (p) => (await call(s.dataRoot, fileUrl(p))).status;
  assert.equal(await status('../secret.svg'), 403);
  assert.equal(await status('pages/../../secret.svg'), 403);
  assert.equal(await status('pages/img/../../../secret.svg'), 403);
  assert.equal(await status('..\\secret.svg'), 403);
  assert.equal(await status(path.join(s.root, 'secret.svg')), 403, 'an absolute path');
  assert.equal(await status('/etc/hosts.svg'), 403);
  assert.equal(await status('C:\\secret.svg'), 403);
  assert.equal(await status('pages/img/a\0.svg'), 400);
  assert.equal(await status('pages/img/.hidden.svg'), 403);
  assert.equal(await status('pages/counter.md'), 415, 'a page is not an image');
  assert.equal(await status('home.config.json'), 415, 'the config is not an image');
  assert.equal(await status('pages/img/dir.svg'), 404);
  assert.equal(await status('pages/img/none.svg'), 404);
  assert.equal(await status(''), 400);
  assert.equal((await call(s.dataRoot, '/api/home/page-file?project=bakery')).status, 400);
});

test('path safety: a symlink that leads out of the folder is refused, one that stays inside works', async () => {
  const s = siteWithHistory();
  fs.writeFileSync(path.join(s.root, 'secret.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.mkdirSync(path.join(s.root, 'outside'));
  fs.writeFileSync(path.join(s.root, 'outside', 'leak.svg'), '<svg/>');
  fs.symlinkSync(path.join(s.root, 'secret.svg'), path.join(s.site, 'pages/img/link.svg'));
  fs.symlinkSync(path.join(s.root, 'outside'), path.join(s.site, 'pages/linked-dir'));
  fs.symlinkSync(path.join(s.site, 'pages/img/counter-sale.svg'), path.join(s.site, 'pages/img/inside.svg'));
  const status = async (p) => (await call(s.dataRoot, fileUrl(p))).status;
  assert.equal(await status('pages/img/link.svg'), 403);
  assert.equal(await status('pages/linked-dir/leak.svg'), 403);
  assert.equal(await status('pages/img/inside.svg'), 200);
});

test('path safety: a page file that is a symlink to outside is refused too', async () => {
  const s = siteWithHistory();
  fs.writeFileSync(path.join(s.root, 'elsewhere.md'), '---\ntitle: x\n---\nsecret');
  fs.rmSync(path.join(s.site, 'pages/oven.md'));
  fs.symlinkSync(path.join(s.root, 'elsewhere.md'), path.join(s.site, 'pages/oven.md'));
  const r = await call(s.dataRoot, pageUrl('oven'));
  assert.equal(r.status, 403);
  assert.doesNotMatch(r.text, /secret/);
});

test('resolveInside: only the listed extensions, size cap, and the config folder as the root', () => {
  const s = makeSite();
  assert.equal(resolveInside(s.site, 'pages/counter.md', PAGE_EXTS, 1e6).ok, true);
  assert.equal(resolveInside(s.site, 'pages/counter.md', IMAGE_EXTS, 1e6).status, 415);
  assert.equal(resolveInside(s.site, 'pages/img/counter-sale.svg', PAGE_EXTS, 1e6).status, 415);
  assert.equal(resolveInside(s.site, 'pages/counter.md', PAGE_EXTS, 10).status, 413);
  assert.equal(resolveInside(s.site, 'pages/nothing.md', PAGE_EXTS, 1e6).status, 404);
  assert.equal(resolveInside(path.join(s.root, 'gone'), 'x.md', PAGE_EXTS, 1e6).status, 404);
  assert.equal(resolveInside(s.site, 5, PAGE_EXTS, 1e6).status, 400);
});

// ----- a real serve.js: encoded traversal over HTTP -----

const freePort = () => new Promise(resolve => { const sv = net.createServer(); sv.listen(0, () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });
const get = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
  }).on('error', reject);
});

test('through a real server: headers, and encoded or double-encoded traversal never leaks a file', async () => {
  const s = siteWithHistory();
  fs.writeFileSync(path.join(s.root, 'secret.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><!--SECRET--></svg>');
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'serve.js'), String(port)], { env: { ...process.env, CH_HOME: s.dataRoot }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try { await get(port, '/api/home?project=bakery'); up = true; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, 'the server started');
    const ok = await get(port, '/api/home/page-file?project=bakery&path=pages/img/counter-sale.svg');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['content-type'], 'image/svg+xml');
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    assert.match(ok.headers['content-security-policy'], /sandbox/);
    for (const p of ['%2e%2e%2fsecret.svg', '..%2fsecret.svg', '%2e%2e/secret.svg', '%252e%252e%252fsecret.svg', 'pages%2f..%2f..%2fsecret.svg', '%2fetc%2fhosts.svg']) {
      const r = await get(port, `/api/home/page-file?project=bakery&path=${p}`);
      assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.doesNotMatch(r.body, /SECRET/);
    }
    const page = await get(port, '/api/home/page?project=bakery&box=counter');
    assert.equal(page.status, 200);
    assert.equal(JSON.parse(page.body).stale.count, 2);
  } finally {
    child.kill();
  }
});
