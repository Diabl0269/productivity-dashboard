/**
 * cli/test/promote.test.js
 * PRO85: `ch tasks promote <epicId>` moves that epic's own backlog tickets to todo (the CLI twin of the
 * Plan page button), one history entry each, and a move back undoes it. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CH_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ch');
const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane: 'a', description: '', labels: ['model:sonnet'], ...extra });
const mk = bySection => ({ version: 1, meta: { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } }, sections: Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks })) });

function setup() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-promote-'));
  fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(mk({
    todo: [epic('T1'), epic('T2', { lane: 'b' }), task('T6', { parentId: 'T2' }), epic('T3', { title: 'Mixer: later' })],
    backlog: [task('T11', { parentId: 'T1' }), task('T12', { parentId: 'T1' }), task('T13', { parentId: 'T2' }), task('T14', { parentId: 'T3' }), task('T15')],
  })));
  return h;
}
const ch = (h, ...args) => {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: h }, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const where = h => {
  const doc = JSON.parse(fs.readFileSync(path.join(h, 'tasks.json'), 'utf8'));
  const out = {};
  for (const s of doc.sections) for (const t of s.tasks) out[t.id] = { section: s.id, history: t.history || [] };
  return out;
};

test('promote moves only that epic\'s backlog tickets to todo, each with a moved history entry', () => {
  const h = setup();
  const r = ch(h, 'tasks', 'promote', 'T1');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /promoted 2 tickets of T1 to todo: T11, T12/);
  const w = where(h);
  for (const id of ['T11', 'T12']) {
    assert.equal(w[id].section, 'todo');
    assert.ok(w[id].history.some(e => e.event === 'moved' && e.from === 'backlog' && e.to === 'todo'), `${id} history`);
  }
  for (const id of ['T13', 'T14', 'T15']) assert.equal(w[id].section, 'backlog', `${id} stays`);
});

test('moving them back (the Undo) restores every ticket to backlog', () => {
  const h = setup();
  ch(h, 'tasks', 'promote', 'T1');
  for (const id of ['T11', 'T12']) assert.equal(ch(h, 'tasks', 'move', id, 'backlog').status, 0);
  const w = where(h);
  assert.equal(w.T11.section, 'backlog');
  assert.equal(w.T12.section, 'backlog');
});

test('promote refuses a "later" bucket, an epic with nothing in backlog, and an unknown id', () => {
  const h = setup();
  assert.notEqual(ch(h, 'tasks', 'promote', 'T3').status, 0);
  assert.notEqual(ch(h, 'tasks', 'promote', 'T2').status, 0, 'T2 has a runnable ticket, it is not parked');
  assert.notEqual(ch(h, 'tasks', 'promote', 'NOPE').status, 0);
  assert.notEqual(ch(h, 'tasks', 'promote').status, 0);
  assert.equal(where(h).T14.section, 'backlog');
});

// The Plan page button: same moveTask path as the board's bulk move, one render, one Undo that restores them all.
test('dashboard promoteBacklogTickets: moves only the named backlog tickets in one render, history entries, Undo puts them back', async () => {
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub, set: () => true });
  class FakeEl {
    constructor() { this.children = []; this.listeners = {}; this.classList = { add() {}, remove() {}, toggle() {} }; this.textContent = ''; }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
  }
  const statusEl = new FakeEl();
  globalThis.document = { getElementById: id => (id === 'status' ? statusEl : null), querySelector: () => null, querySelectorAll: () => [], createElement: () => new FakeEl(), addEventListener() {}, body: stub, documentElement: stub };
  globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { search: '', hash: '', pathname: '/' }, history: stub };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0; // keep markChanged's autosave timer from running
  try {
    const sel = await import('../../dashboard/js/task-selection.js');
    const board = await import('../../dashboard/js/tasks-board.js');
    const io = await import('../../dashboard/js/tasks-io.js');
    const mkT = (id, taskId) => ({ id, taskId, title: taskId, checked: false, history: [], subtasks: [] });
    const state = {
      sections: [{ id: 'todo' }, { id: 'backlog' }],
      tasks: { todo: [], backlog: [mkT(1, 'T11'), mkT(2, 'T12'), mkT(3, 'T13')] },
    };
    let renders = 0;
    const renderFn = () => () => { renders++; }; // the callbacks hand back the render function
    sel.setSelectionCallbacks({ stateFn: () => state, renderFn });
    board.setBoardCallbacks({ stateFn: () => state, renderFn });
    io.setIOCallbacks({ stateFn: () => state, renderFn });

    assert.equal(sel.promoteBacklogTickets(['T11', 'T12']), 2);
    assert.deepEqual(state.tasks.todo.map(t => t.taskId), ['T11', 'T12']);
    assert.deepEqual(state.tasks.backlog.map(t => t.taskId), ['T13'], 'a ticket not named stays in backlog');
    assert.equal(renders, 1, 'one render for the whole batch');
    for (const t of state.tasks.todo) assert.ok(t.history.some(e => e.event === 'moved' && e.from === 'backlog' && e.to === 'todo'));
    assert.equal(sel.promoteBacklogTickets(['NOPE']), 0);

    // Undo: the toast's action puts every one back in a single step.
    const undo = statusEl.children.find(c => c.textContent === 'Undo');
    assert.ok(undo, 'an Undo button is offered');
    undo.listeners.click({ stopPropagation() {} });
    assert.deepEqual(state.tasks.backlog.map(t => t.taskId).sort(), ['T11', 'T12', 'T13']);
    assert.deepEqual(state.tasks.todo, []);
    assert.equal(renders, 2);
  } finally {
    globalThis.setTimeout = realTimeout;
    delete globalThis.document; delete globalThis.window; delete globalThis.localStorage;
  }
});
