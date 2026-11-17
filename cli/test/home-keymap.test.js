/**
 * shared/home-keymap.js and the command registry (PRO125): one key table, no clashes, every key documented.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILTIN_KEYS, GO_KEYS, keyTable, findKeyClashes, chordFromEvent, formatChord, groupKeyRows,
} from '../../shared/home-keymap.js';
import { homeViews } from '../../dashboard/js/home-state.js';
import { registerHomeCommand, homeCommands } from '../../dashboard/js/home-commands.js';
import { keysBlock, withKeys, DOC } from '../../scripts/home-keys-doc.js';

const doc = readFileSync(DOC, 'utf8');

test('the built-in keys have no duplicate chord in a scope', () => {
  assert.deepEqual(findKeyClashes(BUILTIN_KEYS), []);
  assert.deepEqual(findKeyClashes(keyTable({ views: homeViews() })), []);
});

test('the g letters are unique, every one has a view, and plain g is not bound on its own', () => {
  assert.equal(new Set(GO_KEYS.map(g => g.letter)).size, GO_KEYS.length);
  const ids = homeViews().map(v => v.id);
  for (const g of GO_KEYS) assert.ok(ids.includes(g.view), `g ${g.letter} goes to "${g.view}", which is not a registered view`);
  assert.ok(!keyTable({ views: homeViews() }).some(r => r.scope === 'page' && r.keys.includes('g')));
});

test('a view key and the number keys do not clash with a command key', () => {
  registerHomeCommand({ id: 'test-clash-digit', title: 'Digit', group: 'Test', keys: ['2', 'x'], run() {} });
  const cmd = homeCommands().find(c => c.id === 'test-clash-digit');
  assert.deepEqual(cmd.keys, ['x'], 'key 2 belongs to the Map view');
  registerHomeCommand({ id: 'test-clash-esc', title: 'Esc', group: 'Test', keys: ['Esc', 'g o', 'Mod+K'], run() {} });
  assert.deepEqual(homeCommands().find(c => c.id === 'test-clash-esc').keys, []);
  const table = keyTable({ views: homeViews(), commands: homeCommands() });
  assert.deepEqual(findKeyClashes(table), []);
});

test('registerHomeCommand checks what it is given, and keeps the first of an id', () => {
  assert.throws(() => registerHomeCommand({ title: 'x', group: 'g', run() {} }), /id/);
  assert.throws(() => registerHomeCommand({ id: 'a1', group: 'g', run() {} }), /title/);
  assert.throws(() => registerHomeCommand({ id: 'a2', title: 't', run() {} }), /group/);
  assert.throws(() => registerHomeCommand({ id: 'a3', title: 't', group: 'g' }), /run/);
  const warn = console.warn;
  console.warn = () => {};
  try {
    registerHomeCommand({ id: 'test-twice', title: 'First', group: 'Test', run() {} });
    registerHomeCommand({ id: 'test-twice', title: 'Second', group: 'Test', run() {} });
  } finally { console.warn = warn; }
  assert.equal(homeCommands().find(c => c.id === 'test-twice').title, 'First');
});

test('chordFromEvent names a key press the way the table writes it', () => {
  assert.equal(chordFromEvent({ key: 'k', metaKey: true }), 'Mod+K');
  assert.equal(chordFromEvent({ key: 'K', ctrlKey: true }), 'Mod+K');
  assert.equal(chordFromEvent({ key: '?', shiftKey: true }), '?');
  assert.equal(chordFromEvent({ key: 'N', shiftKey: true }), 'N');
  assert.equal(chordFromEvent({ key: 'Escape' }), 'Esc');
  assert.equal(chordFromEvent({ key: 'Tab', shiftKey: true }), 'Shift+Tab');
  assert.equal(chordFromEvent({ key: 'Enter', metaKey: true }), 'Mod+Enter');
  assert.equal(chordFromEvent({ key: 'Shift', shiftKey: true }), null);
});

test('formatChord shows Mac glyphs on a Mac and words elsewhere', () => {
  assert.equal(formatChord('Mod+K', true), '⌘K');
  assert.equal(formatChord('Mod+K', false), 'Ctrl+K');
  assert.equal(formatChord('g o', true), 'g o');
  assert.equal(formatChord('Shift+Tab', false), 'Shift+Tab');
});

test('every key of the table is documented in docs/home-page.md, and the table there is current', () => {
  assert.ok(doc.includes('<!-- keys:start'), 'docs/home-page.md lost its keys markers');
  assert.equal(withKeys(doc), doc, 'the key table in docs/home-page.md is out of date: run node scripts/home-keys-doc.js --write');
  for (const row of keyTable({ views: homeViews() })) {
    for (const k of row.keys) {
      assert.ok(doc.includes(`\`${formatChord(k, true)}\``), `key ${k} (${row.label}) is missing from docs/home-page.md`);
    }
  }
  assert.ok(keysBlock().includes('`g o`'));
});

test('the sheet has a heading for every group and no group is empty', () => {
  for (const g of groupKeyRows(keyTable({ views: homeViews() }))) assert.ok(g.rows.length > 0, g.group);
});
