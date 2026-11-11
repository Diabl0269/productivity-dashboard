/**
 * cli/test/review-gates.test.js
 * PRO41: the review gate refuses checks a session can do itself (placeholders, results, commands to
 * run, file paths with nothing attached, AI-content checks without a project) and `--check-audio`.
 * Synthetic texts and data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { checkOwnerProblem, audioPathError, normalizeCheckInput } from '../../shared/review.js';
import { evidenceVideoResponse } from '../lib/evidence.js';
import { validateTasksDoc } from '../lib/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

const REFUSED = [
  // placeholder
  ['Nothing to check', /--no-checks/],
  ['T1: no manual check needed, covered by tests', /--no-checks/],
  ['There is nothing to test by hand', /--no-checks/],
  // a measured result posed as a check
  ['Eval: run-song-steps passed, cost about $0.02; ops per song 20 and 18', /--tests/],
  ['12 tests passed', /--tests/],
  // asks the reviewer to run something
  ['Run the eval and compare the scores', /--tests/],
  ['Run the script scripts/check-sizes.sh', /--tests/],
  ['Execute the command and read the output', /--tests/],
  ['node scripts/bench.mjs shows no slowdown', /--tests/],
  ['`bash scripts/run.sh` prints OK', /--tests/],
  ['pnpm test is green locally', /--tests/],
  ['python3 tools/render.py --seed 4 and look at the output', /--tests/],
  // file on disk, nothing attached
  ['Listen to X1184/y.wav: the peak grows steadily', /--check-audio/],
  ['Open ~/Desktop/demo.mp4 and watch the fade', /--check-video/],
  ['Look at /Users/someone/shot.png', /--check-video/],
  ['Open end.agsproj and press play', /--check-project/],
  // reading a doc / source / log, or running a CLI command (PRO68)
  ["Open docs/layout/layout.md, section 'Every drag follows the view': it names the three families still to build", /--tests/],
  ['In DragSurfaceRegistryTests.cpp kFollowGaps holds 22 entries and the three exempt surfaces sit in kFollow with a reason', /--tests/],
  ['Run ch metrics cost --since 24h: the cost is about the same share', /--tests/],
  ['Tomorrow after 04:00, ~/Library/Logs/agentsynth-stop-cause.log shows causes instead of unknown', /--tests/],
  ['After the next autorun tick, the autorun log shows REAP lines', /--tests/],
  // AI content, no project
  ['Ask the assistant for a lo-fi song and listen', /--check-project/],
  ['Make an AI song and check the bass', /--check-project/],
  ['Generate a pad with the AI and judge it', /--check-project/],
];

const ALLOWED = [
  'Open the Key field menu on the transport: a Play the scale row shows its state',
  "Open Settings > Sound packs and click a pack's arrow",
  'Open the project lane-custom-lfo, right-click the lane and pick Custom LFO',
  'Run your finger along the strip: the glow follows it',
  'Press Run and the arp starts',
  'Pick Harmonics, then Stack harmonics and press Stack: peaks land on the harmonic lines; Cmd+Z removes them in one step',
  'Turn the knob: it steps by note and the readout names it',
  'Judge whether the note lines read clearly without crowding the curve',
  'Does the tag look right next to the title?',
  'Is the map size comfortable on a laptop screen?',
  'Drag a node to the grid: it snaps and the line follows',
  'Add a Filter, hold a note and drag Cutoff slowly up from the bottom',
  'Click + Track, type osc: only Oscillator rows remain',
  'Open the Mixer and drag a fader: the meter moves smoothly',
  'The run button turns green while the song plays',
  'Scroll the script editor tab: the line numbers stay aligned',
  'Hover a node: the tooltip names the module',
  'No clicks or pops when you switch presets quickly',
];

test('checkOwnerProblem refuses the gate kinds and names the fix', () => {
  for (const [text, fix] of REFUSED) {
    const why = checkOwnerProblem(text);
    assert.ok(why, `should refuse: ${text}`);
    assert.match(why, fix, text);
  }
});

test('checkOwnerProblem lets normal UI wording through', () => {
  for (const text of ALLOWED) assert.equal(checkOwnerProblem(text), null, text);
});

test('attached evidence lifts the path and AI-content refusals, not the others', () => {
  assert.equal(checkOwnerProblem('Listen to X1184/y.wav: the peak grows steadily', { audio: 'X/y.wav' }), null);
  assert.equal(checkOwnerProblem('Listen: the peak grows steadily with no clicks', { audio: 'X/y.wav' }), null);
  assert.equal(checkOwnerProblem('Ask the assistant for a lo-fi song and listen', { project: 'X/a.agsproj' }), null);
  assert.ok(checkOwnerProblem('Ask the assistant for a lo-fi song and listen', { audio: 'X/y.wav' }), 'audio alone is not a project');
  assert.ok(checkOwnerProblem('Run the eval', { project: 'X/a.agsproj' }));
  assert.ok(checkOwnerProblem('Nothing to check', { audio: 'X/y.wav' }));
});

test('audioPathError and normalizeCheckInput accept audio extensions', () => {
  for (const f of ['a.wav', 'd/a.MP3', 'a.m4a', 'a.ogg', 'a.flac']) assert.equal(audioPathError(f), null, f);
  assert.match(audioPathError('a.mp4'), /must end with one of/);
  assert.match(audioPathError('/abs/a.wav'), /relative/);
  assert.match(audioPathError('../a.wav'), /\.\./);
  assert.deepEqual(normalizeCheckInput({ text: 'x', audio: './d//a.wav' }), { text: 'x', audio: 'd/a.wav' });
  assert.throws(() => normalizeCheckInput({ text: 'x', audio: 'a.txt' }));
});

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-gates-test-'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), path.join(home, 'tasks.json'));
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc));
  fs.mkdirSync(path.join(home, 'evidence', 'T1'), { recursive: true });
  fs.writeFileSync(path.join(home, 'evidence', 'T1', 'tone.wav'), 'RIFF....WAVEfmt ');
  return home;
}
const run = (args, home) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
};
const taskOf = (home, id) => {
  for (const s of JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8')).sections) {
    const t = s.tasks.find(x => x.id === id);
    if (t) return t;
  }
  return null;
};

test('ch tasks review refuses a path check and accepts it with --check-audio', () => {
  const home = makeHome();
  const text = 'Listen to T1/tone.wav: the tone is steady';
  let r = run(['tasks', 'review', 'T1', '--shipped', 'x', '--check', text], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--check-audio/);
  r = run(['tasks', 'review', 'T1', '--shipped', 'x', '--check', text, '--check-audio', '1=T1/tone.wav'], home);
  assert.equal(r.status, 0, r.stderr);
  const t = taskOf(home, 'T1');
  assert.equal(t.checks[0].audio, 'T1/tone.wav');
  assert.deepEqual(validateTasksDoc(JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'))).errors || [], []);
});

test('--check-audio accepts an absolute path inside evidence, refuses a missing file and a bad N', () => {
  const home = makeHome();
  const abs = path.join(home, 'evidence', 'T1', 'tone.wav');
  let r = run(['tasks', 'review', 'T1', '--shipped', 'x', '--check', 'Listen: steady tone', '--check-audio', `1=${abs}`], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskOf(home, 'T1').checks[0].audio, 'T1/tone.wav');
  const home2 = makeHome();
  r = run(['tasks', 'review', 'T1', '--shipped', 'x', '--check', 'Listen: steady tone', '--check-audio', '1=T1/none.wav'], home2);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /audio not found/);
  r = run(['tasks', 'review', 'T1', '--shipped', 'x', '--check', 'Listen: steady tone', '--check-audio', '2=T1/tone.wav'], home2);
  assert.notEqual(r.status, 0);
});

test('--result-json check objects take audio', () => {
  const home = makeHome();
  const r = run(['tasks', 'review', 'T1', '--result-json', JSON.stringify({ shipped: ['x'], checks: [{ text: 'Listen: steady tone', audio: 'T1/tone.wav' }] })], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskOf(home, 'T1').checks[0].audio, 'T1/tone.wav');
});

test('the evidence response serves a wav with an audio content type and ranges', () => {
  const home = makeHome();
  const out = evidenceVideoResponse({ dataRoot: home, relPath: 'T1/tone.wav', range: 'bytes=0-3' });
  assert.equal(out.status, 206);
  assert.equal(out.headers['Content-Type'], 'audio/wav');
  assert.equal(evidenceVideoResponse({ dataRoot: home, relPath: 'T1/missing.wav' }).status, 404);
});
