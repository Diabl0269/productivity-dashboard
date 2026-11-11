/**
 * cli/test/epic-ready.test.js
 * PRO61 / PRO62: epic Ready state (shared/epic-ready.js), lanes that no longer depend on pins,
 * `ch tasks ready`, pins meaning focus, and review cards. Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { epicReadiness, openEpicReadiness, readinessLabel, howToCheckText } from '../../shared/epic-ready.js';
import { computeRunPlan } from '../../shared/run-plan.js';
import { cleanupPins } from '../../shared/pin-rules.js';
import { normalizeMeta } from '../lib/schema.js';
import { normalizeTasksMeta } from '../../dashboard/js/tasks-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

const PLAIN = (how = 'open the panel and look at the title') =>
  `## In plain words\n**What you'll notice:** x\n**Why it matters:** y\n**How to check it:** ${how}\n\n## Technical detail (for Claude)\nz`;
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN(), ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane: 'a', description: '', ...extra });
const mk = (bySection, meta) => ({
  version: 1,
  meta: meta || { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } },
  sections: Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks })),
});
const ready = (doc, id) => openEpicReadiness(doc).find(r => r.id === id);

test('ready: todo epic with a runnable child that says how to check it', () => {
  const doc = mk({ todo: [epic('E1'), task('T1', { parentId: 'E1', labels: ['model:haiku'] })] });
  const r = ready(doc, 'E1');
  assert.equal(r.ready, true);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.auto, false);
  assert.equal(r.model, 'sonnet');
  assert.equal(readinessLabel(r), 'Ready');
  assert.deepEqual(r.children, [{ id: 'T1', title: 'Task T1', section: 'todo', runnable: true, why: null, model: 'haiku', needsComputerUse: false, blockedBy: [] }]);
});

test('Auto label shows as Ready · Auto; opus child makes the epic opus', () => {
  const doc = mk({ 'in-progress': [epic('E1', { labels: ['auto'] }), task('T1', { parentId: 'E1', labels: ['model:opus'] })] });
  const r = ready(doc, 'E1');
  assert.equal(r.ready && r.auto, true);
  assert.equal(r.model, 'opus');
  assert.equal(readinessLabel(r), 'Ready · Auto');
});

test('not ready: backlog, later bucket and future bucket, with plain reasons', () => {
  const doc = mk({
    backlog: [epic('E1'), task('T1', { parentId: 'E1' })],
    todo: [epic('E2', { title: 'Timeline: later' }), task('T2', { parentId: 'E2' }),
      epic('E3', { title: 'Custom module (future)' }), task('T3', { parentId: 'E3' })],
  });
  assert.deepEqual(ready(doc, 'E1').reasons, ['in backlog']);
  assert.deepEqual(ready(doc, 'E2').reasons, ['a later bucket']);
  assert.deepEqual(ready(doc, 'E3').reasons, ['a later bucket']);
  assert.match(readinessLabel(ready(doc, 'E1')), /^Not ready: in backlog$/);
});

test('not ready: an open pick or co-task that another child waits on', () => {
  const doc = mk({
    todo: [epic('E1'), task('P1', { parentId: 'E1', title: 'Co-task: pick the colours' }),
      task('T1', { parentId: 'E1', blockedBy: ['P1'] }), task('T2', { parentId: 'E1' })],
  });
  const r = ready(doc, 'E1');
  assert.equal(r.ready, false);
  assert.deepEqual(r.reasons, ['waits on your pick P1']);
  const t1 = r.children.find(c => c.id === 'T1');
  assert.equal(t1.runnable, false);
  assert.equal(t1.why, 'waits on your pick P1');
  assert.deepEqual(t1.blockedBy, ['P1']);
  assert.equal(r.children.find(c => c.id === 'T2').runnable, true);
  // A plain co-task that gates nothing does not stop the other work.
  const solo = mk({ todo: [epic('E1'), task('P1', { parentId: 'E1', title: 'Co-task: send the form' }), task('T2', { parentId: 'E1' })] });
  assert.equal(ready(solo, 'E1').ready, true);
  // Once the pick is done the epic is ready again.
  const done = mk({ todo: [epic('E1'), task('T1', { parentId: 'E1', blockedBy: ['P1'] })], done: [task('P1', { parentId: 'E1', title: 'Co-task: pick', checked: true })] });
  assert.equal(ready(done, 'E1').ready, true);
});

test('not ready: a runnable child with no How to check it', () => {
  const doc = mk({ todo: [epic('E1'), task('FRO12', { parentId: 'E1', description: '## In plain words\n**What you\'ll notice:** x' }), task('T2', { parentId: 'E1' })] });
  assert.deepEqual(ready(doc, 'E1').reasons, ['FRO12 has no How to check it']);
  // The line must sit inside "In plain words", not in the technical section.
  assert.equal(howToCheckText(task('X', { description: '## In plain words\nx\n\n## Technical detail\nHow to check it: no' })), null);
});

test('held children are not runnable but do not block the epic by themselves', () => {
  const doc = mk({ todo: [epic('E1'), task('T1', { parentId: 'E1', labels: ['deploy'] }), task('T2', { parentId: 'E1' })] });
  const r = ready(doc, 'E1');
  assert.equal(r.ready, true);
  const t1 = r.children.find(c => c.id === 'T1');
  assert.equal(t1.runnable, false);
  assert.equal(t1.why, 'held: deploy');
  const allHeld = mk({ todo: [epic('E1'), task('T1', { parentId: 'E1', labels: ['money'] })] });
  assert.equal(ready(allHeld, 'E1').ready, false);
  for (const l of ['public-post', 'needs-approval']) {
    assert.equal(ready(mk({ todo: [epic('E', {}), task('T', { parentId: 'E', labels: [l] })] }), 'E').children[0].runnable, false);
  }
});

test('blocked children and blocked epics', () => {
  const doc = mk({
    todo: [epic('E1'), task('T1', { parentId: 'E1', blockedBy: ['T9'] }), task('T9')],
  });
  const r = ready(doc, 'E1');
  assert.equal(r.ready, false);
  assert.deepEqual(r.children[0].blockedBy, ['T9']);
  assert.equal(r.children[0].why, 'blocked by T9');
  const epicBlocked = mk({ todo: [epic('E1', { blockedBy: ['E2'] }), task('T1', { parentId: 'E1' }), epic('E2', { lane: 'b' }), task('T2', { parentId: 'E2' })] });
  assert.deepEqual(ready(epicBlocked, 'E1').reasons, ['waits on E2']);
});

test('needsComputerUse: label or How to check it wording; the child stays runnable', () => {
  const doc = mk({ todo: [epic('E1'),
    task('T1', { parentId: 'E1', labels: ['computer-use'] }),
    task('T2', { parentId: 'E1', description: PLAIN('Use the menu bar to open Preferences') }),
    task('T3', { parentId: 'E1', description: PLAIN('Look at it in another app') }),
    task('T4', { parentId: 'E1' })] });
  const cu = Object.fromEntries(ready(doc, 'E1').children.map(c => [c.id, [c.needsComputerUse, c.runnable]]));
  assert.deepEqual(cu, { T1: [true, true], T2: [true, true], T3: [true, true], T4: [false, true] });
});

test('needsComputerUse: a decision saying the ticket waits for a run Tal starts; the child stays runnable', () => {
  const dec = text => [{ at: '2026-01-01T00:00:00Z', text }];
  const doc = mk({ todo: [epic('E1'),
    task('T1', { parentId: 'E1', decisions: dec('Skipped. Waits for a run Tal starts.') }),
    task('T2', { parentId: 'E1', decisions: dec('Chose option B') }),
    task('T3', { parentId: 'E1', decisions: ['Left for a run Tal starts'] })] });
  const cu = Object.fromEntries(ready(doc, 'E1').children.map(c => [c.id, [c.needsComputerUse, c.runnable]]));
  assert.deepEqual(cu, { T1: [true, true], T2: [false, true], T3: [true, true] });
});

test('lanes hold in-progress and Ready epics even when nothing is pinned', () => {
  const doc = mk({
    'in-progress': [epic('E1', { lane: 'x', description: '' }), task('T1', { parentId: 'E1', description: '' })],
    todo: [epic('E2', { lane: 'y' }), task('T2', { parentId: 'E2' }), epic('E3', { lane: 'z', title: 'Z: later' }), task('T3', { parentId: 'E3' })],
    backlog: [epic('E4', { lane: 'w' }), task('T4', { parentId: 'E4' })],
  });
  const plan = computeRunPlan(doc);
  assert.deepEqual(plan.lanes.map(l => l.lane).sort(), ['x', 'y']);
  assert.deepEqual(plan.readiness.map(r => [r.id, r.ready]), [['E1', false], ['E2', true], ['E3', false], ['E4', false]]);
  assert.deepEqual(plan.doneEpics, []);
});

test('pins: hand pins are normalized and kept, in the CLI schema and the dashboard one', () => {
  const meta = { dailyPlan: { date: '2026-01-01', taskIds: ['T1'], carriedIds: [], handPinnedIds: ['T1', 'T1', ' T2 '] } };
  assert.deepEqual(normalizeMeta(meta).dailyPlan.handPinnedIds, ['T1', 'T2']);
  assert.deepEqual(normalizeTasksMeta(meta).dailyPlan.handPinnedIds, ['T1', 'T2']);
  assert.equal('handPinnedIds' in normalizeMeta({ dailyPlan: { taskIds: [] } }).dailyPlan, false);
});

test('cleanupPins keeps in-progress and hand pins, drops the rest and finished epics', () => {
  const doc = mk({
    'in-progress': [epic('E1')],
    todo: [epic('E2'), epic('E3'), task('T9')],
    backlog: [epic('E4')],
    done: [epic('E5', { checked: true })],
  }, { dailyPlan: { date: '2026-01-01', taskIds: ['E1', 'E2', 'E3', 'E4', 'E5', 'T9', 'GONE1'], carriedIds: ['E2'], handPinnedIds: ['E3', 'E5'] } });
  const dry = cleanupPins(doc, { dryRun: true });
  assert.deepEqual(dry.map(d => d.id), ['E2', 'E4', 'E5', 'GONE1']);
  assert.equal(doc.meta.dailyPlan.taskIds.length, 7, 'dry run changes nothing');
  cleanupPins(doc);
  assert.deepEqual(doc.meta.dailyPlan.taskIds, ['E1', 'E3', 'T9']);
  assert.deepEqual(doc.meta.dailyPlan.carriedIds, []);
  assert.deepEqual(doc.meta.dailyPlan.handPinnedIds, ['E3']);
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function home(doc) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-ready-'));
  fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc));
  return h;
}
const ch = (h, ...args) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: h }, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const read = h => JSON.parse(fs.readFileSync(path.join(h, 'tasks.json'), 'utf8'));
const find = (doc, id) => { for (const s of doc.sections) { const t = s.tasks.find(x => x.id === id); if (t) return { t, s: s.id }; } return null; };

const cliDoc = () => mk({
  todo: [epic('T1', { labels: ['model:sonnet'] }), task('T2', { parentId: 'T1' }), epic('T3', { lane: 'b', title: 'Timeline: later', labels: ['model:sonnet'] }), task('T4', { parentId: 'T3' })],
  backlog: [epic('T5', { lane: 'c', labels: ['model:sonnet'] }), task('T6', { parentId: 'T5' })],
  'in-progress': [],
});

test('CLI: ch tasks ready lists Ready and Not ready; --auto keeps Ready + Auto; --json shape', () => {
  const h = home(cliDoc());
  const text = ch(h, 'tasks', 'ready');
  assert.equal(text.status, 0, text.err);
  assert.match(text.out, /\[ready\] +T1 /);
  assert.match(text.out, /Not ready: a later bucket/);
  assert.match(text.out, /Not ready: in backlog/);
  assert.equal(ch(h, 'tasks', 'ready', '--auto').out.trim(), 'No epic is Ready with Auto on.');

  assert.equal(ch(h, 'tasks', 'update', 'T1', '--add-label', 'auto').status, 0);
  assert.equal(ch(h, 'tasks', 'update', 'T3', '--add-label', 'auto').status, 0);
  const json = JSON.parse(ch(h, 'tasks', 'ready', '--json').out);
  assert.deepEqual(json.epics.map(e => [e.id, e.ready, e.auto]), [['T1', true, true], ['T3', false, true], ['T5', false, false]]);
  assert.deepEqual(Object.keys(json.epics[0].children[0]), ['id', 'title', 'section', 'runnable', 'why', 'model', 'needsComputerUse', 'blockedBy']);
  const auto = JSON.parse(ch(h, 'tasks', 'ready', '--json', '--auto').out);
  assert.deepEqual(auto.epics.map(e => e.id), ['T1']);

  const rp = ch(h, 'tasks', 'runplan');
  assert.match(rp.out, /Ready state/);
  assert.match(rp.out, /T1\s.*-\s+Ready · Auto/);
  assert.match(rp.out, /T3\s.*-\s+Not ready: a later bucket \(Auto is on\)/);
  assert.match(rp.out, /T5\s.*-\s+Not ready: in backlog/);
  assert.match(rp.out, /Lane: A/, 'the ready epic gets a lane although nothing is pinned');
  assert.match(rp.out, /Epics in one lane run in order; lanes run side by side/);
});

test('CLI: plan --pin remembers a hand pin, --unpin forgets it, --cleanup-pins keeps in-progress + hand pins', () => {
  const doc = cliDoc();
  doc.sections.find(s => s.id === 'in-progress').tasks.push(epic('T7', { lane: 'd' }));
  const h = home(doc);
  assert.equal(ch(h, 'tasks', 'plan', '--pin', 'T1', '--pin', 'T5', '--pin', 'T7', '--pin', 'T3').status, 0);
  assert.deepEqual(read(h).meta.dailyPlan.handPinnedIds, ['T1', 'T5', 'T7', 'T3']);
  assert.equal(ch(h, 'tasks', 'plan', '--unpin', 'T3').status, 0);
  assert.deepEqual(read(h).meta.dailyPlan.handPinnedIds, ['T1', 'T5', 'T7']);

  // Make T1 and T5 look auto-pinned rather than hand-pinned.
  const d = read(h);
  d.meta.dailyPlan.handPinnedIds = ['T1'];
  fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(d));
  const dry = JSON.parse(ch(h, 'tasks', 'plan', '--cleanup-pins', '--dry-run', '--json').out);
  assert.deepEqual(dry.unpinned.map(u => u.id), ['T5']);
  assert.equal(dry.dryRun, true);
  assert.deepEqual(read(h).meta.dailyPlan.taskIds, ['T1', 'T5', 'T7'], 'dry run keeps every pin');
  const real = ch(h, 'tasks', 'plan', '--cleanup-pins');
  assert.match(real.out, /unpinned T5 /);
  assert.deepEqual(read(h).meta.dailyPlan.taskIds, ['T1', 'T7']);
});

test('CLI: moving an epic to in-progress pins it; a todo epic stays unpinned', () => {
  const h = home(cliDoc());
  assert.deepEqual(read(h).meta.dailyPlan.taskIds, []);
  const r = ch(h, 'tasks', 'move', 'T1', 'in-progress');
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(read(h).meta.dailyPlan.taskIds, ['T1']);
  assert.equal('handPinnedIds' in read(h).meta.dailyPlan, false, 'an auto pin is not a hand pin');
});

