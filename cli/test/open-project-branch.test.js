/**
 * cli/test/open-project-branch.test.js
 * PRO101: Open project on an unmerged PR opens that branch's build. pickReviewApp(apps, branch) matches a
 * worktree build by path or falls back to the newest and says so; handleOpenProject takes { branch } or
 * { pr } (resolved by branchOf); an ask with a mergePr gets the "not merged" chip and its Open project
 * button sends the branch, both going away once the PR is MERGED. Synthetic data, fake launch and fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { pickReviewApp, openProject, handleOpenProject } from '../lib/evidence.js';
import { openedMessage, openProject as dashOpenProject } from '../../dashboard/js/check-evidence.js';

const PR = 'https://github.com/example/demo/pull/7';

function makeApp(dir, rel, ageDays) {
  const app = path.join(dir, rel);
  const bin = path.join(app, 'Contents', 'MacOS');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'x'), 'x');
  const t = new Date(Date.now() - ageDays * 86400000);
  fs.utimesSync(path.join(bin, 'x'), t, t);
  return app;
}
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-branch-test-'));
  fs.mkdirSync(path.join(home, 'evidence', 'T1', 'one', 'one.agsproj'), { recursive: true });
  return home;
}

test('pickReviewApp with a branch: the build whose path names it wins, even when older', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-apps-'));
  const main = makeApp(dir, 'main/Agent Synth.app', 0);
  const wt = makeApp(dir, 'worktrees/pro95-plan-cards/Agent Synth.app', 5);
  const picked = pickReviewApp([main, wt], 'feat/pro95-plan-cards');
  assert.equal(picked.app, wt);
  assert.equal(picked.branch, 'feat/pro95-plan-cards');
  assert.equal(picked.branchMissing, undefined);
  assert.equal(pickReviewApp([main, wt]).app, main, 'no branch: newest');
});

test('pickReviewApp with a branch and no matching build: newest build, branchMissing says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-apps-'));
  const main = makeApp(dir, 'main/Agent Synth.app', 1);
  const picked = pickReviewApp([main], 'feat/other');
  assert.equal(picked.app, main);
  assert.equal(picked.branchMissing, 'feat/other');
  assert.equal(pickReviewApp([], 'feat/other'), null);
});

test('openProject / handleOpenProject: branch or pr picks the branch build; a miss falls back and reports it', async () => {
  const home = makeHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-apps-'));
  const main = makeApp(dir, 'main/Agent Synth.app', 0);
  const wt = makeApp(dir, 'build-ci-local/feat-demo/Agent Synth.app', 3);
  const calls = [];
  const launch = async (cmd, args) => { calls.push(args); };
  const base = { host: 'localhost:3000', dataRoot: home, apps: [main, wt], launch };
  const P = 'T1/one/one.agsproj';

  let r = await handleOpenProject({ ...base, bodyText: JSON.stringify({ path: P, branch: 'feat/demo' }) });
  assert.equal(r.json.app, wt);
  assert.equal(r.json.branch, 'feat/demo');
  assert.equal(calls[0][1], wt);

  r = await handleOpenProject({ ...base, branchOf: async (pr) => (pr === PR ? 'feat/demo' : ''), bodyText: JSON.stringify({ path: P, pr: PR }) });
  assert.equal(r.json.app, wt);

  r = await handleOpenProject({ ...base, bodyText: JSON.stringify({ path: P, branch: 'feat/gone' }) });
  assert.equal(r.json.app, main);
  assert.equal(r.json.branchMissing, 'feat/gone');
  assert.match(openedMessage(r.json), /No build of branch feat\/gone found; opened the newest build/);
  assert.match(openedMessage({ app: wt, branch: 'feat/demo' }), /build of branch feat\/demo/);

  r = await handleOpenProject({ ...base, bodyText: JSON.stringify({ path: P }) });
  assert.equal(r.json.app, main);
  assert.equal(r.json.branch, undefined);
  await assert.rejects(openProject({ dataRoot: home, relPath: 'T1/one/none.agsproj', apps: [], branch: 'x', launch }), { status: 404 });
});

test('dashboard openProject sends the held branch and pr only when given', async () => {
  const bodies = [];
  const fetchFn = async (_u, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ app: null }) }; };
  await dashOpenProject('T1/a.agsproj', { fetchFn, toast() {} });
  await dashOpenProject('T1/a.agsproj', { fetchFn, toast() {}, held: { pr: PR, branch: 'feat/demo' } });
  assert.deepEqual(bodies[0], { path: 'T1/a.agsproj' });
  assert.deepEqual(bodies[1], { path: 'T1/a.agsproj', branch: 'feat/demo', pr: PR });
});

function fakeDom() {
  const mk = () => ({ className: '', textContent: '', title: '', removed: false, remove() { this.removed = true; } });
  globalThis.document = { createElement: mk };
}

test('ask chip: shows "not merged" with the PR branch for an open mergePr ask, sets the button branch, and goes on MERGED', async () => {
  fakeDom();
  let state = 'OPEN';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ state, branch: 'feat/demo' }) });
  const { askHeldPrChip } = await import('../../dashboard/js/held-pr-ui.js');
  assert.equal(askHeldPrChip({ text: 'q' }), null, 'no mergePr, no chip');

  const open = { title: 'orig' };
  const chip = askHeldPrChip({ mergePr: PR }, [open]);
  assert.match(chip.textContent, /not merged/);
  assert.equal(open.held.pr, PR);
  await new Promise(r => setTimeout(r, 10));
  assert.match(chip.textContent, /on branch feat\/demo \(PR #7\), not merged/);
  assert.equal(open.held.branch, 'feat/demo');
  assert.match(open.title, /needs a build of branch feat\/demo/);
  assert.equal(chip.removed, false);

  // a second ask on another PR that merged
  state = 'MERGED';
  const PR2 = 'https://github.com/example/demo/pull/8';
  const btn = { title: 'orig' };
  const chip2 = askHeldPrChip({ mergePr: PR2 }, [btn]);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(chip2.removed, true);
  assert.equal(btn.held, null);
  assert.equal(btn.title, 'orig');
  delete globalThis.fetch; delete globalThis.document;
});
