/**
 * cli/test/check-attach.test.js
 * `ch tasks update` attaches/replaces project, video, audio or a no-video reason on an EXISTING check.
 * Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const P = 'T1/one/end.agsproj';
const V = 'T1/one/one.mp4';

function run(args, home) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}

function taskOf(home, id) {
  for (const s of JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8')).sections) {
    const t = s.tasks.find(x => x.id === id);
    if (t) return t;
  }
  return null;
}

function homeWithChecks() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-attach-test-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(home, 'tasks.json'));
  const dir = path.join(home, 'evidence', 'T1', 'one');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'end.agsproj'));
  for (const f of ['one.mp4', 'two.mp4', 'a.wav']) fs.writeFileSync(path.join(dir, f), 'abc');
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc));
  const r = run(['tasks', 'update', 'T1', '--add-check', 'first', '--add-check', 'second', '--check-check', '2'], home);
  assert.equal(r.status, 0, r.stderr);
  return home;
}

test('update: video/project/audio attach to the Nth existing check, tick and text unchanged', () => {
  const home = homeWithChecks();
  const r = run(['tasks', 'update', 'T1', '--check-video', `1=${V}`, '--check-project', `1=${P}`, '--check-audio', '2=T1/one/a.wav'], home);
  assert.equal(r.status, 0, r.stderr);
  const [a, b] = taskOf(home, 'T1').checks;
  assert.equal(a.video, V); assert.equal(a.project, P); assert.equal(a.text, 'first'); assert.equal(a.checked, false);
  assert.equal(b.audio, 'T1/one/a.wav'); assert.equal(b.text, 'second'); assert.equal(b.checked, true);
});

test('update: replaces an existing attachment; video and no-video swap each other', () => {
  const home = homeWithChecks();
  run(['tasks', 'update', 'T1', '--check-video', `1=${V}`], home);
  assert.equal(run(['tasks', 'update', 'T1', '--check-video', '1=T1/one/two.mp4'], home).status, 0);
  assert.equal(taskOf(home, 'T1').checks[0].video, 'T1/one/two.mp4');
  assert.equal(run(['tasks', 'update', 'T1', '--check-no-video', '1=cannot record this'], home).status, 0);
  assert.equal(taskOf(home, 'T1').checks[0].noVideo, 'cannot record this');
  assert.equal(taskOf(home, 'T1').checks[0].video, undefined);
  assert.equal(run(['tasks', 'update', 'T1', '--check-video', `1=${V}`], home).status, 0);
  assert.equal(taskOf(home, 'T1').checks[0].noVideo, undefined);
});

test('update: out of range, bad path, missing file and video+noVideo conflict die and change nothing', () => {
  const home = homeWithChecks();
  const before = fs.readFileSync(path.join(home, 'tasks.json'), 'utf8');
  for (const [args, re] of [
    [['--check-video', `3=${V}`], /between 1 and 2/],
    [['--check-video', `0=${V}`], /between 1 and 2/],
    [['--check-video', '1=../x.mp4'], /\.\./],
    [['--check-video', '1=T1/one/x.mov'], /\.mp4/],
    [['--check-video', '1=T1/one/missing.mp4'], /not found/],
    [['--check-project', '1=T1/one/one.mp4'], /\.agsproj/],
    [['--check-no-video', '1=x'], /3-200|characters/],
    [['--check-video', `1=${V}`, '--check-no-video', '1=cannot record this'], /both a video and a no-video/],
  ]) {
    const r = run(['tasks', 'update', 'T1', ...args], home);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, re, args.join(' '));
  }
  assert.equal(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'), before);
});
