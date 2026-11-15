/**
 * cli/test/mechanical-checks-close-epic.test.js
 * PRO111 (Tal, 2026-11-15): an epic whose only checks are mechanical and run-verified closes without
 * his tick; taste, hardware and hearing checks (clip, audio, project, taste flag) stay his. Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { isMechanicalVerified, epicNeedsTal, settleMechanicalChecks, rollUpAfterClose } from '../../shared/review.js';

process.env.CH_NO_CHECK_PROJECT_GATE = '1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

const av = (result = 'pass') => ({ at: '2026-11-15T10:00:00.000Z', by: 'agent', result, note: 'ran it in a browser' });
const check = (extra = {}) => ({ text: 'page shows it', checked: false, addedAt: '2026-11-15T09:00:00.000Z', ...extra });

test('isMechanicalVerified: only a passed run verification with no clip, audio, project, taste flag or held PR', () => {
  assert.equal(isMechanicalVerified(check({ agentVerified: av() })), true);
  assert.equal(isMechanicalVerified(check()), false);
  assert.equal(isMechanicalVerified(check({ agentVerified: av('fail') })), false);
  for (const extra of [{ video: 'a.mp4' }, { audio: 'a.wav' }, { project: 'a.proj' }, { taste: true }, { heldPr: { pr: 3 } }]) {
    assert.equal(isMechanicalVerified(check({ agentVerified: av(), ...extra })), false, JSON.stringify(extra));
  }
});

test('epicNeedsTal: left and unverified lines and unverified checks still need him', () => {
  assert.equal(epicNeedsTal({ checks: [check({ agentVerified: av() })] }), false);
  assert.equal(epicNeedsTal({ checks: [] }), false);
  assert.equal(epicNeedsTal({ checks: [check()] }), true);
  assert.equal(epicNeedsTal({ checks: [check({ agentVerified: av(), taste: true })] }), true);
  assert.equal(epicNeedsTal({ checks: [], result: { left: ['x'] } }), true);
  assert.equal(epicNeedsTal({ checks: [], result: { unverified: ['needs-tal: hardware: y'] } }), true);
});

test('rollUpAfterClose: an epic with a result and only mechanical-verified checks goes to done and ticks them', () => {
  const epic = { id: 'E1', type: 'epic', result: { shipped: ['C1: x'] }, checks: [check({ agentVerified: av() })] };
  const kid = { id: 'C1', type: 'task', parentId: 'E1' };
  const doc = { sections: [{ id: 'in-progress', tasks: [epic] }, { id: 'done', tasks: [kid] }, { id: 'review', tasks: [] }] };
  assert.deepEqual(rollUpAfterClose(doc, 'E1').map(m => m.to), ['done']);
  assert.equal(epic.checks[0].checked, true);
  assert.match(epic.checks[0].checkedNote, /Verified by agent: ran it in a browser/);
});

test('rollUpAfterClose: a taste check keeps the epic in review and unticked', () => {
  const epic = { id: 'E1', type: 'epic', result: { shipped: ['C1: x'] }, checks: [check({ agentVerified: av(), video: 'a.mp4' })] };
  const kid = { id: 'C1', type: 'task', parentId: 'E1' };
  const doc = { sections: [{ id: 'in-progress', tasks: [epic] }, { id: 'done', tasks: [kid] }, { id: 'review', tasks: [] }] };
  assert.deepEqual(rollUpAfterClose(doc, 'E1').map(m => m.to), ['review']);
  assert.equal(epic.checks[0].checked, false);
});

function runCli(args, dir) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}
const find = (dir, id) => {
  for (const s of JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).sections) {
    const task = s.tasks.find(t => t.id === id);
    if (task) return { task, section: s.id };
  }
  return null;
};

test('ch tasks update --verify-check on the last mechanical check of an epic in review closes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-pro111-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(dir, 'tasks.json'));
  const added = runCli(['tasks', 'add', '--no-project', 'Epic E', '--type', 'epic', '--lane', 'canvas', '--label', 'model:opus', '--json'], dir);
  const epic = JSON.parse(added.stdout).id;
  const kid = JSON.parse(runCli(['tasks', 'add', '--no-project', 'Child', '--parent', epic, '--json'], dir).stdout).id;
  assert.equal(runCli(['tasks', 'review', kid, '--shipped', 'did it', '--check', 'the page lists it'], dir).status, 0);
  assert.equal(find(dir, epic).section, 'review');
  const r = runCli(['tasks', 'update', epic, '--verify-check', '1', '--verify-note', 'drove the page in a browser'], dir);
  assert.equal(r.status, 0, r.stderr);
  const got = find(dir, epic);
  assert.equal(got.section, 'done');
  assert.equal(got.task.checks[0].checked, true);
});
