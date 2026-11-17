/**
 * shared/home-map-stats.js (PRO39): the numbers on every box of the Home map. Synthetic bakery map and tickets.
 * Every count has a case that fails when its rule is removed; placement is checked against epicIdsForBox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';
import { epicIdsForBox } from '../../shared/home-areas.js';
import { openEpicReadiness } from '../../shared/epic-ready.js';
import {
  boxStats, ROOT, projectFamily, placedEpics, epicsInBox, notOnMap, restKey, restArea,
} from '../../shared/home-map-stats.js';

const { config } = normalizeHomeConfig({
  version: 1,
  groups: [
    {
      id: 'shop', name: 'Shop floor',
      areas: [
        { id: 'counter', name: 'Counter', lanes: ['counter'] },
        { id: 'web', name: 'Website', projects: ['bakery-site'], parts: [{ id: 'menu', name: 'Menu page', match: 'menu' }, { id: 'cart', name: 'Cart', lanes: ['cart'] }] },
      ],
    },
    { id: 'kitchen', name: 'Kitchen', areas: [{ id: 'oven', name: 'Oven', lanes: ['oven'] }, { id: 'misc', name: 'Everything else' }] },
  ],
});

const HOW = '## In plain words\n**How to check it:** open the page.';
const t = (id, extra = {}) => ({ id, title: `Ticket ${id}`, type: 'task', description: HOW, ...extra });
const e = (id, extra = {}) => t(id, { type: 'epic', ...extra });

function doc() {
  return {
    meta: { projects: [{ id: 'bakery' }, { id: 'bakery-site', parentId: 'bakery' }, { id: 'farm' }] },
    sections: [
      { id: 'inbox', tasks: [] },
      { id: 'backlog', tasks: [e('B1', { lane: 'oven', project: 'bakery' })] },
      { id: 'todo', tasks: [
        e('B2', { lane: 'counter', project: 'bakery', labels: ['auto'] }), t('B21', { parentId: 'B2', project: 'bakery' }),
        e('B3', { title: 'New menu', project: 'bakery-site' }), t('B31', { parentId: 'B3', project: 'bakery-site' }),
        e('B9', { title: 'zzz', project: 'bakery' }),
        e('F1', { title: 'zzz', project: 'farm' }),
        e('F2', { lane: 'oven', project: 'farm' }), t('F21', { parentId: 'F2', project: 'farm' }),
      ] },
      { id: 'in-progress', tasks: [e('B4', { lane: 'cart', project: 'bakery-site' }), t('B41', { parentId: 'B4', project: 'bakery-site' }), t('B411', { type: 'subtask', parentId: 'B41', project: 'bakery-site' })] },
      { id: 'review', tasks: [t('B22', { parentId: 'B2', project: 'bakery' }), e('B5', { lane: 'counter', project: 'bakery' })] },
      { id: 'done', tasks: [t('B23', { parentId: 'B2', project: 'bakery' }), e('B6', { lane: 'oven', project: 'bakery' }), t('B61', { parentId: 'B6', project: 'bakery' })] },
      { id: 'archive', tasks: [] },
    ],
  };
}

const ready = d => new Map(openEpicReadiness(d).map(r => [r.id, r]));
const running = {
  running: [
    { id: 'B41', state: 'working', epicId: 'B4' },
    { id: 'B411', state: 'waiting-ci', epicId: 'B4' },
    { id: 'B21', state: 'waiting-you', epicId: 'B2' },
    { id: 'B31', state: 'idle', epicId: 'B3' },
    { id: 'X1', state: 'working', epicId: null },
  ],
  epics: { B4: { state: 'running' }, B1: { state: 'stale' }, B3: { state: 'idle' } },
};

test('projectFamily walks sub-projects; null means every project', () => {
  assert.deepEqual([...projectFamily(doc(), 'bakery')].sort(), ['bakery', 'bakery-site']);
  assert.equal(projectFamily(doc(), null), null);
});

test('scope: the project and its sub-projects, plus epics an area claims; other projects\' fallback epics are left out', () => {
  const ids = placedEpics(config, doc(), { project: 'bakery' }).map(p => p.epic.id).sort();
  assert.ok(ids.includes('B3'), 'a sub-project epic is on the map');
  assert.ok(ids.includes('F2'), 'another project, but an area claims it by lane');
  assert.ok(!ids.includes('F1'), 'another project that only reaches the fallback belongs to another map');
  assert.ok(ids.includes('B9'), 'the project\'s own unmatched epic stays (in the fallback)');
  assert.ok(placedEpics(config, doc()).some(p => p.epic.id === 'F1'), 'with no project, every epic is on the map');
});

test('placement agrees with epicIdsForBox (the same rule)', () => {
  const d = doc();
  for (const box of ['shop', 'web', 'menu', 'cart', 'counter', 'kitchen', 'oven', 'misc']) {
    const mine = epicsInBox(config, d, box).map(p => p.epic.id).sort();
    assert.deepEqual(mine, [...epicIdsForBox(config, d, box)].sort(), box);
  }
});

test('boxStats: open epics, ready, auto per box; a part counts in its area and group too', () => {
  const d = doc();
  const s = boxStats(config, d, ready(d), running, { project: 'bakery' });
  assert.equal(s.get('counter').openEpics, 1, 'B2 (B5 is in review, not open)');
  assert.equal(s.get('counter').ready, 1);
  assert.equal(s.get('counter').auto, 1);
  assert.equal(s.get('cart').openEpics, 1);
  assert.equal(s.get('web').openEpics, 2, 'B3 in the area (via menu part) + B4 in the cart part');
  assert.equal(s.get('menu').openEpics, 1);
  assert.equal(s.get('shop').openEpics, 3);
  assert.equal(s.get('oven').openEpics, 2, 'B1 (backlog) and F2 (claimed by lane)');
  assert.equal(s.get('oven').ready, 1, 'F2 is ready; B1 sits in backlog');
  assert.equal(s.get(ROOT).openEpics, 6);
  assert.equal(s.get('misc').openEpics, 1, 'B9 fell to the fallback');
});

test('boxStats: running by state from the running answer; idle tickets and loose work are not counted', () => {
  const d = doc();
  const s = boxStats(config, d, ready(d), running, { project: 'bakery' });
  assert.deepEqual(s.get('cart').running, { working: 1, waitingCi: 1, waitingYou: 0 });
  assert.deepEqual(s.get('counter').running, { working: 0, waitingCi: 0, waitingYou: 1 });
  assert.deepEqual(s.get('menu').running, { working: 0, waitingCi: 0, waitingYou: 0 });
  assert.deepEqual(s.get(ROOT).running, { working: 1, waitingCi: 1, waitingYou: 1 });
  assert.equal(s.get('oven').stale, 1);
  assert.equal(s.get('menu').idle, 1);
  assert.equal(s.get('kitchen').stale, 1);
});

test('boxStats: review-waiting tickets and the open/done ticket counts, by nearest epic', () => {
  const d = doc();
  const s = boxStats(config, d, ready(d), running, { project: 'bakery' });
  assert.equal(s.get('counter').review, 2, 'B22 (a ticket in review) and B5 (an epic in review)');
  assert.deepEqual(s.get('counter').tickets, { open: 1, done: 2 }, 'B21 open; B22 in review and B23 done');
  assert.deepEqual(s.get('cart').tickets, { open: 2, done: 0 }, 'a subtask counts under its epic');
  assert.deepEqual(s.get('oven').tickets, { open: 1, done: 1 }, 'F21 open; B61 under the done epic B6');
});

test('restKey: an area\'s own epics (on none of its parts) have their own record and list; areas without parts have none', () => {
  const d = doc();
  d.sections[2].tasks.push(e('B7', { title: 'zzz', project: 'bakery-site' }));
  const s = boxStats(config, d, ready(d), running, { project: 'bakery' });
  assert.equal(s.get(restKey('web')).openEpics, 1, 'B7 sits on the Website area, on no part');
  assert.equal(s.get('web').openEpics, 3, 'and still counts in the area');
  assert.equal(s.has(restKey('counter')), false);
  assert.deepEqual(epicsInBox(config, d, restKey('web'), { project: 'bakery' }).map(p => p.epic.id), ['B7']);
  assert.equal(restArea(restKey('web')), 'web');
  assert.equal(restArea('web'), null);
});

test('boxStats copes with no running answer, no readiness and an empty map', () => {
  const s = boxStats(config, doc(), null, null, {});
  assert.equal(s.get('counter').ready, 0);
  assert.deepEqual(s.get(ROOT).running, { working: 0, waitingCi: 0, waitingYou: 0 });
  assert.equal(boxStats({ groups: [] }, doc(), null, null).get(ROOT).openEpics, 0);
  assert.equal(boxStats(null, doc(), null, null).size, 1);
});

test('notOnMap: this project\'s open fallback epics, each with what would place it', () => {
  const out = notOnMap(config, doc(), { project: 'bakery' });
  assert.deepEqual(out.map(x => x.id), ['B9']);
  assert.match(out[0].why, /"Everything else"/);
  assert.match(out[0].fix, /project "bakery"/);
  assert.deepEqual(notOnMap(config, doc(), {}).map(x => x.id).sort(), ['B9', 'F1']);
  const d = doc();
  d.sections[2].tasks.push(e('B10', { title: 'zzz', lane: 'nowhere', project: 'bakery' }));
  assert.match(notOnMap(config, d, { project: 'bakery' }).find(x => x.id === 'B10').fix, /lane "nowhere"/);
});
