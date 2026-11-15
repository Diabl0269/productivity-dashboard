// PRO97: needs-tal Unverified lines of done children show on the Plan page while the epic is in progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeRunPlan } from '../../shared/run-plan.js';
import { resolveNeedsTalLine, parseNeedsTalLine } from '../../shared/needs-tal-lines.js';

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

// PRO112: each line is answerable on the Plan page: media shown, tick resolves it, note goes on the source ticket.
test('PRO112: a line with media after a bar carries it and shows clean text', () => {
  assert.deepEqual(parseNeedsTalLine('C1: needs-tal: taste: caption colour | video=C1/a.mp4 project=C1/a.agsproj'),
    { text: 'taste: caption colour', media: { video: 'C1/a.mp4', project: 'C1/a.agsproj' } });
  const plan = computeRunPlan(doc({ unverified: ['needs-tal: taste: caption colour | image=C1/a.png'] }));
  assert.deepEqual(plan.openChecks[0].lines, [{ from: 'C1', text: 'taste: caption colour', media: { image: 'C1/a.png' } }]);
});

test('PRO112: resolveNeedsTalLine drops the line from the child and the epic copy, and only that line', () => {
  const other = 'needs-tal: taste: something else | video=x.mp4';
  const child = { result: { unverified: [LINE, other, 'tried: hardware: no controller'] } };
  const epic = { result: { unverified: [`C1: ${LINE}`] } };
  assert.equal(resolveNeedsTalLine([child, epic], 'hardware: Ctrl+Space opens the palette on a real keyboard'), 2);
  assert.deepEqual(child.result.unverified, [other, 'tried: hardware: no controller']);
  assert.equal(epic.result.unverified, undefined);
  assert.equal(resolveNeedsTalLine([child], 'not there'), 0);
});

test('PRO112 guard: the Plan page needs-tal rows keep a tick box and a note field (every For-you item has an answer control)', () => {
  const src = fs.readFileSync(new URL('../../dashboard/js/run-plan-view.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function renderNeedsTalLines'), src.indexOf('function tickNeedsTalLine'));
  assert.match(body, /type = 'checkbox'/);
  assert.match(body, /noteCell\(/);
});
