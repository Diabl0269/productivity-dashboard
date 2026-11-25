/**
 * cli/test/board-check.test.js
 * AGE214: the guard for "a design-board check that is already answered never reaches Tal, and every board card
 * has a clickable link": no "on the board" check without a board link; none once the board has an answer;
 * `ch tasks checks --lint` finds the offenders. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { boardCheckProblem, boardAnsweredProblem, boardSweepProblems, isBoardLink, mentionsBoard } from '../../shared/board-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const BOARD = 'https://claude.ai/artifact/abc123';
const CHECK = 'Comment A, B or C on the board';

test('mentionsBoard / isBoardLink', () => {
  assert.ok(mentionsBoard('Comment A, B or C on the board'));
  assert.ok(mentionsBoard('Look at THE BOARD'));
  assert.ok(!mentionsBoard('Open the dashboard'));
  assert.ok(isBoardLink({ url: BOARD }));
  assert.ok(isBoardLink({ url: 'https://example.com/x', label: 'Design canvas v2' }));
  assert.ok(!isBoardLink({ url: 'https://github.com/example/demo/pull/1', label: 'PR #1' }));
});

test('a check on the board is refused without a board link, passes with one on the ticket, epic or call', () => {
  const p = boardCheckProblem([CHECK], { tasks: [{ id: 'T1', links: [] }] });
  assert.match(p, /--design-link/);
  assert.match(p, /--add-link/);
  assert.equal(boardCheckProblem([CHECK], { tasks: [{ id: 'T1', links: [{ url: BOARD }] }] }), null);
  assert.equal(boardCheckProblem([CHECK], { tasks: [{ id: 'T1' }, { id: 'E1', links: [{ url: 'x', label: 'Design canvas' }] }] }), null);
  assert.equal(boardCheckProblem([CHECK], { tasks: [{ id: 'T1' }], extraLinks: [BOARD] }), null);
  assert.equal(boardCheckProblem(['Press Play'], { tasks: [{ id: 'T1' }] }), null);
});

test('an answered board is refused with the decision hint; none when no answer is present', () => {
  const linked = { id: 'T1', links: [{ url: BOARD, addedAt: '2026-11-01T00:00:00Z' }] };
  assert.equal(boardAnsweredProblem([CHECK], { ...linked, notes: [{ at: '2026-11-02T00:00:00Z', text: 'Tal commented: B' }] }) !== null, true);
  assert.match(boardAnsweredProblem([CHECK], { ...linked, decisions: [{ at: '2026-11-02T00:00:00Z', text: 'picked A' }] }), /put it in --decision and drop this check/);
  assert.equal(boardAnsweredProblem([CHECK], { ...linked, notes: [{ at: '2026-10-01T00:00:00Z', text: 'answered before the board existed' }] }), null);
  assert.equal(boardAnsweredProblem([CHECK], { ...linked, notes: [{ at: '2026-11-02T00:00:00Z', text: 'built the board' }] }), null);
  assert.equal(boardAnsweredProblem(['Press Play'], { ...linked, notes: [{ text: 'picked A' }] }), null);
});

const doc = () => {
  const d = {
    version: 1,
    sections: [
      { id: 'todo', name: 'Todo', tasks: [
        { id: 'T10', title: 'Epic', type: 'epic', checked: false, subtasks: [], checks: [{ text: 'Pick on the board', checked: false }] },
        { id: 'T11', title: 'Epic two', type: 'epic', checked: false, subtasks: [], links: [{ url: BOARD }], checks: [{ text: 'Pick on the board', checked: false }] },
      ] },
      { id: 'in-progress', name: 'In Progress', tasks: [
        { id: 'T1', title: 'Fine', checked: false, subtasks: [], parentId: 'T11', checks: [{ text: 'Comment on the board', checked: false }, { text: 'Old one on the board', checked: true }] },
        { id: 'T2', title: 'Plain', checked: false, subtasks: [], checks: [{ text: 'Press Play', checked: false }] },
      ] },
      { id: 'done', name: 'Done', tasks: [{ id: 'T3', title: 'Closed', checked: true, subtasks: [], checks: [{ text: 'on the board', checked: false }] }] },
    ],
  };
  for (const s of d.sections) for (const t of s.tasks) t.priority = 'medium';
  return d;
};

test('sweep finds the offender (epic with no link) and not the fine, ticked, plain or closed ones', () => {
  const lines = boardSweepProblems(doc());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^T10#1 /);
});

test('ch tasks checks --lint exits 1 with the offender, 0 when fixed', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-board-'));
  const d = doc();
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(d));
  const run = () => spawnSync(process.execPath, [CH_SCRIPT, 'tasks', 'checks', '--lint'], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  const bad = run();
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stdout, /T10#1/);
  d.sections[0].tasks[0].links = [{ url: BOARD }];
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(d));
  assert.equal(run().status, 0);
});

test('ch tasks update --add-check on the board is refused without a link, allowed with one', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-board-'));
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc()));
  const run = (args) => spawnSync(process.execPath, [CH_SCRIPT, 'tasks', 'update', ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  const bad = run(['T2', '--add-check', CHECK]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /--design-link/);
  const good = run(['T2', '--add-check', CHECK, '--add-link', BOARD, '--link-label', 'Design canvas']);
  assert.equal(good.status, 0, good.stderr);
});
