/**
 * PRO124: config metrics.weeklyReset, `ch metrics usage` (--set / --resets / --clear / --json), the in-memory
 * incremental read of transcripts newer than the last collect, and GET /api/home/usage. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { priceUsage } from '../../shared/model-prices.js';

const CH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ch');
const MODEL = 'claude-opus-4-8';
const PER_M = priceUsage(MODEL, { output_tokens: 0, output: 1_000_000 }); // dollars for a million output tokens
const usd = n => Math.round(n * 100) / 100;

/** A throwaway CH_HOME with a transcripts dir holding one session that wrote `outTokens` output tokens now. */
function home({ weeklyReset, tx = true, outTokens = 2_000_000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-usage-'));
  const projects = path.join(dir, 'transcripts', '-work-demo');
  fs.mkdirSync(projects, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ metrics: { claudeProjects: [projects], ...(weeklyReset ? { weeklyReset } : {}) } }));
  const at = new Date().toISOString();
  if (tx) {
    fs.writeFileSync(path.join(projects, 'sess-1.jsonl'), [
      { type: 'user', sessionId: 'sess-1', timestamp: at, origin: { kind: 'human' }, message: { role: 'user', content: 'DEM1 do it' } },
      { type: 'assistant', sessionId: 'sess-1', timestamp: at, message: { id: 'm1', model: MODEL, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 0, output_tokens: outTokens } } },
    ].map(l => JSON.stringify(l)).join('\n') + '\n');
  }
  return { dir, projects };
}
const ch = (dir, args) => spawnSync('node', [CH, 'metrics', ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
const json = (dir, args = []) => { const r = ch(dir, ['usage', '--json', ...args]); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };

test('config: metrics.weeklyReset is read, validated and defaults to Tuesday 11:00 UTC', () => {
  const read = d => spawnSync('node', ['--input-type=module', '-e',
    `import { metricsConfig } from ${JSON.stringify(path.join(path.dirname(CH), 'cli/lib/metrics-store.js'))}; console.log(JSON.stringify(metricsConfig().weeklyReset))`],
  { env: { ...process.env, CH_HOME: d }, encoding: 'utf8' }).stdout.trim();
  assert.equal(read(home({ tx: false }).dir), '{"weekday":2,"utcHour":11,"utcMinute":0}');
  assert.equal(read(home({ tx: false, weeklyReset: { weekday: 1, utcHour: 8, utcMinute: 15 } }).dir), '{"weekday":1,"utcHour":8,"utcMinute":15}');
  assert.equal(read(home({ tx: false, weeklyReset: { weekday: 9, utcHour: 8 } }).dir), '{"weekday":2,"utcHour":11,"utcMinute":0}');
});

test('usage --json: the live transcript is priced in memory and the metrics store is not written', () => {
  const { dir } = home();
  const m = json(dir);
  assert.equal(m.costThisWeekUSD, usd(2 * PER_M));
  assert.equal(m.source, 'none'); // no weekly limit hit yet: dollars only
  assert.equal(m.pctUsed, null);
  assert.match(m.reason, /not enough limit hits/i);
  assert.equal(m.perRunning.length, 1);
  assert.equal(m.perRunning[0].sessionId, 'sess-1');
  assert.equal(m.perRunning[0].usd, usd(2 * PER_M));
  assert.equal(m.capped, false);
  assert.equal(m.transcriptsRead, 1);
  assert.equal(fs.existsSync(path.join(dir, 'metrics', 'sessions.jsonl')), false, 'usage must not write sessions.jsonl');
  assert.equal(fs.existsSync(path.join(dir, 'metrics', '.sessions-cache.json')), false);
});

test('usage after a collect: stored sessions are used and nothing is re-read', async () => {
  const { dir } = home();
  await new Promise(r => setTimeout(r, 1100)); // the read-again slack is one second
  const c = ch(dir, ['collect', '--sessions']);
  assert.equal(c.status, 0, c.stderr);
  const m = json(dir);
  assert.equal(m.costThisWeekUSD, usd(2 * PER_M));
  assert.equal(m.transcriptsRead, 0);
});

test('usage: a transcript written after the last collect is read; the cap says so and gives the collect time', async () => {
  const { dir, projects } = home();
  await new Promise(r => setTimeout(r, 1100));
  ch(dir, ['collect', '--sessions']);
  await new Promise(r => setTimeout(r, 1100));
  const at = new Date().toISOString();
  for (const n of ['a', 'b', 'c']) {
    fs.writeFileSync(path.join(projects, `new-${n}.jsonl`), [
      { type: 'user', sessionId: `new-${n}`, timestamp: at, origin: { kind: 'human' }, message: { role: 'user', content: 'x' } },
      { type: 'assistant', sessionId: `new-${n}`, timestamp: at, message: { id: `m${n}`, model: MODEL, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 0, output_tokens: 1_000_000 } } },
    ].map(l => JSON.stringify(l)).join('\n') + '\n');
  }
  const m = json(dir);
  assert.equal(m.transcriptsRead, 3);
  assert.equal(m.costThisWeekUSD, usd(5 * PER_M));
  assert.equal(m.capped, false);
  assert.ok(Math.abs(Date.parse(m.asOf) - Date.now()) < 60e3);
  // The cap, through the library: only one read, and as-of falls back to the last collect.
  const code = `import { usageNow } from ${JSON.stringify(path.join(path.dirname(CH), 'cli/lib/usage-live.js'))};
    const m = await usageNow({ maxReads: 1 }); console.log(JSON.stringify({ capped: m.capped, read: m.transcriptsRead, asOf: m.asOf }));`;
  const r = spawnSync('node', ['--input-type=module', '-e', code], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  const o = JSON.parse(r.stdout);
  assert.equal(o.capped, true);
  assert.equal(o.read, 1);
  assert.ok(Date.parse(o.asOf) < Date.now() - 500, 'asOf is the last collect, not now');
});

test('usage --set / --resets / --clear', () => {
  const { dir } = home();
  const set = ch(dir, ['usage', '--set', '60']);
  assert.equal(set.status, 0, set.stderr);
  assert.match(set.stdout, /^60% of the week used · resets /);
  assert.match(set.stdout, /set by you at \d\d:\d\d/);
  const m = json(dir);
  assert.equal(m.source, 'set by you');
  assert.equal(m.pctUsed, 60);
  assert.ok(m.setAt);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'metrics', 'usage-override.json'), 'utf8'));
  assert.equal(stored.pct, 60);
  assert.ok(Date.parse(stored.setAt));
  const far = new Date(Date.now() + 2 * 86400e3).toISOString();
  const r = json(dir, ['--set', '30', '--resets', far]);
  assert.equal(r.resetsAt, far);
  assert.equal(r.pctUsed, 30);
  const cleared = ch(dir, ['usage', '--clear']);
  assert.match(cleared.stdout, /^cleared the percent you set/);
  assert.equal(json(dir).source, 'none');
  assert.equal(fs.existsSync(path.join(dir, 'metrics', 'usage-override.json')), false);
});

test('usage rejects a bad percent, a bad reset, --resets alone and --set with --clear', () => {
  const { dir } = home({ tx: false });
  for (const args of [['--set', '101'], ['--set', '-1'], ['--set', 'abc'], ['--set', '5', '--resets', 'soon'], ['--resets', '2026-11-20T10:00:00Z'], ['--set', '5', '--clear']]) {
    const r = ch(dir, ['usage', ...args]);
    assert.notEqual(r.status, 0, args.join(' '));
  }
  assert.equal(fs.existsSync(path.join(dir, 'metrics', 'usage-override.json')), false);
});

test('GET /api/home/usage: the meter, cached for 60 s, a bad slug is a 400, the route is listed', async () => {
  const { dir } = home();
  process.env.CH_HOME = dir;
  const { handleHomeRoute, homeRoutes } = await import('../../server/home-routes.js');
  assert.ok(homeRoutes().some(r => r.method === 'GET' && r.path === '/api/home/usage'));
  const call = u => new Promise(resolve => {
    const res = { headersSent: false, writeHead(s) { this.status = s; this.headersSent = true; }, end(t) { resolve({ status: this.status, body: JSON.parse(t) }); } };
    handleHomeRoute({ method: 'GET' }, res, new URL(u, 'http://x'), { dataRoot: dir });
  });
  const a = await call('/api/home/usage');
  assert.equal(a.status, 200);
  assert.equal(a.body.costThisWeekUSD, usd(2 * PER_M));
  assert.equal(a.body.cached, false);
  assert.equal((await call('/api/home/usage')).body.cached, true);
  assert.equal((await call('/api/home/usage?fresh=1')).body.cached, false);
  assert.equal((await call('/api/home/usage?project=../x')).status, 400);
  assert.equal((await call('/api/home/usage?project=demo')).body.perRunning.length, 0); // not a demo ticket: filtered
});
