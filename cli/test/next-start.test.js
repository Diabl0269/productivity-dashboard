/**
 * cli/test/next-start.test.js
 * PRO75: shared/next-start.js (which Ready Auto epic autorun starts next, and when), `ch tasks next-start`
 * and GET /api/next-start. Synthetic data, throwaway CH_HOME only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { computeNextStart, nextWeeklyReset, tickAtOrAfter } from '../../shared/next-start.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const REPO_ROOT = path.resolve(__dirname, '../..');

const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look at it\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane: 'a', description: '', labels: ['auto'], ...extra });
const mk = bySection => ({ version: 1, meta: {}, sections: Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks })) });

// 2026-11-12 (Thu) 10:00 UTC; last tick 09:50, so ticks fall at 10:20, 10:50 with a 30-minute interval.
const NOW = Date.parse('2026-11-12T10:00:00Z');
const LAST_TICK = Date.parse('2026-11-12T09:50:00Z');
const base = { now: NOW, lastTickMs: LAST_TICK, tickMin: 30 };

test('slot frees: the next Ready Auto epic starts, in lane order (priority, then rank)', () => {
  const doc = mk({
    todo: [
      epic('E1', { lane: 'x', autoRank: 2 }), task('T1', { parentId: 'E1' }),
      epic('E2', { lane: 'y', autoRank: 1 }), task('T2', { parentId: 'E2' }),
      epic('E3', { lane: 'z', autoPriority: 'low' }), task('T3', { parentId: 'E3' }),
    ],
  });
  const out = computeNextStart({ ...base, doc, liveEpics: [] });
  assert.equal(out.next.epic, 'E2');
  assert.deepEqual(out.next.children, ['T2']);
  assert.equal(out.next.atKind, 'tick');
  assert.equal(out.next.atMs, LAST_TICK + 30 * 60e3);
  assert.match(out.line, /^Next start: E2 \(Epic E2\) at /);
  // E2 has a live run: the slot freed up for the next one in the queue.
  const after = computeNextStart({ ...base, doc, liveEpics: ['E2'] });
  assert.equal(after.next.epic, 'E1');
});

test('an epic that is not Ready is skipped, and named when it is the only Auto epic', () => {
  const doc = mk({
    todo: [
      epic('E1', { autoRank: 1 }), // no children: not Ready
      epic('E2', { lane: 'b', autoRank: 2 }), task('T2', { parentId: 'E2' }),
    ],
  });
  assert.equal(computeNextStart({ ...base, doc }).next.epic, 'E2');
  const only = mk({ todo: [epic('E1', { description: '' }), task('T1', { parentId: 'E1', description: 'no plain words' })] });
  const out = computeNextStart({ ...base, doc: only });
  assert.equal(out.next, null);
  assert.match(out.reason, /no epic is Ready with Auto on \(E1 waits: .*How to check it/);
  assert.match(out.line, /^Next start: none, /);
});

test('a lane with a live run holds its other epics; a free lane starts', () => {
  const doc = mk({
    todo: [
      epic('E1', { lane: 'x', autoRank: 1 }), task('T1', { parentId: 'E1' }),
      epic('E2', { lane: 'x', autoRank: 2 }), task('T2', { parentId: 'E2' }),
    ],
  });
  const out = computeNextStart({ ...base, doc, liveEpics: ['E1'] });
  assert.equal(out.next, null);
  assert.match(out.reason, /E2 waits for lane x \(E1 is running\)/);
});

test('capped: runs at the cap wait for a slot; the epic is named, no time promised', () => {
  const doc = mk({ todo: [epic('E1'), task('T1', { parentId: 'E1' })] });
  const out = computeNextStart({ ...base, doc, liveEpics: ['A', 'B'], settings: { maxRuns: 2 } });
  assert.equal(out.next.epic, 'E1');
  assert.equal(out.next.atKind, 'slot');
  assert.equal(out.next.atMs, null);
  assert.match(out.line, /starts when a run slot frees \(all 2 run slots are busy/);
  // Sessions you run by hand count against maxTotal.
  const manual = computeNextStart({ ...base, doc, liveEpics: ['A'], manualBusy: 7, settings: { maxTotal: 8 } });
  assert.equal(manual.next.atKind, 'slot');
});

test('capped: the machine cap holds an app-build epic; review cap and the off switch give none with a reason', () => {
  const doc = mk({ todo: [epic('FRO9'), task('FRO90', { parentId: 'FRO9' })] });
  const builds = computeNextStart({ ...base, doc, liveEpics: ['FRO1', 'FRO2', 'FRO3'], machineCap: 3 });
  assert.equal(builds.next, null);
  assert.match(builds.reason, /FRO9 waits for an app-build slot \(3 at once\)/);
  const review = computeNextStart({ ...base, doc, reviewCount: 9 });
  assert.equal(review.next, null);
  assert.match(review.reason, /9 cards wait for your review/);
  const off = computeNextStart({ ...base, doc, off: true });
  assert.equal(off.next, null);
  assert.equal(off.reason, 'autorun is paused');
});

test('usage limit: reports the reset time and starts at the first check after it', () => {
  const doc = mk({ todo: [epic('E1'), task('T1', { parentId: 'E1' })] });
  const resetsAtMs = Date.parse('2026-11-12T14:00:00Z');
  const out = computeNextStart({ ...base, doc, limitHits: [{ kind: 'session', atMs: NOW - 60e3, resetsAtMs, lostMin: null }] });
  assert.equal(out.next.epic, 'E1');
  assert.equal(out.next.atKind, 'reset');
  assert.ok(out.next.atMs >= resetsAtMs && out.next.atMs < resetsAtMs + 30 * 60e3, 'first tick at or after the reset');
  assert.match(out.line, /waits until the session usage limit resets/);
  // A hit whose reset has passed holds nothing.
  const past = computeNextStart({ ...base, doc, limitHits: [{ kind: 'session', atMs: NOW - 9e6, resetsAtMs: NOW - 60e3, lostMin: null }] });
  assert.equal(past.next.atKind, 'tick');
});

test('weekly pace stop: waits for the weekly reset (Tuesday 11:00 UTC)', () => {
  const doc = mk({ todo: [epic('E1'), task('T1', { parentId: 'E1' })] });
  const out = computeNextStart({ ...base, doc, weekCostUSD: 900, weekUSD: 1000 });
  assert.equal(out.next.atKind, 'reset');
  const reset = nextWeeklyReset(NOW);
  assert.equal(new Date(reset).toISOString(), '2026-11-17T11:00:00.000Z');
  assert.ok(out.next.atMs >= reset);
  assert.match(out.line, /weekly pace stop/);
  assert.equal(computeNextStart({ ...base, doc, weekCostUSD: 100, weekUSD: 1000 }).next.atKind, 'tick');
});

test('tickAtOrAfter: unknown last tick gives null and the line says "within 30 minutes"', () => {
  assert.equal(tickAtOrAfter(NOW, NOW, null, 30), null);
  const doc = mk({ todo: [epic('E1'), task('T1', { parentId: 'E1' })] });
  const out = computeNextStart({ now: NOW, doc });
  assert.equal(out.next.atMs, null);
  assert.match(out.line, /at the next check, within 30 minutes$/);
});

// ---- CLI and server, on a throwaway CH_HOME ----

function chHome(doc, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-next-start-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc));
  fs.writeFileSync(path.join(dir, 'config.json'), '{}');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
const ch = (dir, ...args) => spawnSync(process.execPath, [CH_SCRIPT, ...args], {
  encoding: 'utf8', env: { ...process.env, CH_HOME: dir, AUTORUN_STATE_DIR: path.join(dir, 'state') },
});

test('ch tasks next-start --json: picks the epic, honours --live and the kill switch', () => {
  const doc = mk({ todo: [epic('E1', { lane: 'x' }), task('T1', { parentId: 'E1' }), epic('E2', { lane: 'y' }), task('T2', { parentId: 'E2' })] });
  const dir = chHome(doc);
  let r = ch(dir, 'tasks', 'next-start', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).next.epic, 'E1');
  r = ch(dir, 'tasks', 'next-start', '--json', '--live', 'E1');
  assert.equal(JSON.parse(r.stdout).next.epic, 'E2');
  r = ch(dir, 'tasks', 'next-start');
  assert.match(r.stdout, /^Next start: E1 /);
  fs.writeFileSync(path.join(dir, 'autorun.off'), 'paused');
  r = ch(dir, 'tasks', 'next-start');
  assert.match(r.stdout, /none, autorun is paused/);
});

test('ch tasks next-start reads the dispatcher tick.json (live runs, last tick)', () => {
  const doc = mk({ todo: [epic('E1', { lane: 'x' }), task('T1', { parentId: 'E1' }), epic('E2', { lane: 'y' }), task('T2', { parentId: 'E2' })] });
  const dir = chHome(doc);
  fs.mkdirSync(path.join(dir, 'state'));
  fs.writeFileSync(path.join(dir, 'state', 'tick.json'), JSON.stringify({ at: new Date().toISOString(), intervalMin: 10, liveEpics: ['E1'], manualBusy: 0 }));
  const out = JSON.parse(ch(dir, 'tasks', 'next-start', '--json').stdout);
  assert.equal(out.next.epic, 'E2');
  assert.ok(out.next.atMs > Date.now() && out.next.atMs <= Date.now() + 10 * 60e3 + 1000, 'next tick within the 10-minute interval');
});

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const get = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
  }).on('error', reject);
});

test('serve.js: GET /api/next-start returns the line', async () => {
  const doc = mk({ todo: [epic('E1'), task('T1', { parentId: 'E1' })] });
  const dir = chHome(doc);
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'serve.js'), String(port)], { env: { ...process.env, CH_HOME: dir, AUTORUN_STATE_DIR: path.join(dir, 'state') }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      try { await get(port, '/api/memory-manifest'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    const r = await get(port, '/api/next-start');
    assert.equal(r.status, 200, r.body);
    const out = JSON.parse(r.body);
    assert.equal(out.next.epic, 'E1');
    assert.match(out.line, /^Next start: E1 /);
  } finally {
    child.kill();
  }
});
