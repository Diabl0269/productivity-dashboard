/**
 * shared/home-config.js: home.config.json v1 validation, the older flat shape, and bad inputs
 * (every problem a plain-words line naming the key). Fixtures are synthetic (a made-up bakery).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeHomeConfig, parseHomeConfig, isLegacyShape, findWhere, boxOfWhere, HOME_CONFIG_VERSION,
} from '../../shared/home-config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const example = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'home.config.example.json'), 'utf8'));

const LEGACY = {
  $comment: 'flat shape',
  repos: ['.', 'bakery-site'],
  groups: { shop: 'Shop floor', kitchen: 'Kitchen' },
  keywordProjects: { shop: ['bakery-site', null], kitchen: ['bakery-orders'] },
  areas: [
    { id: 'counter', name: 'Counter', group: 'shop', lanes: ['counter'], match: 'till|counter', box: [10, 10, 100, 40] },
    { id: 'oven', name: 'Oven', group: 'kitchen', match: 'oven|\\bbake\\b', box: [10, 60, 100, 40] },
    { id: 'pantry', name: 'Pantry', group: 'kitchen', projects: ['bakery-orders'], box: [120, 60, 80, 40] },
  ],
  cables: [{ from: 'counter', to: 'oven', path: 'M0 0 L 10 10' }],
};

test('the shipped example is valid v1 with no problems', () => {
  const { config, errors, legacy } = normalizeHomeConfig(example());
  assert.deepEqual(errors, []);
  assert.equal(legacy, false);
  assert.equal(config.version, HOME_CONFIG_VERSION);
  assert.equal(config.title, 'Corner Bakery');
  assert.deepEqual(config.groups.map(g => g.id), ['shop', 'kitchen']);
  assert.deepEqual(config.groups.map(g => g.areas.length), [3, 2]);
  const oven = config.groups[1].areas[0];
  assert.deepEqual(oven.parts.map(p => p.id), ['proofing', 'deck-oven']);
  assert.deepEqual(oven.parts[0].parts, []);
  assert.deepEqual(oven.box, [40, 320, 380, 140]);
  assert.equal(config.services.length, 3);
  assert.equal(config.automations[0].what.startsWith('Prints'), true);
  assert.equal(config.cables.length, 2);
});

test('every box comes back with the full v1 shape and defaults', () => {
  const { config, errors } = normalizeHomeConfig({ version: 1, groups: [{ id: 'g', name: 'G', areas: [{ id: 'a', name: 'A' }] }] });
  assert.deepEqual(errors, []);
  assert.deepEqual(config.groups[0].areas[0], {
    id: 'a', name: 'A', lanes: [], match: null, projects: [], box: null, page: null, covers: [], parts: [],
  });
  assert.deepEqual(Object.keys(config), ['version', 'title', 'repos', 'groups', 'cables', 'decorations', 'services', 'automations', 'automationDefaults', 'lifecycle', 'fallback', 'legacy']);
});

test('the older flat shape is nested under its groups, with no problems', () => {
  assert.equal(isLegacyShape(LEGACY), true);
  const { config, errors, legacy } = normalizeHomeConfig(LEGACY);
  assert.deepEqual(errors, []);
  assert.equal(legacy, true);
  assert.equal(config.version, 1);
  assert.deepEqual(config.groups.map(g => [g.id, g.name, g.areas.map(a => a.id)]), [
    ['shop', 'Shop floor', ['counter']],
    ['kitchen', 'Kitchen', ['oven', 'pantry']],
  ]);
  assert.deepEqual(config.groups[0].keywordProjects, ['bakery-site', null]);
  assert.equal(config.groups[1].areas[0].match, 'oven|\\bbake\\b');
  assert.equal('group' in config.groups[1].areas[0], false);
  assert.deepEqual(config.cables, [{ from: 'counter', to: 'oven', path: 'M0 0 L 10 10', label: null }]);
  assert.deepEqual(config.services, []);
});

test('legacy: an area naming an unknown group is skipped with a plain-words problem', () => {
  const raw = structuredClone(LEGACY);
  raw.areas.push({ id: 'van', name: 'Delivery van', group: 'road' });
  raw.keywordProjects.road = ['x'];
  const { config, errors } = normalizeHomeConfig(raw);
  assert.equal(config.groups.flatMap(g => g.areas).some(a => a.id === 'van'), false);
  assert.ok(errors.some(e => e.includes('areas[3] ("van")') && e.includes('"group"') && e.includes('"road"')), errors.join('\n'));
  assert.ok(errors.some(e => e.includes('keywordProjects') && e.includes('"road"')));
});

test('bad inputs: unreadable file, wrong type, newer version', () => {
  assert.equal(parseHomeConfig('{ not json').config, null);
  assert.match(parseHomeConfig('{ not json').errors[0], /not valid JSON/);
  assert.equal(normalizeHomeConfig([]).config, null);
  assert.match(normalizeHomeConfig('x').errors[0], /should be a JSON object/);
  const v2 = normalizeHomeConfig({ version: 2, groups: [] });
  assert.equal(v2.config, null);
  assert.match(v2.errors[0], /"version" is 2, but this dashboard reads version 1/);
});

test('bad fields: each problem names where and which key, and the rest still loads', () => {
  const raw = {
    version: 1,
    title: 7,
    colour: 'red',
    groups: [
      {
        id: 'shop', name: 'Shop',
        areas: [
          { id: 'counter', name: 'Counter', box: [1, 2, 3], match: '(unclosed', lanes: 'counter' },
          { name: 'No id' },
          { id: 'has space', name: 'Bad id' },
          { id: 'counter', name: 'Twice' },
          { id: 'oven', parts: [{ id: 'tray', name: 'Tray', parts: [{ id: 'deep', name: 'Too deep' }] }] },
          null,
        ],
      },
      'not a group',
    ],
    cables: [{ from: 'counter', to: 'nowhere' }],
    services: [{ id: 'api', name: 'API', what: 'x', extra: { kept: true } }, { id: 'api', name: 'again' }],
  };
  const { config, errors } = normalizeHomeConfig(raw);
  const has = (...parts) => assert.ok(errors.some(e => parts.every(p => e.includes(p))), `missing: ${parts.join(' + ')}\n${errors.join('\n')}`);
  has('the file', '"title"', 'should be text');
  has('unknown key "colour"');
  has('area "counter"', '"box"', 'four numbers');
  has('area "counter"', '"match"', 'not a valid pattern');
  has('area "counter"', '"lanes"', 'list of text');
  has('areas[1]', '"id" is missing');
  has('areas[2]', '"id" should be letters');
  has('"counter" is already used');
  has('area "oven"', '"name" is missing');
  has('part "tray"', 'one level deep');
  has('areas[5]', 'should be an object');
  has('groups[1]', 'should be an object');
  has('cables[0]', '"to"', '"nowhere"');
  has('service "api"', 'used twice');
  // What was fine is still there, the bad values cleared.
  const areas = config.groups[0].areas;
  assert.deepEqual(areas.map(a => a.id), ['counter', 'oven']);
  assert.equal(areas[0].box, null);
  assert.equal(areas[0].match, null);
  assert.equal(areas[1].name, 'oven');
  assert.deepEqual(areas[1].parts[0].parts, []);
  assert.deepEqual(config.cables, []);
  assert.equal(config.services.length, 1);
  assert.deepEqual(config.services[0].extra, { kept: true });
  assert.equal(config.title, '');
});

test('findWhere and boxOfWhere resolve a box id at every level', () => {
  const { config } = normalizeHomeConfig(example());
  assert.deepEqual(findWhere(config, 'kitchen'), { group: 'kitchen', area: null, part: null });
  assert.deepEqual(findWhere(config, 'oven'), { group: 'kitchen', area: 'oven', part: null });
  assert.deepEqual(findWhere(config, 'deck-oven'), { group: 'kitchen', area: 'oven', part: 'deck-oven' });
  assert.equal(findWhere(config, 'nope'), null);
  assert.equal(findWhere(null, 'oven'), null);
  assert.equal(boxOfWhere(config, findWhere(config, 'deck-oven')).name, 'Deck oven');
  assert.equal(boxOfWhere(config, { group: 'shop' }).name, 'Shop floor');
});
