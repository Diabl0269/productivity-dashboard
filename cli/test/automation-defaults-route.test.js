import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import route from '../../server/home/automation-defaults-route.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-defaults-'));
  const home = path.join(dir, 'home.config.json');
  fs.writeFileSync(home, JSON.stringify({ automations: [
    { id: 'enabled-job', kind: 'launchd', status: [], run: { schedule: { hour: 8, minute: 0 } } },
    { id: 'disabled-job', kind: 'launchd', status: [], run: { schedule: { hour: 9, minute: 0 }, enabled: false } },
  ] }));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ home: { test: home } }));
  return { dir, home };
}

function call(body, deps) {
  return route.handle({ req: { headers: { 'content-type': 'application/json' } }, url: new URL('http://local/api/home/automation-defaults?project=test'), deps: { ...deps, readBody: async () => JSON.stringify(body) } });
}

test('defaults save applies to enabled LaunchAgents and leaves disabled jobs unloaded', async () => {
  const { dir, home } = setup();
  const jobs = [];
  const out = await call({ harness: 'claude', model: 'sonnet', effort: 'high', cli: 'claude', arguments: ['--permission-mode', 'bypassPermissions'], runner: '~/runner.sh' }, {
    dataRoot: dir, root: process.cwd(), installLaunchAgent: async job => { jobs.push(job); return { loaded: true }; },
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'enabled-job');
  assert.equal(jobs[0].effort, 'high');
  assert.equal(jobs[0].harness, 'claude');
  assert.equal(jobs[0].cli, 'claude');
  assert.deepEqual(jobs[0].arguments, ['--permission-mode', 'bypassPermissions']);
  assert.equal(JSON.parse(fs.readFileSync(home, 'utf8')).automationDefaults.model, 'sonnet');
  assert.deepEqual(out.body.warnings, []);
});

test('defaults route rolls back if a LaunchAgent fails to reload', async () => {
  const { dir, home } = setup();
  const before = fs.readFileSync(home, 'utf8');
  await assert.rejects(() => call({ model: 'github-copilot/mai-code-2' }, {
    dataRoot: dir, root: process.cwd(), installLaunchAgent: async () => { throw new Error('no launchd'); },
  }), /nothing was saved/);
  assert.equal(fs.readFileSync(home, 'utf8'), before);
});
