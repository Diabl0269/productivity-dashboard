/**
 * cli/test/note-images.test.js
 * Note images (PRO35) and note editing: shared helpers, CLI flags, serve.js endpoints, round-trip.
 * Fixtures are synthetic: tiny image bytes generated here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

import {
  sniffImageType, attachmentRelPath, attachmentAbsPath, validateImage, storeImage,
  isAttachmentRelPath, MAX_IMAGE_BYTES,
} from '../../shared/note-images.js';
import { loadTasksJson, serializeTasksJson } from '../../dashboard/js/tasks-json.js';
import { editNoteAt, appendNote } from '../../dashboard/js/task-fields.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const REPO_ROOT = path.resolve(__dirname, '../..');
const CH_SCRIPT = path.join(REPO_ROOT, 'ch');

// ---- synthetic image bytes ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A valid w x h RGB PNG filled with one colour. */
function makePng(w = 2, h = 2, rgb = [200, 40, 40]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())]);
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 1)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(8, 3)]);

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-note-images-test-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(dir, 'tasks.json'));
  return dir;
}
function readTasks(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')); }
function findTask(dir, id) {
  for (const s of readTasks(dir).sections) { const t = s.tasks.find(x => x.id === id); if (t) return t; }
  return null;
}
function runCli(args, dir) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}
function writeImg(dir, name, buf) { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; }

// ---- helpers ----
test('sniffImageType recognises png/jpg/gif/webp and rejects others', () => {
  assert.equal(sniffImageType(makePng()), 'png');
  assert.equal(sniffImageType(JPG), 'jpg');
  assert.equal(sniffImageType(GIF), 'gif');
  assert.equal(sniffImageType(WEBP), 'webp');
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImageType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff')), null);
  assert.equal(sniffImageType(Buffer.from('just some plain text here')), null);
  assert.equal(sniffImageType(Buffer.alloc(3)), null);
});

test('validateImage enforces ticket id, type and size cap', () => {
  assert.throws(() => validateImage('T1', Buffer.from('plain text file content')), /not a supported image/);
  assert.throws(() => validateImage('../x', makePng()), /invalid ticket id/);
  assert.throws(() => validateImage('a/b', makePng()), /invalid ticket id/);
  assert.throws(() => validateImage('T1', Buffer.alloc(0)), /empty/);
  const big = Buffer.concat([makePng(), Buffer.alloc(MAX_IMAGE_BYTES)]);
  assert.throws(() => validateImage('T1', big), /too large/);
  assert.equal(validateImage('T1', makePng()), 'png');
});

test('attachmentRelPath is content-hashed (dedupes) and traversal is rejected', () => {
  const a = attachmentRelPath('T1', makePng(2, 2));
  assert.match(a, /^T1\/[0-9a-f]{16}\.png$/);
  assert.equal(a, attachmentRelPath('T1', makePng(2, 2)));
  assert.notEqual(a, attachmentRelPath('T1', makePng(3, 3)));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-ni-'));
  for (const bad of ['../x.png', 'T1/../../etc/passwd', 'T1/..%2f.png', '/etc/passwd', 'T1/abc.png', 'T1/0123456789abcdef.svg', 'T1/sub/0123456789abcdef.png']) {
    assert.equal(isAttachmentRelPath(bad), false, bad);
    assert.throws(() => attachmentAbsPath(root, bad), /invalid attachment path/);
  }
  assert.ok(attachmentAbsPath(root, a).startsWith(path.join(root, 'attachments')));
  const r1 = storeImage(root, 'T1', makePng());
  const r2 = storeImage(root, 'T1', makePng());
  assert.equal(r1, r2);
  assert.equal(fs.readdirSync(path.join(root, 'attachments', 'T1')).length, 1);
});

// ---- CLI ----
test('CLI --add-note with --note-image stores file, images on note, get prints absolute path', () => {
  const dir = makeTmpDir();
  const img = writeImg(dir, 'shot.png', makePng());
  const r = runCli(['tasks', 'update', 'T1', '--add-note', 'see screenshot', '--note-image', img, '--note-image', img], dir);
  assert.equal(r.status, 0, r.stderr);
  const note = findTask(dir, 'T1').notes.at(-1);
  assert.equal(note.text, 'see screenshot');
  assert.equal(note.images.length, 2);
  const abs = path.join(dir, 'attachments', note.images[0]);
  assert.ok(fs.existsSync(abs));
  assert.deepEqual(fs.readFileSync(abs), makePng());
  const g = runCli(['tasks', 'get', 'T1'], dir);
  assert.equal(g.status, 0, g.stderr);
  assert.match(g.stdout, /note \d+ \(\d{4}-\d{2}-\d{2}\): see screenshot/);
  assert.ok(g.stdout.includes(`    image: ${fs.realpathSync(dir) === dir ? abs : abs}`) || g.stdout.includes(`image: ${abs}`));
  const j = runCli(['tasks', 'get', 'T1', '--json'], dir);
  assert.deepEqual(JSON.parse(j.stdout).notes.at(-1).images, note.images);
});

test('CLI rejects unsupported / missing images and flag misuse', () => {
  const dir = makeTmpDir();
  const txt = writeImg(dir, 'x.png', Buffer.from('this is not really a png file'));
  let r = runCli(['tasks', 'update', 'T1', '--add-note', 'n', '--note-image', txt], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a supported image/);
  r = runCli(['tasks', 'update', 'T1', '--add-note', 'n', '--note-image', path.join(dir, 'nope.png')], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot read image file/);
  r = runCli(['tasks', 'update', 'T1', '--note-image', writeImg(dir, 'ok.png', makePng())], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--note-image requires/);
  assert.equal(findTask(dir, 'T1').notes, undefined);
});

test('CLI --edit-note replaces text, keeps at/images, stamps edited, validates', () => {
  const dir = makeTmpDir();
  const img = writeImg(dir, 'a.png', makePng());
  const img2 = writeImg(dir, 'b.png', makePng(4, 4));
  assert.equal(runCli(['tasks', 'update', 'T1', '--add-note', 'first'], dir).status, 0);
  assert.equal(runCli(['tasks', 'update', 'T1', '--add-note', 'second', '--note-image', img], dir).status, 0);
  const before = findTask(dir, 'T1').notes[1];

  let r = runCli(['tasks', 'update', 'T1', '--edit-note', '2', '--note-text', 'second v2'], dir);
  assert.equal(r.status, 0, r.stderr);
  let n = findTask(dir, 'T1').notes[1];
  assert.equal(n.text, 'second v2');
  assert.equal(n.at, before.at);
  assert.deepEqual(n.images, before.images);
  assert.match(n.edited, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(findTask(dir, 'T1').notes[0].edited, undefined);
  assert.match(runCli(['tasks', 'get', 'T1'], dir).stdout, /note 2 \(\d{4}-\d{2}-\d{2}, edited\): second v2/);

  // empty text allowed only because the note has an image
  r = runCli(['tasks', 'update', 'T1', '--edit-note', '2', '--note-text', ''], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(findTask(dir, 'T1').notes[1].text, '');
  // combine with --note-image
  r = runCli(['tasks', 'update', 'T1', '--edit-note', '2', '--note-text', 'with two', '--note-image', img2], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(findTask(dir, 'T1').notes[1].images.length, 2);

  // bounds / empty / unpaired
  for (const [args, re] of [
    [['--edit-note', '3', '--note-text', 'x'], /--edit-note N must be between 1 and 2/],
    [['--edit-note', '0', '--note-text', 'x'], /must be between/],
    [['--edit-note', '1', '--note-text', '  '], /cannot be empty/],
    [['--edit-note', '1'], /requires --note-text/],
    [['--note-text', 'x'], /requires --edit-note/],
  ]) {
    r = runCli(['tasks', 'update', 'T1', ...args], dir);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, re);
  }
  assert.equal(findTask(dir, 'T1').notes[0].text, 'first');
});

test('editing a note leaves reviewNotes (filed state) alone', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'tasks.json');
  const doc = readTasks(dir);
  const t = doc.sections.flatMap(s => s.tasks).find(x => x.id === 'T1');
  t.notes = [{ at: '2026-10-01T10:00:00.000Z', text: 'old' }];
  t.reviewNotes = [{ n: 1, at: '2026-10-01T10:00:00.000Z', text: 'r', kind: 'fix', state: 'filed', filed: 'T9' }];
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = runCli(['tasks', 'update', 'T1', '--edit-note', '1', '--note-text', 'new'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(findTask(dir, 'T1').reviewNotes, t.reviewNotes);
});

// ---- dashboard serializer + helpers ----
test('tasks-json round-trip keeps note images and edited', () => {
  const doc = JSON.parse(fs.readFileSync(FIXTURE_SAMPLE, 'utf8'));
  doc.sections[0].tasks[0].notes = [
    { at: '2026-10-01T10:00:00.000Z', text: 'hi', images: ['T1/0123456789abcdef.png'], edited: '2026-10-02T10:00:00.000Z' },
    { at: '2026-10-01T11:00:00.000Z', text: '', images: ['T1/fedcba9876543210.png'] },
  ];
  const mem = loadTasksJson(JSON.stringify(doc));
  const out = JSON.parse(serializeTasksJson(mem.sections, mem.tasks));
  const notes = out.sections[0].tasks[0].notes;
  assert.deepEqual(notes, doc.sections[0].tasks[0].notes);
});

test('editNoteAt: edit, stamp, keep at, bounds, images', () => {
  const task = {};
  appendNote(task, 'a', ['T1/0123456789abcdef.png']);
  appendNote(task, 'b');
  const at = task.notes[0].at;
  assert.equal(editNoteAt(task, 1, 'a2'), true);
  assert.equal(task.notes[0].text, 'a2');
  assert.equal(task.notes[0].at, at);
  assert.deepEqual(task.notes[0].images, ['T1/0123456789abcdef.png']);
  assert.ok(task.notes[0].edited);
  assert.equal(editNoteAt(task, 3, 'x'), false);
  assert.equal(editNoteAt(task, 2, '  '), false);
  assert.equal(editNoteAt(task, 1, '', []), false);
  assert.equal(editNoteAt(task, 1, 'a3', []), true);
  assert.equal(task.notes[0].images, undefined);
});

// ---- serve.js ----
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

test('serve.js: upload then GET returns bytes and type; bad requests are rejected', async () => {
  const dir = makeTmpDir();
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'serve.js'), String(port)], { env: { ...process.env, CH_HOME: dir }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      try { await request(port, 'GET', '/api/memory-manifest'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    const png = makePng(3, 3);
    const up = await request(port, 'POST', '/api/note-image', { ticketId: 'T1', filename: 'a.png', dataBase64: png.toString('base64') });
    assert.equal(up.status, 200, up.body.toString());
    const { path: rel } = JSON.parse(up.body.toString());
    assert.match(rel, /^T1\/[0-9a-f]{16}\.png$/);
    const got = await request(port, 'GET', '/attachments/' + rel);
    assert.equal(got.status, 200);
    assert.equal(got.headers['content-type'], 'image/png');
    assert.match(got.headers['cache-control'], /max-age=\d{6,}/);
    assert.deepEqual(got.body, png);
    // non-image
    const bad = await request(port, 'POST', '/api/note-image', { ticketId: 'T1', dataBase64: Buffer.from('hello world, not an image').toString('base64') });
    assert.equal(bad.status, 400);
    const badId = await request(port, 'POST', '/api/note-image', { ticketId: '../evil', dataBase64: png.toString('base64') });
    assert.equal(badId.status, 400);
    // traversal / unknown
    for (const p of ['/attachments/T1/..%2f..%2ftasks.json', '/attachments/T1/0123456789abcdef.svg']) {
      const r = await request(port, 'GET', p);
      assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.ok(!r.body.toString().includes('"sections"'), p);
    }
    assert.equal((await request(port, 'GET', '/attachments/T1/0123456789abcdef.png')).status, 404);
  } finally {
    child.kill();
  }
});
