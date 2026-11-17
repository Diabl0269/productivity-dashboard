/**
 * shared/home-ticket-rows.js (PRO119): every ticket as one row with one plain state. Synthetic bakery data.
 * State precedence: running > needs you > in review > ready > waiting > later > done.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';
import { openEpicReadiness } from '../../shared/epic-ready.js';
import {
  ticketRows, filterRows, sortRows, groupRows, countByState, compareIds, STATES,
} from '../../shared/home-ticket-rows.js';

const { config } = normalizeHomeConfig({
  version: 1,
  groups: [
    { id: 'shop', name: 'Shop floor', areas: [{ id: 'counter', name: 'Counter', lanes: ['counter'] }] },
    { id: 'kitchen', name: 'Kitchen', areas: [{ id: 'oven', name: 'Oven', lanes: ['oven'], parts: [{ id: 'fan', name: 'Fan', match: 'fan' }] }] },
  ],
});

const PLAIN = '## In plain words\n**How to check it:** open the shop and look.';
const t = (id, o = {}) => ({ id, title: o.title || `Title ${id}`, type: 'task', checked: false, created: '2026-11-01', description: PLAIN, labels: [], ...o });

/** One doc with every state at least once. */
function sample() {
  return {
    sections: [
      { id: 'inbox', tasks: [t('BK90', { title: 'Loose idea' })] },
      { id: 'backlog', tasks: [t('BK80', { type: 'epic', title: 'Later: wild ideas', lane: 'oven' }), t('BK81', { parentId: 'BK80' })] },
      {
        id: 'todo',
        tasks: [
          t('BK1', { type: 'epic', title: 'Counter till', lane: 'counter', labels: ['model:opus'], updated: '2026-11-10' }),
          t('BK2', { parentId: 'BK1', title: 'Print receipts', labels: ['model:sonnet', 'print'], updated: '2026-11-12' }),
          t('BK3', { parentId: 'BK1', title: 'Wait for printer', blockedBy: ['BK2'], updated: '2026-11-11' }),
          t('BK4', { parentId: 'BK1', title: 'Ask owner', waitingOn: 'Tal', updated: '2026-11-09' }),
          t('BK10', { type: 'epic', title: 'Oven fan speed', lane: 'oven', updated: '2026-11-08' }),
          t('BK11', { parentId: 'BK10', description: 'no plain words section' }),
          t('BK20', { type: 'epic', title: 'Empty epic', lane: 'counter' }),
        ],
      },
      { id: 'in-progress', tasks: [t('BK5', { parentId: 'BK1', title: 'Till drawer', links: [{ url: 'https://github.com/acme/bakery/pull/12', label: 'PR' }] })] },
      {
        id: 'review',
        tasks: [
          t('BK30', { title: 'Shipped sign', lane: 'counter', checked: true, checks: [{ text: 'looks right', checked: true }] }),
          t('BK31', { title: 'Shipped menu', lane: 'counter', checks: [{ text: 'tick me', checked: false }] }),
        ],
      },
      { id: 'done', tasks: [t('BK40', { title: 'Old thing', checked: true, lane: 'counter' })] },
      { id: 'archive', tasks: [t('BK41', { title: 'Older thing', checked: true, lane: 'oven' })] },
    ],
  };
}

const readinessOf = doc => Object.fromEntries(openEpicReadiness(doc).map(r => [r.id, r]));
function rowsOf(running = {}) {
  const doc = sample();
  return ticketRows(doc, config, readinessOf(doc), running);
}
const byId = rows => Object.fromEntries(rows.map(r => [r.id, r]));

test('every ticket gets a row with its place, epic and model', () => {
  const rows = byId(rowsOf());
  assert.equal(Object.keys(rows).length, 15);
  assert.equal(rows.BK2.epicId, 'BK1');
  assert.equal(rows.BK2.epicTitle, 'Counter till');
  assert.equal(rows.BK2.placeName, 'Shop floor › Counter');
  assert.equal(rows.BK2.model, 'sonnet');
  assert.deepEqual(rows.BK2.labels, ['print']);
  assert.equal(rows.BK1.epicId, 'BK1');
  assert.equal(rows.BK90.epicId, null);
  assert.equal(rows.BK10.box.part, 'fan'); // the title matches the part
  assert.equal(rows.BK10.placeName, 'Kitchen › Oven › Fan');
});

test('state: running beats everything, and the words say what it is doing', () => {
  const rows = byId(rowsOf({ BK2: { state: 'working' }, BK4: { state: 'waiting-ci' }, BK31: { state: 'waiting-you' }, BK3: { state: 'idle' } }));
  assert.equal(rows.BK2.state, 'running');
  assert.match(rows.BK2.stateWhy, /Working/);
  assert.equal(rows.BK4.state, 'running'); // would be "needs you" otherwise
  assert.match(rows.BK4.stateWhy, /CI/);
  assert.equal(rows.BK31.state, 'running'); // would be "needs you" otherwise
  assert.match(rows.BK31.stateWhy, /Waiting on you/);
  assert.notEqual(rows.BK3.state, 'running'); // idle is not running
});

test('state: needs you for an ask to the user and for a check to tick', () => {
  const rows = byId(rowsOf());
  assert.equal(rows.BK4.state, 'needs you');
  assert.match(rows.BK4.stateWhy, /waiting for you/);
  // The Plan page's rule (checksOnOpenWork): a ticket already in Ready for review is not "needs you" for its checks.
  assert.equal(rows.BK31.state, 'in review');
  assert.equal(rows.BK31.checksOpen, 1);
});

test('state: needs you for an open ask and an interpretation', () => {
  const doc = sample();
  doc.sections[2].tasks.find(x => x.id === 'BK2').asks = [{ n: 1, at: '2026-11-02T10:00:00Z', text: 'Which printer?', state: 'open', details: 'x'.repeat(80) }];
  doc.sections[2].tasks.find(x => x.id === 'BK3').description = `${PLAIN}\n- Interpretation: they want a thermal printer`;
  const rows = byId(ticketRows(doc, config, readinessOf(doc), {}));
  assert.equal(rows.BK2.state, 'needs you');
  assert.equal(rows.BK2.asks, 1);
  assert.match(rows.BK2.stateWhy, /1 open question/);
  assert.equal(rows.BK3.state, 'needs you');
  assert.equal(rows.BK3.asks, 1);
});

test('state: in review when the column is review and nothing waits on the user', () => {
  assert.equal(byId(rowsOf()).BK30.state, 'in review');
});

test('state: ready follows the Plan page rule for the epic, and the ticket must be free to run', () => {
  const rows = byId(rowsOf());
  assert.equal(rows.BK1.state, 'ready');
  assert.equal(rows.BK2.state, 'ready');
  assert.equal(rows.BK5.state, 'ready');
  assert.equal(rows.BK5.prUrl, 'https://github.com/acme/bakery/pull/12');
});

test('state: waiting with the reason in words (blocked ticket, epic not ready, nothing to run)', () => {
  const rows = byId(rowsOf());
  assert.equal(rows.BK3.state, 'waiting');
  assert.deepEqual(rows.BK3.blockedBy, ['BK2']);
  assert.equal(rows.BK3.stateWhy, 'Blocked by BK2');
  assert.equal(rows.BK10.state, 'waiting'); // its only child has no "How to check it"
  assert.match(rows.BK10.stateWhy, /How to check it/);
  assert.equal(rows.BK11.state, 'waiting');
  assert.match(rows.BK11.stateWhy, /not ready/);
  assert.equal(rows.BK20.state, 'waiting');
  assert.match(rows.BK20.stateWhy, /Nothing open to run/);
});

test('state: later for inbox, backlog and a later bucket; done for done and archive', () => {
  const rows = byId(rowsOf());
  assert.equal(rows.BK90.state, 'later');
  assert.match(rows.BK90.stateWhy, /inbox/i);
  assert.equal(rows.BK81.state, 'later');
  assert.equal(rows.BK80.state, 'later');
  assert.equal(rows.BK40.state, 'done');
  assert.equal(rows.BK41.state, 'done');
  assert.match(rows.BK41.stateWhy, /Archived/);
});

test('every row has exactly one of the known states', () => {
  for (const r of rowsOf()) assert.ok(STATES.includes(r.state), r.id);
});

test('countByState counts every state and the total', () => {
  const c = countByState(rowsOf());
  assert.equal(c.all, 15);
  assert.equal(STATES.reduce((n, s) => n + c[s], 0), 15);
  assert.equal(c.done, 2);
  assert.equal(c['in review'], 2); // BK30 and BK31: its open check does not make it "needs you" in review
});

test('filterRows: done is hidden unless asked for, by switch or by the done state', () => {
  const rows = rowsOf();
  assert.equal(filterRows(rows, {}).length, 13);
  assert.equal(filterRows(rows, { showDone: true }).length, 15);
  assert.deepEqual(filterRows(rows, { states: ['done'] }).map(r => r.id).sort(), ['BK40', 'BK41']);
});

test('filterRows: states, types, text (every word), lane, model and label', () => {
  const rows = rowsOf();
  assert.deepEqual(filterRows(rows, { states: ['ready'] }).map(r => r.id).sort(), ['BK1', 'BK2', 'BK5']);
  assert.deepEqual(filterRows(rows, { states: new Set(['ready', 'later']), types: ['epic'] }).map(r => r.id).sort(), ['BK1', 'BK80']);
  assert.deepEqual(filterRows(rows, { text: 'print receipt' }).map(r => r.id), ['BK2']);
  assert.deepEqual(filterRows(rows, { text: 'kitchen fan' }).map(r => r.id), ['BK10', 'BK11']); // place words match
  assert.equal(filterRows(rows, { text: 'nothing like this' }).length, 0);
  assert.deepEqual(filterRows(rows, { lane: 'oven' }).map(r => r.id).sort(), ['BK10', 'BK11', 'BK80', 'BK81']); // a child takes its epic's lane
  assert.deepEqual(filterRows(rows, { model: 'sonnet' }).map(r => r.id), ['BK2']);
  assert.deepEqual(filterRows(rows, { label: 'print' }).map(r => r.id), ['BK2']);
});

test('filterRows: the place filter keeps the tickets of the selected epics only', () => {
  const rows = rowsOf();
  const kept = filterRows(rows, { place: new Set(['BK1']) }).map(r => r.id).sort();
  assert.deepEqual(kept, ['BK1', 'BK2', 'BK3', 'BK4', 'BK5']);
  assert.equal(filterRows(rows, { place: new Set() }).length, 0);
  assert.equal(filterRows(rows, { place: null }).length, 13);
});

test('sortRows: ids in natural order, dates with empty last, direction, state order, stable', () => {
  const rows = rowsOf();
  assert.deepEqual(sortRows(rows, 'id').map(r => r.id).slice(0, 4), ['BK1', 'BK2', 'BK3', 'BK4']);
  assert.ok(compareIds('BK2', 'BK10') < 0);
  assert.ok(compareIds('BK2', 'WEB1') < 0);
  assert.deepEqual(sortRows(rows, 'updated', 'desc').slice(0, 3).map(r => r.id), ['BK2', 'BK3', 'BK1']);
  assert.deepEqual(sortRows(rows, 'state').map(r => r.state), rows.map(r => r.state).sort((a, b) => STATES.indexOf(a) - STATES.indexOf(b)));
  assert.equal(sortRows(rows, 'lane')[0].lane, 'counter');
  assert.equal(sortRows(rows, 'lane').at(-1).lane, ''); // no lane last
  assert.notEqual(sortRows(rows, 'id'), rows); // a copy
  assert.deepEqual(sortRows(rows, 'model').slice(0, 2).map(r => r.model), ['opus', 'sonnet']);
});

test('groupRows: by state, place, epic and lane; none gives one group', () => {
  const rows = filterRows(rowsOf(), {});
  const byState = groupRows(rows, 'state');
  assert.deepEqual(byState.map(g => g.key), ['needs you', 'in review', 'ready', 'waiting', 'later']);
  assert.equal(byState.reduce((n, g) => n + g.rows.length, 0), rows.length);
  assert.equal(byState[0].counts['needs you'], byState[0].rows.length);
  const byEpic = groupRows(rows, 'epic');
  assert.equal(byEpic[0].key, 'BK1');
  assert.equal(byEpic.at(-1).key, ''); // no epic last
  assert.equal(byEpic.at(-1).label, 'No epic');
  assert.equal(byEpic[0].label, 'BK1 Counter till');
  assert.ok(groupRows(rows, 'place').some(g => g.label === 'Shop floor › Counter'));
  assert.equal(groupRows(rows, 'lane').at(-1).label, 'No lane');
  const none = groupRows(rows, 'none');
  assert.equal(none.length, 1);
  assert.equal(none[0].rows, rows);
});

test('state: a check to tick on open work is needs you (the Plan page rule), a check in review is not', () => {
  const doc = sample();
  doc.sections.find(x => x.id === 'todo').tasks.push({ id: 'BK12', title: 'Tick the fan', type: 'task', parentId: 'BK10', checks: [{ text: 'fan spins', checked: false }] });
  const rows = byId(ticketRows(doc, config, readinessOf(doc), {}));
  assert.equal(rows.BK12.state, 'needs you');
  assert.match(rows.BK12.stateWhy, /1 check to tick/);
  assert.equal(rows.BK31.state, 'in review');
});

test('an idle session is a quiet mark, never running; working, waiting on CI and waiting on you are running', () => {
  const rows = byId(rowsOf({ BK2: { state: 'working' }, BK4: { state: 'waiting-ci' }, BK31: { state: 'waiting-you' }, BK3: { state: 'idle' } }));
  assert.deepEqual(['BK2', 'BK4', 'BK31'].map(id => rows[id].state), ['running', 'running', 'running']);
  assert.equal(rows.BK3.idle, true);
  assert.notEqual(rows.BK3.state, 'running');
  assert.equal(rows.BK2.idle, false);
});
