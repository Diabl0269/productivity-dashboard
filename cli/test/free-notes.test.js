/**
 * cli/test/free-notes.test.js
 * PRO121: free notes (a note with no ticket, `meta.freeNotes`, handle `free#n`): the store helpers,
 * schema + lint, filing (planFiling / applyFiling), prep and report, and the `ch tasks notes` commands
 * on both storage layouts. Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  addFreeNote, editFreeNote, setFreeNoteState, parseNoteHandle, pendingReviewNotes, countUnsentNotes,
  freeNoteErrors, normalizeFreeNotes,
} from '../../shared/review-notes.js';
import { planFiling, applyFiling } from '../../shared/review-filing.js';
import { prepNotes, roundReport } from '../../shared/notes-prep.js';
import { nextTaskId } from '../../shared/task-ids.js';
import { validateTasksDoc, normalizeTasksDoc } from '../lib/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH = path.resolve(__dirname, '../../ch');
const AT = '2026-10-01T10:00:00.000Z';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);

const task = (id, over = {}) => ({
  id, title: `Ticket ${id}`, checked: false, priority: 'medium', type: 'task',
  created: '2026-10-01', updated: null, subtasks: [], checks: [], ...over,
});

/** A bakery: an open "oven" epic in todo, a later bucket for "oven", one review ticket with a note. */
function makeDoc() {
  const ids = ['inbox', 'backlog', 'todo', 'in-progress', 'review', 'done', 'archive'];
  const doc = { version: 1, meta: { projects: [{ id: 'bakery', prefix: 'BKR' }] }, sections: ids.map(id => ({ id, name: id, tasks: [] })) };
  const put = (section, t) => doc.sections.find(s => s.id === section).tasks.push(t);
  put('todo', task('BKR1', { title: 'Oven fixes', type: 'epic', lane: 'oven', project: 'bakery', labels: ['model:sonnet'] }));
  put('backlog', task('BKR2', { title: 'Oven: later', type: 'epic', lane: 'oven', project: 'bakery', labels: ['model:sonnet'] }));
  put('review', task('BKR3', {
    parentId: 'BKR1', project: 'bakery', labels: ['ui'], checks: [{ text: 'Timer beeps', checked: true }],
    reviewNotes: [{ n: 1, at: AT, text: 'timer beep too quiet', kind: 'fix', state: 'new' }],
  }));
  return doc;
}
const newId = (doc) => (project) => nextTaskId(doc.sections.flatMap(s => s.tasks), project || null, doc.meta.projects);
const find = (doc, id) => doc.sections.flatMap(s => s.tasks.map(t => ({ t, s: s.id }))).find(r => r.t.id === id);

test('addFreeNote stores in meta.freeNotes, numbers never reuse, needs a project; handles parse', () => {
  const doc = makeDoc();
  const a = addFreeNote(doc, { text: ' crust burns ', project: 'bakery', area: 'oven', where: 'oven-box', now: AT });
  assert.deepEqual(a, { n: 1, at: AT, text: 'crust burns', kind: 'fix', state: 'new', area: 'oven', project: 'bakery', where: 'oven-box' });
  const b = addFreeNote(doc, { text: 'idea', kind: 'idea', project: 'bakery', now: AT });
  setFreeNoteState(doc, 2, 'dismissed');
  assert.equal(addFreeNote(doc, { text: 'third', project: 'bakery', now: AT }).n, 3, 'n is never reused');
  assert.equal(b.area, undefined);
  assert.throws(() => addFreeNote(doc, { text: 'x' }), /needs a project/);
  assert.throws(() => addFreeNote(doc, { text: 'x', project: 'bakery', area: 'Bad Area' }), /invalid area/);
  assert.throws(() => setFreeNoteState(doc, 2, 'dismissed'), /already dismissed/);
  assert.deepEqual(parseNoteHandle('free#4'), { id: 'free', n: 4, free: true });
  assert.deepEqual(parseNoteHandle('BKR3#2'), { id: 'BKR3', n: 2 });
  editFreeNote(doc, 1, { text: 'crust burns at 250', kind: 'design', area: '' });
  assert.equal(doc.meta.freeNotes[0].text, 'crust burns at 250');
  assert.equal(doc.meta.freeNotes[0].kind, 'design');
  assert.equal(doc.meta.freeNotes[0].area, undefined);
});

test('pendingReviewNotes and countUnsentNotes include open free notes, one entry each', () => {
  const doc = makeDoc();
  addFreeNote(doc, { text: 'crust burns', project: 'bakery', area: 'oven', now: AT });
  addFreeNote(doc, { text: 'gone', project: 'bakery', now: AT });
  setFreeNoteState(doc, 2, 'dismissed');
  const pending = pendingReviewNotes(doc);
  assert.equal(pending.length, 2);
  assert.deepEqual({ ...pending[1], notes: pending[1].notes.map(n => n.n) },
    { id: 'free', title: 'Free note', type: 'free', lane: 'oven', project: 'bakery', section: null, notes: [1] });
  assert.equal(countUnsentNotes(doc), 2);
  assert.equal(countUnsentNotes({ sections: [] }), 0, 'no meta reads as no free notes');
});

test('schema: normalize keeps free notes, an absent list stays absent, lint flags bad ones', () => {
  const doc = makeDoc();
  normalizeTasksDoc(doc);
  assert.equal('freeNotes' in doc.meta, false, 'no migration: absent reads as empty and is not written');
  addFreeNote(doc, { text: 'crust burns', project: 'bakery', area: 'oven', where: 'oven-box', now: AT });
  normalizeTasksDoc(doc);
  assert.equal(doc.meta.freeNotes.length, 1);
  assert.deepEqual(validateTasksDoc(doc).errors, []);
  doc.meta.freeNotes.push({ n: 1, at: 'yesterday', text: '', kind: 'nope', state: 'new' });
  const errs = validateTasksDoc(doc).errors.join('\n');
  for (const want of ['freeNotes[1].n 1 is not unique', 'freeNotes[1].at', 'freeNotes[1].kind', 'freeNotes[1].project']) assert.match(errs, new RegExp(want.replace(/[[\]]/g, '\\$&')));
  assert.deepEqual(freeNoteErrors('x'), ['doc.meta.freeNotes must be an array']);
  assert.equal(normalizeFreeNotes(doc.meta.freeNotes).length, 1, 'the malformed one is dropped');
});

test('filing: a free note routes by its own area; no area is unrouted; idea goes to the later bucket; design files a pair', () => {
  const doc = makeDoc();
  addFreeNote(doc, { text: 'crust burns', project: 'bakery', area: 'oven', where: 'oven-box', now: AT, images: ['free/0123456789abcdef.png'] });
  addFreeNote(doc, { text: 'nowhere to go', project: 'bakery', now: AT });
  addFreeNote(doc, { text: 'a pizza mode', kind: 'idea', project: 'bakery', area: 'oven', now: AT });
  addFreeNote(doc, { text: 'new dial look', kind: 'design', project: 'bakery', area: 'oven', now: AT });
  const plan = planFiling(doc);
  const next = plan.groups.find(g => g.epic.id === 'BKR1');
  assert.deepEqual(next.items.map(i => i.handle), ['BKR3#1', 'free#1', 'free#4'], 'mixed with the review note in one group');
  assert.deepEqual(plan.groups.find(g => g.epic.id === 'BKR2').items.map(i => i.handle), ['free#3']);
  assert.deepEqual(plan.unrouted, [{ handle: 'free#2', reason: 'needs an area' }]);
  assert.deepEqual(planFiling(doc, { ticket: 'free' }).groups.flatMap(g => g.items.map(i => i.handle)), ['free#1', 'free#4', 'free#3']);

  const out = applyFiling(doc, plan, { newId: newId(doc), now: AT });
  const filed = Object.fromEntries(out.filed.map(f => [f.handle, f.id]));
  assert.deepEqual(Object.keys(filed).sort(), ['BKR3#1', 'free#1', 'free#3', 'free#4']);
  const fix = find(doc, filed['free#1']).t;
  assert.equal(fix.parentId, 'BKR1');
  assert.equal(fix.project, 'bakery');
  assert.equal(fix.reviewOf, undefined, 'a free note has no source ticket');
  assert.deepEqual(fix.labels, ['model:sonnet']);
  assert.match(fix.description, /from a free note \(2026-10-01\)\. Place: oven-box\./);
  assert.match(fix.description, /Filed by File review from note free#1\./);
  assert.deepEqual(fix.notes[0].images, ['free/0123456789abcdef.png']);
  assert.equal(find(doc, filed['BKR3#1']).t.reviewOf, 'BKR3', 'the review note still files as before');
  assert.equal(find(doc, filed['free#3']).t.parentId, 'BKR2');
  const build = find(doc, filed['free#4']).t;
  assert.equal(build.blockedBy.length, 1);
  assert.match(find(doc, build.blockedBy[0]).t.title, /^Co-task: pick new dial look/);
  const notes = doc.meta.freeNotes;
  assert.deepEqual(notes.map(n => [n.n, n.state, n.filed || null]), [[1, 'filed', filed['free#1']], [2, 'new', null], [3, 'filed', filed['free#3']], [4, 'filed', filed['free#4']]]);
  assert.equal(find(doc, 'BKR3').s, 'done', 'the review ticket still closes once its own note is filed');
  assert.deepEqual(validateTasksDoc(doc).errors, []);
});

test('prep: free notes get routes, flags and duplicate hints against tickets and other notes; report lists them', () => {
  const doc = makeDoc();
  doc.sections.find(s => s.id === 'todo').tasks.push(task('BKR9', { title: 'Timer beep too quiet on the oven', project: 'bakery', parentId: 'BKR1' }));
  addFreeNote(doc, { text: 'oven timer beep too quiet', project: 'bakery', area: 'oven', now: AT });
  addFreeNote(doc, { text: 'no home', project: 'bakery', now: AT });
  const prep = prepNotes(doc);
  const free1 = prep.items.find(i => i.handle === 'free#1');
  assert.equal(free1.epic.id, 'BKR1');
  assert.ok(free1.dupes.some(d => d.kind === 'ticket' && d.id === 'BKR9'), 'compares with open tickets');
  assert.ok(free1.dupes.some(d => d.kind === 'note' && d.handle === 'BKR3#1'), 'compares with the review notes of the round');
  assert.deepEqual(prep.items.find(i => i.handle === 'free#2').flags, ['no-area']);
  assert.deepEqual(prep.unrouted, ['free#2']);

  applyFiling(doc, planFiling(doc), { newId: newId(doc), now: AT });
  const report = roundReport(doc, '2026-10-01');
  const line = report.lines.find(l => l.handle === 'free#1');
  assert.equal(line.epic, 'BKR1');
  assert.equal(line.model, 'sonnet');
  assert.equal(line.raw, true);
});

// ---- the CLI, on both storage layouts ----

function home(layout = 'single') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-free-notes-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(makeDoc(), null, 2) + '\n');
  const run = (...args) => spawnSync(process.execPath, [CH, 'tasks', ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  if (layout === 'split') assert.equal(run('split').status, 0);
  return { dir, run };
}
const readDoc = (dir) => {
  if (fs.existsSync(path.join(dir, 'tasks.d', 'index.json'))) return JSON.parse(fs.readFileSync(path.join(dir, 'tasks.d', 'index.json'), 'utf8'));
  return JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
};

for (const layout of ['single', 'split']) {
  test(`ch tasks notes: add --free, list, prep, route, send, report, edit and dismiss (${layout} layout)`, () => {
    const { dir, run } = home(layout);
    const img = path.join(dir, 'shot.png');
    fs.writeFileSync(img, PNG);
    let r = run('notes', 'add', '--free', 'crust burns', '--project', 'bakery', '--area', 'oven', '--where', 'oven-box', '--image', img);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /added free#1/);
    r = run('notes', 'add', '--free', 'no home yet', '--project', 'bakery', '--kind', 'idea');
    assert.match(r.stdout, /added free#2 \(no area yet/);
    assert.match(run('notes', 'add', '--free', 'x').stderr, /needs --project/);
    assert.match(run('notes', 'add', '--free', 'x', '--project', 'nope').stderr, /unknown project "nope"/);
    assert.equal(run('lint').status, 0);

    const stored = readDoc(dir).meta.freeNotes;
    assert.equal(stored.length, 2, 'free notes live in the document meta (index.json when split)');
    assert.match(stored[0].images[0], /^free\/[0-9a-f]{16}\.png$/);
    assert.ok(fs.existsSync(path.join(dir, 'attachments', stored[0].images[0])), 'the image is stored under attachments/free/');

    r = run('notes');
    assert.match(r.stdout, /free note project:bakery lane:oven place:oven-box\n {2}free#1 \[fix\]: crust burns \(1 image\)/);
    assert.match(r.stdout, /BKR3#1 \[fix\]: timer beep too quiet/);
    assert.match(r.stdout, /image: .*attachments\/free\//);
    assert.equal(JSON.parse(run('notes', '--ticket', 'free', '--json').stdout).length, 2);
    assert.match(run('notes', 'prep').stdout, /free#2 \[note\]\n {2}-> no epic {2}FLAGS: no-area/);
    assert.match(run('notes', 'route', '--ticket', 'free').stdout, /Needs an area:\n {2}free#2/);

    assert.equal(run('notes', 'edit', 'free#2', 'still no home').status, 0);
    r = run('notes', 'send');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /filed BKR3#1 -> BKR\d+ \(in BKR1\)/);
    assert.match(r.stdout, /filed free#1 -> BKR\d+ \(in BKR1\)/);
    assert.match(r.stdout, /Needs an area: free#2/);
    assert.match(run('notes', 'report', '--since', '2000-01-01').stdout, /free#1 -> BKR\d+, model:sonnet, BKR1/);
    assert.match(run('notes', 'dismiss', 'free#1').stderr, /already filed/);
    assert.match(run('notes', 'dismiss', 'free#2').stdout, /dismissed free#2/);
    assert.match(run('notes').stdout, /No new review notes/);
    const after = readDoc(dir).meta.freeNotes;
    assert.deepEqual(after.map(n => n.state), ['filed', 'dismissed']);
    assert.equal(run('lint').status, 0);
  });
}
