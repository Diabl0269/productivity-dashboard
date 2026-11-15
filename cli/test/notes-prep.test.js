/**
 * cli/test/notes-prep.test.js
 * PRO105: the mechanical parts of the daily review-notes run (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { prepNotes, roundReport, checkStats, applyAuto, words, overlap } from '../../shared/notes-prep.js';
import { applyFiling, planFiling } from '../../shared/review-filing.js';

const task = (id, extra = {}) => ({ id, title: id, checked: false, priority: 'medium', type: 'task', subtasks: [], checks: [], links: [], created: '2026-03-01', ...extra });
const note = (n, text, extra = {}) => ({ n, at: '2026-03-01T10:00:00.000Z', text, kind: 'fix', state: 'new', ...extra });
const docWith = () => ({ sections: [
  { id: 'inbox', name: 'Inbox', tasks: [] },
  { id: 'todo', name: 'To do', tasks: [
    task('E1', { type: 'epic', title: 'Canvas pinch spike', lane: 'canvas', labels: ['model:sonnet'] }),
    task('E2', { type: 'epic', title: 'Canvas fixes', lane: 'canvas', labels: ['model:sonnet'] }),
    task('B1', { title: 'Zoom button snaps to the wrong level', parentId: 'E2', description: '## In plain words\nx\n\nHow to check it: y' }),
  ] },
  { id: 'review', name: 'Ready for review', tasks: [
    task('R1', { title: 'Canvas zoom', lane: 'canvas', reviewNotes: [
      note(1, 'Zoom button snaps to wrong level when clicked', { area: 'canvas' }),
      note(2, 'Zoom button snaps to wrong level on double click', { area: 'canvas' }),
      note(3, 'Something unrelated about audio meters being too dim', { area: 'canvas' }),
      note(4, 'No area at all here', {}),
    ] }),
  ] },
  { id: 'done', name: 'Done', tasks: [] },
] });

test('words and overlap ignore filler and are symmetric enough', () => {
  assert.deepEqual([...words('The zoom and the Button')].sort(), ['button', 'zoom']);
  assert.equal(overlap(words('zoom button'), words('zoom button snaps wrong level')), 1);
  assert.equal(overlap(words('meters'), words('zoom button')), 0);
});

test('prep: duplicate hints against open tickets and other notes, flags for a spike epic and no area', () => {
  const res = prepNotes(docWith());
  const n1 = res.items.find(i => i.handle === 'R1#1');
  assert.ok(n1.dupes.some(d => d.kind === 'ticket' && d.id === 'B1'));
  assert.ok(n1.dupes.some(d => d.kind === 'note' && d.handle === 'R1#2'));
  const n3 = res.items.find(i => i.handle === 'R1#3');
  assert.equal(n3.dupes.length, 0);
  assert.ok(res.items.find(i => i.handle === 'R1#4').flags.includes('no-area') || res.unrouted.includes('R1#4'));
  assert.equal(res.counts.notes, res.items.length);
});

test('prep: the first todo epic of the lane is a spike, so it is flagged', () => {
  const doc = docWith();
  const res = prepNotes(doc);
  const target = planFiling(doc).groups[0].epic;
  assert.equal(target.id, 'E1');
  assert.ok(res.items.find(i => i.handle === 'R1#1').flags.includes('spike-epic'));
});

test('prep: a note never matches the ticket it was written on, and an over-full epic is flagged', () => {
  const doc = docWith();
  const todo = doc.sections[1].tasks;
  for (let i = 0; i < 8; i++) todo.push(task(`X${i}`, { title: `filler ${i}`, parentId: 'E1' }));
  const res = prepNotes(doc);
  assert.ok(res.items.find(i => i.handle === 'R1#1').flags.some(f => /^epic-has-8-open$/.test(f)));
  assert.ok(!res.items.some(i => i.dupes.some(d => d.id === 'R1')));
});

test('report: note -> ticket lines, raw titles, and epic readiness after a real send', () => {
  const doc = docWith();
  doc.sections[1].tasks = doc.sections[1].tasks.filter(t => t.id !== 'E1'); // no spike in this round
  let n = 10;
  applyFiling(doc, planFiling(doc), { newId: () => `N${++n}`, now: '2026-03-02T09:00:00.000Z' });
  const rep = roundReport(doc, '2026-03-02T08:00:00Z');
  assert.ok(rep.lines.length >= 3);
  assert.ok(rep.lines.every(l => l.epic === 'E2' && l.model !== '' && l.raw === true));
  assert.equal(rep.epics.length, 1);
  assert.equal(rep.epics[0].id, 'E2');
  // a ticket made before the run start is not part of the round
  assert.equal(roundReport(doc, '2026-03-05').lines.length, 0);
});

test('report: a rewritten ticket is not raw, and applyAuto adds the label once to a ready epic only', () => {
  const doc = docWith();
  doc.sections[1].tasks = doc.sections[1].tasks.filter(t => t.id !== 'E1');
  let n = 10;
  applyFiling(doc, planFiling(doc), { newId: () => `N${++n}`, now: '2026-03-02T09:00:00.000Z' });
  const first = doc.sections.flatMap(s => s.tasks).find(t => t.id === 'N11');
  first.title = 'Zoom snaps to the right level on click';
  first.description = '## In plain words\nz\n\n**How to check it:** do it';
  const rep = roundReport(doc, '2026-03-02');
  assert.equal(rep.lines.find(l => l.id === 'N11').raw, false);
  const e = rep.epics[0];
  const changed = applyAuto(doc, rep);
  assert.deepEqual(changed, e.candidate ? ['E2'] : []);
  assert.deepEqual(applyAuto(doc, roundReport(doc, '2026-03-02')), []);
  if (e.candidate) assert.ok(doc.sections[1].tasks.find(t => t.id === 'E2').labels.includes('auto'));
});

test('report (PRO110): verified vs skipped checks and tickets still not investigated', () => {
  const doc = docWith();
  doc.sections[1].tasks = doc.sections[1].tasks.filter(t => t.id !== 'E1');
  let n = 10;
  applyFiling(doc, planFiling(doc), { newId: () => `N${++n}`, now: '2026-03-02T09:00:00.000Z' });
  const rest = doc.sections.flatMap(s => s.tasks);
  const rewritten = rest.find(t => t.id === 'N11');
  rewritten.description = '## In plain words\nz'; rewritten.title = 'Zoom snaps on click';
  const host = rest.find(t => t.id === 'R1');
  host.updated = '2026-03-02';
  host.checks = [
    { text: 'a', checked: false, agentVerified: { at: '2026-03-02T10:00:00Z', by: 'agent', result: 'pass', note: 'ran it for real' } },
    { text: 'b', checked: false },
    { text: 'c', checked: true },
    { text: 'd', checked: false, agentVerified: { at: '2026-02-01T10:00:00Z', by: 'agent', result: 'pass', note: 'older run' } },
  ];
  const rep = roundReport(doc, '2026-03-02T08:00:00Z');
  assert.equal(rep.checks.verified, 1);
  assert.deepEqual(rep.checks.skippedChecks, ['R1#2']);
  assert.ok(!rep.notInvestigated.includes('N11'));
  assert.ok(rep.notInvestigated.length >= 2);
  assert.deepEqual(checkStats(doc, '2026-03-05'), { verified: 0, skipped: 0, skippedChecks: [] });
});

test('CLI: notes prep and notes report run on a fixture tracker', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pro105-'));
  fs.copyFileSync(path.join(root, 'cli/test/fixtures/tasks.sample.json'), path.join(home, 'tasks.json'));
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'cli/index.js'), 'tasks', ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  const none = run('notes', 'prep');
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /No new review notes/);
  const bad = run('notes', 'report');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr + bad.stdout, /--since/);
  const rep = run('notes', 'report', '--since', '2026-03-01');
  assert.equal(rep.status, 0, rep.stderr);
  assert.match(rep.stdout, /No notes were filed/);
  assert.match(rep.stdout, /5d: \d+ verified, \d+ skipped/);
  assert.match(rep.stdout, /not investigated: 0/);
  const j = JSON.parse(run('notes', 'report', '--since', '2026-03-01', '--json').stdout);
  assert.deepEqual(j.notInvestigated, []);
  assert.equal(typeof j.checks.verified, 'number');
});
