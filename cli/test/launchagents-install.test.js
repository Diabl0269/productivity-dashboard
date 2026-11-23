import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlist, installJob, jobFromEntry } from '../../scripts/launchagents/lib.mjs';

test('buildPlist escapes values and writes model, schedule and prompt as plist arguments', () => {
  const dirs = { supportDir: '/support', launchDir: '/launch', logDir: '/logs' };
  const xml = buildPlist({
    id: 'daily-summary', schedule: { hour: 8, minute: 5, weekdays: [1, 3] },
    harness: 'opencode', cli: 'opencode', model: 'github-copilot/mai-code-2', skill: 'daily-summary', prompt: 'Run <safe> & stop',
  }, { repoRoot: '/repo & docs', dirs });
  assert.match(xml, /github-copilot\/mai-code-2/);
  assert.match(xml, /Run &lt;safe&gt; &amp; stop/);
  assert.match(xml, /\/repo &amp; docs/);
  assert.match(xml, /<key>Weekday<\/key><integer>1<\/integer>/);
});

test('buildPlist uses generic harness configuration', () => {
  const xml = buildPlist({ id: 'daily-summary', schedule: { hour: 8, minute: 0 }, harness: 'claude', cli: 'claude', model: 'sonnet', arguments: ['--permission-mode', 'bypassPermissions'] }, { repoRoot: '/repo', dirs: { home: '/Users/test', supportDir: '/support', launchDir: '/launch', logDir: '/logs' } });
  assert.match(xml, /AUTOMATION_HARNESS<\/key><string>claude/);
  assert.match(xml, /AUTOMATION_CLI<\/key><string>claude/);
  assert.match(xml, /AUTOMATION_MODEL<\/key><string>sonnet/);
  assert.match(xml, /--permission-mode\nbypassPermissions/);
});

test('buildPlist rejects missing harness or cli rather than defaulting to OpenCode', () => {
  const dirs = { home: '/Users/test', supportDir: '/support', launchDir: '/launch', logDir: '/logs' };
  assert.throws(() => buildPlist({ id: 'daily-summary', schedule: { hour: 8, minute: 0 }, cli: 'agent' }, { repoRoot: '/repo', dirs }), /needs both harness and cli/);
  assert.throws(() => buildPlist({ id: 'daily-summary', schedule: { hour: 8, minute: 0 }, harness: 'custom' }, { repoRoot: '/repo', dirs }), /needs both harness and cli/);
});

test('jobFromEntry defaults model and enabled but preserves explicit runtime settings', () => {
  const job = jobFromEntry({ id: 'daily-summary', kind: 'launchd', run: { schedule: { hour: 7, minute: 15 }, model: 'github-copilot/mai-code-2-flash', enabled: false } });
  assert.equal(job.model, 'github-copilot/mai-code-2-flash');
  assert.equal(job.enabled, false);
  assert.deepEqual(job.schedule, { hour: 7, minute: 15 });
});

test('installJob unloads disabled jobs and does not bootstrap them', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'launchagent-install-'));
  const repoRoot = path.join(home, 'repo');
  fs.mkdirSync(repoRoot);
  const runner = path.join(home, 'run-job.sh');
  fs.writeFileSync(runner, '#!/bin/bash\nexit 0\n');
  const calls = [];
  const result = installJob({ id: 'daily-summary', schedule: { hour: 8, minute: 58 }, harness: 'custom', cli: '/opt/agent', enabled: false }, {
    repoRoot, runnerSource: runner, home,
    exec(file, args) { calls.push([file, args]); },
  });
  assert.equal(result.loaded, false);
  assert.ok(calls.some(([, args]) => args[0] === 'bootout'));
  assert.ok(calls.some(([, args]) => args[2]?.includes('local.opencode.daily-summary.plist')));
  assert.ok(!calls.some(([, args]) => args[0] === 'bootstrap'));
  assert.ok(fs.existsSync(result.plistPath));
});
