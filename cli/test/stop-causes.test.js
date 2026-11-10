/**
 * cli/test/stop-causes.test.js (AGE41)
 * Recorded stop causes ($CH_HOME/stop-causes.jsonl) feed the missed-wake causes of `ch metrics`.
 * Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeSession } from '../../shared/session-metrics.js';
import { recordedStopEvents, stopCause } from '../../shared/limit-hits.js';
import { buildInsights } from '../../shared/insights.js';
import { collectSessions } from '../lib/session-files.js';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const human = (min, text = 'go') => ({ type: 'user', sessionId: 's1', timestamp: at(min), origin: { kind: 'human' }, message: { content: text } });
const work = (min, blocks = [{ type: 'text', text: 'ok' }]) => ({ type: 'assistant', sessionId: 's1', timestamp: at(min), message: { id: `m${min}`, model: 'claude-opus-5', content: blocks } });
const errLine = (min, text) => ({ type: 'assistant', sessionId: 's1', timestamp: at(min), isApiErrorMessage: true, message: { model: '<synthetic>', content: [{ type: 'text', text }] } });
const toolStop = (extraAfterGap = [], opts = {}) => summarizeSession([
  human(0), work(1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
  { type: 'user', sessionId: 's1', timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } },
  human(45, 'hello?'),
  ...extraAfterGap,
], opts);
const entry = (min, cause, sessionId = 's1') => ({ sessionId, at: at(min), cause, evidence: 'log excerpt', recordedAt: at(min + 1) });

test('a recorded cause inside the gap counts for that session; none means no change', () => {
  assert.deepEqual(toolStop().missedWakeCauses, { unknown: 1 });
  assert.deepEqual(toolStop([], { stopCauses: [] }).missedWakeCauses, { unknown: 1 });
  assert.deepEqual(toolStop([], { stopCauses: [entry(20, 'idle-sweep')] }).missedWakeCauses, { 'idle-sweep': 1 });
  for (const c of ['app-quit', 'app-update', 'rate-limit', 'network', 'keypress', 'mac-sleep', 'auth', 'archived']) {
    assert.deepEqual(toolStop([], { stopCauses: [entry(3, c)] }).missedWakeCauses, { [c]: 1 }, c);
  }
});

test('entries of other sessions, unknown causes and entries outside gap +-2 min are ignored', () => {
  const only = (e) => toolStop([], { stopCauses: [e] }).missedWakeCauses;
  assert.deepEqual(only(entry(20, 'network', 'other')), { unknown: 1 });
  assert.deepEqual(only(entry(20, 'unknown')), { unknown: 1 });
  assert.deepEqual(only({ sessionId: 's1', at: 'not a date', cause: 'network' }), { unknown: 1 });
  // the gap runs from the tool result (min 2) to your prompt (min 45)
  assert.deepEqual(only(entry(47, 'network')), { network: 1 }, 'within 2 min after the gap');
  assert.deepEqual(only(entry(47.5, 'network')), { unknown: 1 });
  assert.deepEqual(only(entry(0, 'network')), { network: 1 }, 'within 2 min before the gap');
  assert.deepEqual(only(entry(-0.5, 'network')), { unknown: 1 });
});

test('priority: usage-limit first, then a recorded cause, then api-error, app-closed, interrupt', () => {
  const sys = { type: 'system', subtype: 'api_error', sessionId: 's1', timestamp: at(2.5), error: { formatted: 'Connection dropped (ECONNRESET)' } };
  const withApi = [sys];
  const sum = (extra, stopCauses) => summarizeSession([
    human(0), work(1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
    { type: 'user', sessionId: 's1', timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } },
    ...extra, human(45, 'hello?'),
    ...(extra.length > 1 ? [errLine(46, "You've hit your session limit · resets 12:40pm (UTC)")] : []),
  ], { stopCauses }).missedWakeCauses;
  assert.deepEqual(sum(withApi, [entry(20, 'network')]), { network: 1 }, 'recorded beats api-error');
  assert.deepEqual(sum([sys, sys], [entry(20, 'network')]), { 'usage-limit': 1 }, 'usage-limit beats recorded');
  assert.equal(stopCause(0, 10, [{ ms: 5, cause: 'interrupt' }, { ms: 5, cause: 'mac-sleep' }]), 'mac-sleep');
  assert.deepEqual(recordedStopEvents([entry(1, 'network'), null, { cause: 'network' }], 's1').length, 1);
  assert.deepEqual(recordedStopEvents([entry(1, 'auth'), entry(2, 'archived')], 's1').map((e) => e.cause), ['auth', 'archived']);
});

test('insights name the recorded causes', () => {
  const summary = { n: 1, missedWakeSessions: 1, missedWakes: 1, missedWakeOrigins: { 'tool-result': 1 },
    missedWakeCauses: { 'idle-sweep': 1, 'app-quit': 1, 'app-update': 1, 'rate-limit': 1, network: 1, keypress: 1, 'mac-sleep': 1, auth: 1, archived: 1 } };
  const text = JSON.stringify(buildInsights({ sessions: { summary } }));
  for (const label of ['idle sweep', 'app quit', 'app update', 'rate limit', 'network', 'Escape keypress', 'Mac slept', 'not logged in', 'archived on purpose']) assert.ok(text.includes(label), label);
});

test('collectSessions applies the file entries and re-reads a transcript when they change', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-stop-'));
  const lines = [
    human(0), work(1, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
    { type: 'user', sessionId: 's1', timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } },
    human(45, 'hello?'),
  ];
  fs.writeFileSync(path.join(dir, 's1.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const first = await collectSessions({ dirs: [dir] });
  assert.deepEqual(first.records[0].missedWakeCauses, { unknown: 1 });
  const second = await collectSessions({ dirs: [dir], cache: first.cache, stopCauses: [entry(20, 'app-quit')] });
  assert.deepEqual(second.records[0].missedWakeCauses, { 'app-quit': 1 }, 'cached record is refreshed when entries appear');
  const third = await collectSessions({ dirs: [dir], cache: second.cache, stopCauses: [entry(20, 'app-quit')] });
  assert.deepEqual(third.records[0].missedWakeCauses, { 'app-quit': 1 });
});
