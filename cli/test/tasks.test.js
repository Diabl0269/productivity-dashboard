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

test('tasks move: preserves note, subtasks, priority and sets updated', () => {
  const tmpDir = makeTmpDir(FIXTURE_SAMPLE);
  try {
    // Add a task with a note
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
    assert.equal(moved.note, 'original note', 'note preserved');
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
