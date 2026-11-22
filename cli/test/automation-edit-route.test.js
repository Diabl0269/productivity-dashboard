import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import route from '../../server/home/automation-edit-route.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-edit-'));
  const home = path.join(dir, 'home.config.json');
  const raw = {
    version: 1,
    $comment: 'keep this untouched',
    title: 'Test',
    groups: [],
    automations: [{ id: 'daily-summary', name: 'Daily summary', what: 'Old description', kind: 'launchd', trigger: 'Every day', status: [] }],
  };
  fs.writeFileSync(home, JSON.stringify(raw));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ home: { test: home } }));
  return { dir, home };
}

function request(body, deps) {
  return route.handle({
    req: { headers: { 'content-type': 'application/json' } },
    url: new URL('http://local/api/home/automation?project=test'),
    deps: { ...deps, readBody: async () => JSON.stringify(body) },
  });
}

test('automation edit preserves unrelated raw config fields and updates runtime settings', async () => {
  const { dir, home } = setup();
  const installed = [];
  const out = await request({
    id: 'daily-summary', description: 'New description', enabled: false,
    schedule: { hour: 7, minute: 30, weekdays: [1, 2, 3, 4, 5] }, model: 'github-copilot/mai-code-2',
  }, { dataRoot: dir, root: process.cwd(), installLaunchAgent: async job => { installed.push(job); return { loaded: false }; } });

  const saved = JSON.parse(fs.readFileSync(home, 'utf8'));
  assert.equal(saved.$comment, 'keep this untouched');
  assert.equal(saved.title, 'Test');
  assert.equal(saved.automations[0].what, 'New description');
  assert.deepEqual(saved.automations[0].run.schedule, { hour: 7, minute: 30, weekdays: [1, 2, 3, 4, 5] });
  assert.equal(saved.automations[0].run.enabled, false);
  assert.equal(installed.length, 1);
  assert.equal(installed[0].enabled, false);
  assert.equal(out.body.automation.run.model, 'github-copilot/mai-code-2');
});

test('automation edit rejects invalid model without changing config or installer', async () => {
  const { dir, home } = setup();
  const before = fs.readFileSync(home, 'utf8');
  let called = false;
  await assert.rejects(() => request({ id: 'daily-summary', model: 'bad\u0001model' }, {
    dataRoot: dir, root: process.cwd(), installLaunchAgent: async () => { called = true; },
  }), /characters that are not allowed/);
  assert.equal(fs.readFileSync(home, 'utf8'), before);
  assert.equal(called, false);
});

test('automation edit rolls back config when the installer throws', async () => {
  const { dir, home } = setup();
  const before = fs.readFileSync(home, 'utf8');
  await assert.rejects(() => request({ id: 'daily-summary', model: 'github-copilot/mai-code-2-flash' }, {
    dataRoot: dir, root: process.cwd(), installLaunchAgent: async () => { throw new Error('launchd unavailable'); },
  }), /nothing was saved/);
  assert.equal(fs.readFileSync(home, 'utf8'), before);
});
