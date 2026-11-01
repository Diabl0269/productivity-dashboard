// A save that hits a 409 (a `ch` write landed between load and save) must merge, retry and
// save, not leave the edits in memory behind a Reload button that discards them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const el = () => new Proxy(function () {}, {
  get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : k === 'style' ? {} : () => el(),
  set: () => true,
  apply: () => el(),
});

const tk = (id, extra = {}) => ({ id, title: `Ticket ${id}`, checked: false, priority: 'medium', ...extra });
const docText = (sections) => JSON.stringify({ version: 1, sections: Object.entries(sections).map(([id, tasks]) => ({ id, name: id, tasks })) }, null, 2) + '\n';

test('409 on save: merge with the current file, retry, and save both sides\' edits', async () => {
  globalThis.document = { getElementById: () => el(), createElement: () => el(), body: el() };
  globalThis.window = globalThis;
  const io = await import(join(dir, 'tasks-io.js'));
  const { loadTasksJson } = await import(join(dir, 'tasks-json.js'));
  const http = await import(join(dir, 'http-loader.js'));

  const baseText = docText({ todo: [tk('T1'), tk('T2')], review: [tk('T3', { checks: [{ text: 'look', checked: false }] })] });
  const loaded = loadTasksJson(baseText);
  const st = { hasChanges: false, sections: loaded.sections, tasks: loaded.tasks, ticketTypes: loaded.ticketTypes, meta: loaded.meta };
  http.setLastTaskContent(baseText);
  io.setIOCallbacks({ stateFn: () => st, renderFn: () => () => {}, parseFn: () => loadTasksJson });

  // A background `ch` write: retitles T2 and adds a ticket.
  const remote = JSON.parse(baseText);
  remote.sections[0].tasks[1].title = 'remote title';
  remote.sections[0].tasks.push(tk('T9'));
  const remoteText = JSON.stringify(remote, null, 2) + '\n';

  const posts = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    posts.push(body);
    if (posts.length === 1) return { status: 409, ok: false, json: async () => ({ error: 'conflict', current: remoteText }) };
    return { status: 200, ok: true, json: async () => ({ ok: true }) };
  };

  // Local edit: a review note on T3.
  const t3 = st.tasks.review[0];
  t3.reviewNotes = [{ n: 1, at: '2026-01-01T00:00:00.000Z', text: 'mine', kind: 'fix', state: 'new' }];
  io.markChanged(t3);
  await sleep(900);

  assert.equal(posts.length, 2, 'retried after the conflict');
  assert.equal(posts[1].baseContent, remoteText, 'retry is based on the file as it is now');
  const saved = JSON.parse(posts[1].content);
  const byId = Object.fromEntries(saved.sections.flatMap(s => s.tasks.map(t => [t.id, t])));
  assert.equal(byId.T3.reviewNotes[0].text, 'mine', 'local note kept');
  assert.equal(byId.T2.title, 'remote title', 'remote edit kept');
  assert.ok(byId.T9, 'remote ticket kept');
  assert.equal(st.hasChanges, false);
  assert.equal(st.tasks.todo.find(t => t.taskId === 'T2').title, 'remote title', 'state shows the merged result');
});

test('409 on every attempt: stops after a few retries and keeps the edits flagged unsaved', async () => {
  globalThis.document = { getElementById: () => el(), createElement: () => el(), body: el() };
  globalThis.window = globalThis;
  const io = await import(join(dir, 'tasks-io.js'));
  const { loadTasksJson } = await import(join(dir, 'tasks-json.js'));
  const http = await import(join(dir, 'http-loader.js'));
  const baseText = docText({ todo: [tk('T1')] });
  const loaded = loadTasksJson(baseText);
  const st = { hasChanges: false, sections: loaded.sections, tasks: loaded.tasks, ticketTypes: loaded.ticketTypes, meta: loaded.meta };
  http.setLastTaskContent(baseText);
  io.setIOCallbacks({ stateFn: () => st, renderFn: () => () => {}, parseFn: () => loadTasksJson });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { status: 409, ok: false, json: async () => ({ error: 'conflict', current: baseText }) }; };
  st.tasks.todo[0].title = 'edited';
  io.markChanged(st.tasks.todo[0]);
  await sleep(900);
  assert.equal(calls, io.MAX_CONFLICT_RETRIES + 1);
  assert.equal(st.hasChanges, true);
  assert.equal(st.tasks.todo[0].title, 'edited');
});
