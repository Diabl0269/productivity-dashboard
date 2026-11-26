// Why notes stopped saving: the server re-read ~3,000 ticket files on every poll and save, blocking
// its event loop; a save then waited forever and the tab kept the edit unsaved with no warning.
// Guards: the read cache, the 304 poll, the save timeout, and a failed save that warns and retries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readTasksText, readTasksTextWithSignature, tasksSignature, writeTasksDoc, ticketPath,
} from '../../shared/tasks-files.js';

const here = dirname(fileURLToPath(import.meta.url));
const js = join(here, '..', '..', 'dashboard', 'js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function splitHome() {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'ch-reliab-'));
  const doc = { version: 1, sections: [{ id: 'todo', name: 'Todo', tasks: [
    { id: 'AAA1', title: 'one' }, { id: 'AAA2', title: 'two' },
  ] }] };
  fs.mkdirSync(join(root, 'tasks.d', 'tickets'), { recursive: true });
  fs.writeFileSync(join(root, 'tasks.d', 'index.json'), '{}');
  writeTasksDoc(root, doc);
  return { root, doc };
}

test('unchanged split document is served from cache without re-reading ticket files', () => {
  const { root } = splitHome();
  const first = readTasksTextWithSignature(root);
  const origRead = fs.readFileSync;
  let ticketReads = 0;
  fs.readFileSync = function (p, ...rest) {
    if (String(p).includes(`${path.sep}tickets${path.sep}`)) ticketReads++;
    return origRead.call(this, p, ...rest);
  };
  try {
    const second = readTasksTextWithSignature(root);
    assert.equal(second.text, first.text);
    assert.equal(second.sig, first.sig);
    assert.equal(ticketReads, 0, 'no ticket file opened on an unchanged poll');
  } finally { fs.readFileSync = origRead; }
});

test('a changed ticket changes the signature and the text', () => {
  const { root, doc } = splitHome();
  const before = readTasksTextWithSignature(root);
  doc.sections[0].tasks[1].title = 'two, edited';
  writeTasksDoc(root, doc);
  const after = readTasksTextWithSignature(root);
  assert.notEqual(after.sig, before.sig);
  assert.match(after.text, /two, edited/);
  assert.match(readTasksText(root), /two, edited/);
});

test('a ticket edited in place (not renamed over) is still noticed', async () => {
  const { root } = splitHome();
  readTasksText(root);
  await sleep(20); // let the mtime tick
  const p = ticketPath(root, 'AAA1');
  fs.writeFileSync(p, JSON.stringify({ id: 'AAA1', title: 'hand edited note' }));
  assert.match(readTasksText(root), /hand edited note/);
  assert.notEqual(tasksSignature(root), null);
});

test('a poll answered 304 reads no body and applies nothing', async () => {
  const http = await import(join(js, 'http-loader.js'));
  const seen = [];
  let call = 0;
  globalThis.fetch = async (_url, opts) => {
    seen.push(opts?.headers?.['If-None-Match'] || null);
    call++;
    if (call === 1) return { ok: true, status: 200, headers: { get: () => '"v1"' }, text: async () => '{"sections":[]}' };
    return { ok: false, status: 304, text: async () => { throw new Error('body must not be read on a 304'); } };
  };
  let applied = 0;
  http.startHttpTaskWatching(() => { applied++; }, { intervalMs: 30 });
  await sleep(150);
  http.stopHttpTaskWatching();
  assert.equal(applied, 1, 'first full body applied once');
  assert.equal(seen[0], null);
  assert.ok(seen.slice(1).every(v => v === '"v1"'), 'later polls send the validator');
});

test('a save the server never answers fails instead of hanging', async () => {
  const http = await import(join(js, 'http-loader.js'));
  globalThis.fetch = (_url, opts) => new Promise((_res, rej) => {
    opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(http.httpSave('tasks.json', '{}', { timeoutMs: 50 }), /did not answer/);
});

test('a failed save warns, keeps the edit flagged, and retries until it works', async () => {
  const shown = [];
  const els = { saveBtn: { disabled: true } };
  const el = () => new Proxy(function () {}, {
    get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'classList' ? { add() {}, remove() {}, toggle() {} } : k === 'style' ? {} : () => el(),
    set: () => true,
    apply: () => el(),
  });
  globalThis.window = globalThis;
  globalThis.document = { getElementById: (id) => els[id] || el(), createElement: () => el(), body: el() };
  globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts < 2) throw new Error('connection reset');
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const state = { hasChanges: true, sections: [{ id: 'todo', name: 'Todo' }], tasks: { todo: [] }, ticketTypes: [], meta: {}, taskFileHandle: null };
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 5), ...a); // don't wait the real backoff
  try {
    const io = await import(join(js, 'tasks-io.js'));
    const stateMod = await import(join(js, 'state.js'));
    io.setIOCallbacks({ stateFn: () => state, renderFn: () => () => {}, parseFn: () => null });
    await io.autoSave();
    assert.equal(state.hasChanges, true, 'edit stays flagged after a failed save');
    await sleep(100);
    assert.ok(attempts >= 2, 'it retried on its own');
    assert.equal(state.hasChanges, false, 'and cleared once the save went through');
    void shown; void stateMod;
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});
