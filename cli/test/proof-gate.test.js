/**
 * cli/test/proof-gate.test.js
 * PRO37: `ch tasks review` refuses a ui/audio ticket whose Unverified lines lack an allowed
 * reason tag, or that has neither evidence nor a tagged line; `--force "<why>"` overrides and is
 * recorded. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { unverifiedTag, proofGateProblem, splitForceReason, proofLabels } from '../../shared/proof-gate.js';
import { validateTasksDoc } from '../lib/schema.js';
import { loadTasksJson, serializeTasksJson } from '../../dashboard/js/tasks-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

test('unverifiedTag reads the four allowed tags only', () => {
  assert.equal(unverifiedTag('taste: does it feel smooth'), 'taste');
  assert.equal(unverifiedTag('  Hardware: real controller'), 'hardware');
  assert.equal(unverifiedTag('outside:API deploy'), 'outside');
  assert.equal(unverifiedTag('consent: OS prompt, Tal away'), 'consent');
  assert.equal(unverifiedTag('not looked at on screen'), null);
  assert.equal(unverifiedTag('taste:'), null, 'a tag needs text after it');
  assert.equal(unverifiedTag('screen: not looked at'), null);
  assert.equal(unverifiedTag('needs-tal: taste: does the fade feel smooth'), 'taste');
  assert.equal(unverifiedTag('tried: hardware: no controller attached'), 'hardware');
  assert.equal(unverifiedTag('needs-tal: only Tal can say'), null, 'the hook prefix alone is not a reason');
  assert.equal(unverifiedTag('tried: opened the screen, the build crashed'), null);
});

test('proofLabels reads ui/audio on the ticket or its epic', () => {
  assert.deepEqual(proofLabels({ labels: ['ui'] }, null), ['ui']);
  assert.deepEqual(proofLabels({ labels: [] }, { labels: ['audio'] }), ['audio']);
  assert.deepEqual(proofLabels({ labels: ['model:sonnet'] }, { labels: [] }), []);
});

test('proofGateProblem: untagged refused, tagged or evidence accepted, other tickets untouched', () => {
  const ui = { id: 'X1', labels: ['ui'] };
  assert.match(proofGateProblem({ task: ui, unverified: ['not looked at on screen'] }), /taste:[\s\S]*hardware:/);
  assert.match(proofGateProblem({ task: ui, unverified: [] }), /--evidence/);
  assert.equal(proofGateProblem({ task: ui, unverified: ['taste: smooth?'] }), null);
  assert.equal(proofGateProblem({ task: ui, unverified: [], hasEvidence: true }), null);
  assert.match(proofGateProblem({ task: ui, unverified: ['taste: ok', 'skipped'], hasEvidence: true }), /Untagged \(1\)/);
  assert.equal(proofGateProblem({ task: { id: 'X2', labels: [] }, unverified: ['skipped'] }), null);
});

test('splitForceReason: bare --force stays, --force "<why>" carries the reason', () => {
  assert.deepEqual(splitForceReason(['T1', '--force']), ['T1', '--force']);
  assert.deepEqual(splitForceReason(['T1', '--force', '--check', 'c']), ['T1', '--force', '--check', 'c']);
  assert.deepEqual(splitForceReason(['T1', '--force', 'machine busy']), ['T1', '--force', '--force-reason', 'machine busy']);
  assert.deepEqual(splitForceReason(['T1', '--force=why']), ['T1', '--force', '--force-reason', 'why']);
});

function makeHome({ epicLabel = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-proof-test-'));
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  const t1 = doc.sections.flatMap(s => s.tasks).find(t => t.id === 'T1');
  if (epicLabel) {
    const epic = { id: 'T900', title: 'UI epic', type: 'epic', priority: 'medium', checked: false, labels: ['ui'], subtasks: [] };
    doc.sections[0].tasks.push(epic);
    t1.parentId = 'T900';
    t1.labels = [];
  } else {
    t1.labels = ['ui'];
  }
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc));
  fs.mkdirSync(path.join(home, 'evidence', 'T1'), { recursive: true });
  fs.writeFileSync(path.join(home, 'evidence', 'T1', 'shot.png'), 'PNG');
  return home;
}
const run = (args, home) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
};
const readDoc = (home) => JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
const taskOf = (home, id) => readDoc(home).sections.flatMap(s => s.tasks).find(t => t.id === id);
const base = ['tasks', 'review', 'T1', '--shipped', 'a', '--check', 'Drag the fader: the meter follows'];

test('ch tasks review on a ui ticket: untagged line refused with the allowed list', () => {
  const home = makeHome();
  const r = run([...base, '--unverified', 'not looked at on screen'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /taste:/);
  assert.match(r.stderr, /consent:/);
  assert.notEqual(taskOf(home, 'T1').checked, true, 'nothing written');
});

test('ch tasks review on a ui ticket: tagged line accepted', () => {
  const home = makeHome();
  const r = run([...base, '--unverified', 'taste: does it feel smooth'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(validateTasksDoc(readDoc(home)).errors || [], []);
});

test('ch tasks review on a ui ticket: no proof at all refused, --evidence accepted and recorded', () => {
  const home = makeHome();
  let r = run(base, home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--evidence/);
  r = run([...base, '--evidence', 'T1/shot.png'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(taskOf(home, 'T1').reviewEvidence, ['T1/shot.png']);
  assert.match(run(['tasks', 'get', 'T1'], home).stdout, /evidence: T1\/shot\.png/);
});

test('--evidence refuses a missing file and a path outside the evidence folder', () => {
  const home = makeHome();
  assert.notEqual(run([...base, '--evidence', 'T1/none.png'], home).status, 0);
  assert.notEqual(run([...base, '--evidence', '../tasks.json'], home).status, 0);
  assert.notEqual(run([...base, '--evidence', '/etc/hosts'], home).status, 0);
});

test('--force "<why>" accepts and records the reason; a bare --force does not pass the proof gate', () => {
  const home = makeHome();
  let r = run([...base, '--unverified', 'not looked at', '--force'], home);
  assert.notEqual(r.status, 0);
  r = run([...base, '--unverified', 'not looked at', '--force', 'machine busy'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskOf(home, 'T1').forcedReview.reason, 'machine busy');
  assert.match(run(['tasks', 'get', 'T1'], home).stdout, /forced review: machine busy/);
});

test('the ui label on the epic applies to its child', () => {
  const home = makeHome({ epicLabel: true });
  assert.notEqual(run([...base, '--unverified', 'skipped'], home).status, 0);
  assert.equal(run([...base, '--unverified', 'hardware: real controller'], home).status, 0);
});

test('review --force T1 still reads T1 as the id', () => {
  const home = makeHome();
  const r = run(['tasks', 'review', '--force', 'T1', '--shipped', 'a', '--check', 'c', '--unverified', 'taste: ok'], home);
  assert.equal(r.status, 0, r.stderr);
});

test('the dashboard keeps reviewEvidence and forcedReview when it saves', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), 'utf8'));
  Object.assign(doc.sections[0].tasks[0], { reviewEvidence: ['T1/shot.png'], forcedReview: { reason: 'machine busy', at: '2026-11-07T00:00:00Z' } });
  const mem = loadTasksJson(JSON.stringify(doc));
  const out = JSON.parse(serializeTasksJson(mem.sections, mem.tasks)).sections[0].tasks[0];
  assert.deepEqual(out.reviewEvidence, ['T1/shot.png']);
  assert.equal(out.forcedReview.reason, 'machine busy');
});
