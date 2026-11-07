/**
 * cli/test/cost-estimate.test.js: the cost estimate of a ticket from similar shipped tickets
 * (shared/cost-estimate.js), the payload fields, `ch tasks next`, `ch metrics estimate` and the
 * serve.js endpoints. Synthetic data only; throwaway CH_HOME, never ~/.productivity-dashboard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { estimatorFor, formatRange, usd } from '../../shared/cost-estimate.js';
import { buildMetricsPayload } from '../../shared/metrics-payload.js';
import { costLine } from '../../dashboard/js/ticket-cost-ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CH = path.join(ROOT, 'ch');
const DAY = 86400000;

const tk = (id, over = {}) => ({ id, title: `${id} title`, type: 'task', project: 'pa', lane: 'l', created: '2026-10-01', checked: false, priority: 'medium', subtasks: [], history: [], ...over });
const sonnet = ['model:sonnet'];
const opus = ['model:opus'];

/**
 * done: sonnet tasks T11..T16 in pa (cost 1..6), T17 sonnet but costed only 100 days ago (outside the window),
 * opus tasks T21..T23 in pa (10, 20, 30) and T31, T32 in pb (40, 50). Open: T1 (sonnet, todo), T4 (opus, in
 * progress), T2 (no label, todo) under epic T5 with a review and a done child that cost nothing.
 */
function doc() {
  const done = [
    ...[1, 2, 3, 4, 5, 6].map(n => tk(`T1${n}`, { labels: sonnet })),
    tk('T17', { labels: sonnet }),
    ...[1, 2, 3].map(n => tk(`T2${n}`, { labels: opus })),
    ...[1, 2].map(n => tk(`T3${n}`, { labels: opus, project: 'pb' })),
    tk('T41', { parentId: 'T5' }),
  ];
  return {
    version: 1,
    sections: [
      { id: 'todo', name: 'todo', tasks: [tk('T1', { parentId: 'T5', labels: sonnet }), tk('T2', { parentId: 'T5' }), tk('T3', { labels: sonnet })] },
      { id: 'in-progress', name: 'in-progress', tasks: [tk('T5', { type: 'epic' }), tk('T4', { parentId: 'T5', labels: opus })] },
      { id: 'review', name: 'review', tasks: [tk('T42', { parentId: 'T5' })] },
      { id: 'done', name: 'done', tasks: done },
    ],
    meta: {},
  };
}
const COST = { T11: 1, T12: 2, T13: 3, T14: 4, T15: 5, T16: 6, T21: 10, T22: 20, T23: 30, T31: 40, T32: 50 };
const ses = (id, ticket, cost, startMs) => ({
  key: id, sessionId: id, ticket, start: new Date(startMs).toISOString(), end: new Date(startMs + 3600000).toISOString(),
  activeMin: 30, costUSD: cost, helperCostUSD: 0, byTicket: { [ticket]: { costUSD: cost, tokens: 10, toolCalls: 1 } }, tokens: {}, helperTokens: {},
});
function sessions(nowMs) {
  const recent = nowMs - 3 * DAY;
  return [
    ...Object.entries(COST).map(([id, c]) => ses(`s-${id}`, id, c, recent)),
    ses('s-old', 'T17', 999, nowMs - 100 * DAY),
    ses('s-ep', 'T5', 2, recent),
  ];
}
const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const est = (over = {}) => estimatorFor({ doc: doc(), sessions: sessions(NOW), nowMs: NOW, ...over });

test('estimate: the narrowest group with 5 samples wins, with median, p75, n and its basis', () => {
  const e = est();
  assert.equal(e.samples, 11); // T17's only session is 100 days old: not a sample
  // label + type + project + lane: 6 sonnet tasks in pa/l -> median 3.5, p75 4.75
  assert.deepEqual(e.estimate('T1'), { typicalUSD: 3.5, highUSD: 4.75, n: 6, basis: 'model:sonnet · task · pa · lane l' });
  // opus in pa has 3 samples (< 5): fall back to label + type, 5 samples (10..50)
  assert.deepEqual(e.estimate('T4'), { typicalUSD: 30, highUSD: 40, n: 5, basis: 'model:opus · task' });
  // no label: nothing shares it, so all 11 shipped tickets
  assert.deepEqual(e.estimate('T2'), { typicalUSD: 6, highUSD: 25, n: 11, basis: 'all shipped tickets' });
  assert.equal(e.estimate('NOPE'), null);
});

test('estimate: a ticket in the sample is not compared with itself', () => {
  // T11 is one of 6 sonnet samples; without itself it has 5, still enough: median of 2..6 = 4
  const s1 = est().estimate('T11');
  assert.equal(s1.n, 5);
  assert.equal(s1.typicalUSD, 4);
});

test('estimate: null with fewer than 5 samples overall, for tickets and epics', () => {
  const few = sessions(NOW).filter(s => ['s-T11', 's-T12', 's-T21', 's-ep'].includes(s.key));
  const e = estimatorFor({ doc: doc(), sessions: few, nowMs: NOW });
  assert.equal(e.samples, 3);
  assert.equal(e.estimate('T1'), null);
  assert.equal(e.estimate('T5'), null);
});

test('estimate: an epic is the sum of its open tickets only, with what was spent so far', () => {
  const e = est().estimate('T5');
  // open children: T1 (3.5 / 4.75), T2 (6 / 25), T4 (30 / 40); T42 (review) and T41 (done) are not open
  assert.equal(e.typicalUSD, 39.5);
  assert.equal(e.highUSD, 69.75);
  assert.equal(e.n, 3);
  assert.equal(e.basis, 'sum of 3 open tickets');
  assert.equal(e.spentUSD, 2);
  assert.deepEqual(e.perChild.map(k => k.ticket).sort(), ['T1', 'T2', 'T4']);
});

test('estimate: --project limits the samples to that project', () => {
  const e = est({ project: 'pb' });
  assert.equal(e.samples, 2);
  assert.equal(e.estimate('T4'), null);
});

test('formatRange and usd', () => {
  assert.equal(formatRange({ typicalUSD: 4.2, highUSD: 9.4 }), '~$4.2 (up to $9.4)');
  assert.equal(formatRange({ typicalUSD: 4, highUSD: 9 }), '~$4 (up to $9)');
  assert.equal(formatRange({ typicalUSD: 30, highUSD: 40.4 }), '~$30 (up to $40)');
  assert.equal(formatRange({ typicalUSD: 0.5, highUSD: 0.5 }), '~$0.50');
  assert.equal(formatRange(null), '');
  assert.equal(usd(12.6), '$13');
});

test('payload: next items carry the estimate and estimates summarises the samples', () => {
  const p = buildMetricsPayload({ doc: doc(), sessions: sessions(NOW), cfg: {}, now: NOW });
  const ts1 = p.next.find(t => t.id === 'T1');
  assert.deepEqual(ts1.estimate, { typicalUSD: 3.5, highUSD: 4.75, n: 6, basis: 'model:sonnet · task · pa · lane l' });
  assert.ok(p.next.every(t => 'estimate' in t));
  assert.equal(p.estimates.sampleWindowDays, 90);
  assert.equal(p.estimates.samples, 11);
  assert.deepEqual(p.estimates.byLabel.find(g => g.label === 'model:opus'), { label: 'model:opus', n: 5, medianUSD: 30, p75USD: 40 });
  assert.deepEqual(p.estimates.byLabel.find(g => g.label === 'model:sonnet'), { label: 'model:sonnet', n: 6, medianUSD: 3.5, p75USD: 4.75 });
  // the estimate window is 90 days even when the report window is 7
  const narrow = buildMetricsPayload({ doc: doc(), sessions: sessions(NOW), cfg: {}, now: NOW, since: NOW - 7 * DAY });
  assert.equal(narrow.estimates.samples, 11);
  const none = buildMetricsPayload({ doc: doc(), sessions: [], cfg: {}, now: NOW });
  assert.deepEqual(none.estimates, { sampleWindowDays: 90, samples: 0, byLabel: [] });
  assert.ok(none.next.every(t => t.estimate === null));
});

test('costLine: likely cost before a start, cost so far after, epic remaining, nothing without data', () => {
  const e = { typicalUSD: 4, highUSD: 9, n: 23, basis: 'x' };
  assert.equal(costLine({ state: 'todo', cost: null, estimate: e }), 'Likely cost ~$4, up to $9 (from 23 similar shipped tickets)');
  assert.equal(costLine({ state: 'in-progress', cost: { costUSD: 2.46 }, estimate: e }), 'Cost so far $2.5');
  assert.equal(costLine({ state: 'done', cost: { costUSD: 12 }, estimate: e }), 'Cost so far $12');
  assert.equal(costLine({ state: 'todo', cost: null, estimate: null }), '');
  assert.equal(costLine(null), '');
  assert.match(costLine({ state: 'in-progress', cost: { costUSD: 2 }, estimate: { typicalUSD: 40, highUSD: 70, n: 3, basis: 'sum of 3 open tickets', spentUSD: 2 } }),
    /^Likely cost left ~\$40, up to \$70 \(sum of 3 open tickets\), \$2\.0 spent so far$|^Likely cost left ~\$40, up to \$70 \(sum of 3 open tickets\), \$2 spent so far$/);
});

function home({ withSessions = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-estimate-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc()));
  fs.writeFileSync(path.join(dir, 'config.json'), '{}');
  if (withSessions) {
    fs.mkdirSync(path.join(dir, 'metrics'));
    fs.writeFileSync(path.join(dir, 'metrics', 'sessions.jsonl'), sessions(Date.now()).map(s => JSON.stringify(s)).join('\n') + '\n');
  }
  return dir;
}
const run = (dir, ...a) => spawnSync(process.execPath, [CH, ...a], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });

test('ch tasks next shows the likely cost range per ticket, and nothing extra without sessions data', () => {
  const dir = home();
  const bare = home({ withSessions: false });
  try {
    const r = run(dir, 'tasks', 'next', '--n', '10');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /T1[^\n]*\n[^\n]*likely ~\$3\.5 \(up to \$4\.8\)/);
    const json = JSON.parse(run(dir, 'tasks', 'next', '--json', '--n', '10').stdout);
    assert.deepEqual(json.find(p => p.id === 'T1').estimate, { typicalUSD: 3.5, highUSD: 4.75, n: 6, basis: 'model:sonnet · task · pa · lane l' });
    const none = run(bare, 'tasks', 'next', '--n', '10');
    assert.equal(none.status, 0, none.stderr);
    assert.ok(none.stdout.includes('T1'));
    assert.ok(!/likely/.test(none.stdout));
    assert.equal(JSON.parse(run(bare, 'tasks', 'next', '--json').stdout)[0].estimate, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('ch metrics estimate: one ticket, an epic per child, the samples summary, json, unknown id, no data', () => {
  const dir = home();
  const bare = home({ withSessions: false });
  try {
    const one = run(dir, 'metrics', 'estimate', 't1');
    assert.equal(one.status, 0, one.stderr);
    assert.match(one.stdout, /T1: ~\$3\.5 \(up to \$4\.8\)/);
    assert.match(one.stdout, /from 6 similar shipped tickets: model:sonnet · task · pa · lane l/);
    const epic = run(dir, 'metrics', 'estimate', 'T5');
    assert.match(epic.stdout, /Epic T5: ~\$40 \(up to \$70\) still to do \(sum of 3 open tickets\); \$2\.00 spent so far/);
    assert.match(epic.stdout, /T4\s+~\$30 \(up to \$40\)/);
    assert.ok(!/T42|T41/.test(epic.stdout));
    const sum = run(dir, 'metrics', 'estimate');
    assert.match(sum.stdout, /11 shipped tickets/);
    assert.match(sum.stdout, /model:opus\s+5\s+\$30\.00\s+\$40\.00/);
    assert.equal(JSON.parse(run(dir, 'metrics', 'estimate', 'T4', '--json').stdout).estimate.n, 5);
    assert.equal(JSON.parse(run(dir, 'metrics', 'estimate', '--json').stdout).samples, 11);
    assert.equal(run(dir, 'metrics', 'estimate', 'ZZ9').status, 1);
    const none = run(bare, 'metrics', 'estimate', 'T1');
    assert.equal(none.status, 0, none.stderr);
    assert.match(none.stdout, /no estimate/);
    assert.equal(JSON.parse(run(bare, 'metrics', 'estimate', 'T1', '--json').stdout).estimate, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
function get(port, urlPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serve.js: /api/metrics/ticket-cost and /api/metrics/estimates', async () => {
  const dir = home();
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(port)], { env: { ...process.env, CH_HOME: dir }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      try { await get(port, '/api/memory-manifest'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    const todo = await get(port, '/api/metrics/ticket-cost?id=t1');
    assert.equal(todo.status, 200, todo.body);
    const t = JSON.parse(todo.body);
    assert.equal(t.state, 'todo');
    assert.equal(t.cost, null);
    assert.equal(t.estimate.typicalUSD, 3.5);
    const shipped = JSON.parse((await get(port, '/api/metrics/ticket-cost?id=T22')).body);
    assert.equal(shipped.state, 'done');
    assert.equal(shipped.cost.costUSD, 20);
    const many = JSON.parse((await get(port, '/api/metrics/estimates?ids=T5,T1,NOPE')).body);
    assert.equal(many.T5.n, 3);
    assert.equal(many.T5.typicalUSD, 39.5);
    assert.equal(many.T1.highUSD, 4.75);
    assert.equal(many.NOPE, null);
    assert.equal((await get(port, '/api/metrics/ticket-cost')).status, 400);
    assert.equal((await get(port, '/api/metrics/estimates', 'POST')).status, 405);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
