/**
 * cli/test/turnkey-check.test.js
 * FRO2246 (kind check-tal-should-not-get): the ONE guard for "every check Tal gets is turnkey". A table of every
 * check shape from the nine source notes (FRO1258#1, FRO359#1, FRO699#1, FRO700#1, BAC35#5, FRO2170#4, BAC114#1,
 * FRO1594#10, WEB5#5) plus the seven request items goes through the real `ch tasks review` with every gate on.
 * Each shape is either refused (naming the fix) or lands carrying a project, a clip or still, a board link when it
 * names a board, and a verify record unless it is Tal's taste question. Synthetic data, fake gh.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { turnkeyCheckProblems, isTalOnlyCheck, missingScriptPaths } from '../../shared/turnkey-check.js';
import { checkOwnerProblem, DESIGN_BOARD_RE } from '../../shared/review.js';
import { pickReviewApp } from '../lib/evidence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const PR = 'https://github.com/example/demo/pull/7';
const BOARD = 'https://claude.ai/artifact/abc123';
const STEPS = 'Open project, in the Mixer panel press Play on the Reverb card: the tail fades out in about 2 s';

const ticket = (id, project, labels = [], extra = {}) => ({
  id, title: `Ticket ${id}`, checked: false, priority: 'medium', created: '2026-11-01', updated: null, project, subtasks: [],
  ...(labels.length ? { labels } : {}), ...extra,
});

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-turnkey-'));
  const held = { links: [{ url: PR, label: 'PR #7' }] };
  const doc = {
    version: 1,
    sections: [
      { id: 'todo', name: 'Todo', tasks: [] },
      { id: 'in-progress', name: 'In Progress', tasks: [
        ticket('FRO1', 'frontend', ['ui']),
        ticket('FRO2', 'frontend', ['ai']),
        ticket('FRO3', 'frontend', ['ui'], held),
        ticket('FRO4', 'frontend', ['design', 'ui']),
        ticket('BAC1', 'backend', ['ai']),
        ticket('WEB1', 'website', [], held),
      ] },
      { id: 'review', name: 'Ready for review', tasks: [] },
      { id: 'done', name: 'Done', tasks: [] },
    ],
  };
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc));
  const ev = path.join(home, 'evidence', 'T');
  fs.mkdirSync(path.join(ev, 'song.agsproj'), { recursive: true });
  for (const f of ['clip.mp4', 'clip2.mp4', 'still.png', 'song.wav']) fs.writeFileSync(path.join(ev, f), 'x');
  return home;
}

function fakeGh() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-fake-gh-'));
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho '{"state":"OPEN","headRefName":"feat/demo-branch"}'\n`, { mode: 0o755 });
  return bin;
}

function makeApp(dir, rel) {
  const app = path.join(dir, rel);
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'x'), 'x');
  return app;
}

const GH = fakeGh();
function run(args, home) {
  const env = { ...process.env, CH_HOME: home, PATH: `${GH}:${process.env.PATH}` };
  delete env.CH_NO_CHECK_PROJECT_GATE; // every gate on: this is what sessions get
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env, encoding: 'utf8' });
  return { stderr: r.stderr || '', status: r.status ?? 2 };
}
const checksOf = (home, id) => {
  for (const s of JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8')).sections) {
    const t = s.tasks.find(x => x.id === id);
    if (t) return t.checks || [];
  }
  return [];
};

const P = 'T/song.agsproj';
const V = 'T/clip.mp4';
const VERIFY = 'proof scenario mixer-reverb.yaml, mark 1 shows the tail';
const full = (n = 1) => ['--check-project', `${n}=${P}`, '--check-video', `${n}=${V}`];

// Every shape from the nine notes and the seven items. `refused`: the review fails and stderr names the fix.
const TABLE = [
  { note: 'FRO1258#1 AI song with no project (worded without "ask the AI")', id: 'FRO2',
    args: ['--check', 'Is the dubstep song punchy enough in the Mixer panel?', '--check-no-project', '1=made in chat, not saved', '--check-video', `1=${V}`],
    refused: /AI ticket's check carries what the AI made/ },
  { note: 'BAC35#5 an eval run handed to Tal', id: 'BAC1',
    args: ['--check', 'Run the eval and listen to the techno song', '--check-audio', '1=T/song.wav'], refused: /run it yourself/ },
  { note: 'BAC114#1 an API check with nothing the AI made', id: 'BAC1',
    args: ['--check', 'Ask the AI for a techno groove on the dev API', '--check-no-video', '1=API answer, a song file'],
    refused: /create the project with the AI yourself/ },
  { note: 'FRO699#1 a before/after check', id: 'FRO1',
    args: ['--check', 'In the Mixer panel, compare with the old reverb: the tail is longer now', ...full()], refused: /only the finished state/ },
  { note: 'FRO699#1 "previously" wording', id: 'FRO1',
    args: ['--check', 'In the Mixer panel the Reverb card previously cut the tail; is it smooth now?', ...full()], refused: /only the finished state/ },
  { note: 'FRO700#1 a bare "Try on branch"', id: 'FRO1',
    args: ['--check', 'Try on branch fro700-reverb, then say merge or not', ...full()], refused: /exact steps/ },
  { note: 'FRO1594#10 "what story board?": a board with no link', id: 'FRO1',
    args: ['--check', 'In the story board, is the Mixer layout calm in each theme?', ...full()], refused: /names a design board/ },
  { note: 'FRO359#1 Open project on an unmerged branch with no build of it', id: 'FRO3',
    args: ['--check', 'Is the Reverb card tail calm in the Mixer panel?', ...full(), '--held-pr', 'real-Mac look', '--try-steps', STEPS],
    refused: /no build of branch feat\/demo-branch is registered/ },
  { note: 'WEB5#5 a launch script path that is not there', id: 'WEB1',
    args: ['--check', 'Is the pricing card calm on the account page?', '--check-image', '1=T/still.png', '--held-pr', 'live deploy held',
      '--try-steps', 'Site started with `~/no-such-dir-fro2246/scripts/launch-web-branch.sh feat/x`, open http://localhost:4321/account: the card shows the price'],
    refused: /script paths do not exist: ~\/no-such-dir-fro2246\/scripts\/launch-web-branch\.sh/ },
  { note: 'item 6: a check with no clip or still', id: 'FRO1',
    args: ['--check', 'Is the Reverb card calm in the Mixer panel?', '--check-project', `1=${P}`], refused: /no clip or still/ },
  { note: 'item 6: "nothing to see" on a ui ticket', id: 'FRO1',
    args: ['--check', 'Is the Reverb card calm in the Mixer panel?', '--check-project', `1=${P}`, '--check-no-video', '1=nothing to see'],
    refused: /not a reason on a ui, website or AI ticket/ },
  { note: 'item 7: a step Claude can run, not tried', id: 'FRO1',
    args: ['--check', 'In the Mixer panel press Play on the Reverb card: the tail fades in 2 s', ...full()], refused: /try this one yourself/ },
  // Accepted shapes: each must land turnkey.
  { note: 'FRO1258#1 done right: the AI-made project and its clip', id: 'FRO2',
    args: ['--check', 'Is the dubstep song the AI made punchy enough in the Mixer panel?', ...full()] },
  { note: 'FRO2170#4: a ticket id in the text (the Plan page makes it a button)', id: 'FRO1',
    args: ['--check', 'Is the FRO2170 card spacing calm in the Mixer panel in each theme?', ...full()] },
  { note: 'FRO1594#10 done right: the board linked on the check', id: 'FRO1',
    args: ['--check', 'In the story board, is the Mixer layout calm in each theme?', ...full(), '--check-link', `1=${BOARD}`] },
  { note: 'item 4: a design ticket fills the board link from --design-link', id: 'FRO4',
    args: ['--check', 'In the design board, is round 2 calmer than round 1?', ...full(), '--design-link', BOARD] },
  { note: 'item 7: a step Claude ran, with its verify note', id: 'FRO1',
    args: ['--check', 'In the Mixer panel press Play on the Reverb card: the tail fades in 2 s', ...full(), '--check-verify', `1=${VERIFY}`] },
  { note: 'item 6: a still is evidence too', id: 'FRO1',
    args: ['--check', 'Is the Reverb card calm in the Mixer panel?', '--check-project', `1=${P}`, '--check-image', '1=T/still.png'] },
  { note: 'item 3: an A/B with both sides attached may compare', id: 'FRO1',
    args: ['--check', 'In the Mixer panel, compare with the old reverb: is the new tail smoother?', '--check-project', `1=${P}`,
      '--check-video', `1=${V}`, '--check-audio', '1=T/song.wav'] },
];

for (const row of TABLE) {
  test(`turnkey: ${row.note}`, () => {
    const home = makeHome();
    const r = run(['tasks', 'review', row.id, '--shipped', 'shipped it', ...row.args], home);
    if (row.refused) {
      assert.notEqual(r.status, 0, `should be refused: ${row.note}`);
      assert.match(r.stderr, row.refused);
      assert.equal(checksOf(home, row.id).length, 0, 'nothing written');
      return;
    }
    assert.equal(r.status, 0, r.stderr);
    const checks = checksOf(home, row.id);
    assert.ok(checks.length >= 1);
    for (const c of checks) {
      assert.ok(c.project, `project on "${c.text}"`);
      assert.ok(c.video || c.image || c.audio, `clip or still on "${c.text}"`);
      if (DESIGN_BOARD_RE.test(c.text)) assert.equal(c.link?.url, BOARD, `board link on "${c.text}"`);
      assert.ok(c.agentVerified || isTalOnlyCheck(c), `tried by the session or Tal's taste: "${c.text}"`);
    }
  });
}

test('turnkey: FRO359#1 done right: --build-app stores the branch build and registers it', () => {
  const home = makeHome();
  const app = makeApp(fs.mkdtempSync(path.join(os.tmpdir(), 'ch-apps-')), 'wt/Agent Synth.app');
  const r = run(['tasks', 'review', 'FRO3', '--shipped', 's', '--check', 'Is the Reverb card tail calm in the Mixer panel?', ...full(),
    '--held-pr', 'real-Mac look', '--try-steps', STEPS, '--build-app', app], home);
  assert.equal(r.status, 0, r.stderr);
  const checks = checksOf(home, 'FRO3');
  assert.ok(checks.length >= 2, 'the check and its Try on branch check');
  for (const c of checks) assert.equal(c.heldPr?.buildApp, app);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.deepEqual(cfg.reviewProjectApps, [app]);
  // Open project then opens exactly that build for the branch, even though its path does not name the branch.
  assert.equal(pickReviewApp(cfg.reviewProjectApps, 'feat/demo-branch', app).app, app);
  // A missing build is shown plainly, never replaced by main's newest build.
  assert.deepEqual(pickReviewApp(cfg.reviewProjectApps, 'feat/other'), { app: null, builtAt: null, branchMissing: 'feat/other' });
});

test('turnkey: --build-app must be an existing .app and goes with --held-pr', () => {
  const home = makeHome();
  let r = run(['tasks', 'review', 'FRO3', '--shipped', 's', '--check', 'Is the Reverb card tail calm in the Mixer panel?', ...full(),
    '--held-pr', 'why', '--try-steps', STEPS, '--build-app', '/no/such/Agent Synth.app'], home);
  assert.match(r.stderr, /--build-app must be an existing \.app bundle/);
  r = run(['tasks', 'review', 'FRO1', '--shipped', 's', '--check', 'Is the Reverb card calm in the Mixer panel?', ...full(), '--build-app', '/x.app'], home);
  assert.match(r.stderr, /--build-app goes with --held-pr/);
});

test('turnkey rules (pure): taste questions need no verify; ids, A/B and boards', () => {
  assert.equal(isTalOnlyCheck({ text: 'Is the knob calm in each theme?' }), true);
  assert.equal(isTalOnlyCheck({ text: 'needs-tal: taste: caption colour' }), true);
  assert.equal(isTalOnlyCheck({ text: 'Press Play: the meter moves', audio: 'a.wav' }), true);
  assert.equal(isTalOnlyCheck({ text: 'Press Play: the meter moves' }), false);
  assert.deepEqual(turnkeyCheckProblems([{ text: 'Is it calm?', video: 'a.mp4' }], { labels: ['ui'] }), []);
  assert.equal(turnkeyCheckProblems([{ text: 'Is it calm?', noVideo: 'reads a number in the log' }], { labels: [], project: 'backend' }).length, 0);
  assert.equal(turnkeyCheckProblems([{ text: 'Is it calm?', noVideo: 'no visible change' }], { labels: ['ui'] }).length, 1);
  assert.equal(turnkeyCheckProblems([{ text: 'Is it calm?', noVideo: 'no visible change' }], { labels: ['ui', 'no-ui'], project: 'frontend' }).length, 0);
  // Ordinary words stay allowed: the app's canvas, a sound design, "before the next note".
  for (const ok of ['Drag a cable on the canvas: is the curve calm?', 'Is the sound design of the pad warm?', 'Does the tail fade before the next note?']) {
    assert.equal(checkOwnerProblem(ok, { video: 'a.mp4' }), null, ok);
  }
  const exists = p => p === '/home/u/suite/scripts/launch-web-branch.sh';
  assert.deepEqual(missingScriptPaths('run `scripts/launch-web-branch.sh x`', { exists, home: '/home/u', roots: ['/home/u/suite'] }), []);
  assert.deepEqual(missingScriptPaths('run `scripts/gone.sh`', { exists, roots: ['/home/u/suite'] }), ['scripts/gone.sh']);
  assert.deepEqual(missingScriptPaths('run `scripts/gone.sh`', { exists }), [], 'relative paths are only checked when scriptRoots is set');
  assert.deepEqual(missingScriptPaths('`~/suite/scripts/launch-web-branch.sh`', { exists, home: '/home/u' }), []);
});
