/**
 * The Overview's queue panel (PRO152): a markdown file of `## item` sections that the page lists, reorders,
 * edits and drops. The file format and every operation are in shared/md-queue.js; the file is reached only
 * through a queue id of the project's home.config.json ("queues").
 *
 *   GET /api/home/queue?project=<slug>&id=<queue id>
 *     -> { id, title, items: [{ id, title, fields: [{ key, value }] }], total, hidden, violations: [], etag, error? }
 *   PUT /api/home/queue?project=<slug>   body { id, etag, op: 'move' | 'edit' | 'drop' | 'undo', ... }
 *     move { itemId, to }  edit { itemId, key, value }  drop { itemId }  undo { token }
 *     -> the same payload as GET after the write, plus { undo: token | null, itemId } (itemId follows a new title).
 *
 * A PUT must send the etag of the text it was looking at; a stale one is a 409. After every write and on
 * every GET the queue's optional `check` runs (server/home/queue-check.js) and its lines are `violations`.
 */

import path from 'node:path';
import { loadProjectHomeConfig, SLUG_RE } from './project-config.js';
import { ID_RE } from '../../shared/home-config-check.js';
import { parseQueue, listItems, moveItem, editItem, dropItem, QueueError } from '../../shared/md-queue.js';
import { runQueueCheck } from './queue-check.js';
import { queuePath, readQueueFile, writeQueueFile, etagOf, rememberUndo, forgetUndo, takeUndo } from './queue-store.js';

const MAX_BODY = 32 * 1024;

function fail(status, message) { return Object.assign(new Error(message), { status }); }

function locate(deps, slug, id) {
  if (slug !== null && !SLUG_RE.test(slug)) throw fail(400, `"${slug.slice(0, 60)}" is not a project slug (letters, digits, ".", "-", "_").`);
  if (typeof id !== 'string' || !ID_RE.test(id)) throw fail(400, '"id" should be a queue id from the home config.');
  const home = loadProjectHomeConfig(deps.dataRoot, slug);
  if (home.missing) throw fail(404, 'This project has no Home config.');
  if (!home.path || !home.config) throw fail(409, home.errors[0] || 'The home config could not be read.');
  const queue = (home.config.queues || []).find(q => q.id === id);
  if (!queue) throw fail(404, `No queue "${id}" in this project's home config.`);
  return { home, queue, file: queuePath(home.path, queue), key: `${home.path}|${id}` };
}

async function payloadOf(queue, configPath, text, extra = {}) {
  const parsed = parseQueue(text);
  const { visible, hidden } = listItems(parsed, queue);
  return {
    id: queue.id, title: queue.title,
    items: visible.slice(0, queue.show).map(i => ({ id: i.id, title: i.title, fields: i.fields })),
    total: visible.length, hidden, show: queue.show, dropAs: queue.dropAs,
    violations: await runQueueCheck(queue, path.dirname(configPath)),
    etag: etagOf(text), ...extra,
  };
}

const get = {
  method: 'GET',
  path: '/api/home/queue',
  async handle({ url, deps }) {
    const { home, queue, file } = locate(deps, url.searchParams.get('project') || null, url.searchParams.get('id'));
    let read;
    try { read = readQueueFile(file, queue); } catch (e) {
      return { body: { id: queue.id, title: queue.title, items: [], total: 0, hidden: 0, show: queue.show, dropAs: queue.dropAs, violations: [], etag: null, error: e.message } };
    }
    return { body: await payloadOf(queue, home.path, read.text) };
  },
};

const put = {
  method: 'PUT',
  path: '/api/home/queue',
  async handle({ req, url, deps }) {
    if (!/^application\/json\b/i.test(req.headers?.['content-type'] || '')) throw fail(415, 'Send the change as application/json.');
    let body;
    try { body = JSON.parse(await deps.readBody(req, MAX_BODY)); } catch (e) {
      throw fail(e.status || 400, e.status ? e.message : 'The request is not valid JSON.');
    }
    const { home, queue, file, key } = locate(deps, url.searchParams.get('project') || null, body?.id);
    if (!['move', 'edit', 'drop', 'undo'].includes(body.op)) throw fail(400, '"op" should be move, edit, drop or undo.');
    if (typeof body.etag !== 'string' || !body.etag) throw fail(400, '"etag" is missing: send the etag from the last answer.');
    const read = readQueueFile(file, queue);
    if (read.etag !== body.etag) throw fail(409, 'The file changed since this list was loaded (someone edited it). The list was refreshed; try again.');

    let next = read.text;
    let itemId = body.itemId;
    try {
      if (body.op === 'undo') next = takeUndo(key, body.token, read.etag);
      else {
        if (typeof body.itemId !== 'string') throw fail(400, '"itemId" should be the id of an item.');
        if (body.op === 'move') next = moveItem(read.text, body.itemId, body.to, queue);
        else if (body.op === 'edit') { const r = editItem(read.text, body.itemId, body.key, body.value); next = r.text; itemId = r.id; } else next = dropItem(read.text, body.itemId, queue);
      }
    } catch (e) {
      if (e instanceof QueueError) throw fail(e.status, e.message);
      throw e;
    }
    let undo = null;
    if (next !== read.text) {
      writeQueueFile(read.real, next);
      if (body.op === 'undo') forgetUndo(key); else undo = rememberUndo(key, read.text, next);
    }
    return { body: await payloadOf(queue, home.path, next, { undo, itemId: itemId ?? null }) };
  },
};

export default [get, put];
