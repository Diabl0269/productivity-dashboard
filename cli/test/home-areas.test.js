/**
 * shared/home-areas.js (PRO117): which place of the map an epic belongs to. Synthetic bakery map;
 * the rule order is the prototype's: lanes, then title (only for the group's keywordProjects), then projects,
 * then the fallback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';
import {
  boxForEpic, epicIdsForBox, lanesForBox, boxPath, childBoxes, unmatchedEpics,
} from '../../shared/home-areas.js';

const { config } = normalizeHomeConfig({
  version: 1,
  groups: [
    {
      id: 'shop', name: 'Shop floor', keywordProjects: ['bakery-site', null],
      areas: [
        { id: 'counter', name: 'Counter', lanes: ['counter'], match: 'till|receipt' },
        {
          id: 'web', name: 'Website', projects: ['bakery-site'], match: 'checkout',
          parts: [{ id: 'menu', name: 'Menu page', match: 'menu' }, { id: 'cart', name: 'Cart', lanes: ['cart'] }],
        },
      ],
    },
    {
      id: 'kitchen', name: 'Kitchen', keywordProjects: ['bakery-orders'],
      areas: [
        { id: 'oven', name: 'Oven', lanes: ['oven'], match: 'oven|bake', projects: ['bakery-orders'] },
        { id: 'misc', name: 'Everything else' },
      ],
    },
  ],
});

const epic = (id, o = {}, status = 'in-progress') => ({ id, type: 'epic', title: o.title || id, lane: o.lane, project: o.project, status });
const doc = (...epics) => ({
  sections: [
    { id: 'in-progress', tasks: epics.filter(e => e.status === 'in-progress') },
    { id: 'done', tasks: epics.filter(e => e.status === 'done') },
    { id: 'todo', tasks: [...epics.filter(e => e.status === 'todo'), { id: 'T1', type: 'task', title: 'not an epic', lane: 'oven' }] },
  ],
});

test('the config is clean', () => { assert.ok(config.groups.length === 2); });

test('lanes win over a title match', () => {
  const b = boxForEpic(config, epic('E1', { lane: 'oven', title: 'new till', project: 'bakery-site' }));
  assert.deepEqual(b, { group: 'kitchen', area: 'oven', part: null, matchedBy: 'lane' });
});

test('a title pattern counts only for the group\'s keywordProjects (null = no project)', () => {
  assert.equal(boxForEpic(config, epic('E1', { title: 'Fix the till', project: 'bakery-site' })).area, 'counter');
  assert.equal(boxForEpic(config, epic('E2', { title: 'Fix the till', project: null })).matchedBy, 'title');
  // "oven" matches the kitchen area, but a bakery-site epic is not a kitchen keyword project -> falls on to the project rule
  const b = boxForEpic(config, epic('E3', { title: 'oven page', project: 'bakery-site' }));
  assert.deepEqual([b.area, b.matchedBy], ['web', 'project']);
  assert.equal(boxForEpic(config, epic('E4', { title: 'oven timer', project: 'bakery-orders' })).area, 'oven');
});

test('projects, then the fallback (the last area unless "fallback" names one)', () => {
  assert.deepEqual(boxForEpic(config, epic('E1', { title: 'zzz', project: 'bakery-orders' })), { group: 'kitchen', area: 'oven', part: null, matchedBy: 'project' });
  assert.deepEqual(boxForEpic(config, epic('E2', { title: 'zzz' })), { group: 'kitchen', area: 'misc', part: null, matchedBy: 'fallback' });
  const named = { ...config, fallback: 'counter' };
  assert.equal(boxForEpic(named, epic('E3', { title: 'zzz' })).area, 'counter');
});

test('a part matches by its own lanes or match, inside the chosen area only', () => {
  assert.deepEqual(boxForEpic(config, epic('E1', { title: 'checkout of the menu', project: 'bakery-site' })), { group: 'shop', area: 'web', part: 'menu', matchedBy: 'title' });
  assert.equal(boxForEpic(config, epic('E2', { lane: 'cart', project: 'bakery-site' })).part, 'cart');
  assert.equal(boxForEpic(config, epic('E3', { title: 'checkout', project: 'bakery-site' })).part, null);
  assert.equal(boxForEpic(config, epic('E4', { title: 'the menu', project: 'bakery-orders' })).part, null);
});

test('a map with no areas answers with nulls instead of failing', () => {
  assert.deepEqual(boxForEpic({ groups: [] }, epic('E1')), { group: null, area: null, part: null, matchedBy: 'fallback' });
  assert.deepEqual(boxForEpic(null, epic('E1')).group, null);
});

test('epicIdsForBox: a group, an area or a part; descendants included; open and closed epics', () => {
  const d = doc(
    epic('E1', { title: 'menu update', project: 'bakery-site' }),
    epic('E2', { title: 'checkout', project: 'bakery-site' }, 'done'),
    epic('E3', { lane: 'counter' }),
    epic('E4', { lane: 'oven' }, 'todo'),
  );
  assert.deepEqual([...epicIdsForBox(config, d, 'shop')].sort(), ['E1', 'E2', 'E3']);
  assert.deepEqual([...epicIdsForBox(config, d, 'web')].sort(), ['E1', 'E2']);
  assert.deepEqual([...epicIdsForBox(config, d, 'menu')], ['E1']);
  assert.deepEqual([...epicIdsForBox(config, d, 'kitchen')], ['E4']);
  assert.equal(epicIdsForBox(config, d, 'nope').size, 0);
  assert.equal(epicIdsForBox(config, d, null).size, 0);
});

test('lanesForBox collects a box and everything inside it', () => {
  assert.deepEqual(lanesForBox(config, 'shop').sort(), ['cart', 'counter']);
  assert.deepEqual(lanesForBox(config, 'web'), ['cart']);
  assert.deepEqual(lanesForBox(config, 'cart'), ['cart']);
  assert.deepEqual(lanesForBox(config, 'nope'), []);
});

test('boxPath and childBoxes walk the tree', () => {
  assert.deepEqual(boxPath(config, 'menu'), [
    { id: 'shop', name: 'Shop floor', level: 'group' }, { id: 'web', name: 'Website', level: 'area' }, { id: 'menu', name: 'Menu page', level: 'part' },
  ]);
  assert.deepEqual(boxPath(config, 'nope'), []);
  assert.deepEqual(childBoxes(config, null).map(b => b.id), ['shop', 'kitchen']);
  assert.deepEqual(childBoxes(config, 'shop').map(b => b.id), ['counter', 'web']);
  assert.deepEqual(childBoxes(config, 'web').map(b => b.id), ['menu', 'cart']);
  assert.deepEqual(childBoxes(config, 'menu'), []);
  assert.deepEqual(childBoxes(config, 'nope'), []);
});

test('unmatchedEpics lists open epics that fell to the fallback, with the reason', () => {
  const d = doc(epic('E1', { title: 'zzz' }), epic('E2', { title: 'zzz' }, 'done'), epic('E3', { lane: 'oven' }), epic('E4', { title: 'later' }, 'todo'));
  const out = unmatchedEpics(config, d);
  assert.deepEqual(out.map(e => e.id), ['E1', 'E4']);
  assert.deepEqual(Object.keys(out[0]), ['id', 'title', 'lane', 'project', 'why']);
  assert.match(out[0].why, /"Everything else"/);
});
