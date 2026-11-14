// PRO97: needs-tal Unverified lines of done children show on the Plan page while the epic is in progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRunPlan } from '../../shared/run-plan.js';

const LINE = 'needs-tal: hardware: Ctrl+Space opens the palette on a real keyboard';

function doc({ epicSection = 'in-progress', childSection = 'done', unverified = [LINE], asks = [], epicResult } = {}) {
  const child = { id: 'C1', title: 'Palette key', type: 'task', parentId: 'E1', result: { at: '2026-11-10T10:00:00.000Z', shipped: ['x'], ci: 'all passed', unverified } };
  const epic = { id: 'E1', title: 'Palette epic', type: 'epic', lane: 'a', asks };
  if (epicResult) epic.result = epicResult;
  const sibling = { id: 'C2', title: 'Still open', type: 'task', parentId: 'E1' };
  return { sections: [
    { id: epicSection, tasks: [epic] },
    { id: childSection, tasks: [child] },
    { id: 'todo', tasks: [sibling] },
  ] };
}

test('an in-progress epic with a done child carrying a needs-tal line shows it in openChecks', () => {
  const plan = computeRunPlan(doc());
  assert.deepEqual(plan.openChecks.map(r => r.id), ['E1']);
  assert.deepEqual(plan.openChecks[0].lines, [{ from: 'C1', text: 'hardware: Ctrl+Space opens the palette on a real keyboard' }]);
  assert.deepEqual(plan.openChecks[0].checks, { done: 0, total: 1 });
});

test('a child the dashboard has archived still counts as done', () => {
  assert.equal(computeRunPlan(doc({ childSection: 'archive' })).openChecks.length, 1);
});

test('the rolled-up copy on the epic and the child own line show once', () => {
  const plan = computeRunPlan(doc({ epicResult: { at: '2026-11-10T10:00:00.000Z', shipped: ['C1: x'], ci: 'all passed', unverified: [`C1: ${LINE}`] } }));
  assert.equal(plan.openChecks[0].lines.length, 1);
});

test('nothing shows when the child is not done, the line is resolved, or it is not a needs-tal line', () => {
  assert.deepEqual(computeRunPlan(doc({ childSection: 'in-progress' })).openChecks, []);
  assert.deepEqual(computeRunPlan(doc({ unverified: [] })).openChecks, []);
  assert.deepEqual(computeRunPlan(doc({ unverified: ['tried: hardware: no controller attached'] })).openChecks, []);
});

test('a ticked check on the epic does not show; an unticked one still does', () => {
  const d = doc({ unverified: [] });
  d.sections[0].tasks[0].checks = [{ text: 'look', checked: true, addedAt: '2026-11-10T10:00:00.000Z' }];
  assert.deepEqual(computeRunPlan(d).openChecks, []);
  d.sections[0].tasks[0].checks.push({ text: 'listen', checked: false, addedAt: '2026-11-10T10:00:00.000Z' });
  assert.deepEqual(computeRunPlan(d).openChecks[0].checks, { done: 1, total: 2 });
});

test('a line an open ask already puts stays hidden; a resolved ask does not hide it', () => {
  const ask = (state) => ({ n: 1, at: '2026-11-11T10:00:00.000Z', text: 'Does Ctrl+Space open the palette on a real keyboard?', state });
  assert.deepEqual(computeRunPlan(doc({ asks: [ask('open')] })).openChecks, []);
  assert.equal(computeRunPlan(doc({ asks: [ask('answered')] })).openChecks.length, 1);
});

test('epics in review are unchanged: their lines are not in openChecks', () => {
  const plan = computeRunPlan(doc({ epicSection: 'review' }));
  assert.deepEqual(plan.openChecks, []);
  assert.deepEqual(plan.review.map(r => r.id), ['E1']);
});
