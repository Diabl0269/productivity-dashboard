/**
 * cli/test/open-pr-gate.test.js
 * PRO70: `ch tasks review` refuses a ticket whose PR is open unless --held-pr '<why>' (which adds
 * the "Try on branch X" check); merged passes; closed-unmerged refuses; gh failing only warns.
 * A fake `gh` script on PATH stands in for GitHub. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { prLinks, openPrGate } from '../lib/open-pr-gate.js';

// PRO100: these fixtures file bare checks; the project-or-reason gate has its own tests (review-project-gate.test.js).
process.env.CH_NO_CHECK_PROJECT_GATE = '1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const PR = 'https://github.com/example/demo/pull/42';

function makeHome(links) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-pr-test-'));
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  const t1 = doc.sections.flatMap(s => s.tasks).find(t => t.id === 'T1');
  t1.labels = [];
  if (links) t1.links = links;
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc));
  return home;
}
/** A bin dir whose `gh` prints `out` and exits `code`. */
function fakeGh(out, code = 0) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-fake-gh-'));
  const f = path.join(bin, 'gh');
  fs.writeFileSync(f, `#!/bin/sh\n${code ? 'echo "gh: network down" >&2\n' : `echo '${out}'\n`}exit ${code}\n`, { mode: 0o755 });
  return bin;
}
const run = (args, home, bin) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
};
const taskOf = (home, id) => JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8')).sections.flatMap(s => s.tasks).find(t => t.id === id);
const base = ['tasks', 'review', 'T1', '--shipped', 'a', '--check', 'Open the panel: the label reads Gain'];
const STEPS = 'Open project, in the Mixer panel press Play on the Reverb card: the tail fades out in 2 s';
const open = '{"state":"OPEN","headRefName":"feat/demo-branch"}';

test('prLinks reads the PR label or a /pull/n URL only', () => {
  assert.equal(prLinks([{ url: 'https://x.test/a', label: 'PR #7' }, { url: PR }, { url: 'https://example.com' }, { url: 'https://x.test/b', label: 'Thread' }]).length, 2);
});

test('open PR: review refused, nothing written', () => {
  const home = makeHome([{ url: PR, label: 'PR #42' }]);
  const r = run(base, home, fakeGh(open));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /still open/);
  assert.match(r.stderr, /--held-pr/);
  assert.match(r.stderr, /--try-steps/);
  assert.notEqual(taskOf(home, 'T1').checked, true);
});

test('open PR + --held-pr: accepted, adds the try-on-branch check and records the reason', () => {
  const home = makeHome([{ url: PR, label: 'PR #42' }]);
  const r = run([...base, '--held-pr', 'waiting on a real-Mac check', '--try-steps', STEPS], home, fakeGh(open));
  assert.equal(r.status, 0, r.stderr);
  const t = taskOf(home, 'T1');
  assert.ok(t.checks.some(c => c.text === `Try on branch feat/demo-branch: ${STEPS}`));
  assert.equal(t.heldPr.reason, 'waiting on a real-Mac check');
  assert.equal(t.heldPr.branch, 'feat/demo-branch');
  assert.match(run(['tasks', 'get', 'T1'], home, fakeGh(open)).stdout, /PR held open: waiting on a real-Mac check/);
});

test('--held-pr without a reason is refused', () => {
  const home = makeHome([{ url: PR, label: 'PR #42' }]);
  assert.notEqual(run([...base, '--held-pr', ' '], home, fakeGh(open)).status, 0);
});

test('PR given with --add-link is checked too', () => {
  const home = makeHome();
  const r = run([...base, '--add-link', PR], home, fakeGh(open));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /still open/);
});

test('merged PR: review passes with no extra check', () => {
  const home = makeHome([{ url: PR, label: 'PR #42' }]);
  const r = run(base, home, fakeGh('{"state":"MERGED","headRefName":"feat/demo-branch"}'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskOf(home, 'T1').checks.length, 1);
});

test('closed-unmerged PR: refused', () => {
  const home = makeHome([{ url: PR, label: 'PR #42' }]);
  const r = run(base, home, fakeGh('{"state":"CLOSED","headRefName":"x"}'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /closed without merging/);
});

test('gh fails: warning, review still goes through', () => {
  const home = makeHome([{ url: PR, label: 'PR #42' }]);
  const r = run(base, home, fakeGh('', 1));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /warning: could not check .*not blocking/);
});

test('no PR link: gh is never asked', () => {
  const home = makeHome();
  assert.equal(run(base, home, fakeGh('', 1)).stderr.includes('warning'), false);
});

test('openPrGate with an injected state function', () => {
  const g = openPrGate({ id: 'T1', links: [{ url: PR }], heldPr: 'why', state: () => ({ state: 'OPEN', branch: 'b' }) });
  assert.match(g.error, /--try-steps/);
  const ok = openPrGate({ id: 'T1', links: [{ url: PR }], heldPr: 'why', trySteps: STEPS, state: () => ({ state: 'OPEN', branch: 'b' }) });
  assert.equal(ok.error, null);
  assert.deepEqual(ok.checks, [`Try on branch b: ${STEPS}`]);
});

test('AGE162: held PR without good --try-steps is refused (missing, short, generic)', () => {
  const state = () => ({ state: 'OPEN', branch: 'b' });
  for (const trySteps of [undefined, '', 'try it out', 'Try on branch b, then say merge or not and look at the Mixer panel', 'x'.repeat(39)]) {
    const g = openPrGate({ id: 'T1', links: [{ url: PR }], heldPr: 'why', trySteps, state });
    assert.match(g.error, /--held-pr needs --try-steps/, String(trySteps));
    assert.deepEqual(g.checks, []);
  }
  assert.equal(openPrGate({ id: 'T1', links: [{ url: PR }], heldPr: 'why', trySteps: 'x'.repeat(40), state }).error, null);
});

test('AGE162: CLI refuses missing steps, steps without a held PR, and owner-gated steps', () => {
  const home = makeHome([{ url: PR, label: 'PR #42' }]);
  let r = run([...base, '--held-pr', 'waiting on a real-Mac check'], home, fakeGh(open));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--held-pr needs --try-steps/);
  r = run([...base, '--held-pr', 'why', '--try-steps', 'Run the eval on the techno groove prompt three times and compare scores'], home, fakeGh(open));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /these checks are yours/);
  const none = makeHome();
  r = run([...base, '--try-steps', STEPS], none, fakeGh(open));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--try-steps goes with --held-pr/);
  r = run(['tasks', 'review', 'T1', '--shipped', 'a', '--check', 'After PR #1 merges: run the prompt 3 times'], none, fakeGh(open));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /waits on a merge is yours/);
});
