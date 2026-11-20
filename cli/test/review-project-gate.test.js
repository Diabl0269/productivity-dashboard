/**
 * cli/test/review-project-gate.test.js
 * PRO100: every --check of a review carries a project to open or an explicit reason there is none
 * (--check-no-project N=<reason>); the build chip data (shared/check-build.js). Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { checkProjectGateProblem, normalizeCheckInput, addChecks, checkEvidenceErrors } from '../../shared/review.js';
import { checkBuildInfo, noProjectLine } from '../../shared/check-build.js';
import { loadTasksJson } from '../../dashboard/js/tasks-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const P = 'T1/one/end.agsproj';

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-pro100-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), path.join(home, 'tasks.json'));
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc));
  fs.mkdirSync(path.join(home, 'evidence', 'T1', 'one', 'end.agsproj'), { recursive: true });
  return home;
}

function run(args, home) {
  const env = { ...process.env, CH_HOME: home };
  delete env.CH_NO_CHECK_PROJECT_GATE;
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}

const taskOf = (home, id) => {
  for (const s of JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8')).sections) {
    const t = s.tasks.find(x => x.id === id);
    if (t) return t;
  }
  return null;
};
const base = ['tasks', 'review', 'T1', '--shipped', 's'];

test('gate refuses a check with neither project nor reason and names its number', () => {
  const home = makeHome();
  const r = run([...base, '--check', 'first', '--check', 'second', '--check-project', `1=${P}`], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /check 2: "second"/);
  assert.doesNotMatch(r.stderr, /check 1:/);
  assert.match(r.stderr, /--check-no-project N=<reason>/);
  assert.equal((taskOf(home, 'T1').checks || []).length, 0, 'nothing written');
});

test('gate accepts a project, or a reason, per check; the reason is stored', () => {
  const home = makeHome();
  const r = run([...base, '--check', 'first', '--check', 'second', '--check-project', `1=${P}`,
    '--check-no-project', '2=reads a setting, no project involved'], home);
  assert.equal(r.status, 0, r.stderr);
  const checks = taskOf(home, 'T1').checks;
  assert.equal(checks[0].project, P);
  assert.equal(checks[0].noProject, undefined);
  assert.equal(checks[1].noProject, 'reads a setting, no project involved');
});

test('gate: a project and a reason on one check, a bad reason or a bad N are refused', () => {
  const home = makeHome();
  let r = run([...base, '--check', 'a', '--check-project', `1=${P}`, '--check-no-project', '1=because'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /both a project and a no-project reason/);
  r = run([...base, '--check', 'a', '--check-no-project', '1=x'], home);
  assert.match(r.stderr, /3-200 characters/);
  r = run([...base, '--check', 'a', '--check-no-project', '2=because'], home);
  assert.match(r.stderr, /N must be between 1 and 1/);
});

test('gate: --no-checks needs no project, --force "<why>" overrides and is recorded', () => {
  const home = makeHome();
  assert.equal(run([...base, '--no-checks', 'docs only'], home).status, 0);
  const h2 = makeHome();
  let r = run([...base, '--check', 'a', '--force'], h2);
  assert.notEqual(r.status, 0, 'bare --force names no reason');
  r = run([...base, '--check', 'a', '--force', 'agent had no project'], h2);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskOf(h2, 'T1').forcedReview.reason, 'agent had no project');
});

test('--result-json check objects carry noProject; update attaches or replaces it on an existing check', () => {
  const home = makeHome();
  const json = JSON.stringify({ checks: [{ text: 'a', noProject: 'pure logic, nothing to open' }] });
  assert.equal(run([...base, '--result-json', json], home).status, 0);
  assert.equal(taskOf(home, 'T1').checks[0].noProject, 'pure logic, nothing to open');
  const r = run(['tasks', 'update', 'T1', '--check-project', `1=${P}`], home);
  assert.equal(r.status, 0, r.stderr);
  const c = taskOf(home, 'T1').checks[0];
  assert.equal(c.project, P);
  assert.equal(c.noProject, undefined, 'a project replaces the reason');
});

test('checkProjectGateProblem, normalizeCheckInput, addChecks and the schema agree', () => {
  assert.equal(checkProjectGateProblem([{ text: 'a', project: P }, { text: 'b', noProject: 'no project here' }]), null);
  assert.match(checkProjectGateProblem([{ text: 'a' }, { text: 'b' }]), /check 1: "a"[\s\S]*check 2: "b"/);
  assert.throws(() => normalizeCheckInput({ text: 'a', project: P, noProject: 'both' }), /both a project and a noProject/);
  assert.equal(normalizeCheckInput({ text: 'a', noProject: ' no project here ' }).noProject, 'no project here');
  const task = {};
  addChecks(task, [{ text: 'a', noProject: 'no project here' }]);
  addChecks(task, [{ text: 'a', project: P }]);
  assert.equal(task.checks[0].project, P);
  assert.equal(task.checks[0].noProject, undefined);
  assert.equal(checkEvidenceErrors({ noProject: 'ab' }, 'c').length, 1);
  assert.deepEqual(checkEvidenceErrors({ noProject: 'abc' }, 'c'), []);
});

test('plan data: the dashboard keeps noProject, and a check\'s build info carries project, app and state', () => {
  const doc = { meta: {}, sections: [{ id: 'review', tasks: [{ id: 'T1', title: 't', checks: [{ text: 'a', noProject: 'nothing to open' }, { text: 'b', project: P }] }] }] };
  const checks = Object.values(loadTasksJson(JSON.stringify(doc)).tasks).flat()[0].checks;
  assert.equal(checks[0].noProject, 'nothing to open');
  assert.equal(noProjectLine(checks[0]), 'No project: nothing to open');
  assert.equal(noProjectLine(checks[1]), null);
  const build = { app: '/Apps/Test.app', builtAt: '2026-11-10T10:00:00.000Z' };
  assert.deepEqual(checkBuildInfo(checks[1], build, { kind: 'current' }), { project: P, app: '/Apps/Test.app', builtAt: build.builtAt, state: 'current', text: 'in your build' });
  assert.equal(checkBuildInfo(checks[1], build, { kind: 'stale' }).text, 'needs a newer build');
  assert.equal(checkBuildInfo(checks[1], build, { kind: 'unknown' }).text, null, 'unknown shows the path only');
  assert.equal(checkBuildInfo(checks[1], build, null).state, null);
  assert.equal(checkBuildInfo({ ...checks[1], heldPr: { pr: 1, branch: 'b' } }, build, { kind: 'current' }).state, null, 'a held branch never claims in your build');
  assert.equal(checkBuildInfo(checks[1], null, { kind: 'current' }), null, 'no build info: nothing');
  assert.equal(checkBuildInfo(checks[0], build, { kind: 'current' }), null, 'no project: nothing');
});

test('BAC118: a sound check with an "any patch works" / "no saved project" / "needs a deploy" reason and no audio is refused', () => {
  const home = makeHome();
  for (const [text, why] of [
    ['Play the same chord on Basic Shapes then Bell: both sound equally loud', 'any wavetable patch works, no saved project involved'],
    ['Listen to the song the next prompt makes: is the crow louder?', 'reads a server-side setting after the next API deploy'],
  ]) {
    const r = run([...base, '--check', text, '--check-no-project', `1=${why}`], home);
    assert.notEqual(r.status, 0, why);
    assert.match(r.stderr, /sound check\(s\) say there is no project/);
    assert.match(r.stderr, /--check-audio N=<path>/);
  }
  assert.equal((taskOf(home, 'T1').checks || []).length, 0, 'nothing written');
});

test('BAC118: the same reason is fine on a non-sound check, and a sound check with a project or audio passes', () => {
  assert.equal(checkProjectGateProblem([{ text: 'The Settings tab shows the new row', noProject: 'any patch works, no project' }]), null);
  assert.equal(checkProjectGateProblem([{ text: 'Hear the bell chord', project: P }]), null);
  assert.equal(checkProjectGateProblem([{ text: 'Hear the bell chord', noProject: 'any patch works', audio: 'T1/a.wav' }]), null);
  assert.match(checkProjectGateProblem([{ text: 'Is the bell chord quieter?', noProject: 'needs a deploy first' }]), /sound check/);
});
