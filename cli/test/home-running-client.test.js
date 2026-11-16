/**
 * dashboard/js/home-where.js and home-running-data.js (PRO117) in node: fake ctx, fake fetch, no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';

globalThis.document = { hidden: false, addEventListener() {} };

const { selectedEpicIds, ticketInSelection } = await import('../../dashboard/js/home-where.js');
const data = await import('../../dashboard/js/home-running-data.js');

const { config } = normalizeHomeConfig({
  version: 1,
  groups: [{ id: 'shop', name: 'Shop', areas: [{ id: 'counter', name: 'Counter', lanes: ['counter'] }, { id: 'rest', name: 'Rest' }] }],
});
const doc = {
  sections: [{
    id: 'in-progress',
    tasks: [
      { id: 'E1', type: 'epic', title: 'Till', lane: 'counter' },
      { id: 'T1', type: 'task', title: 'Receipt', parentId: 'E1' },
      { id: 'F1', type: 'feature', title: 'Roll', parentId: 'T1' },
      { id: 'E2', type: 'epic', title: 'Other' },
      { id: 'T2', type: 'task', title: 'Orphan' },
    ],
  }],
};
const ctxWith = (area) => ({ selection: () => ({ project: 'bakery', group: area ? 'shop' : null, area, part: null }), config: () => config, doc: () => doc });

test('selectedEpicIds is null without a selection and the place\'s epics with one', () => {
  assert.equal(selectedEpicIds(ctxWith(null)), null);
  assert.deepEqual([...selectedEpicIds(ctxWith('counter'))], ['E1']);
  assert.deepEqual([...selectedEpicIds(ctxWith('rest'))], ['E2']);
  assert.equal(selectedEpicIds({ ...ctxWith('counter'), config: () => null }), null);
});

test('ticketInSelection: no place keeps everything; a place keeps its epic\'s tree (ids, running items, nested tickets)', () => {
  assert.equal(ticketInSelection(ctxWith(null), { id: 'T2' }), true);
  const c = ctxWith('counter');
  assert.equal(ticketInSelection(c, { id: 'E1' }), true);
  assert.equal(ticketInSelection(c, { id: 'T1' }), true);
  assert.equal(ticketInSelection(c, { id: 'F1' }), true);
  assert.equal(ticketInSelection(c, { id: 'T2' }), false);
  assert.equal(ticketInSelection(c, { id: 'X', epicId: 'E1' }), true);
  assert.equal(ticketInSelection(c, { id: 'X', epicId: null }), false);
});

test('running data: fetch, lookups, subscribers, a failed fetch keeps the last answer with a warning', async () => {
  const answers = [
    { project: null, at: 't1', running: [{ id: 'T1' }], loose: [], epics: { E1: { state: 'running', running: ['T1'] } }, byTicket: { T1: { state: 'working' } }, warnings: [] },
  ];
  let fail = false;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(url, /^\/api\/home\/running/);
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => answers[0] };
  };
  const seen = [];
  const off = data.onRunning(a => seen.push(a));
  assert.equal(data.getRunning(), null);
  assert.equal(data.runningFor('T1'), null);
  await data.refreshRunning();
  assert.equal(data.runningFor('T1').state, 'working');
  assert.equal(data.runningFor('nope'), null);
  assert.equal(data.epicRunState('E1').state, 'running');
  assert.equal(data.epicRunState('E9'), null);
  assert.equal(seen.length, 1);
  // a second call while one is in flight shares it
  const p1 = data.refreshRunning();
  const p2 = data.refreshRunning();
  assert.equal(p1, p2);
  await p1;
  assert.equal(calls, 2);
  fail = true;
  await data.refreshRunning();
  assert.equal(data.runningFor('T1').state, 'working', 'last answer kept');
  assert.match(data.getRunning().warnings.join(' '), /could not be refreshed/);
  off();
  await data.refreshRunning();
  assert.equal(seen.length, 3);
});
