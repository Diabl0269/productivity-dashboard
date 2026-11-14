/**
 * cli/test/ask-check-overlap.test.js
 * PRO90: one judgement, one card. sameJudgement / overlaps (shared/ask-check-overlap.js), `ch tasks ask`
 * and `ch tasks review` refusing a question and a check that repeat each other (--same-judgement links
 * them, --not-same proceeds), answering ticking the linked checks with a note (also the epic's prefixed
 * copy), dismiss not ticking, and taste checks folding near-duplicates. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { normalizeJudgement, sameJudgement, overlapsForAsk, overlapsForCheck, linkedCheckKeys } from '../../shared/ask-check-overlap.js';
import { addAsk, answerAsk, askErrors, cleanAsks, tickLinkedChecks, resolveAsk } from '../../shared/asks.js';
import { foldTasteChecks } from '../lib/taste-checks.js';
import { validateTasksDoc } from '../lib/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const DETAILS = 'Open the Reverb panel on the master bus and compare the mix at 30 percent against 50; it sets the default.';
const PR = 'https://github.com/example/demo/pull/42';

function makeHome({ epic = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-overlap-test-'));
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/tasks.sample.json'), 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  const t1 = doc.sections.flatMap(s => s.tasks).find(t => t.id === 'T1');
  t1.labels = [];
  if (epic) {
    doc.sections.find(s => s.id === 'todo').tasks.push({ id: 'T9', title: 'Epic', type: 'epic', checked: false, priority: 'medium', subtasks: [] });
    t1.parentId = 'T9';
  }
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc));
  const abs = path.join(dir, 'evidence/T1/a.agsproj');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
  return dir;
}
const run = (args, dir) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
};
const taskOf = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).sections.flatMap(s => s.tasks).find(t => t.id === id);
const review = (dir, extra = []) => run(['tasks', 'review', 'T1', '--shipped', 'a', '--check', 'Reverb Mix at 30% sounds right', ...extra], dir);
const ASK = ['tasks', 'ask', 'T1', 'Does Reverb Mix 30% sound right?', '--details', DETAILS, '--project', 'T1/a.agsproj'];

test('normalizeJudgement strips the rolled prefix, "taste:" and punctuation', () => {
  assert.equal(normalizeJudgement('FRO12: taste: Reverb Mix 30%?'), 'reverb mix 30');
});

test('sameJudgement: near-duplicates match, unrelated texts do not', () => {
  assert.ok(sameJudgement('Reverb Mix at 30% sounds right', 'taste: Reverb Mix 30%?'));
  assert.ok(sameJudgement('Reverb Mix at 30% sounds right', 'T1: Reverb Mix at 30% sounds right'));
  assert.ok(sameJudgement('Does the caption colour match the track header?', 'Caption colour matches the track header'));
  assert.ok(sameJudgement('Is the delay feedback knob label readable at small size', 'the delay feedback knob label readable at small size, in dark mode'));
  assert.ok(!sameJudgement('Reverb Mix at 30% sounds right', 'Open the export dialog: the file name field is focused'));
  assert.ok(!sameJudgement('Does the glide feel right?', 'Does the vibrato feel right?'));
  assert.ok(!sameJudgement('', 'anything here'));
});

test('overlapsForAsk / overlapsForCheck: text, ticked and handed checks are skipped, merge ask matches a held-PR check', () => {
  const checks = [
    { id: 'T1', n: 1, check: { text: 'Reverb Mix at 30% sounds right', checked: false } },
    { id: 'T1', n: 2, check: { text: 'Reverb Mix at 30% sounds right!', checked: true } },
    { id: 'T1', n: 3, check: { text: 'Reverb Mix 30% sounds right', checked: false, handedTo: 'T5' } },
    { id: 'T1', n: 4, check: { text: 'Try on branch x, then say merge or not', checked: false, heldPr: { pr: PR, branch: 'x' } } },
  ];
  assert.deepEqual(overlapsForAsk({ text: 'Does Reverb Mix 30% sound right?' }, checks).map(e => e.n), [1]);
  assert.deepEqual(overlapsForAsk({ text: 'Merge it?', mergePr: `${PR}/` }, checks).map(e => e.n), [4]);
  const asks = [{ id: 'T1', ask: { text: 'Does Reverb Mix 30% sound right?' } }, { id: 'T1', ask: { text: 'Merge?', mergePr: PR } }];
  assert.equal(overlapsForCheck({ text: 'taste: Reverb Mix 30%' }, asks).length, 1);
  assert.equal(overlapsForCheck({ text: 'Try on branch x', heldPr: { pr: PR, branch: 'x' } }, asks).length, 1);
  assert.equal(overlapsForCheck({ text: 'Reverb Mix 30%', checked: true }, asks).length, 0);
  assert.deepEqual([...linkedCheckKeys([{ checkRefs: [{ id: 'T1', text: 'a' }] }])], ['T1\0a']);
});

test('CLI: ask refused on an overlapping check, linked with --same-judgement, allowed with --not-same', () => {
  const dir = makeHome();
  assert.equal(review(dir).status, 0);
  let r = run(ASK, dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /T1 check 1: Reverb Mix at 30% sounds right/);
  assert.match(r.stderr, /One judgement shows once: pass --same-judgement/);
  assert.equal((taskOf(dir, 'T1').asks || []).length, 0);

  r = run([...ASK, '--not-same', ' '], dir);
  assert.notEqual(r.status, 0, 'a reason is required');
  r = run([...ASK, '--same-judgement', '--not-same', 'x'], dir);
  assert.notEqual(r.status, 0, 'not both');

  r = run([...ASK, '--not-same', 'this one is about the default, not the 30% value'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskOf(dir, 'T1').asks[0].notSame, 'this one is about the default, not the 30% value');
  assert.equal(taskOf(dir, 'T1').asks[0].checkRefs, undefined);

  const dir2 = makeHome();
  review(dir2);
  r = run([...ASK, '--same-judgement'], dir2);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(taskOf(dir2, 'T1').asks[0].checkRefs, [{ id: 'T1', text: 'Reverb Mix at 30% sounds right' }]);
  assert.deepEqual(validateTasksDoc(JSON.parse(fs.readFileSync(path.join(dir2, 'tasks.json'), 'utf8'))).errors ?? [], []);
});

test('CLI: answering ticks the linked check with the note; dismiss does not', () => {
  const dir = makeHome();
  review(dir);
  assert.equal(run([...ASK, '--option', 'A: keep 30', '--option', 'B: 50', '--same-judgement'], dir).status, 0);
  const r = run(['tasks', 'answer', 'T1', 'A'], dir);
  assert.equal(r.status, 0, r.stderr);
  const c = taskOf(dir, 'T1').checks[0];
  assert.equal(c.checked, true);
  assert.equal(c.checkedNote, 'answered on question 1: A: keep 30');
  assert.ok(c.checkedAt);

  const d2 = makeHome();
  review(d2);
  run([...ASK, '--same-judgement'], d2);
  assert.equal(run(['tasks', 'answer', 'T1', '--dismiss'], d2).status, 0);
  assert.equal(taskOf(d2, 'T1').checks[0].checked, false);
  const d3 = makeHome();
  review(d3);
  run([...ASK, '--same-judgement'], d3);
  assert.equal(run(['tasks', 'answer', 'T1', '--park', 'later'], d3).status, 0);
  assert.equal(taskOf(d3, 'T1').checks[0].checked, false);
});

test('CLI: a child under an epic: the epic copy is linked and ticked', () => {
  const dir = makeHome({ epic: true });
  assert.equal(review(dir).status, 0);
  assert.equal(taskOf(dir, 'T9').checks[0].text, 'T1: Reverb Mix at 30% sounds right');
  let r = run(ASK, dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /T9 check 1: T1: Reverb Mix at 30% sounds right/);
  r = run([...ASK, '--same-judgement'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(taskOf(dir, 'T1').asks[0].checkRefs, [{ id: 'T9', text: 'T1: Reverb Mix at 30% sounds right' }]);
  r = run(['tasks', 'answer', 'T1', 'yes, keep it'], dir);
  assert.equal(r.status, 0, r.stderr);
  const c = taskOf(dir, 'T9').checks[0];
  assert.equal(c.checked, true);
  assert.equal(c.checkedNote, 'answered on question 1: yes, keep it');
  assert.match(run(['tasks', 'get', 'T9'], dir).stdout, /T1: Reverb Mix at 30% sounds right/);
});

test('CLI: review refused when a new check overlaps an open ask; --same-judgement links it, --not-same proceeds', () => {
  const dir = makeHome();
  assert.equal(run(ASK, dir).status, 0);
  let r = review(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /a new check repeats an open question/);
  assert.match(r.stderr, /T1 question 1: Does Reverb Mix 30% sound right\?/);
  assert.ok(!taskOf(dir, 'T1').checked);
  r = review(dir, ['--same-judgement']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(taskOf(dir, 'T1').asks[0].checkRefs, [{ id: 'T1', text: 'Reverb Mix at 30% sounds right' }]);
  // re-running the same review is not refused again: the check is already linked
  assert.equal(review(dir).status, 0);
  assert.equal(run(['tasks', 'answer', 'T1', 'fine'], dir).status, 0);
  assert.equal(taskOf(dir, 'T1').checks[0].checked, true);

  const d2 = makeHome();
  run(ASK, d2);
  assert.equal(review(d2, ['--not-same', 'the ask is about the default']).status, 0);
});

test('CLI: review --ask that repeats one of the call\'s checks goes through the same rule', () => {
  const dir = makeHome();
  const base = ['tasks', 'review', 'T1', '--shipped', 'a', '--check', 'Glide time 200ms is the default', '--ask', 'Is glide time 200ms the default?', '--ask-details', DETAILS];
  const r = run(base, dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /this question repeats a check/);
  assert.match(r.stderr, /T1 new check: Glide time 200ms is the default/);
  assert.equal(run([...base, '--same-judgement'], dir).status, 0);
  assert.deepEqual(taskOf(dir, 'T1').asks[0].checkRefs, [{ id: 'T1', text: 'Glide time 200ms is the default' }]);
});

test('merge ask vs a held-PR check: the same PR is one judgement', () => {
  const task = { id: 'T1', checks: [{ text: 'Try on branch x, then say merge or not', checked: false, heldPr: { pr: PR, branch: 'x' } }] };
  const hits = overlapsForAsk({ text: 'Merge it?', mergePr: PR }, [{ id: 'T1', check: task.checks[0], n: 1 }]);
  assert.equal(hits.length, 1);
  const ask = addAsk(task, { text: 'Merge it?', mergePr: PR, details: DETAILS, checkRefs: hits.map(h => ({ id: h.id, text: h.check.text })) });
  assert.deepEqual(ask.checkRefs, [{ id: 'T1', text: task.checks[0].text }]);
});

test('answerAsk ticks linked checks across tickets; resolveAsk reports them; schema and loaders keep the fields', () => {
  const doc = { sections: [{ id: 'todo', tasks: [
    { id: 'T1', checks: [{ text: 'looks right', checked: false }], asks: [] },
    { id: 'T2', checks: [] },
  ] }] };
  const t1 = doc.sections[0].tasks[0];
  addAsk(t1, { text: 'Does it look right?', details: DETAILS, media: { image: 'T1/a.png' }, checkRefs: [{ id: 'T1', text: 'looks right' }], notSame: 'n', now: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(askErrors(t1, 'T1'), []);
  const cleaned = cleanAsks(t1).asks[0];
  assert.deepEqual(cleaned.checkRefs, [{ id: 'T1', text: 'looks right' }]);
  assert.equal(cleaned.notSame, 'n');
  assert.ok(askErrors({ asks: [{ ...t1.asks[0], checkRefs: [{ id: 'bad', text: '' }] }] }, 'x').some(e => /checkRefs/.test(e)));
  const out = answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'yes', now: '2026-01-02T00:00:00.000Z' });
  assert.deepEqual(out.ticked, [{ id: 'T1', text: 'looks right' }]);
  assert.equal(t1.checks[0].checkedNote, 'answered on question 1: yes');
  // the dashboard path: resolveAsk + tickLinkedChecks on its own tickets
  const t = { id: 'T3', checks: [{ text: 'c', checked: false }] };
  addAsk(t, { text: 'Is it fine to look at?', details: DETAILS, media: { image: 'T3/a.png' }, checkRefs: [{ id: 'T3', text: 'c' }] });
  const r = resolveAsk(t, '1', { action: 'done', reply: '' });
  assert.equal(tickLinkedChecks(id => (id === 'T3' ? t : null), r).length, 1);
  assert.equal(t.checks[0].checkedNote, 'answered on question 1: done');
});

test('foldTasteChecks: a project-less near-duplicate folds into the same-judgement check', () => {
  const targets = [{ text: 'Reverb Mix at 30% sounds right', checked: false }, { text: 'Other thing', checked: false }];
  const rest = foldTasteChecks([{ text: 'Reverb Mix 30%', video: 'T1/a.mp4', taste: true }, { text: 'Unrelated glow colour', taste: true }], targets);
  assert.deepEqual(rest.map(c => c.text), ['Unrelated glow colour']);
  assert.equal(targets[0].video, 'T1/a.mp4');
  assert.equal(targets[0].text, 'Reverb Mix at 30% sounds right', 'text untouched');
});
