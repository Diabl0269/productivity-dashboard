/**
 * cli/test/tasks-files.test.js
 * The split tasks layout (tasks.d/index.json + one file per ticket): the shared module,
 * `ch tasks split` and the CLI on a split home, and serve.js reading/saving it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import {
  tasksLayout, readTasksDoc, readTasksText, writeTasksDoc, writeSplit, splitDoc,
  migrateToSplit, layoutWarnings, stringifyDoc, indexPath, ticketPath, ticketsDir, singlePath,
} from '../../shared/tasks-files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const FIXTURE_DUPE = path.join(__dirname, 'fixtures/tasks.dupe.json');
const REPO_ROOT = path.resolve(__dirname, '../..');
const CH_SCRIPT = path.join(REPO_ROOT, 'ch');

function tmpHome(fixture = FIXTURE_SAMPLE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-split-test-'));
  if (fixture) fs.copyFileSync(fixture, path.join(dir, 'tasks.json'));
  return dir;
}

function runCli(args, home) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], {
    env: { ...process.env, CH_HOME: home },
    encoding: 'utf8',
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}

function backupNames(home) {
  const dir = path.join(home, '.backup', 'tasks');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

// ---------------------------------------------------------------------------
// shared/tasks-files.js
// ---------------------------------------------------------------------------

test('split then read reproduces the single file byte for byte', () => {
  const home = tmpHome();
  const original = fs.readFileSync(singlePath(home), 'utf8');
  const doc = JSON.parse(original);
  fs.rmSync(singlePath(home));
  writeSplit(home, doc);
  assert.equal(tasksLayout(home), 'split');
  assert.equal(readTasksText(home), stringifyDoc(doc));
  assert.deepEqual(readTasksDoc(home), doc);
});

test('index keeps section order and lists ids, one file per ticket', () => {
  const home = tmpHome();
  const doc = readTasksDoc(home);
  writeSplit(home, doc);
  const index = JSON.parse(fs.readFileSync(indexPath(home), 'utf8'));
  assert.deepEqual(index.sections.map(s => s.id), doc.sections.map(s => s.id));
  for (const [i, s] of doc.sections.entries()) {
    assert.deepEqual(index.sections[i].tasks, s.tasks.map(t => t.id));
    for (const t of s.tasks) {
      assert.deepEqual(JSON.parse(fs.readFileSync(ticketPath(home, t.id), 'utf8')), t);
    }
  }
});

test('writeSplit rewrites only changed tickets and removes dropped ones', () => {
  const home = tmpHome();
  const doc = readTasksDoc(home);
  writeSplit(home, doc);
  const ids = doc.sections.flatMap(s => s.tasks.map(t => t.id));
  assert.ok(ids.length >= 3);
  const [changed, dropped] = ids;
  const target = doc.sections.flatMap(s => s.tasks).find(t => t.id === changed);
  target.title = 'Changed title';
  for (const s of doc.sections) s.tasks = s.tasks.filter(t => t.id !== dropped);
  const r = writeSplit(home, doc);
  assert.equal(r.written, 1);
  assert.equal(r.removed, 1);
  assert.equal(fs.existsSync(ticketPath(home, dropped)), false);
  assert.equal(readTasksDoc(home).sections.flatMap(s => s.tasks).find(t => t.id === changed).title, 'Changed title');
});

test('writeSplit refuses duplicate or missing ids instead of losing a ticket', () => {
  const dupe = JSON.parse(fs.readFileSync(FIXTURE_DUPE, 'utf8'));
  assert.throws(() => splitDoc(dupe), /duplicate ticket id/);
  const noId = { version: 1, sections: [{ id: 'todo', name: 'Todo', tasks: [{ id: null, title: 'x' }] }] };
  assert.throws(() => splitDoc(noId), /valid id/);
});

test('a missing ticket file is reported, not silently dropped', () => {
  const home = tmpHome();
  const doc = readTasksDoc(home);
  fs.rmSync(singlePath(home));
  writeSplit(home, doc);
  const id = doc.sections.flatMap(s => s.tasks)[0].id;
  fs.rmSync(ticketPath(home, id));
  assert.throws(() => readTasksDoc(home), new RegExp(`${id}\\.json is missing`));
});

test('writeTasksDoc keeps the single layout when there is no tasks.d', () => {
  const home = tmpHome();
  const doc = readTasksDoc(home);
  doc.sections[0].name = 'Renamed';
  writeTasksDoc(home, doc);
  assert.equal(tasksLayout(home), 'single');
  assert.equal(fs.existsSync(path.join(home, 'tasks.d')), false);
  assert.equal(JSON.parse(fs.readFileSync(singlePath(home), 'utf8')).sections[0].name, 'Renamed');
});

test('migrateToSplit verifies, then moves tasks.json to the backup path', () => {
  const home = tmpHome();
  const original = fs.readFileSync(singlePath(home), 'utf8');
  const dest = path.join(home, '.backup', 'tasks', 'tasks-x.json');
  const r = migrateToSplit(home, { moveSingleTo: dest });
  assert.equal(fs.existsSync(singlePath(home)), false);
  assert.equal(fs.readFileSync(dest, 'utf8'), original);
  const doc = JSON.parse(original);
  assert.equal(r.tickets, doc.sections.reduce((n, s) => n + s.tasks.length, 0));
  assert.deepEqual(r.sections, doc.sections.map(s => ({ id: s.id, count: s.tasks.length })));
  assert.equal(readTasksText(home), stringifyDoc(doc));
  assert.throws(() => migrateToSplit(home, { moveSingleTo: dest }), /already split/);
});

test('migrateToSplit leaves tasks.json alone when the split fails', () => {
  const home = tmpHome(FIXTURE_DUPE);
  const original = fs.readFileSync(singlePath(home), 'utf8');
  assert.throws(() => migrateToSplit(home, { moveSingleTo: path.join(home, 'b.json') }), /split aborted/);
  assert.equal(fs.readFileSync(singlePath(home), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(home, 'tasks.d')), false);
  assert.equal(tasksLayout(home), 'single');
});

test('layoutWarnings flags a stale tasks.json next to tasks.d', () => {
  const home = tmpHome();
  writeSplit(home, readTasksDoc(home));
  assert.match(layoutWarnings(home)[0], /ignored/);
  fs.rmSync(singlePath(home));
  assert.deepEqual(layoutWarnings(home), []);
});

// ---------------------------------------------------------------------------
// ch on a split home
// ---------------------------------------------------------------------------

test('ch tasks split: backs up, splits, and every command keeps working', () => {
  const home = tmpHome();
  const original = fs.readFileSync(singlePath(home), 'utf8');
  const before = runCli(['tasks', 'list', '--json'], home);
  assert.equal(before.status, 0, before.stderr);

  const split = runCli(['tasks', 'split'], home);
  assert.equal(split.status, 0, split.stderr);
  assert.match(split.stdout, /verified/);
  assert.equal(fs.existsSync(singlePath(home)), false);
  const backups = backupNames(home);
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(home, '.backup', 'tasks', backups[0]), 'utf8'), original);

  const after = runCli(['tasks', 'list', '--json'], home);
  assert.equal(after.stdout, before.stdout);

  const add = runCli(['tasks', 'add', 'Split layout ticket', '--json'], home);
  assert.equal(add.status, 0, add.stderr);
  const id = JSON.parse(add.stdout).id;
  assert.ok(fs.existsSync(ticketPath(home, id)), 'new ticket gets its own file');
  assert.equal(runCli(['tasks', 'done', id], home).status, 0);
  assert.equal(JSON.parse(runCli(['tasks', 'get', id, '--json'], home).stdout).section, 'done');
  assert.equal(runCli(['tasks', 'lint'], home).status, 0);
  assert.equal(fs.existsSync(singlePath(home)), false, 'no tasks.json is written back');
  assert.equal(runCli(['tasks', 'split'], home).status !== 0, true, 'second split refuses');
});

test('ch tasks backup and restore work on a split home', () => {
  const home = tmpHome();
  assert.equal(runCli(['tasks', 'split'], home).status, 0);
  const snapshot = readTasksText(home);
  const b = JSON.parse(runCli(['tasks', 'backup', '--json'], home).stdout);
  assert.equal(fs.readFileSync(b.path, 'utf8'), snapshot, 'backup is the assembled document');

  const add = JSON.parse(runCli(['tasks', 'add', 'Gone after restore', '--json'], home).stdout);
  assert.ok(fs.existsSync(ticketPath(home, add.id)));
  const r = runCli(['tasks', 'restore', b.name], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readTasksText(home), snapshot);
  assert.equal(fs.existsSync(ticketPath(home, add.id)), false);
  assert.equal(tasksLayout(home), 'split');
});

test('ch tasks lint warns about a leftover tasks.json', () => {
  const home = tmpHome();
  const original = fs.readFileSync(singlePath(home), 'utf8');
  assert.equal(runCli(['tasks', 'split'], home).status, 0);
  fs.writeFileSync(singlePath(home), original);
  const lint = runCli(['tasks', 'lint'], home);
  assert.equal(lint.status, 0);
  assert.match(lint.stderr, /tasks\.json exists next to tasks\.d/);
});

// ---------------------------------------------------------------------------
// serve.js on a split home
// ---------------------------------------------------------------------------

async function withServer(home, fn) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'serve.js'), String(port)], {
    env: { ...process.env, CH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', d => { if (String(d).includes('Dashboard:')) resolve(); });
      child.on('exit', code => reject(new Error(`serve.js exited ${code}`)));
    });
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    child.kill();
  }
}

test('serve.js serves the assembled document and saves back into tasks.d', async () => {
  const home = tmpHome();
  assert.equal(runCli(['tasks', 'split'], home).status, 0);
  await withServer(home, async (base) => {
    const got = await fetch(`${base}/tasks.json`);
    assert.equal(got.status, 200);
    const text = await got.text();
    assert.equal(text, readTasksText(home));

    // The dashboard sends its own serialization; formatting may differ from the
    // assembled text, so the conflict check compares documents, not bytes.
    const doc = JSON.parse(text);
    const first = doc.sections.flatMap(s => s.tasks)[0];
    first.title = 'Saved from the dashboard';
    const save = await fetch(`${base}/api/save`, {
      method: 'POST',
      body: JSON.stringify({ path: 'tasks.json', content: JSON.stringify(doc), baseContent: JSON.stringify(JSON.parse(text)) }),
    });
    assert.equal(save.status, 200, await save.text());
    assert.equal(fs.existsSync(singlePath(home)), false);
    assert.equal(JSON.parse(fs.readFileSync(ticketPath(home, first.id), 'utf8')).title, 'Saved from the dashboard');

    // A stale base is a conflict and writes nothing.
    const stale = await fetch(`${base}/api/save`, {
      method: 'POST',
      body: JSON.stringify({ path: 'tasks.json', content: text, baseContent: text }),
    });
    assert.equal(stale.status, 409);
    assert.equal(JSON.parse(fs.readFileSync(ticketPath(home, first.id), 'utf8')).title, 'Saved from the dashboard');

    // Backup and restore through the dashboard endpoints.
    const b = await (await fetch(`${base}/api/tasks-backup`, { method: 'POST' })).json();
    assert.ok(b.name);
    const files = fs.readdirSync(ticketsDir(home)).length;
    const restore = await fetch(`${base}/api/tasks-restore`, { method: 'POST', body: JSON.stringify({ name: b.name }) });
    assert.equal(restore.status, 200);
    assert.equal(fs.readdirSync(ticketsDir(home)).length, files);
  });
});

test('serve.js still serves a single tasks.json verbatim', async () => {
  const home = tmpHome();
  const original = fs.readFileSync(singlePath(home), 'utf8');
  await withServer(home, async (base) => {
    assert.equal(await (await fetch(`${base}/tasks.json`)).text(), original);
  });
});
