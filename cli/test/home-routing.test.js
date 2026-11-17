/**
 * Home tab routing (dashboard/js/routing.js) and state (dashboard/js/home-state.js):
 * /dashboard/home/<view>?where=<box id>&hproject=<slug>, the registries, and the selection.
 * Runs in Node with a mocked window.location, like routing.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';

function mockWindow(pathname, search = '') {
  global.window = {
    location: { pathname, search },
    history: { replaceState() {}, pushState() {} },
    addEventListener() {},
  };
}

test('parseRoute: /dashboard/home/<view>?where=&hproject=', async () => {
  mockWindow('/dashboard/home/map', '?where=oven&hproject=bakery');
  const { parseRoute, buildPath, buildSearchForRoute } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.tab, 'home');
  assert.equal(route.homeView, 'map');
  assert.equal(route.where, 'oven');
  assert.equal(route.homeProject, 'bakery');
  assert.equal(buildPath(route), '/dashboard/home/map');
  assert.equal(buildSearchForRoute(route), '?where=oven&hproject=bakery');
});

test('parseRoute: /dashboard/home alone, no view and no place', async () => {
  mockWindow('/dashboard/home');
  const { parseRoute, buildPath, buildSearchForRoute } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.tab, 'home');
  assert.equal(route.homeView, undefined);
  assert.equal(route.where, undefined);
  assert.equal(buildPath(route), '/dashboard/home');
  assert.equal(buildSearchForRoute(route), '');
});

test('buildSearchForRoute: home keys are dropped off Home and other params are kept', async () => {
  mockWindow('/dashboard/home/lanes', '?where=oven&hproject=bakery&project=bakery-site&q=flour');
  const { buildSearchForRoute } = await import('../../dashboard/js/routing.js');
  assert.equal(buildSearchForRoute({ tab: 'tasks' }), '?project=bakery-site&q=flour');
  assert.equal(buildSearchForRoute({ tab: 'home', homeView: 'lanes' }), '?project=bakery-site&q=flour');
  assert.equal(buildSearchForRoute({ tab: 'home', homeView: 'lanes', where: 'pantry' }), '?where=pantry&project=bakery-site&q=flour');
});

test('the Tasks project filter (?project=) is not read as the Home project', async () => {
  mockWindow('/dashboard/home/tickets', '?project=bakery-site');
  const { parseRoute } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.homeProject, undefined);
  assert.equal(route.homeView, 'tickets');
});

test('other tabs route as before', async () => {
  mockWindow('/dashboard/plan', '?where=oven');
  const { parseRoute, buildPath, buildSearchForRoute } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.tab, 'plan');
  assert.equal(route.homeView, undefined);
  assert.equal(buildPath(route), '/dashboard/plan');
  assert.equal(buildSearchForRoute(route), '');
});

test('home-state: placeholders give way to real registrations in any order', async () => {
  const s = await import('../../dashboard/js/home-state.js');
  const real = { id: 'zz-map', label: 'Real', key: 8, render() {} };
  s.registerHomeView(real);
  s.registerHomeView({ id: 'zz-map', label: 'Placeholder', key: 8, placeholder: true, render() {} });
  assert.equal(s.homeView('zz-map').label, 'Real');
  s.registerHomeView({ id: 'zz-lanes', label: 'Placeholder', key: 9, placeholder: true, render() {} });
  s.registerHomeView({ id: 'zz-lanes', label: 'Real lanes', key: 9, render() {} });
  assert.equal(s.homeView('zz-lanes').label, 'Real lanes');
  assert.deepEqual(s.homeViews().map(v => v.key), [...s.homeViews().map(v => v.key)].sort((a, b) => a - b));
  s.registerTopBarItem({ id: 'search', slot: 'search', placeholder: true, render() {} });
  s.registerTopBarItem({ id: 'real-search', slot: 'search', render() {} });
  assert.deepEqual(s.topBarItemsIn('search').map(i => i.id), ['real-search']);
  assert.throws(() => s.registerHomeView({ id: 'x', label: 'X', key: 0, render() {} }), /key/);
  assert.throws(() => s.registerTopBarItem({ id: 'x', slot: 'left', render() {} }), /slot/);
  assert.throws(() => s.registerStripItem({ id: 'x' }), /render/);
});

test('home-state: the selection waits for the config, is kept across views, and clears', async () => {
  const s = await import('../../dashboard/js/home-state.js');
  for (const [id, key] of [['v1', 1], ['v2', 2]]) s.registerHomeView({ id, label: id, key, render() {} });
  const events = [];
  const off = s.subscribe(e => events.push(e.type));
  s.applyHomeRoute({ homeView: 'v2', where: 'deck-oven', homeProject: 'bakery' });
  assert.equal(s.getHomeView(), 'v2');
  assert.equal(s.selectedBoxId(), null); // no config yet: pending
  assert.equal(s.homeRouteState().where, 'deck-oven');
  const { config } = normalizeHomeConfig({
    version: 1,
    groups: [{ id: 'kitchen', name: 'Kitchen', areas: [{ id: 'oven', name: 'Oven', parts: [{ id: 'deck-oven', name: 'Deck oven' }] }] }],
  });
  assert.equal(s.setHomeData({ project: 'bakery', config, errors: [] }), null);
  assert.deepEqual(s.getSelection(), { project: 'bakery', group: 'kitchen', area: 'oven', part: 'deck-oven' });
  s.setView('v1');
  assert.equal(s.getHomeView(), 'v1');
  assert.equal(s.selectedBoxId(), 'deck-oven');
  s.setSelection({ group: 'kitchen' });
  assert.deepEqual(s.getSelection(), { project: 'bakery', group: 'kitchen', area: null, part: null });
  s.setSelection('nowhere'); // unknown ids are ignored
  assert.equal(s.selectedBoxId(), 'kitchen');
  s.clearSelection();
  assert.equal(s.hasSelection(), false);
  assert.deepEqual(s.homeRouteState(), { homeView: 'v1', where: undefined, homeProject: 'bakery' });
  s.applyHomeRoute({ homeView: 'v1', where: 'ghost' });
  assert.equal(s.setHomeData({ project: 'bakery', config, errors: [] }), 'ghost');
  assert.ok(events.includes('view') && events.includes('selection') && events.includes('config'));
  off();
});

test('home-state: each project keeps its own selected place across a switch (PRO127)', async () => {
  mockWindow('/dashboard/home/map', '');
  const s = await import('../../dashboard/js/home-state.js');
  const cfg = (area) => normalizeHomeConfig({ version: 1, groups: [{ id: `g-${area}`, name: 'G', areas: [{ id: area, name: area }] }] }).config;
  s.applyHomeRoute({ homeView: 'map', homeProject: 'bakery' });
  s.setHomeData({ project: 'bakery', config: cfg('oven'), errors: [] });
  s.setSelection('oven');
  s.setProject('garden');
  assert.equal(s.selectedBoxId(), null); // a new project starts with no place
  s.setHomeData({ project: 'garden', config: cfg('beds'), errors: [] });
  s.setSelection('beds');
  s.setProject('bakery');
  assert.equal(s.homeRouteState().where, 'oven'); // waits for bakery's config, already in the address
  s.setHomeData({ project: 'bakery', config: cfg('oven'), errors: [] });
  assert.equal(s.selectedBoxId(), 'oven');
  s.setProject('garden');
  s.setHomeData({ project: 'garden', config: cfg('beds'), errors: [] });
  assert.equal(s.selectedBoxId(), 'beds');
});
