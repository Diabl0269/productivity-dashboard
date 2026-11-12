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
  assert.notEqual(taskOf(home, 'T1').checked, true);
});

test('open PR + --held-pr: accepted, adds the try-on-branch check and records the reason', () => {
  const home = makeHome([{ url: PR, label: 'PR #42' }]);
  const r = run([...base, '--held-pr', 'waiting on a real-Mac check'], home, fakeGh(open));
  assert.equal(r.status, 0, r.stderr);
  const t = taskOf(home, 'T1');
  assert.ok(t.checks.some(c => c.text === 'Try on branch feat/demo-branch, then say merge or not'));
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
  assert.equal(g.error, null);
  assert.deepEqual(g.checks, ['Try on branch b, then say merge or not']);
});
