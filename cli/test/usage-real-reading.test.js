/**
 * AGE201: the Home usage chip shows Claude's own weekly percent. A fresh reading (`source: 'claude'`) wins over
 * the estimate and over cost-since-set; a stale one falls back to the estimate labelled "about"; the chip and its
 * source line say exactly what is stored (bug kind cpu-claim-vs-monitor: the shown number must be the watched one).
 * Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeUsageMeter, chipText, chipParts, chipLevel } from '../../shared/usage-meter.js';
import { parseClaudeUsage } from '../lib/usage-override.js';
import { sourceLine } from '../../dashboard/js/home-usage.js';

const HOUR = 3600e3;
const T = iso => Date.parse(iso);
const NOW = T('2026-11-13T11:00:00Z');
const CH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ch');
const hourOf = iso => Math.floor(T(iso) / HOUR);
const sess = [{ sessionId: 'a', start: '2026-11-11T08:00:00Z', end: '2026-11-13T10:30:00Z', costUSD: 500,
  costByHour: { [hourOf('2026-11-11T08:00:00Z')]: 400, [hourOf('2026-11-13T10:00:00Z')]: 100 } }];
const meter = override => computeUsageMeter({ sessions: sess, nowMs: NOW, weekUSD: 1000, override });
const reading = (ageMin, pct = 85) => ({ pct, source: 'claude', setAt: new Date(NOW - ageMin * 60e3).toISOString() });

test('a fresh reading from Claude wins over the estimate and over cost since it was read', () => {
  const m = meter(reading(5)); // 100 USD was spent in the hour after the reading: not added
  assert.equal(m.source, 'read from Claude');
  assert.equal(m.pctUsed, 85);
  assert.notEqual(meter(null).pctUsed, 85); // the estimate (50) differs
  assert.equal(chipText(m).startsWith('85% of the week used'), true); // not "about"
  assert.equal(chipLevel(m), 'amber');
  assert.equal(computeUsageMeter({ sessions: sess, nowMs: NOW, weekUSD: null, override: reading(5) }).pctUsed, 85);
});

test('a stale reading falls back to the estimate, labelled about', () => {
  const m = meter(reading(16));
  assert.equal(m.source, 'estimated');
  assert.equal(m.pctUsed, 50);
  assert.equal(chipParts(m).main, 'about 50% of the week used');
  assert.equal(meter(reading(14)).source, 'read from Claude');
});

test('a hand-set percent still counts the cost since it was set', () => {
  const m = meter({ pct: 40, setAt: new Date(NOW - 60 * 60e3).toISOString() });
  assert.equal(m.source, 'set by you');
  assert.equal(m.pctUsed, 50);
});

test('parseClaudeUsage reads the statusline shape and the flat shape, and nothing else', () => {
  assert.deepEqual(parseClaudeUsage({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1795000000 } } }),
    { pct: 85, resetsAt: new Date(1795000000e3).toISOString() });
  assert.deepEqual(parseClaudeUsage({ rate_limits: { seven_day: { used_percentage: 12.5 } } }), { pct: 12.5, resetsAt: null });
  assert.deepEqual(parseClaudeUsage({ pct: 7, resetsAt: '2026-11-17T11:00:00Z' }), { pct: 7, resetsAt: '2026-11-17T11:00:00Z' });
  assert.equal(parseClaudeUsage({ rate_limits: { five_hour: { used_percentage: 5 } } }), null);
  assert.equal(parseClaudeUsage(null), null);
});

test('chip and source line show what is stored: CLI round trip from statusline JSON to the chip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-age201-'));
  const env = { ...process.env, CH_HOME: dir };
  const reset = new Date(Date.now() + 3 * 86400e3);
  reset.setUTCMilliseconds(0);
  const input = JSON.stringify({ rate_limits: { seven_day: { used_percentage: 85, resets_at: reset.getTime() / 1000 } } });
  const w = spawnSync('node', [CH, 'metrics', 'usage', '--from-claude'], { env, input, encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'metrics', 'usage-override.json'), 'utf8'));
  assert.equal(stored.pct, 85);
  assert.equal(stored.source, 'claude');
  const r = spawnSync('node', [CH, 'metrics', 'usage', '--json'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.source, 'read from Claude');
  assert.equal(m.pctUsed, stored.pct);
  assert.equal(m.setAt, stored.setAt);
  assert.match(chipText(m), new RegExp(`^${stored.pct}% of the week used`));
  const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  assert.equal(sourceLine(m), `Read from Claude at ${hhmm(new Date(stored.setAt))}`);
  // A feed without plan limits stores nothing new.
  const before = fs.readFileSync(path.join(dir, 'metrics', 'usage-override.json'), 'utf8');
  spawnSync('node', [CH, 'metrics', 'usage', '--from-claude'], { env, input: '{"model":{}}', encoding: 'utf8' });
  assert.equal(fs.readFileSync(path.join(dir, 'metrics', 'usage-override.json'), 'utf8'), before);
});
