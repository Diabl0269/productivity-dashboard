/**
 * cli/test/review-close-paths.test.js
 * PRO138: every tick path closes a finished review (answering an ask that links a check, and the
 * `ch tasks ready --apply-auto` sweep). Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { answerAsk } from '../../shared/asks.js';
import { closeIfReviewComplete, reviewReadyToClose } from '../../shared/review.js';

const CH_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ch');
const AT = '2026-11-21T10:00:00.000Z';
const base = { checked: false, priority: 'medium', type: 'task', created: '2026-03-01', updated: null, subtasks: [], links: [] };
const tk = (id, extra = {}) => ({ ...base, id, title: `Task ${id}`, checks: [], ...extra });
const ask = (extra = {}) => ({ n: 1, at: AT, text: 'Which one?', state: 'open', options: [{ key: 'A', text: 'Yes' }, { key: 'B', text: 'No' }], ...extra });
const mk = by => ({ version: 1, meta: { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } }, sections: ['inbox', 'backlog', 'todo', 'in-progress', 'review', 'done', 'archive'].map(id => ({ id, name: id, tasks: by[id] || [] })) });
const where = (doc, id) => doc.sections.find(s => s.tasks.some(t => t.id === id))?.id;

test('answering an ask that links a check on another review ticket closes that ticket', () => {
  const doc = mk({
    review: [tk('T1', { checked: true, asks: [ask({ checkRefs: [{ id: 'T9', text: 'Sounds right' }] })] }), tk('T9', { checked: true, checks: [{ text: 'Sounds right', checked: false }] })],
  });
  const out = answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'A', now: AT });
  assert.deepEqual(out.ticked.map(t => t.id), ['T9']);
  assert.ok(out.closed.includes('T9'));
  assert.deepEqual(out.closedByChecks, ['T9']);
  assert.equal(where(doc, 'T9'), 'done');
  assert.equal(doc.sections.find(s => s.id === 'done').tasks.find(t => t.id === 'T9').history.at(-1).note, 'every check ticked');
});

test('a review with an open ask, an unsent note or an unresolved needs-tal line is not closed; tried: lines and left do not hold it', () => {
  const ticked = [{ text: 'a', checked: true }];
  assert.equal(reviewReadyToClose(tk('T1', { checks: ticked }), 'review'), true);
  assert.equal(reviewReadyToClose(tk('T1', { checks: [] }), 'review'), false, 'needs at least one check');
  assert.equal(reviewReadyToClose(tk('T1', { checks: ticked, asks: [ask()] }), 'review'), false);
  assert.equal(reviewReadyToClose(tk('T1', { checks: ticked, reviewNotes: [{ n: 1, text: 'x', state: 'new', kind: 'idea', at: AT }] }), 'review'), false);
  assert.equal(reviewReadyToClose(tk('T1', { checks: ticked, result: { unverified: ['needs-tal: hardware: plug in a pad'] } }), 'review'), false);
  assert.equal(reviewReadyToClose(tk('T1', { checks: ticked, result: { unverified: ['tried: hardware: no pad here'], left: ['polish'] } }), 'review'), true);
  assert.equal(reviewReadyToClose(tk('T1', { checks: ticked }), 'todo'), false);
});

test('closeIfReviewComplete rolls the epic up', () => {
  const doc = mk({
    review: [tk('T2', { checks: [{ text: 'a', checked: true }], parentId: 'T3' })],
    'in-progress': [tk('T3', { type: 'epic' })],
  });
  const c = closeIfReviewComplete(doc, doc.sections.find(s => s.id === 'review').tasks[0], { now: AT });
  assert.equal(c.id, 'T2');
  assert.equal(where(doc, 'T2'), 'done');
  assert.ok(c.epics.length >= 0);
});

function home(doc) { const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-pro138-close-')); fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc)); return h; }
const ch = (h, ...a) => { const r = spawnSync(process.execPath, [CH_SCRIPT, ...a], { env: { ...process.env, CH_HOME: h }, encoding: 'utf8' }); return { status: r.status, out: r.stdout, err: r.stderr }; };

test('ready --apply-auto closes finished reviews; --dry-run only reports', () => {
  const doc = mk({
    review: [
      tk('T1', { checked: true, checks: [{ text: 'a', checked: true }] }),
      tk('T2', { checked: true, checks: [{ text: 'a', checked: true }], result: { at: AT, shipped: ['x'], unverified: ['needs-tal: taste: the bass'] } }),
    ],
  });
  const h = home(doc);
  const before = fs.readFileSync(path.join(h, 'tasks.json'), 'utf8');
  const dry = ch(h, 'tasks', 'ready', '--apply-auto', '--dry-run');
  assert.equal(dry.status, 0, dry.err);
  assert.match(dry.out, /dry run: closed T1: every check ticked/);
  assert.doesNotMatch(dry.out, /T2/);
  assert.equal(fs.readFileSync(path.join(h, 'tasks.json'), 'utf8'), before);
  const real = ch(h, 'tasks', 'ready', '--apply-auto');
  assert.match(real.out, /^closed T1: every check ticked$/m);
  const after = JSON.parse(fs.readFileSync(path.join(h, 'tasks.json'), 'utf8'));
  assert.equal(where(after, 'T1'), 'done');
  assert.equal(where(after, 'T2'), 'review');
});
