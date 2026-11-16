/**
 * dashboard/js/home-map-layout.js (PRO39): the Home map lays every level out for the view's size. Synthetic maps.
 * Boxes never overlap, stay inside the view, keep the config's order, and minis stay inside their box.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';
import {
  layoutLevel, zoomFor, treemap, grid, nearestBox, rectsFor, PAD,
} from '../../dashboard/js/home-map-layout.js';

const parts = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-p${i}`, name: `${prefix} part ${i}` }));
const { config } = normalizeHomeConfig({
  version: 1,
  groups: [
    { id: 'shop', name: 'Shop floor', areas: [
      { id: 'counter', name: 'Counter', parts: parts('counter', 9) },
      { id: 'web', name: 'Website', what: 'Orders and the menu online.', parts: parts('web', 3) },
      { id: 'display', name: 'Display case' },
    ] },
    { id: 'kitchen', name: 'Kitchen', areas: [{ id: 'oven', name: 'Oven', parts: parts('oven', 2) }] },
    { id: 'office', name: 'Office', areas: [] },
  ],
});

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r, o) => r.x >= o.x - 0.5 && r.y >= o.y - 0.5 && r.x + r.w <= o.x + o.w + 0.5 && r.y + r.h <= o.y + o.h + 0.5;

function sane(layout, W, H) {
  const view = { x: PAD, y: PAD, w: W - 2 * PAD, h: H - 2 * PAD };
  layout.boxes.forEach((b, i) => {
    assert.ok(b.rect.w > 0 && b.rect.h > 0, `${b.id} has a size`);
    assert.ok(inside(b.rect, view), `${b.id} inside the view`);
    for (const c of layout.boxes.slice(i + 1)) assert.ok(!overlap(b.rect, c.rect), `${b.id} and ${c.id} overlap`);
    b.minis.forEach((m, j) => {
      assert.ok(inside(m.rect, b.rect), `mini ${m.id} inside ${b.id}`);
      for (const n of b.minis.slice(j + 1)) assert.ok(!overlap(m.rect, n.rect), `minis ${m.id} and ${n.id} overlap`);
    });
  });
}

test('zoomFor: a box with children is zoomed into; a leaf shows its parent level', () => {
  assert.equal(zoomFor(config, null), null);
  assert.equal(zoomFor(config, 'shop'), 'shop');
  assert.equal(zoomFor(config, 'office'), null, 'a group with no areas is a leaf of the top level');
  assert.equal(zoomFor(config, 'counter'), 'counter');
  assert.equal(zoomFor(config, 'display'), 'shop', 'an area with no parts is a leaf of its group');
  assert.equal(zoomFor(config, 'counter-p3'), 'counter');
  assert.equal(zoomFor(config, 'nope'), null);
});

test('every level at 700, 1100 and 1500 wide: inside the view, no overlaps, config order kept', () => {
  for (const [W, H] of [[700, 420], [1100, 600], [1500, 760]]) {
    const top = layoutLevel(config, null, W, H);
    assert.equal(top.kind, 'system');
    assert.deepEqual(top.boxes.map(b => b.id), ['shop', 'kitchen', 'office']);
    sane(top, W, H);
    const shop = top.boxes.find(b => b.id === 'shop');
    assert.deepEqual(shop.minis.map(m => m.id), ['counter', 'web', 'display'], 'the system level shows each group\'s areas');
    const group = layoutLevel(config, 'shop', W, H);
    assert.equal(group.kind, 'group');
    sane(group, W, H);
    const counter = group.boxes.find(b => b.id === 'counter');
    assert.equal(counter.minis.length + counter.more, 9, 'every part is a mini or counted in "+N more"');
    const area = layoutLevel(config, 'counter', W, H);
    assert.equal(area.kind, 'area');
    assert.equal(area.boxes.length, 9);
    sane(area, W, H);
    assert.ok(area.boxes.every(b => b.minis.length === 0), 'parts are leaves');
  }
});

test('a bigger group gets a bigger box at the top level', () => {
  const top = layoutLevel(config, null, 1200, 700);
  const size = id => { const r = top.boxes.find(b => b.id === id).rect; return r.w * r.h; };
  assert.ok(size('shop') > size('kitchen'));
});

test('`what` shows only when the box has room for it', () => {
  const roomy = layoutLevel(config, 'shop', 1400, 800).boxes.find(b => b.id === 'web');
  assert.equal(roomy.showWhat, true);
  assert.equal(layoutLevel(config, 'shop', 1400, 800).boxes.find(b => b.id === 'counter').showWhat, false, 'no `what` in the config');
});

test('treemap keeps order and fills the rect; grid keeps tiles at least the minimum size', () => {
  const r = treemap([3, 1, 1], { x: 0, y: 0, w: 1000, h: 600 }, 10);
  assert.equal(r.length, 3);
  assert.ok(r[0].x === 0 && r[0].y === 0);
  const g = grid(5, { x: 0, y: 0, w: 400, h: 100 }, { minW: 92, minH: 26, aspect: 3 });
  assert.equal(g.rects.length + g.more, 5);
  assert.ok(g.rects.every(t => t.w >= 92 && t.h >= 26));
  const tight = grid(40, { x: 0, y: 0, w: 200, h: 60 }, { minW: 92, minH: 26 });
  assert.ok(tight.more > 0 && tight.moreRect, 'what does not fit is counted in a "+N more" tile');
  assert.deepEqual(grid(3, { x: 0, y: 0, w: 50, h: 10 }).rects, []);
});

test('nearestBox moves by geometry, preferring boxes in line', () => {
  const boxes = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'b', rect: { x: 120, y: 0, w: 100, h: 100 } },
    { id: 'c', rect: { x: 0, y: 120, w: 100, h: 100 } },
    { id: 'd', rect: { x: 120, y: 120, w: 100, h: 100 } },
  ];
  assert.equal(nearestBox(boxes, 'a', 'right'), 'b');
  assert.equal(nearestBox(boxes, 'a', 'down'), 'c');
  assert.equal(nearestBox(boxes, 'd', 'up'), 'b');
  assert.equal(nearestBox(boxes, 'd', 'left'), 'c');
  assert.equal(nearestBox(boxes, 'a', 'left'), null);
  assert.equal(nearestBox(boxes, 'zzz', 'left'), 'a');
});

test('`rest` adds one leaf for the area\'s own epics at the area level only, without touching the config', () => {
  const rest = { id: 'web#rest', name: 'Whole area' };
  const l = layoutLevel(config, 'web', 1100, 600, { rest });
  assert.deepEqual(l.boxes.map(b => b.id), ['web-p0', 'web-p1', 'web-p2', 'web#rest']);
  sane(l, 1100, 600);
  assert.equal(config.groups[0].areas[1].parts.length, 3);
  assert.equal(layoutLevel(config, 'shop', 1100, 600, { rest }).boxes.length, 3);
});

test('a box lists open epics in its body (leaf) or under its minis when two lines fit there', () => {
  const top = layoutLevel(config, null, 1200, 700);
  for (const b of top.boxes) {
    if (!b.lines) continue;
    assert.ok(b.lines.h >= 42 && inside(b.lines, b.rect), `${b.id} lines inside`);
    for (const m of b.minis) assert.ok(!overlap(m.rect, b.lines), `${b.id} lines clear of ${m.id}`);
  }
  assert.ok(top.boxes.find(b => b.id === 'kitchen').lines, 'one area leaves room for epics');
  const area = layoutLevel(config, 'counter', 1100, 600);
  assert.ok(area.boxes.every(b => b.lines === b.body));
});

test('rectsFor holds main boxes and minis (zoom anchors)', () => {
  const rects = rectsFor(layoutLevel(config, null, 1200, 700));
  assert.ok(rects.has('shop') && rects.has('counter') && !rects.has('counter-p0'));
});

test('a config with services, cables and boxes everywhere does not change the layout rules', () => {
  const { config: withExtras } = normalizeHomeConfig({
    version: 1,
    groups: [{ id: 'g', name: 'G', box: [0, 0, 10, 10], areas: [{ id: 'a', name: 'A', box: [5, 5, 1, 1] }, { id: 'b', name: 'B', box: [5, 5, 1, 1] }] }],
    cables: [{ from: 'a', to: 'b' }],
    services: [{ id: 's', name: 'S', what: 'a service' }],
  });
  const l = layoutLevel(withExtras, 'g', 900, 500);
  sane(l, 900, 500);
  assert.equal(l.boxes.length, 2);
});
