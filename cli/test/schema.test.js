/**
 * cli/test/schema.test.js
 * Tests for cli/lib/schema.js — validateTasksDoc, SECTIONS, PRIORITIES, helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS,
  SECTION_IDS,
  PRIORITIES,
  isSectionId,
  isPriority,
  validateTasksDoc,
} from '../lib/schema.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('SECTIONS has all five canonical ids', () => {
  const ids = SECTIONS.map(s => s.id);
  assert.deepEqual(ids, ['backlog', 'todo', 'in-progress', 'done', 'archive']);
});

test('SECTION_IDS matches SECTIONS map', () => {
  assert.deepEqual(SECTION_IDS, SECTIONS.map(s => s.id));
});

test('PRIORITIES contains low/medium/high', () => {
  assert.deepEqual(PRIORITIES, ['low', 'medium', 'high']);
});

test('isSectionId returns true for valid ids', () => {
  for (const id of SECTION_IDS) {
    assert.ok(isSectionId(id), `expected ${id} to be valid`);
  }
});

test('isSectionId returns false for unknown ids', () => {
  assert.equal(isSectionId('random'), false);
  assert.equal(isSectionId(''), false);
  assert.equal(isSectionId(undefined), false);
});

test('isPriority returns true for valid priorities', () => {
  for (const p of PRIORITIES) {
    assert.ok(isPriority(p));
  }
});

test('isPriority returns false for unknown priorities', () => {
  assert.equal(isPriority('urgent'), false);
  assert.equal(isPriority(''), false);
  assert.equal(isPriority(null), false);
});

// ---------------------------------------------------------------------------
// validateTasksDoc — valid document
// ---------------------------------------------------------------------------

function makeValidDoc(overrides = {}) {
  return {
    version: 1,
    sections: [
      {
        id: 'todo',
        name: 'Todo',
        tasks: [
          {
            id: 'T1',
            title: 'Do something',
            checked: false,
            priority: 'medium',
            created: '2026-01-01',
            updated: null,
            subtasks: [],
          },
        ],
      },
      {
        id: 'done',
        name: 'Done',
        tasks: [],
      },
    ],
    ...overrides,
  };
}

test('validateTasksDoc: valid minimal document passes', () => {
  const result = validateTasksDoc(makeValidDoc());
  assert.ok(result.valid, `expected valid, got errors: ${result.errors.join('; ')}`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.duplicateIds.length, 0);
});

test('validateTasksDoc: valid doc with subtasks passes', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].subtasks = [
    { text: 'Step one', checked: false },
    { text: 'Step two', checked: true },
  ];
  const result = validateTasksDoc(doc);
  assert.ok(result.valid, result.errors.join('; '));
});

test('validateTasksDoc: valid doc with all section ids passes', () => {
  const doc = {
    version: 1,
    sections: SECTION_IDS.map(id => ({ id, name: id, tasks: [] })),
  };
  const result = validateTasksDoc(doc);
  assert.ok(result.valid, result.errors.join('; '));
});

// ---------------------------------------------------------------------------
// validateTasksDoc — duplicate ids
// ---------------------------------------------------------------------------

test('validateTasksDoc: duplicate T5 flagged in duplicateIds', () => {
  const doc = {
    version: 1,
    sections: [
      {
        id: 'todo',
        name: 'Todo',
        tasks: [
          { id: 'T1', title: 'First', checked: false, priority: 'medium', created: '2026-01-10', updated: null, subtasks: [] },
          { id: 'T5', title: 'First T5', checked: false, priority: 'low', created: '2026-01-10', updated: null, subtasks: [] },
        ],
      },
      {
        id: 'in-progress',
        name: 'In Progress',
        tasks: [
          { id: 'T5', title: 'Second T5', checked: false, priority: 'high', created: '2026-01-11', updated: null, subtasks: [] },
        ],
      },
    ],
  };
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.duplicateIds.includes('T5'), `expected T5 in duplicateIds, got: ${JSON.stringify(result.duplicateIds)}`);
});

test('validateTasksDoc: tasks.dupe.json fixture is invalid with T5 duplicate', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(__dirname, 'fixtures/tasks.dupe.json'), 'utf8');
  const doc = JSON.parse(raw);
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false, 'dupe fixture should be invalid');
  assert.ok(result.duplicateIds.includes('T5'), `expected T5 duplicate, got: ${JSON.stringify(result.duplicateIds)}`);
});

// ---------------------------------------------------------------------------
// validateTasksDoc — bad priority
// ---------------------------------------------------------------------------

test('validateTasksDoc: bad priority rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].priority = 'urgent';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('priority')), `expected priority error, got: ${result.errors}`);
});

// ---------------------------------------------------------------------------
// validateTasksDoc — bad section id
// ---------------------------------------------------------------------------

test('validateTasksDoc: unknown section id rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].id = 'not-a-real-section';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('not a valid section id')), result.errors.join('; '));
});

// ---------------------------------------------------------------------------
// validateTasksDoc — bad date
// ---------------------------------------------------------------------------

test('validateTasksDoc: malformed created date rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].created = '01-01-2026'; // wrong format
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('created') && e.includes('YYYY-MM-DD')), result.errors.join('; '));
});

test('validateTasksDoc: malformed updated date rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].updated = '2026/01/01';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('updated') && e.includes('YYYY-MM-DD')), result.errors.join('; '));
});

test('validateTasksDoc: null updated is allowed', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].updated = null;
  const result = validateTasksDoc(doc);
  assert.ok(result.valid, result.errors.join('; '));
});

// ---------------------------------------------------------------------------
// validateTasksDoc — structural errors
// ---------------------------------------------------------------------------

test('validateTasksDoc: missing version errors', () => {
  const doc = makeValidDoc({ version: 'one' });
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('version')));
});

test('validateTasksDoc: non-array sections errors', () => {
  const result = validateTasksDoc({ version: 1, sections: 'bad' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('sections')));
});

test('validateTasksDoc: non-boolean checked errors', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].checked = 'yes';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('checked')));
});

test('validateTasksDoc: non-string title errors', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].title = 123;
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('title')));
});

test('validateTasksDoc: bad task id format errors', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].id = 'task-1';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('T\\d+')), result.errors.join('; '));
});

test('validateTasksDoc: subtask missing text errors', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].subtasks = [{ text: 123, checked: false }];
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('subtasks') && e.includes('text')));
});

test('validateTasksDoc: non-array subtasks errors', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].subtasks = 'none';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('subtasks')));
});

test('validateTasksDoc: null/undefined input returns invalid', () => {
  assert.equal(validateTasksDoc(null).valid, false);
  assert.equal(validateTasksDoc(undefined).valid, false);
  assert.equal(validateTasksDoc('string').valid, false);
});
