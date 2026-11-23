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

test('pickReviewApp with a branch and no matching build: no app, branchMissing says so (FRO2246: never main in its place)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-apps-'));
  const main = makeApp(dir, 'main/Agent Synth.app', 1);
  const picked = pickReviewApp([main], 'feat/other');
  assert.equal(picked.app, null);
  assert.equal(picked.branchMissing, 'feat/other');
  assert.equal(pickReviewApp([], 'feat/other').branchMissing, 'feat/other');
  // FRO2246: the build the review registered wins for its branch, but only when config.json lists it.
  const own = makeApp(dir, 'slot-3/Agent Synth.app', 4);
  assert.equal(pickReviewApp([main, own], 'feat/other', own).app, own);
  assert.equal(pickReviewApp([main], 'feat/other', own).branchMissing, 'feat/other');
});

test('openProject / handleOpenProject: branch or pr picks the branch build; a miss opens nothing and says so', async () => {
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
  assert.equal(r.status, 409);
  assert.equal(r.json.branchMissing, 'feat/gone');
  assert.match(r.json.error, /No build of branch feat\/gone yet, so nothing was opened/);
  assert.equal(calls.length, 2, 'nothing launched for the missing branch');
  assert.match(openedMessage({ app: wt, branch: 'feat/demo' }), /build of branch feat\/demo/);

  r = await handleOpenProject({ ...base, bodyText: JSON.stringify({ path: P }) });
  assert.equal(r.json.app, main);
  assert.equal(r.json.branch, undefined);
  await assert.rejects(openProject({ dataRoot: home, relPath: 'T1/one/none.agsproj', apps: [], branch: 'x', launch }), { status: 404 });
});

test('AGE162: no path + branch opens the branch build alone; no path and no branch/pr is 400; no apps is 404', async () => {
  const home = makeHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-apps-'));
  const main = makeApp(dir, 'main/Agent Synth.app', 0);
  const wt = makeApp(dir, 'build-ci-local/feat-demo/Agent Synth.app', 3);
  const calls = [];
  const launch = async (cmd, args) => { calls.push([cmd, args]); };
  const base = { host: 'localhost:3000', dataRoot: home, apps: [main, wt], launch };
  let r = await handleOpenProject({ ...base, bodyText: JSON.stringify({ branch: 'feat/demo', pr: PR }) });
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0], ['open', ['-a', wt]]);
  assert.equal(r.json.branch, 'feat/demo');
  r = await handleOpenProject({ ...base, bodyText: JSON.stringify({ branch: 'feat/gone' }) });
  assert.equal(r.status, 409);
  assert.equal(r.json.branchMissing, 'feat/gone');
  assert.equal(calls.length, 1, 'FRO2246: main is never opened in place of the branch build');
  assert.equal((await handleOpenProject({ ...base, bodyText: '{}' })).status, 400);
  assert.equal((await handleOpenProject({ ...base, bodyText: JSON.stringify({ branch: ' ' }) })).status, 400);
  r = await handleOpenProject({ ...base, apps: [], bodyText: JSON.stringify({ branch: 'feat/demo' }) });
  assert.equal(r.status, 404);
  assert.match(r.json.error, /no app build is configured/);
});

test('AGE162: dashboard openProject(null) sends no path; openBranchButton and the MERGED removal', async () => {
  const bodies = [];
  const fetchFn = async (_u, o) => { bodies.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ app: null }) }; };
  await dashOpenProject(null, { fetchFn, toast() {}, held: { pr: PR, branch: 'feat/demo' } });
  assert.deepEqual(bodies[0], { branch: 'feat/demo', pr: PR });

  const mkEl = () => ({ className: '', textContent: '', title: '', removed: false, attrs: {}, listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; }, remove() { this.removed = true; } });
  globalThis.document = { createElement: mkEl };
  let state = 'OPEN';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ state, branch: 'feat/late' }) });
  const { openBranchButton } = await import('../../dashboard/js/check-evidence.js');
  const { heldPrChip } = await import('../../dashboard/js/held-pr-ui.js');
  const held = { pr: 'https://github.com/example/demo/pull/11', branch: '' };
  const btn = openBranchButton(held);
  assert.equal(btn.textContent, 'Open project');
  assert.equal(btn.attrs['aria-label'], 'Open the build of its PR branch (no saved project)');
  assert.equal(btn.branchOnly, true);
  assert.equal(btn.held, held);
  const proj = { title: 'orig' };
  const chip = heldPrChip({ heldPr: held }, [btn, proj]);
  assert.equal(btn.title, 'Open the build of its PR branch (no saved project)');
  assert.match(proj.title, /needs a build of branch/);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(btn.title, 'Open the build of branch feat/late (no saved project)');
  assert.equal(btn.removed, false);

  state = 'MERGED';
  const pr9 = 'https://github.com/example/demo/pull/9';
  const btn2 = openBranchButton({ pr: pr9, branch: 'b' });
  const proj2 = { title: 'orig' };
  heldPrChip({ heldPr: { pr: pr9, branch: 'b' } }, [btn2, proj2]);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(btn2.removed, true);
  assert.equal(proj2.title, 'orig');
  assert.equal(proj2.held, null);
  assert.equal(chip.removed, false);
  delete globalThis.fetch; delete globalThis.document;
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
