/**
 * cli/test/run-plan.test.js
 * Tests for shared/run-plan.js (computeRunPlan) and `ch tasks runplan`.
 * Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { computeRunPlan, isPickGate, modelOf, laneDisplayName } from '../../shared/run-plan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

function task(id, extra = {}) {
  return { id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], ...extra };
}
function epic(id, extra = {}) { return task(id, { type: 'epic', title: `Epic ${id}`, ...extra }); }
function mkDoc(tasks, pinned) {
  return {
    version: 1,
    meta: { dailyPlan: { date: '2026-01-01', taskIds: pinned, carriedIds: [] } },
    sections: [{ id: 'todo', name: 'Todo', tasks }],
  };
}
/** Doc with tasks spread over sections: { todo: [...], 'in-progress': [...] }. */
function mkSectionDoc(bySection, pinned) {
  const doc = mkDoc([], pinned);
  doc.sections = Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks }));
  return doc;
}
const lane = (plan, name) => plan.lanes.find(l => l.lane === name);
const ids = cards => cards.map(c => `${c.id}${c.isRest ? '+' : ''}`);

test('pick gate: Co-task title or label only; Design: is not a gate', () => {
  assert.equal(isPickGate({ title: 'Co-task: choose' }), true);
  assert.equal(isPickGate({ title: 'co-TASK : x' }), true);
  assert.equal(isPickGate({ title: 'x', labels: ['Co-Task'] }), true);
  assert.equal(isPickGate({ title: 'Design: colours' }), false);
  assert.equal(isPickGate({ title: 'x', labels: ['design'] }), false);
});

test('ready epic: now card with ticket count and command', () => {
  const doc = mkDoc([epic('E1', { lane: 'a' }), task('T2', { parentId: 'E1' }), task('T3', { parentId: 'E1', checked: true })], ['E1']);
  const plan = computeRunPlan(doc);
  const [c] = lane(plan, 'a').now;
  assert.equal(c.state, 'ready');
  assert.equal(c.openTickets, 1);
  assert.equal(c.command, '/ship-task E1');
  assert.equal(lane(plan, 'a').later.length, 0);
});

test('same-lane blocker is ordering, not waiting', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a', blockedBy: ['E2'] }), task('T11', { parentId: 'E1' }),
    epic('E2', { lane: 'a' }), task('T12', { parentId: 'E2' }),
  ], ['E1', 'E2']);
  const l = lane(computeRunPlan(doc), 'a');
  assert.deepEqual(ids(l.now), ['E2', 'E1']);
  assert.equal(l.later.length, 0);
  assert.match(l.now[1].why, /Runs after E2/);
});

test('cross-lane blocker -> later, and flips to now when it closes', () => {
  const tasks = [
    epic('E1', { lane: 'a' }), task('T2', { parentId: 'E1' }),
    epic('E3', { lane: 'b', blockedBy: ['E1'] }), task('T4', { parentId: 'E3' }),
  ];
  const plan = computeRunPlan(mkDoc(tasks, ['E1', 'E3']));
  assert.deepEqual(ids(lane(plan, 'b').later), ['E3']);
  assert.equal(lane(plan, 'b').later[0].state, 'later');
  assert.match(lane(plan, 'b').later[0].why, /Needs E1/);
  tasks[1].checked = true;
  const after = computeRunPlan(mkDoc(tasks, ['E1', 'E3']));
  assert.deepEqual(ids(lane(after, 'b').now), ['E3']);
  assert.deepEqual(after.doneEpics, ['E1']);
});

test('cross-lane child-level blocker also makes the epic later', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a' }), task('T2', { parentId: 'E1' }),
    epic('E3', { lane: 'b' }), task('T4', { parentId: 'E3', blockedBy: ['T2'] }),
  ], ['E1', 'E3']);
  assert.deepEqual(ids(lane(computeRunPlan(doc), 'b').later), ['E3']);
});

test('partial renders twice with the same command', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a' }),
    task('T2', { parentId: 'E1', title: 'Co-task: pick palette' }),
    task('T3', { parentId: 'E1', blockedBy: ['T2'] }),
    task('T4', { parentId: 'E1' }),
  ], ['E1']);
  const l = lane(computeRunPlan(doc), 'a');
  assert.equal(l.now[0].state, 'partial');
  assert.equal(l.now[0].openTickets, 1);
  assert.equal(l.later[0].state, 'later');
  assert.equal(l.later[0].isRest, true);
  assert.equal(l.later[0].openTickets, 1);
  assert.equal(l.now[0].command, l.later[0].command);
  assert.match(l.now[0].why, /Stops at your T2 pick/);
  assert.match(l.later[0].why, /Needs your T2 pick/);
});

test('all tickets gated by an open pick -> later', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a' }),
    task('T2', { parentId: 'E1', labels: ['co-task'] }),
    task('T3', { parentId: 'E1', blockedBy: ['T2'] }),
  ], ['E1']);
  const l = lane(computeRunPlan(doc), 'a');
  assert.equal(l.now.length, 0);
  assert.deepEqual(ids(l.later), ['E1']);
  assert.match(l.later[0].why, /your T2 pick/);
});

test('in-lane blocker that is later makes the dependant later', () => {
  const base = [
    epic('E1', { lane: 'a' }), task('T2', { parentId: 'E1' }),
    epic('E3', { lane: 'b' }), task('T4', { parentId: 'E3' }),
    epic('E5', { lane: 'b', blockedBy: ['E3'] }), task('T6', { parentId: 'E5' }),
  ];
  const pins = ['E1', 'E3', 'E5'];
  const l = lane(computeRunPlan(mkDoc(base, pins)), 'b');
  assert.deepEqual(ids(l.now), ['E3', 'E5']);
  const blocked = base.map(t => (t.id === 'E3' ? { ...t, blockedBy: ['E1'] } : t));
  const l2 = lane(computeRunPlan(mkDoc(blocked, pins)), 'b');
  assert.deepEqual(ids(l2.later), ['E3', 'E5']);
  assert.equal(l2.now.length, 0);
});

test('done epics are counted and skipped', () => {
  const doc = mkDoc([
    epic('E1'), task('T2', { parentId: 'E1', checked: true }),
    epic('E3', { checked: true }),
    epic('E4'), task('T5', { parentId: 'E4' }),
  ], ['E1', 'E3', 'E4']);
  const plan = computeRunPlan(doc);
  assert.deepEqual(plan.doneEpics, ['E1', 'E3']);
  assert.deepEqual(plan.lanes.flatMap(l => ids(l.now)), ['E4']);
});

test('design lane appears when picks exist, with a prompt card and a human card', () => {
  const doc = mkDoc([
    epic('F1', { lane: 'a' }),
    task('F2', { parentId: 'F1', title: 'Co-task: pick A' }),
    task('F3', { parentId: 'F1', blockedBy: ['F2'] }),
    task('F4', { parentId: 'F1', labels: ['Co-task'], title: 'pick B' }),
  ], ['F1']);
  const plan = computeRunPlan(doc);
  assert.equal(plan.lanes[0].lane, 'design');
  assert.equal(plan.lanes[0].name, 'Design round');
  assert.equal(plan.lanes[0].needsBuild, false);
  assert.equal(plan.lanes[0].now.length, 1);
  const [prompt] = plan.lanes[0].now;
  assert.equal(prompt.title, 'Draw the 2 pick canvases');
  assert.match(prompt.command, /^Draw the design canvases for F2 and F4 \(one board per ticket/);
  assert.match(prompt.command, /then stop for my picks\.$/);
  assert.deepEqual(plan.picks.map(p => ({ id: p.id, gates: p.gates })), [{ id: 'F2', gates: ['F1'] }, { id: 'F4', gates: ['F1'] }]);
  assert.equal(computeRunPlan(mkDoc([epic('E1'), task('T2', { parentId: 'E1' })], ['E1'])).lanes.some(l => l.lane === 'design'), false);
});

test('Design: ticket is built by an agent: no pick, no design lane', () => {
  const doc = mkDoc([epic('E1', { lane: 'a' }), task('T2', { parentId: 'E1', title: 'Design: layout' }), task('T3', { parentId: 'E1', blockedBy: ['T2'] })], ['E1']);
  const plan = computeRunPlan(doc);
  assert.equal(plan.picks.length, 0);
  assert.equal(plan.lanes[0].lane, 'a');
  assert.equal(plan.lanes[0].now[0].state, 'ready');
});

test('epics without a lane go to unassigned, shown as "No lane yet"', () => {
  const l = computeRunPlan(mkDoc([epic('E1'), task('T2', { parentId: 'E1' })], ['E1'])).lanes[0];
  assert.equal(l.lane, 'unassigned');
  assert.equal(l.name, 'No lane yet');
});

test('needsBuild and appLaneCount: FRO prefix or agentsynth/frontend project', () => {
  const doc = mkDoc([
    epic('FRO1', { lane: 'app' }), task('FRO2', { parentId: 'FRO1' }),
    epic('E3', { lane: 'proj', project: 'agentsynth' }), task('T4', { parentId: 'E3' }),
    epic('E5', { lane: 'web', project: 'website' }), task('T6', { parentId: 'E5' }),
  ], ['FRO1', 'E3', 'E5']);
  const plan = computeRunPlan(doc);
  assert.equal(lane(plan, 'app').needsBuild, true);
  assert.equal(lane(plan, 'proj').needsBuild, true);
  assert.equal(lane(plan, 'web').needsBuild, false);
  assert.equal(plan.appLaneCount, 2);
  assert.equal(plan.machineCap, 3);
  assert.equal(computeRunPlan(doc, { machineCap: 5 }).machineCap, 5);
});

test('cycles do not crash and keep every epic', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a', blockedBy: ['E2'] }), task('T3', { parentId: 'E1' }),
    epic('E2', { lane: 'a', blockedBy: ['E1'] }), task('T5', { parentId: 'E2' }),
    epic('E6', { lane: 'b', blockedBy: ['E7'] }), task('T8', { parentId: 'E6', blockedBy: ['T9'] }), task('T9', { parentId: 'E6', blockedBy: ['T8'] }),
    epic('E7', { lane: 'c', blockedBy: ['E6'] }), task('T10', { parentId: 'E7' }),
  ], ['E1', 'E2', 'E6', 'E7']);
  const plan = computeRunPlan(doc);
  const all = plan.lanes.flatMap(l => [...l.now, ...l.later].map(c => c.id));
  for (const id of ['E1', 'E2', 'E6', 'E7']) assert.ok(all.includes(id), id);
});

test('CLI: ch tasks runplan --json and text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-runplan-'));
  const doc = mkDoc([
    epic('T1', { lane: 'alpha' }), task('T2', { parentId: 'T1', title: 'Co-task: pick' }),
    task('T3', { parentId: 'T1', blockedBy: ['T2'] }), task('T4', { parentId: 'T1' }),
  ], ['T1']);
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc));
  const run = args => spawnSync(process.execPath, [CH_SCRIPT, 'tasks', ...args], {
    env: { ...process.env, CH_HOME: dir }, encoding: 'utf8',
  });
  const j = run(['runplan', '--json']);
  assert.equal(j.status, 0, j.stderr);
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.lanes[0].lane, 'design');
  assert.equal(parsed.lanes[1].now[0].command, '/ship-task T1');
  assert.equal(parsed.picks[0].id, 'T2');
  const t = run(['runplan']);
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /Lane: Design round/);
  assert.match(t.stdout, /Lane: Alpha/);
  assert.match(t.stdout, /-- after your pick T2 --/);
  assert.match(t.stdout, /\/ship-task T1/);
  assert.match(t.stdout, /At most 3 app builds at once \(0 could start now\)/);
});

test('dashboard tasks.json round-trip preserves lane', async () => {
  const { loadTasksJson, serializeTasksJson } = await import('../../dashboard/js/tasks-json.js');
  const doc = mkDoc([epic('T1', { lane: 'alpha' })], ['T1']);
  const mem = loadTasksJson(JSON.stringify(doc));
  assert.equal(mem.tasks.todo[0].lane, 'alpha');
  const out = JSON.parse(serializeTasksJson(mem.sections, mem.tasks, mem.ticketTypes, mem.meta));
  assert.equal(out.sections[0].tasks[0].lane, 'alpha');
});

test('dashboard routing knows the runplan tab', async () => {
  global.window = { location: { pathname: '/dashboard/runplan' }, history: { replaceState() {}, pushState() {} }, addEventListener() {} };
  const { parseRoute, buildPath } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.tab, 'runplan');
  assert.equal(buildPath(route), '/dashboard/runplan');
});

test('design round splits pick gates into draw, pick and publish stages', () => {
  const canvas = [{ label: 'Design canvas', url: 'https://x/c' }];
  const decisions = [{ at: '2026-01-01T00:00:00Z', text: 'Option B' }];
  const gate = (id, extra) => task(id, { parentId: 'E1', title: `Co-task: pick ${id}`, ...extra });
  const stages = tasks => computeRunPlan(mkDoc([epic('E1', { lane: 'a' }), ...tasks], ['E1']));
  const designNow = plan => plan.lanes[0].now;

  let plan = stages([gate('D1'), gate('D2', { links: canvas, waitingOn: 'Claude: revise' })]);
  assert.deepEqual(designNow(plan).map(c => c.id), ['design-canvases']);
  assert.match(designNow(plan)[0].command, /canvases for D1 and D2 /);

  plan = stages([gate('P1', { links: canvas }), gate('P2', { waitingOn: 'Tal: decide' }),
    gate('P3', { links: canvas, decisions, waitingOn: 'Tal: more' })]);
  assert.deepEqual(designNow(plan).map(c => c.id), ['design-picks']);
  assert.equal(designNow(plan)[0].why, 'Picks: P1, P2 and P3');
  assert.equal(designNow(plan)[0].command, null);

  plan = stages([gate('U1', { links: canvas, decisions }), gate('U2', { decisions, waitingOn: 'someone' })]);
  const [pub] = designNow(plan);
  assert.deepEqual(designNow(plan).map(c => c.id), ['design-publish']);
  assert.equal(pub.title, 'Publish the 2 picked designs to the Design System');
  assert.equal(pub.state, 'ready');
  assert.equal(pub.isPrompt, true);
  assert.equal(pub.why, 'An agent adds the chosen options to the Design System');
  assert.match(pub.command, /^Publish the picked designs for U1 and U2 to the AgentSynth Design System and Storybook/);

  plan = stages([gate('M1'), gate('M2', { links: canvas }), gate('M3', { links: canvas, decisions })]);
  assert.deepEqual(designNow(plan).map(c => c.id), ['design-canvases', 'design-picks', 'design-publish']);
  assert.match(designNow(plan)[0].command, /canvases for M1 /);
  assert.equal(designNow(plan)[1].why, 'Picks: M2');
  assert.match(designNow(plan)[2].command, /designs for M3 /);
  assert.deepEqual(plan.picks.map(p => p.stage), ['draw', 'pick', 'publish']);
  assert.equal(designNow(stages([gate('S1', { links: canvas, decisions })]))[0].title, 'Publish the 1 picked design to the Design System');
});

test('inProgress: epic itself, or an open child, in the in-progress section', () => {
  const own = computeRunPlan(mkSectionDoc({
    'in-progress': [epic('E1', { lane: 'a' })], todo: [task('T2', { parentId: 'E1' })],
  }, ['E1']));
  assert.equal(lane(own, 'a').now[0].inProgress, true);

  const viaChild = computeRunPlan(mkSectionDoc({
    todo: [epic('E1', { lane: 'a' }), epic('E3', { lane: 'b' }), task('T4', { parentId: 'E3' })],
    'in-progress': [task('T2', { parentId: 'E1' })],
  }, ['E1', 'E3']));
  assert.equal(lane(viaChild, 'a').now[0].inProgress, true);
  assert.equal(lane(viaChild, 'b').now[0].inProgress, false);
});

test('inProgress: a done child in the in-progress section does not count', () => {
  const plan = computeRunPlan(mkSectionDoc({
    todo: [epic('E1', { lane: 'a' }), task('T3', { parentId: 'E1' })],
    'in-progress': [task('T2', { parentId: 'E1', checked: true })],
  }, ['E1']));
  assert.equal(lane(plan, 'a').now[0].inProgress, false);
});

test('waitsOn: a later card that needs a cross-lane epic names the epic, not a pick', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a' }), task('T2', { parentId: 'E1' }),
    epic('E3', { lane: 'b', blockedBy: ['E1'] }), task('T4', { parentId: 'E3' }),
  ], ['E1', 'E3']);
  const plan = computeRunPlan(doc);
  assert.deepEqual(lane(plan, 'b').waitsOn, { picks: [], epics: ['E1'] });
  assert.deepEqual(lane(plan, 'a').waitsOn, { picks: [], epics: [] });
});

test('waitsOn: picks from partial and gated cards, sorted and deduped, with epics', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a' }),
    task('T10', { parentId: 'E1', title: 'Co-task: pick X' }),
    task('T2', { parentId: 'E1', title: 'Co-task: pick Y' }),
    task('T3', { parentId: 'E1', blockedBy: ['T10', 'T2'] }), task('T4', { parentId: 'E1' }),
    epic('E5', { lane: 'b', blockedBy: ['E1'] }), task('T6', { parentId: 'E5' }),
  ], ['E1', 'E5']);
  const plan = computeRunPlan(doc);
  assert.deepEqual(lane(plan, 'a').waitsOn, { picks: ['T2', 'T10'], epics: [] });
  assert.deepEqual(lane(plan, 'b').waitsOn, { picks: [], epics: ['E1'] });
});

test('step: unrelated epics without a lane all start together; a dependant is step 1', () => {
  const free = computeRunPlan(mkDoc([
    epic('E1'), task('T2', { parentId: 'E1' }), epic('E3'), task('T4', { parentId: 'E3' }),
    epic('E5'), task('T6', { parentId: 'E5' }),
  ], ['E1', 'E3', 'E5']));
  assert.deepEqual(lane(free, 'unassigned').now.map(c => c.step), [0, 0, 0]);

  const chained = lane(computeRunPlan(mkDoc([
    epic('E1', { blockedBy: ['E3'] }), task('T2', { parentId: 'E1' }), epic('E3'), task('T4', { parentId: 'E3' }),
    epic('E5'), task('T6', { parentId: 'E5' }),
  ], ['E1', 'E3', 'E5'])), 'unassigned');
  assert.deepEqual(chained.now.map(c => [c.id, c.step]), [['E3', 0], ['E5', 0], ['E1', 1]]);
});

test('step: named lanes keep position order', () => {
  const l = lane(computeRunPlan(mkDoc([
    epic('E1', { lane: 'a' }), task('T2', { parentId: 'E1' }), epic('E3', { lane: 'a' }), task('T4', { parentId: 'E3' }),
  ], ['E1', 'E3'])), 'a');
  assert.deepEqual(l.now.map(c => c.step), [0, 1]);
});

test('appStartCount counts step-0 build epics across lanes', () => {
  const plan = computeRunPlan(mkDoc([
    epic('FRO1'), task('FRO2', { parentId: 'FRO1' }), epic('FRO3'), task('FRO4', { parentId: 'FRO3' }),
    epic('FRO5', { blockedBy: ['FRO1'] }), task('FRO6', { parentId: 'FRO5' }),
    epic('E7', { lane: 'web' }), task('T8', { parentId: 'E7' }),
    epic('FRO9', { lane: 'app' }), task('FRO10', { parentId: 'FRO9' }),
    epic('FRO11', { lane: 'app' }), task('FRO12', { parentId: 'FRO11' }),
  ], ['FRO1', 'FRO3', 'FRO5', 'E7', 'FRO9', 'FRO11']));
  // unassigned: FRO1, FRO3 start now (FRO5 waits on FRO1); app lane: only FRO9 first; web: no build.
  assert.equal(plan.appStartCount, 3);
  assert.equal(plan.appLaneCount, 2);
});

test('cards carry the model from the epic model: label, null without one', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a', labels: ['model:opus'] }), task('T2', { parentId: 'E1' }),
    epic('E3', { lane: 'b' }), task('T4', { parentId: 'E3' }),
  ], ['E1', 'E3']);
  const cards = computeRunPlan(doc).lanes.flatMap(l => l.now);
  assert.equal(cards.find(c => c.id === 'E1').model, 'Opus');
  assert.equal(cards.find(c => c.id === 'E3').model, null);
  assert.equal(modelOf({ labels: ['x', 'model: sonnet'] }), 'Sonnet');
});

test('lane names are shown capitalized, slugs stay raw', () => {
  assert.equal(laneDisplayName('timeline'), 'Timeline');
  assert.equal(laneDisplayName('mod-lanes'), 'Mod lanes');
  assert.equal(laneDisplayName('ai'), 'AI');
  const l = computeRunPlan(mkDoc([epic('E1', { lane: 'timeline' }), task('T2', { parentId: 'E1' })], ['E1'])).lanes[0];
  assert.equal(l.lane, 'timeline');
  assert.equal(l.name, 'Timeline');
});

test('co-tasks that need no design get a to-do card, not a canvas', () => {
  const doc = mkDoc([
    epic('E1', { lane: 'a' }),
    task('T2', { parentId: 'E1', title: 'Co-task: submit the form' }),
    task('T3', { parentId: 'E1', title: 'Co-task: pick the layout' }),
    task('T4', { parentId: 'E1', title: 'Co-task: icons', labels: ['design'] }),
  ], ['E1']);
  const plan = computeRunPlan(doc);
  const design = plan.lanes[0];
  assert.equal(design.name, 'Design round');
  assert.match(design.now.find(c => c.id === 'design-canvases').command, /canvases for T3 and T4 /);
  const todo = design.now.find(c => c.id === 'co-tasks');
  assert.equal(todo.why, 'Co-tasks: T2');
  assert.equal(plan.picks.find(p => p.id === 'T2').stage, 'todo');
  const withCanvas = computeRunPlan(mkDoc([epic('E1', { lane: 'a' }),
    task('T2', { parentId: 'E1', title: 'Co-task: revisit shapes', links: [{ label: 'Design canvas', url: 'https://x' }] })], ['E1']));
  assert.equal(withCanvas.picks[0].stage, 'pick');
  const only = computeRunPlan(mkDoc([epic('E1', { lane: 'a' }), task('T2', { parentId: 'E1', title: 'Co-task: check it' })], ['E1']));
  assert.equal(only.lanes[0].name, 'Co-tasks');
  assert.deepEqual(only.lanes[0].now.map(c => c.id), ['co-tasks']);
});
