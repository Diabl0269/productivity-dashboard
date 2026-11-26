/**
 * cli/test/branch-site.test.js
 * WEB49: config.json branchSites, the branch-site server helpers and the dashboard's pure poll helper.
 * Synthetic data only; nothing here starts a site or opens Terminal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  readBranchSites, pickBranchSite, branchSiteScript, handleBranchSiteInfo, handleStartBranchSite, handleBranchSiteReady,
} from '../../server/branch-site.js';
import { pollSiteReady, branchSiteLabel } from '../../dashboard/js/branch-site-ui.js';

const rule = { projects: ['site-a'], command: 'bash ./run.sh {branch}', url: 'http://localhost:4321/' };
const root = (cfg) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-bs-'));
  if (cfg !== undefined) fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify(cfg));
  return d;
};

test('readBranchSites keeps valid rules and drops malformed ones', () => {
  const d = root({ branchSites: [
    rule,
    { ...rule, projects: [] }, { ...rule, projects: [3] }, { ...rule, command: 'no placeholder' },
    { ...rule, url: 'https://example.com/' }, { ...rule, url: 'nope' }, null, 'x',
    { projects: ['b'], command: 'x {branch}', url: 'http://127.0.0.1:8080' },
  ] });
  assert.deepEqual(readBranchSites(d).map(r => r.projects[0]), ['site-a', 'b']);
  assert.deepEqual(readBranchSites(root()), []);
  assert.deepEqual(readBranchSites(root({ branchSites: 'x' })), []);
});

test('pickBranchSite finds the first rule listing the project', () => {
  const rules = [rule, { ...rule, projects: ['site-a', 'site-b'], url: 'http://localhost:1/' }];
  assert.equal(pickBranchSite(rules, 'site-a'), rules[0]);
  assert.equal(pickBranchSite(rules, 'site-b'), rules[1]);
  assert.equal(pickBranchSite(rules, 'other'), null);
});

test('branchSiteScript single-quotes the branch and refuses bad names', () => {
  const s = branchSiteScript(rule, 'feat/a-b.1');
  assert.ok(s.startsWith('#!/bin/bash\n# '));
  assert.ok(s.endsWith("bash ./run.sh 'feat/a-b.1'\n"));
  for (const bad of ['-x', 'a;rm', '$(x)', 'a b', '', 'a'.repeat(201), 'a\nb', undefined]) {
    assert.throws(() => branchSiteScript(rule, bad), (e) => e.status === 400, String(bad));
  }
});

test('handleBranchSiteInfo reports whether a rule exists', () => {
  const d = root({ branchSites: [rule] });
  assert.deepEqual(handleBranchSiteInfo({ dataRoot: d, project: 'site-a' }).json, { configured: true, url: rule.url, command: rule.command });
  assert.deepEqual(handleBranchSiteInfo({ dataRoot: d, project: 'zzz' }).json, { configured: false });
});

const down = async () => false;

test('handleStartBranchSite: 403 cross-origin, 404 without a rule, 400 bad branch', async () => {
  const d = root({ branchSites: [rule] });
  const launch = async () => { throw new Error('must not launch'); };
  const body = JSON.stringify({ branch: 'b1', project: 'site-a' });
  assert.equal((await handleStartBranchSite({ origin: 'http://evil.test', host: 'localhost:3000', bodyText: body, dataRoot: d, launch, isUp: down })).status, 403);
  const none = await handleStartBranchSite({ host: 'h', bodyText: JSON.stringify({ branch: 'b1', project: 'zzz' }), dataRoot: d, launch, isUp: down });
  assert.equal(none.status, 404);
  assert.match(none.json.error, /no branchSites rule for project zzz/);
  assert.equal((await handleStartBranchSite({ host: 'h', bodyText: JSON.stringify({ branch: '-x', project: 'site-a' }), dataRoot: d, launch, isUp: down })).status, 400);
  assert.equal((await handleStartBranchSite({ host: 'h', bodyText: '{', dataRoot: d, launch, isUp: down })).status, 400);
});

test('handleStartBranchSite writes an executable .command and opens it', async () => {
  const d = root({ branchSites: [rule] });
  const calls = [];
  const out = await handleStartBranchSite({
    origin: 'http://localhost:3000', host: 'localhost:3000', dataRoot: d,
    bodyText: JSON.stringify({ branch: 'feat/x', project: 'site-a' }), launch: async (...a) => { calls.push(a); }, isUp: down,
  });
  const file = path.join(d, 'run', 'branch-site-feat-x.command');
  assert.equal(out.status, 200);
  assert.deepEqual(out.json, { url: rule.url, command: "bash ./run.sh 'feat/x'", script: file });
  assert.deepEqual(calls, [['open', [file]]]);
  assert.ok(fs.statSync(file).mode & 0o100, 'executable');
  assert.match(fs.readFileSync(file, 'utf8'), /^#!\/bin\/bash\n/);
});

test('handleBranchSiteReady: true on a listening port, false on a closed one, refuses non-local hosts', async () => {
  const srv = net.createServer(s => s.end());
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  assert.deepEqual((await handleBranchSiteReady({ url: `http://127.0.0.1:${port}/` })).json, { ready: true });
  await new Promise(r => srv.close(r));
  assert.deepEqual((await handleBranchSiteReady({ url: `http://127.0.0.1:${port}/` })).json, { ready: false });
  assert.equal((await handleBranchSiteReady({ url: 'http://example.com:80/' })).status, 400);
  assert.equal((await handleBranchSiteReady({ url: 'garbage' })).status, 400);
});

test('pollSiteReady polls until ready or the timeout', async () => {
  let n = 0;
  const fetchFn = async () => ({ ok: true, json: async () => ({ ready: ++n >= 3 }) });
  const sleeps = [];
  assert.equal(await pollSiteReady({ url: 'http://localhost:1/', fetchFn, sleep: async (ms) => { sleeps.push(ms); } }), true);
  assert.deepEqual(sleeps, [2000, 2000]);
  const never = async () => ({ ok: true, json: async () => ({ ready: false }) });
  assert.equal(await pollSiteReady({ url: 'u', fetchFn: never, sleep: async () => {}, intervalMs: 1000, timeoutMs: 3000 }), false);
  assert.equal(branchSiteLabel('b'), 'Run the site of branch b and open it');
});

test('handleStartBranchSite refuses (409) while another site holds the port, and launches nothing', async () => {
  const d = root({ branchSites: [rule] });
  const out = await handleStartBranchSite({
    host: 'h', dataRoot: d, bodyText: JSON.stringify({ branch: 'feat/y', project: 'site-a' }),
    launch: async () => { throw new Error('must not launch'); }, isUp: async () => true,
  });
  assert.equal(out.status, 409);
  assert.equal(out.json.busy, true);
  assert.ok(!fs.existsSync(path.join(d, 'run', 'branch-site-feat-y.command')));
});
