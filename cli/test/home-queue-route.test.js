/**
 * GET/PUT /api/home/queue (PRO152): a made-up bakery's menu queue in a temp folder. Etags, the 409s, bad ops,
 * unknown ids, dropAs, the check's violations and the one-step undo. Never touches a real CH_HOME.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import queueRoutes from '../../server/home/queue-route.js';
import { homeRoutes } from '../../server/home-routes.js';

const [getRoute, putRoute] = queueRoutes;
const FILE = '# Menu\n\n## Rye\n- status: idea\n\n## Bagel\n- length: 2\n\n## Scone\n- status: made\n\n## Tart\n- length: 5\n';

function setup({ queue = {}, text = FILE } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-route-'));
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'menu.md'), text);
  const home = path.join(dir, 'home.config.json');
  fs.writeFileSync(home, JSON.stringify({ version: 1, groups: [], queues: [{ id: 'menu', title: 'Next bakes', file: 'docs/menu.md', show: 2, ...queue }] }));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ home: { bakery: home } }));
  return { dir, data, file: path.join(dir, 'docs', 'menu.md') };
}
const read = f => fs.readFileSync(f, 'utf8');
const GET = (s, id = 'menu', project = 'bakery') => getRoute.handle({ url: new URL(`http://x/api/home/queue?project=${project}${id === null ? '' : `&id=${id}`}`), deps: { dataRoot: s.data } });
const PUT = (s, body, { type = 'application/json', project = 'bakery' } = {}) => putRoute.handle({
  req: { headers: { 'content-type': type } }, url: new URL(`http://x/api/home/queue?project=${project}`),
  deps: { dataRoot: s.data, readBody: async () => (typeof body === 'string' ? body : JSON.stringify(body)) },
});

test('the route table lists GET and PUT /api/home/queue', () => {
  const r = homeRoutes().filter(x => x.path === '/api/home/queue').map(x => x.method).sort();
  assert.deepEqual(r, ['GET', 'PUT']);
});

test('GET lists the first `show` visible items with counts and an etag', async () => {
  const s = setup();
  const { body } = await GET(s);
  assert.deepEqual([body.id, body.title, body.total, body.hidden], ['menu', 'Next bakes', 3, 1]);
  assert.deepEqual(body.items.map(i => i.id), ['Rye#0', 'Bagel#0']);
  assert.deepEqual(body.items[0].fields, [{ key: 'status', value: 'idea' }]);
  assert.deepEqual(body.violations, []);
  assert.match(body.etag, /^[0-9a-f]{40}$/);
  assert.equal(body.error, undefined);
});

test('GET: unknown queue 404, missing id 400, bad slug 400, missing file is an error line not a throw', async () => {
  const s = setup();
  await assert.rejects(() => GET(s, 'nope'), e => e.status === 404);
  await assert.rejects(() => GET(s, null), e => e.status === 400);
  await assert.rejects(() => GET(s, 'menu', 'bad/slug'), e => e.status === 400);
  fs.rmSync(s.file);
  const { body } = await GET(s);
  assert.match(body.error, /does not exist/);
  assert.deepEqual(body.items, []);
});

test('GET: the file must be a regular .md file (a folder is refused in plain words)', async () => {
  const s = setup();
  fs.rmSync(s.file);
  fs.mkdirSync(s.file);
  const { body } = await GET(s);
  assert.match(body.error, /not a regular \.md file/);
});

test('PUT move reorders the file, answers with the new list, an undo token and a new etag', async () => {
  const s = setup();
  const g = (await GET(s)).body;
  const { body } = await PUT(s, { id: 'menu', etag: g.etag, op: 'move', itemId: 'Tart#0', to: 0 });
  assert.deepEqual(body.items.map(i => i.id), ['Tart#0', 'Rye#0']);
  assert.notEqual(body.etag, g.etag);
  assert.ok(body.undo);
  assert.equal(read(s.file), '# Menu\n\n## Tart\n- length: 5\n\n## Rye\n- status: idea\n\n## Scone\n- status: made\n\n## Bagel\n- length: 2\n');
  assert.equal(fs.readdirSync(path.dirname(s.file)).filter(f => f.endsWith('.tmp')).length, 0, 'no temp file left');
});

test('PUT edit changes one value (and a new title gives the new item id)', async () => {
  const s = setup();
  const g = (await GET(s)).body;
  const a = (await PUT(s, { id: 'menu', etag: g.etag, op: 'edit', itemId: 'Bagel#0', key: 'length', value: '3' })).body;
  assert.equal(read(s.file), FILE.replace('length: 2', 'length: 3'));
  const b = (await PUT(s, { id: 'menu', etag: a.etag, op: 'edit', itemId: 'Bagel#0', key: 'title', value: 'Pretzel' })).body;
  assert.equal(b.itemId, 'Pretzel#0');
  assert.deepEqual(b.items.map(i => i.title), ['Rye', 'Pretzel']);
});

test('PUT drop deletes the section; with dropAs "skipped" it only marks the status', async () => {
  const s = setup();
  const g = (await GET(s)).body;
  const a = (await PUT(s, { id: 'menu', etag: g.etag, op: 'drop', itemId: 'Rye#0' })).body;
  assert.deepEqual(a.items.map(i => i.id), ['Bagel#0', 'Tart#0']);
  assert.equal(read(s.file), FILE.replace('## Rye\n- status: idea\n\n', ''));
  const t = setup({ queue: { dropAs: 'skipped' } });
  const g2 = (await GET(t)).body;
  const b = (await PUT(t, { id: 'menu', etag: g2.etag, op: 'drop', itemId: 'Rye#0' })).body;
  assert.equal(read(t.file), FILE.replace('- status: idea', '- status: skipped'));
  assert.deepEqual(b.items.map(i => i.id), ['Bagel#0', 'Tart#0']);
});

test('PUT with a stale etag is a 409 in plain words and writes nothing', async () => {
  const s = setup();
  const g = (await GET(s)).body;
  fs.appendFileSync(s.file, '\n## Pie\n');
  const before = read(s.file);
  await assert.rejects(() => PUT(s, { id: 'menu', etag: g.etag, op: 'drop', itemId: 'Rye#0' }), e => e.status === 409 && /changed since/.test(e.message));
  assert.equal(read(s.file), before);
});

test('PUT refuses: wrong content type, bad JSON, bad op, no etag, unknown queue, unknown item, newline value', async () => {
  const s = setup();
  const g = (await GET(s)).body;
  const ok = { id: 'menu', etag: g.etag };
  await assert.rejects(() => PUT(s, ok, { type: 'text/plain' }), e => e.status === 415);
  await assert.rejects(() => PUT(s, '{nope'), e => e.status === 400);
  await assert.rejects(() => PUT(s, { ...ok, op: 'explode', itemId: 'Rye#0' }), e => e.status === 400 && /op/.test(e.message));
  await assert.rejects(() => PUT(s, { id: 'menu', op: 'drop', itemId: 'Rye#0' }), e => e.status === 400 && /etag/.test(e.message));
  await assert.rejects(() => PUT(s, { ...ok, id: 'ghost', op: 'drop', itemId: 'Rye#0' }), e => e.status === 404);
  await assert.rejects(() => PUT(s, { ...ok, id: '../x', op: 'drop', itemId: 'Rye#0' }), e => e.status === 400);
  await assert.rejects(() => PUT(s, { ...ok, op: 'drop', itemId: 'Ghost#0' }), e => e.status === 404);
  await assert.rejects(() => PUT(s, { ...ok, op: 'drop' }), e => e.status === 400);
  await assert.rejects(() => PUT(s, { ...ok, op: 'edit', itemId: 'Rye#0', key: 'status', value: 'a\nb' }), e => e.status === 400 && /one line/.test(e.message));
  await assert.rejects(() => PUT(s, { ...ok, op: 'move', itemId: 'Scone#0', to: 0 }), e => e.status === 400);
  assert.equal(read(s.file), FILE);
});

test('a path in the request never chooses the file (only the queue id does)', async () => {
  const s = setup();
  const url = new URL('http://x/api/home/queue?project=bakery&id=menu&file=/etc/hosts');
  const { body } = await getRoute.handle({ url, deps: { dataRoot: s.data } });
  assert.equal(body.id, 'menu');
  assert.equal(body.items[0].id, 'Rye#0');
});

test('the check runs on GET and after a write; exit 1 lines are violations, exit 0 none', async () => {
  const script = "const t=require('fs').readFileSync(process.argv[1],'utf8');const bad=t.split('\\n## ')[1].startsWith('Tart');if(bad){console.log('Tart is first.');console.error('Put bread first.');process.exit(1)}";
  const s = setup({ queue: { check: { command: [process.execPath, '-e', script, path.join(os.tmpdir(), 'x')] } } });
  const q = JSON.parse(read(path.join(s.dir, 'home.config.json')));
  q.queues[0].check.command[3] = s.file;
  fs.writeFileSync(path.join(s.dir, 'home.config.json'), JSON.stringify(q));
  const g = (await GET(s)).body;
  assert.deepEqual(g.violations, []);
  const m = (await PUT(s, { id: 'menu', etag: g.etag, op: 'move', itemId: 'Tart#0', to: 0 })).body;
  assert.deepEqual(m.violations, ['Tart is first.', 'Put bread first.']);
  assert.deepEqual((await GET(s)).body.violations, ['Tart is first.', 'Put bread first.']);
});

test('a check that cannot start gives one line; an exit other than 0 or 1 does not pretend to be violations', async () => {
  const s = setup({ queue: { check: { command: ['/no/such/program-xyz'] } } });
  const a = (await GET(s)).body;
  assert.equal(a.violations.length, 1);
  assert.match(a.violations[0], /could not run/);
  const t = setup({ queue: { check: { command: [process.execPath, '-e', 'process.exit(3)'] } } });
  assert.match((await GET(t)).body.violations[0], /could not run.*exited with 3/);
});

test('the check runs in its cwd, relative to the config file', async () => {
  const s = setup({ queue: { check: { command: [process.execPath, '-e', 'console.log(process.cwd());process.exit(1)'], cwd: 'docs' } } });
  const out = (await GET(s)).body.violations[0];
  assert.equal(fs.realpathSync(out), fs.realpathSync(path.join(s.dir, 'docs')));
});

test('undo puts the file back exactly once, only while nothing else changed it', async () => {
  const s = setup();
  const g = (await GET(s)).body;
  const d = (await PUT(s, { id: 'menu', etag: g.etag, op: 'drop', itemId: 'Rye#0' })).body;
  assert.notEqual(read(s.file), FILE);
  await assert.rejects(() => PUT(s, { id: 'menu', etag: d.etag, op: 'undo', token: 'wrong' }), e => e.status === 409 && /nothing to undo/.test(e.message));
  const u = (await PUT(s, { id: 'menu', etag: d.etag, op: 'undo', token: d.undo })).body;
  assert.equal(read(s.file), FILE);
  assert.equal(u.etag, g.etag);
  assert.equal(u.undo, null);
  await assert.rejects(() => PUT(s, { id: 'menu', etag: u.etag, op: 'undo', token: d.undo }), e => e.status === 409);
});

test('only the last write can be undone; an outside edit after it blocks the undo', async () => {
  const s = setup();
  const g = (await GET(s)).body;
  const a = (await PUT(s, { id: 'menu', etag: g.etag, op: 'edit', itemId: 'Rye#0', key: 'status', value: 'planned' })).body;
  const b = (await PUT(s, { id: 'menu', etag: a.etag, op: 'move', itemId: 'Tart#0', to: 0 })).body;
  await assert.rejects(() => PUT(s, { id: 'menu', etag: b.etag, op: 'undo', token: a.undo }), e => e.status === 409);
  fs.appendFileSync(s.file, 'extra line\n');
  const fresh = (await GET(s)).body;
  await assert.rejects(() => PUT(s, { id: 'menu', etag: fresh.etag, op: 'undo', token: b.undo }), e => e.status === 409 && /changed after/.test(e.message));
});

test('a move that changes nothing writes nothing and hands out no undo', async () => {
  const s = setup();
  const g = (await GET(s)).body;
  const out = (await PUT(s, { id: 'menu', etag: g.etag, op: 'move', itemId: 'Rye#0', to: 0 })).body;
  assert.equal(out.undo, null);
  assert.equal(read(s.file), FILE);
});
