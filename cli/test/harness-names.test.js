/**
 * PRO136: a check must not name a sound that exists only in the test-mode fixtures (FRO2023's
 * "Test Tone"). The list comes from a suite checkout's fixtures folder; this test builds a synthetic one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixtureNames, harnessNamesIn, harnessNameProblem } from '../lib/harness-names.js';

process.env.CH_NO_CHECK_PROJECT_GATE = '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

function makeSuite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-harness-suite-'));
  const fx = path.join(root, 'agentsynth/Tools/ui-verify/fixtures');
  const pack = (dir, instruments) => {
    fs.mkdirSync(path.join(fx, dir), { recursive: true });
    fs.writeFileSync(path.join(fx, dir, 'pack.json'), JSON.stringify({ id: 'p', name: 'P', instruments }));
  };
  pack('SoundPacksTone/tones', [{ id: 'tone', name: 'Test Tone' }]);
  pack('SoundPacksUpright/core', [{ id: 'up', name: 'Upright piano' }]);
  fs.mkdirSync(path.join(root, 'agentsynth/Source'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agentsynth/Source/CoreSounds.cpp'), 'const char* n = "Upright piano";');
  return root;
}

test('fixtureNames reads every instrument name; a name the app ships is not harness-only', () => {
  const root = makeSuite();
  assert.deepEqual(fixtureNames(root).sort(), ['Test Tone', 'Upright piano']);
  assert.deepEqual(harnessNamesIn('Add a Sampler and pick Test Tone, then Upright piano', [root]), ['Test Tone']);
});

test('the FRO2023 check is refused; shipped names, a handed project and no roots pass', () => {
  const root = makeSuite();
  const text = 'FRO2023: In the Sampler picker choose the Test Tone sound and look at the short black keys';
  assert.match(harnessNameProblem({ text }, [root]), /Test Tone.*test harness/);
  assert.equal(harnessNameProblem({ text, project: 'FRO2023/a.agsproj' }, [root]), null);
  assert.equal(harnessNameProblem({ text: 'Pick Upright piano and look at the keys' }, [root]), null);
  assert.equal(harnessNameProblem({ text }, []), null);
});

test('a new fixture name is covered without editing the linter', () => {
  const root = makeSuite();
  const dir = path.join(root, 'agentsynth/Tools/ui-verify/fixtures/SoundPacksNew/x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ instruments: [{ name: 'Fixture Bell' }] }));
  assert.deepEqual(harnessNamesIn('pick Fixture Bell', [root]), ['Fixture Bell']);
});

test('ch tasks review refuses a Test Tone check and says to name a shipped sound', () => {
  const root = makeSuite();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-harness-home-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), path.join(home, 'tasks.json'));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ scriptRoots: [root] }));
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc));
  const run = (check) => spawnSync(process.execPath, [CH_SCRIPT, 'tasks', 'review', 'T1', '--shipped', 'x', '--check', check],
    { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  const bad = run('Pick the Test Tone sound when adding a Sampler and look at the black keys');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Test Tone.*name a shipped sound/);
  const good = run('Pick the Upright piano sound when adding a Sampler and look at the black keys');
  assert.equal(good.status, 0, good.stderr);
});
