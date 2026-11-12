/**
 * cli/test/parked-epics.test.js
 * PRO72: one readiness rule for Plan cards and the Ready strip; epics parked on backlog tickets are
 * named by the card, `ch tasks ready`, `ch tasks lint` and refused by `ch tasks review`.
 * Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openEpicReadiness, parkedAfterClosing } from '../../shared/epic-ready.js';
import { computeRunPlan } from '../../shared/run-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look at the title\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane: 'a', description: '', labels: ['model:sonnet'], ...extra });
const mk = (bySection, meta) => ({
  version: 1,
  meta: meta || { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } },
  sections: Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks })),
});
const cards = plan => plan.lanes.flatMap(l => [...l.now, ...l.later]);

function home(doc) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-parked-'));
  fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc));
  return h;
}
const ch = (h, ...args) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: h }, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const read = h => JSON.parse(fs.readFileSync(path.join(h, 'tasks.json'), 'utf8'));

// A parked epic: its only open child sits in backlog. A second epic is runnable.
const parkedDoc = () => mk({
  todo: [epic('T1'), epic('T2', { lane: 'b' }), task('T3', { parentId: 'T2' })],
  backlog: [task('T4', { parentId: 'T1' })],
  done: [task('T6', { parentId: 'T1', checked: true })],
}, { dailyPlan: { date: '2026-01-01', taskIds: ['T1'], carriedIds: [] } }); // pinned, so it gets a card

test('card: a backlog-parked epic says Not ready and names the parked child, never Ready now', () => {
  const doc = parkedDoc();
  const plan = computeRunPlan(doc);
  const c = cards(plan).find(x => x.id === 'T1');
  assert.equal(c.state, 'notready');
  assert.equal(c.why, 'Not ready: waits on T4 in backlog');
  assert.equal(plan.lanes.find(l => l.lane === 'a').now.some(x => x.id === 'T1'), false);
  assert.equal(cards(plan).find(x => x.id === 'T2').state, 'ready');
});

test('card: an epic whose children are all blocked shows the readiness reason', () => {
  const doc = mk({ 'in-progress': [epic('T1')], todo: [task('T4', { parentId: 'T1', blocked: true })] });
  const c = cards(computeRunPlan(doc)).find(x => x.id === 'T1');
  assert.equal(c.state, 'notready');
  assert.equal(c.why, 'Not ready: no ticket is free to run');
});

test('property: no card in the now list or in state ready belongs to an epic readiness calls Not ready', () => {
  const docs = [
    parkedDoc(),
    mk({ 'in-progress': [epic('T1')], todo: [task('T4', { parentId: 'T1', blocked: true })] }),
    mk({ todo: [epic('T1'), task('T4', { parentId: 'T1', description: 'no how to check' })] }),
    mk({ todo: [epic('T1', { title: 'Things: later' }), task('T4', { parentId: 'T1' })] }),
    mk({ todo: [epic('T1'), task('T4', { parentId: 'T1', labels: ['needs-approval'] })] }),
    mk({ todo: [epic('T1'), epic('T2'), task('T4', { parentId: 'T1', blockedBy: ['T5'] }), task('T5', { parentId: 'T2' })] }),
    mk({ todo: [epic('T1', { title: 'Plain' }), task('T4', { parentId: 'T1' })], backlog: [epic('T2'), task('T5', { parentId: 'T2' })] },
      { dailyPlan: { date: '2026-01-01', taskIds: ['T2'], carriedIds: [] } }),
  ];
  for (const doc of docs) {
    const byId = new Map(openEpicReadiness(doc).map(r => [r.id, r]));
    const plan = computeRunPlan(doc);
    for (const lane of plan.lanes) {
      for (const c of [...lane.now, ...lane.later]) {
        const r = byId.get(c.id);
        if (!r) continue;
        if (r.ready === false) {
          assert.notEqual(c.state, 'ready', `${c.id} is Not ready (${r.reasons.join('; ')}) but its card says Ready now`);
          assert.equal(lane.now.includes(c) && c.state === 'ready', false);
        }
      }
    }
  }
});

test('ready: a parked epic names the backlog ticket; JSON carries parked ids', () => {
  const h = home(parkedDoc());
  const text = ch(h, 'tasks', 'ready');
  assert.equal(text.status, 0, text.err);
  assert.match(text.out, /Not ready: waits on T4 in backlog/);
  const json = JSON.parse(ch(h, 'tasks', 'ready', '--json').out);
  assert.deepEqual(json.epics.find(e => e.id === 'T1').parked, ['T4']);
  assert.deepEqual(json.epics.find(e => e.id === 'T2').parked, []);
});

test('lint: warns about an open epic whose only open tickets are in backlog', () => {
  const h = home(parkedDoc());
  const r = ch(h, 'tasks', 'lint');
  assert.match(r.err, /lint: warning: epic T1 is in todo but its only open tickets are in backlog \(T4\)/);
  assert.doesNotMatch(r.err, /epic T2 is in/);
  const clean = ch(home(mk({ todo: [epic('T1'), task('T4', { parentId: 'T1' })] })), 'tasks', 'lint');
  assert.doesNotMatch(clean.err, /only open tickets are in backlog/);
});

const reviewDoc = () => mk({
  todo: [epic('T1'), task('T5', { parentId: 'T1' })],
  backlog: [task('T4', { parentId: 'T1' })],
});

test('review: refuses to leave the epic with only backlog tickets; --allow-parked overrides', () => {
  assert.deepEqual(parkedAfterClosing(reviewDoc(), reviewDoc().sections[0].tasks[0], 'T5'), ['T4']);
  const h = home(reviewDoc());
  const refused = ch(h, 'tasks', 'review', 'T5', '--shipped', 'x', '--no-checks', 'nothing to look at');
  assert.notEqual(refused.status, 0);
  assert.match(refused.err, /would leave epic T1 with only backlog tickets open \(T4\)/);
  assert.match(refused.err, /"\(later\)" epic or to todo/);
  assert.equal(read(h).sections.find(s => s.id === 'todo').tasks.some(t => t.id === 'T5'), true, 'nothing moved');

  const empty = ch(h, 'tasks', 'review', 'T5', '--shipped', 'x', '--no-checks', 'nothing to look at', '--allow-parked', ' ');
  assert.notEqual(empty.status, 0);
  assert.match(empty.err, /--allow-parked needs a reason/);

  const ok = ch(h, 'tasks', 'review', 'T5', '--shipped', 'x', '--no-checks', 'nothing to look at', '--allow-parked', 'T4 waits on the next release');
  assert.equal(ok.status, 0, ok.err);
  assert.match(ok.err, /only backlog tickets/);
});

test('review: passes when another runnable child stays, or the backlog ticket moved to todo', () => {
  const doc = reviewDoc();
  doc.sections.find(s => s.id === 'todo').tasks.push(task('T3', { parentId: 'T1' }));
  const h = home(doc);
  const r = ch(h, 'tasks', 'review', 'T5', '--shipped', 'x', '--no-checks', 'nothing to look at');
  assert.equal(r.status, 0, r.err);
});
