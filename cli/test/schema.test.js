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
  DEFAULT_TICKET_TYPES,
  normalizeTicketTypes,
  allowedParentTypeIds,
  isSectionId,
  isPriority,
  validateTasksDoc,
} from '../lib/schema.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('SECTIONS has all six canonical ids', () => {
  const ids = SECTIONS.map(s => s.id);
  assert.deepEqual(ids, ['inbox', 'backlog', 'todo', 'in-progress', 'done', 'archive']);
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

// ---------------------------------------------------------------------------
// Ticket types + hierarchy
// ---------------------------------------------------------------------------

test('DEFAULT_TICKET_TYPES has epic/feature/task/bug', () => {
  assert.deepEqual(
    DEFAULT_TICKET_TYPES.map(t => t.id),
    ['epic', 'feature', 'task', 'bug'],
  );
});

test('normalizeTicketTypes returns defaults for empty input', () => {
  assert.equal(normalizeTicketTypes(null).length, 4);
  assert.equal(normalizeTicketTypes([])[0].id, 'epic');
});

test('normalizeTicketTypes re-injects missing built-in types', () => {
  const types = normalizeTicketTypes([
    { id: 'spike', name: 'Spike', color: '#111111', parentTypes: [] },
  ]);
  assert.deepEqual(types.map(t => t.id), ['epic', 'feature', 'task', 'bug', 'spike']);
});

test('validateTasksDoc: custom ticketTypes with hierarchy passes', () => {
  const doc = makeValidDoc({
    ticketTypes: [
      { id: 'epic', name: 'Epic', color: '#8B5CF6', parentTypes: [] },
      { id: 'feature', name: 'Feature', color: '#F59E0B', parentTypes: ['epic'] },
      { id: 'task', name: 'Task', color: '#3B82F6', parentTypes: ['epic', 'feature'] },
      { id: 'bug', name: 'Bug', color: '#EF4444', parentTypes: ['epic', 'feature', 'task'] },
    ],
  });
  doc.sections[0].tasks.push({
    id: 'T2',
    title: 'Child',
    checked: false,
    priority: 'low',
    type: 'bug',
    parentId: 'T1',
    created: '2026-01-02',
    updated: null,
    subtasks: [],
  });
  doc.sections[0].tasks[0].type = 'epic';
  const result = validateTasksDoc(doc);
  assert.ok(result.valid, result.errors.join('; '));
});

test('validateTasksDoc: unknown type rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].type = 'story';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('.type')), result.errors.join('; '));
});

test('validateTasksDoc: missing parentId rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].parentId = 'T99';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('parentId') && e.includes('does not exist')));
});

test('validateTasksDoc: self parentId rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].parentId = 'T1';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('itself')));
});

test('validateTasksDoc: bad ticket type color rejected', () => {
  const doc = makeValidDoc({
    ticketTypes: [{ id: 'epic', name: 'Epic', color: 'purple', parentTypes: [] }],
  });
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('color')));
});

test('validateTasksDoc: parent type link must be allowed', () => {
  const doc = makeValidDoc({
    ticketTypes: [
      { id: 'epic', name: 'Epic', color: '#8B5CF6', parentTypes: [] },
      { id: 'task', name: 'Task', color: '#3B82F6', parentTypes: ['epic'] },
      { id: 'bug', name: 'Bug', color: '#EF4444', parentTypes: ['epic'] },
    ],
  });
  doc.sections[0].tasks[0].type = 'epic';
  doc.sections[0].tasks.push({
    id: 'T2',
    title: 'Work item',
    checked: false,
    priority: 'medium',
    type: 'task',
    parentId: 'T1',
    created: '2026-01-02',
    updated: null,
    subtasks: [],
  });
  doc.sections[0].tasks.push({
    id: 'T3',
    title: 'Regression',
    checked: false,
    priority: 'high',
    type: 'bug',
    parentId: 'T2',
    created: '2026-01-03',
    updated: null,
    subtasks: [],
  });
  const bad = validateTasksDoc(doc);
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some(e => e.includes('not allowed')));
});

test('allowedParentTypeIds: legacy list order when parentTypes omitted', () => {
  const types = normalizeTicketTypes([
    { id: 'epic', name: 'Epic', color: '#8B5CF6' },
    { id: 'task', name: 'Task', color: '#3B82F6' },
    { id: 'spike', name: 'Spike', color: '#14B8A6' },
  ]);
  assert.deepEqual(allowedParentTypeIds(types, 'spike'), ['epic', 'task']);
  assert.deepEqual(allowedParentTypeIds(types, 'task'), ['epic']);
  assert.deepEqual(allowedParentTypeIds(types, 'epic'), []);
});

// ---------------------------------------------------------------------------
// New optional fields: dueDate, blocked, labels, links, blockedBy
// ---------------------------------------------------------------------------

test('validateTasksDoc: dueDate / blocked / labels / links / blockedBy pass', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks.push({
    id: 'T2',
    title: 'Blocked child',
    checked: false,
    priority: 'high',
    created: '2026-01-02',
    updated: null,
    subtasks: [],
    dueDate: '2026-03-01',
    blocked: true,
    waitingOn: 'Alice',
    labels: ['urgent', 'ops'],
    links: [{ label: 'Doc', url: 'https://example.com' }],
    blockedBy: ['T1'],
  });
  const result = validateTasksDoc(doc);
  assert.ok(result.valid, result.errors.join('; '));
});

test('validateTasksDoc: bad dueDate rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].dueDate = '03-01-2026';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('dueDate')));
});

test('validateTasksDoc: missing blockedBy id rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].blockedBy = ['T99'];
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('blockedBy') && e.includes('does not exist')));
});

test('validateTasksDoc: self blockedBy rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].blockedBy = ['T1'];
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('itself')));
});

test('validateTasksDoc: bad link rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].links = [{ label: 'x' }];
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('links') && e.includes('url')));
});

test('normalizeTask: drops empty optional fields', async () => {
  const { normalizeTask } = await import('../lib/schema.js');
  const task = {
    id: 'T1',
    title: 'x',
    checked: false,
    priority: 'low',
    dueDate: '',
    blocked: false,
    waitingOn: '',
    labels: [],
    links: [],
    blockedBy: [],
    parentId: '',
    assignee: '',
    estimateMinutes: 0,
    history: [],
  };
  normalizeTask(task);
  assert.equal('dueDate' in task, false);
  assert.equal('blocked' in task, false);
  assert.equal('waitingOn' in task, false);
  assert.equal('labels' in task, false);
  assert.equal('links' in task, false);
  assert.equal('blockedBy' in task, false);
  assert.equal('parentId' in task, false);
  assert.equal('assignee' in task, false);
  assert.equal('estimateMinutes' in task, false);
  assert.equal('history' in task, false);
});

test('validateTasksDoc: assignee estimateMinutes history pass', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].assignee = 'alex';
  doc.sections[0].tasks[0].estimateMinutes = 90;
  doc.sections[0].tasks[0].history = [
    { at: '2026-01-01T12:00:00.000Z', event: 'created', to: 'todo' },
  ];
  const result = validateTasksDoc(doc);
  assert.ok(result.valid, result.errors.join('; '));
});

test('validateTasksDoc: bad estimateMinutes rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].estimateMinutes = -5;
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('estimateMinutes')));
});

test('validateTasksDoc: blocked must be boolean', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].blocked = 'yes';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('blocked')));
});

test('validateTasksDoc: waitingOn must be string', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].waitingOn = 42;
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('waitingOn')));
});

test('appendHistory caps at HISTORY_MAX', async () => {
  const { appendHistory, HISTORY_MAX } = await import('../lib/schema.js');
  const task = { id: 'T1', history: [] };
  for (let i = 0; i < HISTORY_MAX + 10; i++) {
    appendHistory(task, { event: 'moved', from: 'a', to: 'b' });
  }
  assert.equal(task.history.length, HISTORY_MAX);
});

test('validateTasksDoc: issueUrl project energy snooze timeEntries decisions pass', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].issueUrl = 'https://github.com/org/repo/issues/1';
  doc.sections[0].tasks[0].project = 'my-app';
  doc.sections[0].tasks[0].energy = 'deep';
  doc.sections[0].tasks[0].snoozeUntil = '2026-09-01';
  doc.sections[0].tasks[0].timeEntries = [{ at: '2026-01-01T12:00:00.000Z', minutes: 25 }];
  doc.sections[0].tasks[0].decisions = [{ at: '2026-01-01T12:00:00.000Z', text: 'Ship MVP' }];
  doc.meta = {
    dailyPlan: { date: '2026-01-01', taskIds: ['T1'], carriedIds: [] },
    weeklyCapacityMinutes: 600,
    projects: [{ id: 'my-app', name: 'My App', color: '#3B82F6' }],
    ideas: ['try X'],
    review: { weeklyDate: null, checks: {} },
  };
  const result = validateTasksDoc(doc);
  assert.ok(result.valid, result.errors.join('; '));
});

test('validateTasksDoc: bad issueUrl rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].issueUrl = 'http://insecure.example.com';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('issueUrl')));
});

test('validateTasksDoc: bad energy rejected', () => {
  const doc = makeValidDoc();
  doc.sections[0].tasks[0].energy = 'hyperfocus';
  const result = validateTasksDoc(doc);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('energy')));
});

test('ensureSections adds inbox and orders sections', async () => {
  const { ensureSections, SECTION_IDS } = await import('../lib/schema.js');
  const doc = makeValidDoc();
  const { added } = ensureSections(doc);
  assert.ok(added.includes('inbox'));
  assert.deepEqual(doc.sections.map(s => s.id).filter(id => SECTION_IDS.includes(id)).slice(0, 6), SECTION_IDS);
});

test('normalizeMeta fills defaults', async () => {
  const { normalizeMeta } = await import('../lib/schema.js');
  const meta = normalizeMeta(null);
  assert.equal(meta.weeklyCapacityMinutes, 600);
  assert.deepEqual(meta.projects, []);
  assert.deepEqual(meta.ideas, []);
  assert.ok(meta.dailyPlan);
});
