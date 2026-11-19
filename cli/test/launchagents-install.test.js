import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasPlutil = spawnSync('plutil', ['-help']).status === 0;

test('install.mjs writes lint-clean plists into a temp dir without loading', { skip: !hasPlutil && 'plutil is only available on macOS' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'la-inst-'));
  const env = { ...process.env, HOME: tmp, LAUNCH_AGENTS_DIR: path.join(tmp, 'agents'), AUTOMATION_LOG_DIR: path.join(tmp, 'logs'), REPO_ROOT: repo, COPILOT_TASKS_DIR: path.join(tmp, 'none') };
  const r = spawnSync(process.execPath, ['scripts/launchagents/install.mjs', '--no-load', '--only', 'daily-summary'], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const file = path.join(tmp, 'agents', 'local.opencode.daily-summary.plist');
  assert.equal(spawnSync('plutil', ['-lint', file]).status, 0);
  const json = JSON.parse(spawnSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }).stdout);
  assert.equal(json.StartCalendarInterval.length, 5);
  assert.equal(json.WorkingDirectory, repo);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('install configures the selected harness runtime fields', async () => {
  const { buildPlist } = await awaitImportInstall();
  const plist = buildPlist({ id: 'demo', schedule: [], harness: 'claude', model: 'sonnet', agent: 'reviewer', effort: 'high' }, { root: repo, logs: '/tmp/logs' });
  assert.equal(plist.EnvironmentVariables.AUTOMATION_HARNESS, 'claude');
  assert.equal(plist.EnvironmentVariables.CLAUDE_MODEL, 'sonnet');
  assert.equal(plist.EnvironmentVariables.CLAUDE_AGENT, 'reviewer');
  assert.equal(plist.EnvironmentVariables.CLAUDE_EFFORT, 'high');
});

function awaitImportInstall() {
  return import('../../scripts/launchagents/install.mjs');
}

test('run-job.sh records the session id and exit code in the sidecar', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'la-run-'));
  const cli = path.join(tmp, 'fake-cli');
  fs.writeFileSync(cli, '#!/bin/sh\necho \'{"sessionID":"ses_TEST123"}\'\nexit 3\n', { mode: 0o755 });
  const env = { ...process.env, OPENCODE_CLI: cli, AUTOMATION_LOG_DIR: tmp };
  spawnSync('/bin/bash', ['scripts/launchagents/run-job.sh', 'demo', 'prompt'], { cwd: repo, env });
  const last = JSON.parse(fs.readFileSync(path.join(tmp, 'demo.last.json'), 'utf8'));
  assert.equal(last.sessionID, 'ses_TEST123');
  assert.equal(last.exitCode, 3);
  const history = fs.readFileSync(path.join(tmp, 'demo.runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(history.at(-1).sessionID, 'ses_TEST123');
  fs.rmSync(tmp, { recursive: true, force: true });
});
