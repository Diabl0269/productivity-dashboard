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
import { listTranscripts, summarizeTranscriptFile, collectSessions, expandProjectDirs } from '../lib/session-files.js';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const base = (min, extra) => ({ sessionId: 's1', timestamp: at(min), gitBranch: 'main', ...extra });
const human = (min, text = 'x') => base(min, { type: 'user', origin: { kind: 'human' }, message: { content: text } });
const notif = (min) => base(min, { type: 'user', origin: { kind: 'task-notification' }, message: { content: '<task-notification>done</task-notification>' } });
const toolResult = (min, id) => base(min, { type: 'user', message: { content: [{ type: 'tool_result', content: 'r', ...(id ? { tool_use_id: id } : {}) }] } });
const use = (min, name, id) => asst(min, [{ type: 'tool_use', id, name, input: {} }]);
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

test('silences are classified by what was pending: question wait, tool wait, model stall', () => {
  // (a) AskUserQuestion pending for 40 min: a question wait, not a stall, and not a tool wait
  const q = summarizeSession([human(0), use(1, 'AskUserQuestion', 'q1'), toolResult(41, 'q1'), stop(42)]);
  assert.deepEqual([q.questionWaits, q.questionWaitMin, q.toolWaits, q.stalls], [1, 40, 0, 0]);
  // (b) a Bash call pending for 30 min (long command or permission prompt)
  const b = summarizeSession([human(0), use(1, 'Bash', 'b1'), toolResult(31, 'b1'), use(32, 'Bash', 'b2'), toolResult(60, 'b2'), stop(61)]);
  assert.deepEqual([b.toolWaits, b.toolWaitMin, b.toolWaitTools, b.stalls, b.questionWaits], [2, 58, { Bash: 2 }, 0, 0]);
  // (c) nothing pending: the model went silent
  const m = summarizeSession([human(0), use(1, 'Bash', 'c1'), toolResult(2, 'c1'), asst(40), stop(41)]);
  assert.deepEqual([m.stalls, m.stallMin, m.toolWaits, m.questionWaits], [1, 38, 0, 0]);
  // a question pending next to another tool counts as a question wait
  const both = summarizeSession([human(0), asst(1, [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }, { type: 'tool_use', id: 'y', name: 'AskUserQuestion', input: {} }]), toolResult(50, 'y'), stop(51)]);
  assert.deepEqual([both.questionWaits, both.toolWaits], [1, 0]);
});

test('a silence before the assistant answered the opening prompt is a missed wake, by origin', () => {
  const peer = base(60, { type: 'user', origin: { kind: 'peer' }, message: { content: 'ping' } });
  const r = summarizeSession([
    human(0), asst(1), stop(2),
    notif(10), asst(40), stop(41), // notification at 10 answered only at 40: missed wake
    peer, asst(61), stop(62), // answered promptly
    human(100), stop(130), // a human prompt never answered
    human(200), asst(201), use(202, 'Read', 'r1'), toolResult(203, 'r1'), asst(240), stop(241), // real stall
  ]);
  assert.equal(r.missedWakes, 2);
  assert.equal(r.missedWakeMin, 60);
  assert.deepEqual(r.missedWakeOrigins, { 'task-notification': 1, human: 1 });
  assert.equal(r.stalls, 1);
  assert.equal(r.toolWaits, 0);
});

test('a final assistant message closes the turn: no stall, the reply wait starts there', () => {
  const final = (min) => base(min, { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } });
  const r = summarizeSession([human(0), final(1), human(50), final(51), stop(52)]);
  assert.equal(r.stalls, 0);
  assert.equal(r.missedWakes, 0);
  assert.equal(r.activeMin, 2);
  assert.deepEqual(r.replyWaits, [49]);
  // a late stop_hook_summary for the same turn does not reopen or double-close it
  const late = summarizeSession([human(0), final(1), stop(2), human(10), final(11), stop(12)]);
  assert.equal(late.turns, 2);
  assert.equal(late.activeMin, 2);
  assert.deepEqual(late.replyWaits, [9]);
  // a message that ends with a tool call does not close the turn
  const tool = base(1, { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'z', name: 'Bash', input: {} }] } });
  assert.equal(summarizeSession([human(0), tool, toolResult(40, 'z'), stop(41)]).toolWaits, 1);
});

test('a tool result nobody answered before the next prompt is a missed wake; a late answer is a stall', () => {
  const unanswered = summarizeSession([human(0), use(1, 'Bash', 'u1'), toolResult(2, 'u1'), notif(40), asst(41), stop(42)]);
  assert.deepEqual([unanswered.missedWakes, unanswered.missedWakeOrigins, unanswered.stalls], [1, { 'tool-result': 1 }, 0]);
  const late = summarizeSession([human(0), use(1, 'Bash', 'u2'), toolResult(2, 'u2'), asst(40), stop(41)]);
  assert.deepEqual([late.missedWakes, late.stalls], [0, 1]);
});

test('reply waits: each wait from turn end to the next human prompt (a notification turn restarts the wait)', () => {
  const r = summarizeSession([human(0), asst(1), stop(2), human(12), asst(13), stop(14), notif(20), stop(21), human(74), stop(75)]);
  assert.deepEqual(r.replyWaits, [10, 53]);
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

test('claudeProjects entries ending in * match directories by prefix', async () => {
  const fx = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcript-basic.jsonl');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-sessions-glob-'));
  try {
    for (const n of ['-Users-me-work', '-Users-me-work-app', '-Users-me-other']) fs.mkdirSync(path.join(root, n));
    fs.writeFileSync(path.join(root, '-Users-me-work-file'), 'not a dir');
    fs.copyFileSync(fx, path.join(root, '-Users-me-work', 's1.jsonl'));
    fs.copyFileSync(fx, path.join(root, '-Users-me-work-app', 's2.jsonl'));
    fs.copyFileSync(fx, path.join(root, '-Users-me-other', 's3.jsonl'));
    const dirs = expandProjectDirs([path.join(root, '-Users-me-work*'), path.join(root, '-Users-me-other'), path.join(root, 'missing*')]);
    assert.deepEqual(dirs.map(d => path.basename(d)), ['-Users-me-work', '-Users-me-work-app', '-Users-me-other']);
    const res = await collectSessions({ dirs: [path.join(root, '-Users-me-work*')] });
    assert.deepEqual(res.records.map(r => r.project).sort(), ['-Users-me-work', '-Users-me-work-app']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
