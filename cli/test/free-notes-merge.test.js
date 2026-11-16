/**
 * cli/test/free-notes-merge.test.js
 * PRO121: free notes (`meta.freeNotes`) survive the dashboard's own load/save (tasks-json.js) and the
 * three-way save merge (shared/tasks-merge.js) when the CLI and the dashboard both write: a note
 * added by either side is never lost, and a dismissal on one side beats the stale copy on the other.
 * Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeTasksDocs } from '../../shared/tasks-merge.js';
import { addFreeNote, setFreeNoteState } from '../../shared/review-notes.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const AT = '2026-10-01T10:00:00.000Z';

const tk = (id, extra = {}) => ({ id, title: `Ticket ${id}`, checked: false, priority: 'medium', ...extra });
const baseDoc = () => ({
  version: 1,
  meta: { dailyPlan: { date: null, taskIds: [], carriedIds: [] }, projects: [{ id: 'bakery', prefix: 'BKR' }] },
  sections: [{ id: 'todo', name: 'Todo', tasks: [tk('BKR1'), tk('BKR2')] }],
});
const note = (doc, text, over = {}) => addFreeNote(doc, { text, project: 'bakery', now: AT, ...over });
const texts = (doc) => (doc.meta.freeNotes || []).map(n => `${n.n}:${n.text}:${n.state}`);

// The dashboard merges documents in its own canonical shape (tasks-io.js canonicalDoc), so do the same.
const { loadTasksJson: loadJson, serializeTasksJson: serializeJson } = await import(join(dir, 'tasks-json.js'));
const canon = (doc) => { const m = loadJson(JSON.stringify(doc)); return JSON.parse(serializeJson(m.sections, m.tasks, m.ticketTypes, m.meta)); };
const merge = (base, local, current) => mergeTasksDocs(canon(base), canon(local), canon(current));

test('dashboard load + save keeps meta.freeNotes (it used to drop unknown meta keys)', async () => {
  const { loadTasksJson, serializeTasksJson } = await import(join(dir, 'tasks-json.js'));
  const doc = baseDoc();
  note(doc, 'crust burns', { area: 'oven', where: 'oven-box', images: ['free/0123456789abcdef.png'] });
  const mem = loadTasksJson(JSON.stringify(doc));
  const out = JSON.parse(serializeTasksJson(mem.sections, mem.tasks, mem.ticketTypes, mem.meta));
  assert.deepEqual(out.meta.freeNotes, doc.meta.freeNotes);
  const none = JSON.parse(serializeTasksJson(...Object.values(loadTasksJson(JSON.stringify(baseDoc())))));
  assert.equal('freeNotes' in none.meta, false, 'no free notes: nothing written');
});

test('merge: CLI added a free note while the dashboard edited a ticket: the note is kept', () => {
  const base = baseDoc();
  const local = clone(base);
  local.sections[0].tasks[0].title = 'dashboard title';
  const current = clone(base);
  note(current, 'from the CLI');
  const merged = merge(base, local, current);
  assert.deepEqual(texts(merged), ['1:from the CLI:new']);
  assert.equal(merged.sections[0].tasks[0].title, 'dashboard title');
});

test('merge: the dashboard added a free note while the CLI edited a ticket: the note is kept', () => {
  const base = baseDoc();
  const local = clone(base);
  note(local, 'from the box');
  const current = clone(base);
  current.sections[0].tasks[1].title = 'cli title';
  const merged = merge(base, local, current);
  assert.deepEqual(texts(merged), ['1:from the box:new']);
  assert.equal(merged.sections[0].tasks[1].title, 'cli title');
});

test('merge: both sides added a free note with the same n: both kept, the dashboard one renumbered', () => {
  const base = baseDoc();
  const local = clone(base);
  note(local, 'from the box');
  const current = clone(base);
  note(current, 'from the CLI');
  const merged = merge(base, local, current);
  assert.deepEqual(texts(merged), ['1:from the CLI:new', '2:from the box:new']);
});

test('merge: a dismissal on one side and a new note on the other both land; other meta edits too', () => {
  const base = baseDoc();
  note(base, 'old note');
  const local = clone(base);
  setFreeNoteState(local, 1, 'dismissed');
  local.meta.dailyPlan.taskIds = ['BKR1']; // a pin made in the dashboard
  const current = clone(base);
  note(current, 'new from the CLI');
  const merged = merge(base, local, current);
  assert.deepEqual(texts(merged), ['1:old note:dismissed', '2:new from the CLI:new']);
  assert.deepEqual(merged.meta.dailyPlan.taskIds, ['BKR1']);

  // Reverse: the notes run filed it in the CLI while the dashboard still shows it as new and adds another.
  const local2 = clone(base);
  note(local2, 'second from the box');
  const current2 = clone(base);
  Object.assign(current2.meta.freeNotes[0], { state: 'filed', filed: 'BKR3' });
  const merged2 = merge(base, local2, current2);
  assert.deepEqual(texts(merged2), ['1:old note:filed', '2:second from the box:new']);
  assert.equal(merged2.meta.freeNotes[0].filed, 'BKR3');
});

test('autosave: a 409 from a CLI free note merges and saves both notes', async () => {
  const el = () => new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : k === 'style' ? {} : () => el()),
    set: () => true,
    apply: () => el(),
  });
  globalThis.document = { getElementById: () => el(), createElement: () => el(), body: el() };
  globalThis.window = globalThis;
  const io = await import(join(dir, 'tasks-io.js'));
  const { loadTasksJson } = await import(join(dir, 'tasks-json.js'));
  const http = await import(join(dir, 'http-loader.js'));

  const baseText = JSON.stringify(baseDoc(), null, 2) + '\n';
  const loaded = loadTasksJson(baseText);
  const st = { hasChanges: false, sections: loaded.sections, tasks: loaded.tasks, ticketTypes: loaded.ticketTypes, meta: loaded.meta };
  http.setLastTaskContent(baseText);
  io.setIOCallbacks({ stateFn: () => st, renderFn: () => () => {}, parseFn: () => loadTasksJson });

  const remote = JSON.parse(baseText);
  note(remote, 'from the CLI');
  const remoteText = JSON.stringify(remote, null, 2) + '\n';
  const posts = [];
  globalThis.fetch = async (url, init) => {
    posts.push(JSON.parse(init.body));
    if (posts.length === 1) return { status: 409, ok: false, json: async () => ({ error: 'conflict', current: remoteText }) };
    return { status: 200, ok: true, json: async () => ({ ok: true }) };
  };

  note({ meta: st.meta }, 'from the box'); // what the Home note box does (meta is shared with the state)
  io.markChanged(null);
  await sleep(900);

  assert.equal(posts.length, 2, 'retried after the conflict');
  const saved = JSON.parse(posts[1].content);
  assert.deepEqual(texts(saved), ['1:from the CLI:new', '2:from the box:new']);
  assert.deepEqual(texts({ meta: st.meta }), ['1:from the CLI:new', '2:from the box:new'], 'the state shows the merged notes');
});
