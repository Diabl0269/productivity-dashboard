/**
 * GET /api/home/running (server/home/running-route.js, PRO117): project config -> repos -> readers ->
 * computeRunning, cached 15 s, never throws. Throwaway CH_HOME and HOME (so no real session or tick is read).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleHomeRoute, homeRoutes } from '../../server/home-routes.js';
import { clearRunningCache, buildRunning } from '../../server/home/running-route.js';

const realHome = process.env.HOME;
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-run-home-'));
process.env.HOME = fakeHome;
after(() => { process.env.HOME = realHome; });

const PROMPT = JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: '/ship-task BKR12' } });

function setup({ repos = [], withSession = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ch-run-route-')));
  const cfgFile = path.join(dir, 'home.config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ version: 1, title: 'Bakery', repos, groups: [] }));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ home: { bakery: cfgFile } }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({
    version: 1,
    meta: {},
    sections: [{
      id: 'in-progress',
      name: 'In progress',
      tasks: [
        { id: 'BKR10', title: 'Online ordering', type: 'epic', project: 'bakery', checked: false },
        { id: 'BKR12', title: 'Cart page', type: 'task', parentId: 'BKR10', project: 'bakery', checked: false },
      ],
    }],
  }));
  if (withSession) {
    const proj = path.join(fakeHome, '.claude', 'projects', 'bakery');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 's1.jsonl'), PROMPT + '\n');
  }
  return dir;
}

function call(dataRoot, urlPath) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, 'http://localhost');
    const res = {
      headersSent: false,
      writeHead(status) { this.status = status; this.headersSent = true; },
      end(text) { resolve({ status: this.status, body: text ? JSON.parse(text) : null }); },
    };
    if (!handleHomeRoute({ method: 'GET' }, res, url, { dataRoot, corsHeaders: {} })) resolve({ handled: false });
  });
}

test('the route table lists /api/home/running', () => {
  assert.ok(homeRoutes().some(r => r.method === 'GET' && r.path === '/api/home/running'));
});

test('a live session naming a ticket shows as running under its epic', async () => {
  clearRunningCache();
  const dir = setup();
  const { status, body } = await call(dir, '/api/home/running?project=bakery');
  assert.equal(status, 200);
  assert.equal(body.project, 'bakery');
  assert.deepEqual(body.running.map(r => [r.id, r.epicId, r.state]), [['BKR12', 'BKR10', 'working']]);
  assert.equal(body.epics.BKR10.state, 'running');
  assert.deepEqual(body.warnings, []);
});

test('the answer is cached for 15 s per project', async () => {
  clearRunningCache();
  const dir = setup();
  const a = await call(dir, '/api/home/running?project=bakery');
  fs.rmSync(path.join(fakeHome, '.claude', 'projects', 'bakery'), { recursive: true });
  const b = await call(dir, '/api/home/running?project=bakery');
  assert.equal(b.body.at, a.body.at);
  assert.equal(b.body.running.length, 1);
  clearRunningCache();
  const c = await call(dir, '/api/home/running?project=bakery');
  assert.equal(c.body.running.length, 0);
});

test('a missing repo folder is a warning, not an error; the rest is still answered', async () => {
  clearRunningCache();
  const dir = setup({ repos: ['./not-there'], withSession: true });
  const { status, body } = await call(dir, '/api/home/running?project=bakery');
  assert.equal(status, 200);
  assert.equal(body.running.length, 1);
  assert.match(body.warnings.join(' '), /not-there/);
});

test('no project entry, an unreadable tasks file or a bad slug never throws', async () => {
  clearRunningCache();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-run-empty-'));
  const out = await buildRunning(empty, null);
  assert.deepEqual(out.running, []);
  assert.ok(out.warnings.length >= 1);
  const bad = await call(setup(), '/api/home/running?project=a%2Fb');
  assert.equal(bad.status, 400);
});

test('a reader that throws still answers (no throw) with the rest and a warning', async () => {
  clearRunningCache();
  const dir = setup();
  const out = await buildRunning(dir, 'bakery', Date.now(), async () => { throw new Error('git exploded'); });
  assert.equal(out.running.length, 1, 'the partial readers still found the session');
  assert.match(out.warnings.join(' '), /live-work sources could not be read \(git exploded\)/);
  assert.equal(out.project, 'bakery');
});
