/**
 * cli/test/tasks.test.js
 * Tests for cli/lib/tasks-store.js functions, using synthetic fixtures.
 *
 * Pure function tests (nextId, findTask, etc.) work directly on parsed fixture JSON,
 * bypassing load() which caches _cachedRoot and is not safe to call multiple times
 * with different CH_HOME values in the same process.
 *
 * Mutation tests invoke the CLI via child_process (the `ch` script) with CH_HOME set.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const FIXTURE_DUPE = path.join(__dirname, 'fixtures/tasks.dupe.json');
const REPO_ROOT = path.resolve(__dirname, '../..');
const CH_SCRIPT = path.join(REPO_ROOT, 'ch');

// Import pure store functions directly (no load() — that goes through io.js with cache)
import {
  nextId,
  findTask,
  findAll,
  sectionById,
  flatTasks,
  todayStr,
} from '../lib/tasks-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(fixturePath) {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function makeTmpDir(srcFixture) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-task-test-'));
  fs.copyFileSync(srcFixture, path.join(tmpDir, 'tasks.json'));
  return tmpDir;
}

function readTasks(tmpDir) {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, 'tasks.json'), 'utf8'));
}

/**
 * Run the ch script with CH_HOME=tmpDir.
 */
function runCli(args, tmpDir) {
  const result = spawnSync(process.execPath, [CH_SCRIPT, ...args], {
    env: { ...process.env, CH_HOME: tmpDir },
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? (result.error ? 2 : 0),
  };
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

test('todayStr returns YYYY-MM-DD format', () => {
  const s = todayStr();
  assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
});

test('nextId: sample doc with T1..T6 returns T7', () => {
  const doc = loadFixture(FIXTURE_SAMPLE);
  assert.equal(nextId(doc), 'T7');
});

test('nextId: empty sections returns T1', () => {
  const doc = { version: 1, sections: [{ id: 'todo', name: 'Todo', tasks: [] }] };
  assert.equal(nextId(doc), 'T1');
});

test('nextId: handles gaps — returns max+1', () => {
  const doc = {
    version: 1,
    sections: [
      { id: 'todo', name: 'Todo', tasks: [
        { id: 'T1', title: 'a', checked: false, priority: 'low', created: '2026-01-01', updated: null, subtasks: [] },
        { id: 'T10', title: 'b', checked: false, priority: 'low', created: '2026-01-01', updated: null, subtasks: [] },
      ]},
    ],
  };
  assert.equal(nextId(doc), 'T11');
});

test('nextId with duplicate ids: uses max numeric id across all copies', () => {
  // dupe fixture has T1, T5, T5 -> max is 5 -> nextId = T6
  const doc = loadFixture(FIXTURE_DUPE);
  assert.equal(nextId(doc), 'T6');
});

test('findTask: finds task in correct section', () => {
  const doc = loadFixture(FIXTURE_SAMPLE);
  const result = findTask(doc, 'T3');
  assert.ok(result, 'T3 should be found');
  assert.equal(result.task.id, 'T3');
  assert.equal(result.section.id, 'in-progress');
});

test('findTask: returns null for unknown id', () => {
  const doc = loadFixture(FIXTURE_SAMPLE);
  assert.equal(findTask(doc, 'T999'), null);
});

test('findAll: returns all matches for duplicate id', () => {
  const doc = loadFixture(FIXTURE_DUPE);
  const matches = findAll(doc, 'T5');
  assert.equal(matches.length, 2, `expected 2 matches for T5, got ${matches.length}`);
  assert.ok(matches.every(m => m.task.id === 'T5'));
});

test('findAll: single match for non-duplicate id', () => {
  const doc = loadFixture(FIXTURE_SAMPLE);
  const matches = findAll(doc, 'T1');
  assert.equal(matches.length, 1);
});

test('sectionById: returns correct section', () => {
  const doc = loadFixture(FIXTURE_SAMPLE);
  const sec = sectionById(doc, 'done');
  assert.ok(sec);
  assert.equal(sec.id, 'done');
});

test('sectionById: returns undefined for unknown id', () => {
  const doc = loadFixture(FIXTURE_SAMPLE);
  assert.equal(sectionById(doc, 'nonexistent'), undefined);
});

test('flatTasks: returns all tasks across sections (6 in sample)', () => {
  const doc = loadFixture(FIXTURE_SAMPLE);
  const tasks = flatTasks(doc);
  assert.equal(tasks.length, 6);
  for (const t of tasks) {
    assert.ok(typeof t.section === 'string', `task ${t.id} missing .section`);
  }
});

test('flatTasks active=true excludes done/archive and fully-checked tasks', () => {
  const doc = loadFixture(FIXTURE_SAMPLE);
  const tasks = flatTasks(doc, { active: true });
  const ids = tasks.map(t => t.id);
  assert.ok(!ids.includes('T5'), 'T5 (done, checked) should be excluded');
  assert.ok(!ids.includes('T6'), 'T6 (done, checked) should be excluded');
  assert.ok(ids.includes('T1'), 'T1 should be included');
  assert.ok(ids.includes('T3'), 'T3 should be included');
});

test('flatTasks preserves section order then task order', () => {
  const doc = loadFixture(FIXTURE_SAMPLE);
  const tasks = flatTasks(doc);
  const ids = tasks.map(t => t.id);
  const todoIdx = ids.indexOf('T1');
  const inProgIdx = ids.indexOf('T3');
  const doneIdx = ids.indexOf('T5');
  assert.ok(todoIdx < inProgIdx, 'todo before in-progress');
  assert.ok(inProgIdx < doneIdx, 'in-progress before done');
});

// ---------------------------------------------------------------------------
// Mutation tests via CLI child_process (ch script)
// ---------------------------------------------------------------------------

test('tasks add: assigns unique id and sets created date', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'add', 'New synthetic task', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.id, 'T7', `expected T7, got ${out.id}`);
    assert.equal(out.section, 'todo');

    const doc = readTasks(tmpDir);
    const todo = doc.sections.find(s => s.id === 'todo');
    const task = todo.tasks.find(t => t.id === 'T7');
    assert.ok(task, 'T7 should exist in tasks.json');
    assert.match(task.created, /^\d{4}-\d{2}-\d{2}$/, 'created should be a date');
    assert.equal(task.title, 'New synthetic task');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks move: preserves description, subtasks, priority and sets updated', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    // Add a task with a description (--note is a legacy alias)
    const addResult = runCli(['tasks', 'add', 'Task to move', '--section', 'todo', '--note', 'original note', '--json'], tmpDir);
    assert.equal(addResult.status, 0, `add failed: ${addResult.stderr}`);
    const addOut = JSON.parse(addResult.stdout.trim());
    const addedId = addOut.id;

    // Add a subtask to it
    const subtaskResult = runCli(['tasks', 'update', addedId, '--add-subtask', 'subtask one'], tmpDir);
    assert.equal(subtaskResult.status, 0, `add-subtask failed: ${subtaskResult.stderr}`);

    // Move to in-progress
    const moveResult = runCli(['tasks', 'move', addedId, 'in-progress', '--json'], tmpDir);
    assert.equal(moveResult.status, 0, `move failed: ${moveResult.stderr}`);

    const doc = readTasks(tmpDir);
    const inProg = doc.sections.find(s => s.id === 'in-progress');
    const moved = inProg.tasks.find(t => t.id === addedId);

    assert.ok(moved, `${addedId} should be in in-progress after move`);
    assert.equal(moved.description, 'original note', 'description preserved');
    assert.equal(moved.subtasks.length, 1, 'subtasks preserved');
    assert.equal(moved.subtasks[0].text, 'subtask one');
    assert.match(moved.updated, /^\d{4}-\d{2}-\d{2}$/, 'updated should be set after move');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks done: sets checked=true and moves to done section', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'done', 'T1', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.checked, true);
    assert.equal(out.section, 'done');

    const doc = readTasks(tmpDir);
    const done = doc.sections.find(s => s.id === 'done');
    const task = done.tasks.find(t => t.id === 'T1');
    assert.ok(task, 'T1 should be in done section');
    assert.equal(task.checked, true);

    const todo = doc.sections.find(s => s.id === 'todo');
    assert.ok(!todo.tasks.find(t => t.id === 'T1'), 'T1 should not be in todo anymore');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update --add-subtask: appends subtask', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    // T2 has no subtasks in fixture
    const result = runCli(['tasks', 'update', 'T2', '--add-subtask', 'Write the stub'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const doc = readTasks(tmpDir);
    const todo = doc.sections.find(s => s.id === 'todo');
    const task = todo.tasks.find(t => t.id === 'T2');
    assert.equal(task.subtasks.length, 1);
    assert.equal(task.subtasks[0].text, 'Write the stub');
    assert.equal(task.subtasks[0].checked, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update --check-subtask: marks subtask checked', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    // T1 subtasks[1] = 'Add package.json' (checked: false)
    const result = runCli(['tasks', 'update', 'T1', '--check-subtask', '2'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const doc = readTasks(tmpDir);
    const todo = doc.sections.find(s => s.id === 'todo');
    const task = todo.tasks.find(t => t.id === 'T1');
    assert.equal(task.subtasks[1].checked, true, 'second subtask should be checked');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update --edit-subtask: rewrites subtask text, preserves checked state', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    // T1 subtasks[1] = 'Add package.json' (checked: false) — check it, then rewrite the text
    const checked = runCli(['tasks', 'update', 'T1', '--check-subtask', '2'], tmpDir);
    assert.equal(checked.status, 0, `stderr: ${checked.stderr}`);

    const result = runCli(
      ['tasks', 'update', 'T1', '--edit-subtask', '2', '--subtask-text', 'Add package.json — done 2026-08-06'],
      tmpDir
    );
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const doc = readTasks(tmpDir);
    const todo = doc.sections.find(s => s.id === 'todo');
    const task = todo.tasks.find(t => t.id === 'T1');
    assert.equal(task.subtasks[1].text, 'Add package.json — done 2026-08-06');
    assert.equal(task.subtasks[1].checked, true, 'checked state should survive a text edit');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update --edit-subtask: rejects out-of-range index', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'update', 'T1', '--edit-subtask', '99', '--subtask-text', 'nope'], tmpDir);
    assert.notEqual(result.status, 0, 'should fail on out-of-range index');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update --edit-subtask: requires --subtask-text', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'update', 'T1', '--edit-subtask', '1'], tmpDir);
    assert.notEqual(result.status, 0, 'should fail without --subtask-text');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update --subtask-text: requires --edit-subtask', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'update', 'T1', '--subtask-text', 'orphan'], tmpDir);
    assert.notEqual(result.status, 0, 'should fail without --edit-subtask');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks export: produces markdown containing task title', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'export'], tmpDir);
    assert.equal(result.status, 0, `export failed: ${result.stderr}`);
    assert.ok(
      result.stdout.includes('Set up project scaffolding'),
      `expected T1 title in output:\n${result.stdout}`,
    );
    // Check that there's at least one section header in the output
    assert.ok(result.stdout.includes('##'), 'expected section header in markdown output');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks lint --json: flags dupe fixture as invalid with exit code 2', () => {
  const tmpDir = makeTmpDir(FIXTURE_DUPE);
  try {
    const result = runCli(['tasks', 'lint', '--json'], tmpDir);
    assert.equal(result.status, 2, `expected exit 2, got ${result.status}; stdout: ${result.stdout}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.valid, false);
    assert.ok(
      out.duplicateIds.includes('T5'),
      `expected T5 in duplicateIds: ${JSON.stringify(out.duplicateIds)}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks lint --json: sample fixture is valid', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'lint', '--json'], tmpDir);
    assert.equal(result.status, 0, `lint failed on sample: stdout=${result.stdout} stderr=${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.valid, true);
    assert.equal(out.duplicateIds.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update: dueDate, blocked, labels, links, blockedBy round-trip', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    let result = runCli([
      'tasks', 'update', 'T2',
      '--due', '2026-08-30',
      '--blocked',
      '--waiting-on', 'reviewer',
      '--add-label', 'ops',
      '--add-label', 'urgent',
      '--add-link', 'https://example.com/doc',
      '--link-label', 'Doc',
      '--add-blocked-by', 'T1',
      '--json',
    ], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.dueDate, '2026-08-30');
    assert.equal(out.blocked, true);
    assert.equal(out.waitingOn, 'reviewer');
    assert.deepEqual(out.labels, ['ops', 'urgent']);
    assert.equal(out.links.length, 1);
    assert.equal(out.links[0].url, 'https://example.com/doc');
    assert.equal(out.links[0].label, 'Doc');
    assert.deepEqual(out.blockedBy, ['T1']);

    result = runCli(['tasks', 'update', 'T2', '--clear-due', '--unblocked', '--clear-waiting-on', '--clear-labels', '--clear-links', '--clear-blocked-by', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const cleared = JSON.parse(result.stdout.trim());
    assert.equal(cleared.dueDate, undefined);
    assert.equal(cleared.blocked, undefined);
    assert.equal(cleared.waitingOn, undefined);
    assert.equal(cleared.labels, undefined);
    assert.equal(cleared.links, undefined);
    assert.equal(cleared.blockedBy, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks add: accepts due, blocked, label, link, blocked-by', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli([
      'tasks', 'add', 'New with meta',
      '--due', '2026-09-01',
      '--blocked',
      '--waiting-on', 'vendor',
      '--label', 'ops',
      '--link', 'https://example.com',
      '--blocked-by', 'T1',
      '--json',
    ], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    const doc = readTasks(tmpDir);
    const todo = doc.sections.find(s => s.id === 'todo');
    const task = todo.tasks.find(t => t.id === out.id);
    assert.equal(task.dueDate, '2026-09-01');
    assert.equal(task.blocked, true);
    assert.equal(task.waitingOn, 'vendor');
    assert.deepEqual(task.labels, ['ops']);
    assert.equal(task.links[0].url, 'https://example.com');
    assert.deepEqual(task.blockedBy, ['T1']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update: assignee and estimate (time, not SP)', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    let result = runCli([
      'tasks', 'update', 'T2',
      '--assignee', 'alex',
      '--estimate', '2h',
      '--json',
    ], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.assignee, 'alex');
    assert.equal(out.estimateMinutes, 120);
    assert.ok(Array.isArray(out.history) && out.history.some(h => h.event === 'estimate'));

    result = runCli(['tasks', 'update', 'T2', '--clear-assignee', '--clear-estimate', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const cleared = JSON.parse(result.stdout.trim());
    assert.equal(cleared.assignee, undefined);
    assert.equal(cleared.estimateMinutes, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks move: appends history entry', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'move', 'T1', 'in-progress', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const doc = readTasks(tmpDir);
    const sec = doc.sections.find(s => s.id === 'in-progress');
    const task = sec.tasks.find(t => t.id === 'T1');
    assert.ok(task.history?.some(h => h.event === 'moved' && h.to === 'in-progress'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks set-priority: appends history entry', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'set-priority', 'T2', 'high', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const doc = readTasks(tmpDir);
    const task = doc.sections.flatMap(s => s.tasks).find(t => t.id === 'T2');
    assert.equal(task.priority, 'high');
    assert.ok(task.history?.some(h => h.event === 'priority' && h.to === 'high'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks add: accepts estimate and assignee', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli([
      'tasks', 'add', 'Timed work',
      '--estimate', '1d',
      '--assignee', 'jordan',
      '--json',
    ], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    const doc = readTasks(tmpDir);
    const task = doc.sections.flatMap(s => s.tasks).find(t => t.id === out.id);
    assert.equal(task.estimateMinutes, 480);
    assert.equal(task.assignee, 'jordan');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update: invalid estimate rejected', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'update', 'T2', '--estimate', '3sp', '--json'], tmpDir);
    assert.notEqual(result.status, 0);
    assert.ok(/estimate/i.test(result.stderr) || /estimate/i.test(result.stdout));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks dump: includes dueDate assignee estimateMinutes labels links blockedBy', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    let result = runCli([
      'tasks', 'update', 'T2',
      '--due', '2026-10-01',
      '--assignee', 'alex',
      '--estimate', '30m',
      '--add-label', 'ops',
      '--add-link', 'https://example.com/x',
      '--add-blocked-by', 'T1',
      '--blocked',
      '--waiting-on', 'deps',
      '--json',
    ], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    result = runCli(['tasks', 'dump', '--active'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const rows = JSON.parse(result.stdout.trim());
    const row = rows.find(r => r.id === 'T2');
    assert.ok(row, 'T2 missing from dump');
    assert.equal(row.dueDate, '2026-10-01');
    assert.equal(row.assignee, 'alex');
    assert.equal(row.estimateMinutes, 30);
    assert.equal(row.estimate, '30m');
    assert.deepEqual(row.labels, ['ops']);
    assert.equal(row.links[0].url, 'https://example.com/x');
    assert.deepEqual(row.blockedBy, ['T1']);
    assert.equal(row.blocked, true);
    assert.equal(row.waitingOn, 'deps');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks capture: adds to inbox', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'capture', 'Quick idea', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.section, 'inbox');
    const doc = readTasks(tmpDir);
    const inbox = doc.sections.find(s => s.id === 'inbox');
    assert.ok(inbox, 'inbox section should exist');
    assert.ok(inbox.tasks.find(t => t.id === out.id));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks update: issue project energy snooze decision', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    let result = runCli([
      'tasks', 'update', 'T2',
      '--issue', 'https://github.com/org/repo/issues/9',
      '--project', 'cli',
      '--energy', 'deep',
      '--snooze', '2026-12-01',
      '--decision', 'Ship without feature X',
      '--json',
    ], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.issueUrl, 'https://github.com/org/repo/issues/9');
    assert.equal(out.project, 'cli');
    assert.equal(out.energy, 'deep');
    assert.equal(out.snoozeUntil, '2026-12-01');
    assert.equal(out.decisions[0].text, 'Ship without feature X');

    result = runCli([
      'tasks', 'update', 'T2',
      '--clear-issue', '--clear-project', '--clear-energy', '--clear-snooze',
      '--json',
    ], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const cleared = JSON.parse(result.stdout.trim());
    assert.equal(cleared.issueUrl, undefined);
    assert.equal(cleared.project, undefined);
    assert.equal(cleared.energy, undefined);
    assert.equal(cleared.snoozeUntil, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks plan: pin and show', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    let result = runCli(['tasks', 'plan', '--pin', 'T1', '--pin', 'T2', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.ok(out.taskIds.includes('T1'));
    assert.ok(out.taskIds.includes('T2'));

    result = runCli(['tasks', 'plan', '--unpin', 'T1', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const unpinned = JSON.parse(result.stdout.trim());
    assert.ok(!unpinned.taskIds.includes('T1'));
    assert.ok(unpinned.taskIds.includes('T2'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('tasks lint --fix: adds inbox and meta', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    const result = runCli(['tasks', 'lint', '--fix', '--json'], tmpDir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout.trim());
    assert.equal(out.valid, true);
    const doc = readTasks(tmpDir);
    assert.ok(doc.sections.find(s => s.id === 'inbox'));
    assert.ok(doc.meta);
    assert.equal(typeof doc.meta.weeklyCapacityMinutes, 'number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
