/**
 * cli/test/session-metrics.test.js: synthetic transcripts only (no real prompt text).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeSession, ticketFrom } from '../../shared/session-metrics.js';
import { listTranscripts, summarizeTranscriptFile, collectSessions } from '../lib/session-files.js';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const base = (min, extra) => ({ sessionId: 's1', timestamp: at(min), gitBranch: 'main', ...extra });
const human = (min, text = 'x') => base(min, { type: 'user', origin: { kind: 'human' }, message: { content: text } });
const notif = (min) => base(min, { type: 'user', origin: { kind: 'task-notification' }, message: { content: '<task-notification>done</task-notification>' } });
const toolResult = (min) => base(min, { type: 'user', message: { content: [{ type: 'tool_result', content: 'r' }] } });
const asst = (min, blocks = [{ type: 'text', text: 'a' }]) => base(min, { type: 'assistant', message: { content: blocks } });
const ask = (min) => asst(min, [{ type: 'tool_use', name: 'AskUserQuestion', input: { questions: [] } }]);
const stop = (min, prevented = false) => base(min, { type: 'system', subtype: 'stop_hook_summary', preventedContinuation: prevented });

test('turns: active time, wait on user, wall', () => {
  const r = summarizeSession([human(0), asst(5), stop(10), human(40), asst(42), stop(50)]);
  assert.equal(r.turns, 2);
  assert.equal(r.userPrompts, 2);
  assert.equal(r.activeMin, 20);
  assert.equal(r.waitUserMin, 30);
  assert.equal(r.wallMin, 50);
  assert.equal(r.key, 's1');
  assert.deepEqual(r.prs, []);
});

test('notification-originated turn does not end the wait on the user', () => {
  const r = summarizeSession([human(0), stop(10), notif(20), asst(21), stop(25), human(60), stop(70)]);
  assert.equal(r.turns, 3);
  assert.equal(r.userPrompts, 2);
  assert.equal(r.activeMin, 25);
  // waits: 25 -> 60 (next human prompt); 10 -> 20 ended by a notification, so not counted
  assert.equal(r.waitUserMin, 35);
});

test('tool_result carriers are not prompts', () => {
  const r = summarizeSession([human(0), asst(1), toolResult(2), stop(3)]);
  assert.equal(r.userPrompts, 1);
  assert.equal(r.turns, 1);
});

test('question vs mid-run question (after 15 min of active time)', () => {
  const r = summarizeSession([human(0), ask(2), toolResult(3), ask(20), toolResult(21), stop(22)]);
  assert.equal(r.questions, 2);
  assert.equal(r.questionsMidRun, 1);
  const bare = summarizeSession([human(0), asst(1, [{ type: 'text', text: 'AskUserQuestion' }]), stop(2)]);
  assert.equal(bare.questions, 0);
});

test('stall inside a turn counts; long idle between turns does not', () => {
  const stalled = summarizeSession([human(0), asst(1), toolResult(31), stop(32)]);
  assert.equal(stalled.stalls, 1);
  assert.equal(stalled.stallMin, 30);
  const idle = summarizeSession([human(0), asst(1), stop(2), human(200), stop(201)]);
  assert.equal(idle.stalls, 0);
  assert.equal(idle.waitUserMin, 198);
  const custom = summarizeSession([human(0), asst(1), toolResult(11), stop(12)], { stallMinutes: 5 });
  assert.equal(custom.stalls, 1);
});

test('stopBlocked, compactions, prs, cost from last cost-state', () => {
  const r = summarizeSession([
    human(0),
    stop(1, true),
    base(2, { type: 'system', subtype: 'compact_boundary' }),
    { type: 'pr-link', sessionId: 's1', prNumber: 12, prRepository: 'o/r', prUrl: 'u' },
    { type: 'pr-link', sessionId: 's1', prNumber: 12, prRepository: 'o/r', prUrl: 'u' },
    { type: 'cost-state', sessionId: 's1', totalCostUSD: 1 },
    { type: 'cost-state', sessionId: 's1', totalCostUSD: 12.345 },
    stop(3),
  ], { project: 'p' });
  assert.equal(r.stopBlocked, 1);
  assert.equal(r.compactions, 1);
  assert.deepEqual(r.prs, ['o/r#12']);
  assert.equal(r.costUSD, 12.35);
  assert.equal(r.project, 'p');
  assert.equal(r.activeMin, 3);
});

test('record never carries prompt text; title from custom-title; ticket from it', () => {
  const r = summarizeSession([{ type: 'custom-title', customTitle: 'PRO40 - x', sessionId: 's1' }, human(0, 'secret words'), stop(1)]);
  assert.equal(r.ticket, 'PRO40');
  assert.equal(r.title, 'PRO40 - x');
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('empty input gives null', () => {
  assert.equal(summarizeSession([]), null);
});

test('ticketFrom precedence', () => {
  assert.equal(ticketFrom({ title: 'PRO40 - dev', branch: 'fro1-x', firstPrompt: '/ship-task BAC9' }), 'PRO40');
  assert.equal(ticketFrom({ title: 'no id here', branch: 'fro1626-thing', firstPrompt: '/ship-task BAC9' }), 'FRO1626');
  assert.equal(ticketFrom({ title: null, branch: 'main', firstPrompt: 'please /ship-task bac93 now' }), 'BAC93');
  assert.equal(ticketFrom({ firstPrompt: '<command-name>/ship-task</command-name><command-args>PRO7</command-args>' }), 'PRO7');
  assert.equal(ticketFrom({ title: 'fix a thing', branch: 'main', firstPrompt: 'hello' }), null);
  assert.equal(ticketFrom({}), null);
});

test('ticket from /ship-task in the first human prompt, which is not stored', () => {
  const r = summarizeSession([human(0, '/ship-task AGE28 please'), stop(1)]);
  assert.equal(r.ticket, 'AGE28');
  assert.ok(!JSON.stringify(r).includes('please'));
});

test('files: list, summarize skipping junk lines, collect with cache', async () => {
  const fx = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcript-basic.jsonl');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-sessions-'));
  try {
    fs.copyFileSync(fx, path.join(dir, 'abc.jsonl'));
    fs.mkdirSync(path.join(dir, 'abc', 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'abc', 'subagents', 'agent-1.jsonl'), '{}\n');
    fs.writeFileSync(path.join(dir, 'abc', 'subagents', 'agent-2.jsonl'), '{}\n');
    const list = listTranscripts(dir);
    assert.equal(list.length, 1);
    assert.equal(list[0].sessionId, 'abc');
    assert.equal(list[0].helperCount, 2);
    const rec = await summarizeTranscriptFile(list[0].path, {});
    assert.equal(rec.ticket, 'PRO40');
    assert.equal(rec.wallMin, 10);
    assert.equal(rec.costUSD, 1.23);
    const first = await collectSessions({ dirs: [dir] });
    assert.equal(first.records.length, 1);
    assert.equal(first.records[0].helpers, 2);
    assert.equal(first.records[0].project, path.basename(dir));
    // unchanged file: served from cache (poison the cached record to prove no re-parse)
    const p = list[0].path;
    first.cache[p].record = { ...first.cache[p].record, title: 'cached' };
    const second = await collectSessions({ dirs: [dir], cache: first.cache });
    assert.equal(second.records[0].title, 'cached');
    // changed file: re-parsed
    fs.appendFileSync(p, '{"type":"custom-title","customTitle":"FRO1 - new","sessionId":"s1"}\n');
    const third = await collectSessions({ dirs: [dir], cache: second.cache });
    assert.equal(third.records[0].title, 'FRO1 - new');
    const none = await collectSessions({ dirs: [dir], since: Date.now() + 1e6 });
    assert.equal(none.records.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
