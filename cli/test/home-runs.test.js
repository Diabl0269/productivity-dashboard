/**
 * PRO122, PRO123: the "How it runs" config keys (automations, services, lifecycle), the two routes
 * GET /api/home/automations and /api/home/services (60 s cache, a slow reader answers "checking"), and
 * `ch tasks automations` on a throwaway CH_HOME. Synthetic bakery data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeHomeConfig } from '../../shared/home-config.js';
import { handleHomeRoute, homeRoutes } from '../../server/home-routes.js';
import { cachedStatus, clearStatusCache } from '../../server/home/status-cache.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXAMPLE = path.join(REPO_ROOT, 'home.config.example.json');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ch-home-runs-'));

const GROUPS = [{ id: 'kitchen', name: 'Kitchen', areas: [{ id: 'oven', name: 'Oven' }] }];

test('the example config validates with no problems and has rows of every kind', () => {
  const { config, errors } = normalizeHomeConfig(JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')));
  assert.deepEqual(errors, []);
  assert.ok(config.automations.length >= 3);
  assert.ok(config.automations.every(a => Array.isArray(a.status) && a.group));
  assert.ok(config.services.some(s => s.console && s.usedBy.length));
  assert.ok(config.lifecycle === null || Array.isArray(config.lifecycle.stages));
});

test('automations: kinds, groups, status sources (one or a list), problems in plain words', () => {
  const { config, errors } = normalizeHomeConfig({
    version: 1,
    groups: GROUPS,
    automations: [
      { id: 'bake-list', name: 'Bake list', what: 'Prints it', trigger: 'daily 18:00', kind: 'launchd', status: { type: 'launchctl', label: 'com.bakery.bakelist' }, mapBox: [1, 2] },
      { id: 'tick', name: 'Tick', kind: 'inside', group: 'Inside the oven loop', status: [{ type: 'log-tail', path: '~/oven.log', okPattern: 'OK', maxAgeMin: 30 }, { type: 'json-file', path: 'state/tick.json', okField: 'ok' }] },
      { id: 'hook', name: 'Hook', kind: 'hook' },
      { id: 'bad-kind', name: 'X', kind: 'rocket', status: { type: 'launchctl' } },
      { id: 'bad-status', name: 'Y', status: { type: 'gh-workflow', repo: 'not a repo', workflow: 'CI', extra: 1 } },
      { id: 'bad-age', name: 'Z', status: { type: 'mtime', path: '/x', maxAgeMin: -5, okPattern: '(' } },
      { id: 'web', name: 'W', status: { type: 'http', url: 'https://x.example/' } },
    ],
  });
  const has = (...p) => assert.ok(errors.some(e => p.every(x => e.includes(x))), `missing: ${p.join(' + ')}\n${errors.join('\n')}`);
  const a = Object.fromEntries(config.automations.map(x => [x.id, x]));
  assert.equal(a['bake-list'].group, 'Scheduled jobs');
  assert.deepEqual(a['bake-list'].status, [{ type: 'launchctl', label: 'com.bakery.bakelist' }]);
  assert.deepEqual(a['bake-list'].mapBox, [1, 2], 'keys for later features are kept');
  assert.equal(a.tick.group, 'Inside the oven loop');
  assert.equal(a.tick.status.length, 2);
  assert.equal(a.hook.group, 'Hooks');
  assert.deepEqual(a.hook.status, []);
  assert.equal(a['bad-kind'].kind, null);
  has('automation "bad-kind"', '"kind" should be one of');
  has('automation "bad-kind" > status', 'needs "label"');
  has('automation "bad-status" > status', 'unknown key "extra"');
  has('automation "bad-status" > status', '"repo" should be "owner/name"');
  has('automation "bad-age" > status', '"maxAgeMin" should be a number');
  has('automation "bad-age" > status', '"okPattern" is not a valid pattern');
  has('automation "web" > status', '"type" should be one of');
});

test('services: usedBy names known boxes, console must be a web address, never a secret in a status url', () => {
  const { config, errors } = normalizeHomeConfig({
    version: 1,
    groups: GROUPS,
    services: [
      { id: 'orders', name: 'Order API', what: 'Takes orders', usedBy: ['oven', 'nowhere'], console: 'https://console.example/orders', status: { type: 'http', url: 'https://orders.example/health' }, cost: { note: '5 a month' } },
      { id: 'leaky', name: 'Leaky', status: { type: 'http', url: 'https://x.example/?token=abc' }, console: 'javascript:alert(1)' },
      { id: 'plain', name: 'Plain', status: { type: 'http', url: 'http://orders.example/' } },
      { id: 'ci', name: 'CI', status: { type: 'gh-workflow', repo: 'bakery/site', workflow: 'CI' } },
      { id: 'log', name: 'Log', status: { type: 'log-tail', path: '/x.log' } },
    ],
  });
  const has = (...p) => assert.ok(errors.some(e => p.every(x => e.includes(x))), `missing: ${p.join(' + ')}\n${errors.join('\n')}`);
  const s = Object.fromEntries(config.services.map(x => [x.id, x]));
  assert.deepEqual(s.orders.usedBy, ['oven']);
  assert.equal(s.orders.cost, '5 a month');
  has('service "orders"', '"usedBy" names "nowhere"');
  assert.deepEqual(s.leaky.status, []);
  assert.equal(s.leaky.console, null);
  has('service "leaky" > status', 'must not hold a user, token, key or password');
  has('service "leaky"', '"console" should be a web address');
  has('service "plain" > status', 'should start with https://');
  assert.equal(s.ci.status.length, 1);
  has('service "log" > status', '"type" should be one of gh-workflow, http, json-file, none');
});

test('lifecycle (AGE199): stage links to a job, skill and page, checked against the automations', () => {
  const { config, errors } = normalizeHomeConfig({
    version: 1,
    automations: [{ id: 'autorun', name: 'Autorun', what: 'Starts runs.' }],
    lifecycle: { stages: [
      { id: 'ready', job: 'autorun', page: 'pages/workspace.md' },
      { id: 'running', job: 'ghost', skill: '.claude/skills/ship-task/SKILL.md' },
    ] },
  });
  assert.deepEqual(config.lifecycle.stages, [
    { id: 'ready', job: 'autorun', page: 'pages/workspace.md' },
    { id: 'running', skill: '.claude/skills/ship-task/SKILL.md' },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /stages\[1\]: "job" should be the id of an automation, got "ghost"/);
});

test('lifecycle (AGE199): the "where the AI runs" chain keeps known nodes and edges, drops the rest', () => {
  const { config, errors } = normalizeHomeConfig({
    version: 1,
    groups: [{ id: 'app', name: 'App', areas: [{ id: 'chat', name: 'Chat', box: [0, 0, 10, 10] }] }],
    lifecycle: { ai: {
      title: 'Where answers come from',
      nodes: [{ id: 'chat', name: 'Chat', what: 'Asks.', box: 'chat' }, { id: 'api', name: 'Backend', what: 'Calls.', box: 'nowhere' }, { id: 'chat' }, { id: 'model', name: 'Model', what: 'Answers.' }],
      edges: [{ from: 'chat', to: 'api', label: 'request' }, { from: 'api', to: 'model' }, { from: 'api', to: 'ghost' }],
    } },
  });
  const ai = config.lifecycle.ai;
  assert.equal(ai.title, 'Where answers come from');
  assert.deepEqual(ai.nodes.map(n => [n.id, n.box]), [['chat', 'chat'], ['api', null], ['model', null]]);
  assert.deepEqual(ai.edges, [{ from: 'chat', to: 'api', label: 'request' }, { from: 'api', to: 'model', label: null }]);
  assert.equal(errors.length, 3); // an unknown box, a duplicate node, an edge to a node that is not there
  assert.equal(normalizeHomeConfig({ version: 1, lifecycle: { stages: [] } }).config.lifecycle.ai, null);
});

test('lifecycle: relabels and hides known stages only', () => {
  const { config, errors } = normalizeHomeConfig({ version: 1, lifecycle: { stages: [{ id: 'ready', label: 'Queued' }, { id: 'filed', hide: true }, { id: 'warp' }, { id: 'done', hide: 'yes' }] } });
  assert.deepEqual(config.lifecycle.stages, [{ id: 'ready', label: 'Queued' }, { id: 'filed', hide: true }, { id: 'done' }]);
  assert.ok(errors.some(e => e.includes('stages[2]') && e.includes('"id" should be one of')));
  assert.ok(errors.some(e => e.includes('"hide" should be true or false')));
  assert.equal(normalizeHomeConfig({ version: 1 }).config.lifecycle, null);
  assert.ok(normalizeHomeConfig({ version: 1, lifecycle: [] }).errors[0].includes('"lifecycle" should be an object'));
});

/** A throwaway CH_HOME whose config.json points "bakery" at a config file in the same folder. */
function bakeryHome(extra = {}) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'tick.json'), JSON.stringify({ at: new Date().toISOString(), ok: true }));
  fs.writeFileSync(path.join(dir, 'oven.log'), `${new Date(Date.now() - 3 * 3600e3).toISOString()} ERROR oven too cold\n`);
  const cfg = {
    version: 1,
    title: 'Corner Bakery',
    groups: GROUPS,
    automations: [
      { id: 'tick', name: 'Oven tick', what: 'Checks the oven', trigger: 'every 10 min', kind: 'inside', status: { type: 'json-file', path: 'tick.json', okField: 'ok', maxAgeMin: 30 } },
      { id: 'oven-log', name: 'Oven log', what: 'Logs the oven', kind: 'launchd', status: { type: 'log-tail', path: 'oven.log', failPattern: 'ERROR' } },
      { id: 'by-hand', name: 'Stock count', what: 'Counted by hand', kind: 'skill' },
    ],
    services: [{ id: 'none', name: 'Payments', what: 'Card payments', console: 'https://pay.example/', status: { type: 'none' } }],
    ...extra,
  };
  const file = path.join(dir, 'home.config.json');
  fs.writeFileSync(file, JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ home: { bakery: file } }));
  return dir;
}

function call(dataRoot, urlPath) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, 'http://localhost');
    const res = {
      headersSent: false,
      writeHead(status) { this.status = status; this.headersSent = true; },
      end(text) { resolve({ status: this.status, body: JSON.parse(text) }); },
    };
    assert.equal(handleHomeRoute({ method: 'GET' }, res, url, { dataRoot }), true);
  });
}

test('the route table lists both status routes', () => {
  const paths = homeRoutes().map(r => r.path);
  assert.ok(paths.includes('/api/home/automations'));
  assert.ok(paths.includes('/api/home/services'));
});

test('GET /api/home/automations and /services: each entry with its result, relative paths against the config', async () => {
  clearStatusCache();
  const dir = bakeryHome();
  const r = await call(dir, '/api/home/automations?project=bakery');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.automations.map(a => [a.id, a.result]));
  assert.equal(by.tick.ok, true);
  assert.equal(by.tick.late, false);
  assert.equal(by['oven-log'].ok, false);
  assert.match(by['oven-log'].detail, /oven too cold/);
  assert.equal(by['by-hand'].ok, null);
  const s = await call(dir, '/api/home/services?project=bakery');
  assert.equal(s.body.services[0].console, 'https://pay.example/');
  assert.equal(s.body.services[0].result.ok, null);
  // ?fresh=1 bypasses the 60 s server status cache immediately
  fs.writeFileSync(path.join(dir, 'tick.json'), JSON.stringify({ at: new Date().toISOString(), ok: false }));
  assert.equal((await call(dir, '/api/home/automations?project=bakery')).body.automations.find(a => a.id === 'tick').result.ok, true);
  assert.equal((await call(dir, '/api/home/automations?project=bakery&fresh=1')).body.automations.find(a => a.id === 'tick').result.ok, false);
  assert.equal((await call(dir, '/api/home/automations?project=../etc')).status, 400);
  const missing = await call(tmp(), '/api/home/automations?project=bakery');
  assert.equal(missing.body.missing, true);
  assert.deepEqual(missing.body.automations, []);
});

test('a slow reader answers "checking" and fills in later; the answer is cached for a minute', async () => {
  clearStatusCache();
  // Cached: a file that changes inside the minute is not read again; with no cache it is.
  const dir = tmp();
  const file = path.join(dir, 'x.json');
  fs.writeFileSync(file, JSON.stringify({ at: '2026-06-15T10:00:00Z' }));
  const entries = [{ id: 'x', status: [{ type: 'json-file', path: 'x.json' }] }];
  const first = await cachedStatus('automations', 'bakery', entries, { baseDir: dir });
  assert.equal(first[0].result.lastRun, '2026-06-15T10:00:00.000Z');
  fs.writeFileSync(file, JSON.stringify({ at: '2026-06-15T11:00:00Z' }));
  assert.equal((await cachedStatus('automations', 'bakery', entries, { baseDir: dir }))[0].result.lastRun, '2026-06-15T10:00:00.000Z');
  assert.equal((await cachedStatus('automations', 'bakery', entries, { baseDir: dir, ttlMs: 0 }))[0].result.lastRun, '2026-06-15T11:00:00.000Z');

  clearStatusCache();
  const hang = tmp();
  const bin = path.join(hang, 'launchctl');
  fs.writeFileSync(bin, '#!/bin/sh\nsleep 1\nprintf "\\tstate = not running\\n\\tlast exit code = 0\\n"\n');
  fs.chmodSync(bin, 0o755);
  const list = [{ id: 'quick', status: [{ type: 'none' }] }, { id: 'sleepy', status: [{ type: 'launchctl', label: 'com.bakery.sleepy' }] }];
  const t = Date.now();
  const early = await cachedStatus('automations', 'slow-test', list, { baseDir: hang, waitMs: 100, readOpts: { launchctl: bin } });
  assert.ok(Date.now() - t < 900, 'did not wait for the slow reader');
  assert.equal(early[0].result.ok, null);
  assert.equal(early[0].result.checking, undefined);
  assert.equal(early[1].result.checking, true);
  await new Promise(r => setTimeout(r, 1300));
  const later = await cachedStatus('automations', 'slow-test', list, { baseDir: hang, waitMs: 100, readOpts: { launchctl: bin } });
  assert.equal(later[1].result.checking, undefined);
  assert.equal(later[1].result.ok, true);
});

test('ch tasks automations prints every row with its state, and --json gives the same data', () => {
  clearStatusCache();
  const dir = bakeryHome();
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'cli/index.js'), 'tasks', 'automations', ...args], { encoding: 'utf8', env: { ...process.env, CH_HOME: dir } });
  const text = run('--project', 'bakery');
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Corner Bakery/);
  assert.match(text.stdout, /Inside another job:\n {2}ok +Oven tick/);
  assert.match(text.stdout, /failed +Oven log/);
  assert.match(text.stdout, /unknown +Stock count/);
  assert.match(text.stdout, /Services:\n {2}unknown +Payments/);
  const json = JSON.parse(run('--json').stdout);
  assert.equal(json.project, 'bakery');
  assert.deepEqual(json.automations.map(a => a.state), ['ok', 'failed', 'unknown']);
  assert.equal(json.services[0].state, 'unknown');
  const none = spawnSync(process.execPath, [path.join(REPO_ROOT, 'cli/index.js'), 'tasks', 'automations'], { encoding: 'utf8', env: { ...process.env, CH_HOME: tmp() } });
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /no home config/);
});
