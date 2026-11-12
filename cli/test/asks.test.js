/**
 * cli/test/asks.test.js
 * PRO73 "Asks for you": shared/asks.js, the ask / answer / asks commands, review --ask, and
 * older tickets' questions read from their result with no migration (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  openAsks, taskAsks, addAsk, resolveAsk, closeMergedAsks, isLegacyQuestion, askErrors, askLines, asksNotice,
} from '../../shared/asks.js';
import { isNeedsTalLine } from '../../shared/proof-gate.js';
import { mergeTasksDocs } from '../../shared/tasks-merge.js';
import { loadTasksJson, serializeTasksJson } from '../../dashboard/js/tasks-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

const AT = '2026-03-01T10:00:00.000Z';
const result = (extra) => ({ at: AT, shipped: ['did it'], ci: 'all passed', ...extra });

/** A small doc: an epic in review whose child is done, plus standalone tickets. */
function legacyDoc() {
  return {
    sections: [
      { id: 'todo', tasks: [{ id: 'T10', title: 'Open one', checked: false }] },
      {
        id: 'review',
        tasks: [{
          id: 'E1', title: 'Epic', type: 'epic', checked: true,
          result: result({
            left: ['C1: Should the strip go with the track?', 'C1: plain leftover', 'Own question on the epic?'],
            unverified: ['C1: needs-tal: taste: does the glide feel right', 'C1: tried: hardware: no controller'],
          }),
        }],
      },
      {
        id: 'done',
        tasks: [
          {
            id: 'C1', title: 'Child', parentId: 'E1', checked: true,
            result: result({
              left: ['Should the strip go with the track?', 'plain leftover'],
              unverified: ['needs-tal: taste: does the glide feel right', 'tried: hardware: no controller'],
            }),
          },
          {
            id: 'T11', title: 'Done ticket', checked: true,
            result: result({
              left: ['Catalog PR is prepared but not merged. Merge it?', 'Is the copy right?  ', 'nothing to ask'],
              unverified: ['needs-tal: taste: the hues', 'needs-tal: the wording reads clearly', 'taste: unprefixed is not an ask'],
            }),
          },
        ],
      },
    ],
  };
}

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-asks-test-'));
  const doc = JSON.parse(fs.readFileSync(FIXTURE_SAMPLE, 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc));
  return dir;
}

function runCli(args, dir) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}

function readTask(dir, id) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
  for (const s of doc.sections) { const t = s.tasks.find(x => x.id === id); if (t) return t; }
  return null;
}

function writeTask(dir, id, patch) {
  const file = path.join(dir, 'tasks.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) if (t.id === id) Object.assign(t, patch);
  fs.writeFileSync(file, JSON.stringify(doc));
}

// ---------------------------------------------------------------------------
// Legacy detection (read-time, no migration)
// ---------------------------------------------------------------------------

test('every Left line ending in "?" (or saying Merge it) appears in the asks list, done tickets included', () => {
  const doc = legacyDoc();
  const rows = openAsks(doc);
  const lefts = doc.sections.flatMap(s => s.tasks).flatMap(t => (t.result?.left || []).map(l => ({ id: t.id, l })));
  for (const { id, l } of lefts.filter(x => isLegacyQuestion(x.l))) {
    const shown = rows.some(r => r.text === l.trim() && r.id === id)
      // an epic's rolled-up copy of a child's line shows once, on the child
      || (/^C1: /.test(l) && rows.some(r => r.id === 'C1' && r.text === l.slice(4)));
    assert.ok(shown, `missing ask for ${id}: ${l}`);
  }
  assert.ok(!rows.some(r => /plain leftover|nothing to ask/.test(r.text)), 'plain Left lines are not asks');
  assert.equal(rows.filter(r => r.text === 'Should the strip go with the track?').length, 1, 'epic copy deduped');
  assert.equal(rows.find(r => r.id === 'T11' && r.key === 'L1').kind, 'merge');
  assert.equal(rows.find(r => r.id === 'E1').text, 'Own question on the epic?');
});

test('needs-tal Unverified lines are one row per ticket, others are not asks', () => {
  const rows = openAsks(legacyDoc()).filter(r => r.kind === 'taste');
  assert.deepEqual(rows.map(r => r.id).sort(), ['C1', 'T11']);
  const t11 = rows.find(r => r.id === 'T11');
  assert.equal(t11.key, 'T');
  assert.equal(t11.text, '2 things to judge');
  assert.deepEqual(t11.lines, ['needs-tal: taste: the hues', 'needs-tal: the wording reads clearly']);
  assert.equal(rows.find(r => r.id === 'C1').text, '1 thing to judge');
  assert.equal(isNeedsTalLine('E1: needs-tal: taste: x'), true);
  assert.equal(isNeedsTalLine('taste: x'), false);
});

test('resolving a legacy ask persists in resolvedAsks and leaves the result alone', () => {
  const doc = legacyDoc();
  const t11 = doc.sections[2].tasks[1];
  const before = JSON.stringify(t11.result);
  const out = resolveAsk(t11, 'l2', { action: 'answer', reply: 'Yes', now: AT });
  assert.equal(out.state, 'answered');
  assert.match(t11.decisions[0].text, /asked "Is the copy right\?": Yes$/);
  resolveAsk(t11, 'T', { action: 'dismiss', now: AT });
  assert.equal(JSON.stringify(t11.result), before);
  assert.equal(t11.resolvedAsks.length, 3);
  assert.equal(t11.decisions.length, 1, 'dismiss writes no decision');
  assert.deepEqual(taskAsks(t11).map(a => a.key), ['L1']);
  assert.throws(() => resolveAsk(t11, 'T', { action: 'done' }), /no open ask "T"/);
  // A needs-tal line added later shows again, alone.
  t11.result.unverified.push('needs-tal: taste: a new one');
  assert.deepEqual(taskAsks(t11).find(a => a.key === 'T').lines, ['needs-tal: taste: a new one']);
});

// ---------------------------------------------------------------------------
// New asks
// ---------------------------------------------------------------------------

test('addAsk / resolveAsk / askLines; bad input refused', () => {
  const task = { id: 'T1' };
  addAsk(task, { text: 'Pick A or B?', by: '2026-03-05', now: AT });
  addAsk(task, { text: 'Merge it?', mergePr: 'https://github.com/acme/widgets/pull/7', now: AT });
  assert.throws(() => addAsk(task, { text: '  ' }), /non-empty/);
  assert.throws(() => addAsk(task, { text: 'x', by: 'soon' }), /YYYY-MM-DD/);
  assert.throws(() => addAsk(task, { text: 'x', mergePr: 'https://example.com/x' }), /pull request URL/);
  assert.deepEqual(taskAsks(task).map(a => [a.key, a.kind]), [['1', 'ask'], ['2', 'merge']]);
  assert.throws(() => resolveAsk(task, '1', { action: 'answer', reply: '' }), /needs a reply/);
  resolveAsk(task, '1', { action: 'answer', reply: 'A', now: AT });
  assert.deepEqual(askLines(task), ['Ask: Pick A or B? (answered: A)', 'Ask: Merge it? [https://github.com/acme/widgets/pull/7]']);
  assert.deepEqual(askErrors(task, 'x'), []);
  assert.ok(askErrors({ asks: [{ n: 1, text: '', at: AT, state: 'nope' }] }, 'x').length >= 2);
});

test('asks with a date come first, soonest first, then oldest', () => {
  const doc = { sections: [{ id: 'todo', tasks: [
    { id: 'A', asks: [{ n: 1, at: '2026-01-01T00:00:00Z', text: 'old', state: 'open' }] },
    { id: 'B', asks: [{ n: 1, at: '2026-02-01T00:00:00Z', text: 'late date', by: '2026-04-01', state: 'open' }] },
    { id: 'C', asks: [{ n: 1, at: '2026-02-02T00:00:00Z', text: 'soon date', by: '2026-03-01', state: 'open' }] },
  ] }] };
  assert.deepEqual(openAsks(doc).map(r => r.id), ['C', 'B', 'A']);
});

test('a merge ask closes itself once its PR merges, and only then', () => {
  const task = { id: 'T1' };
  addAsk(task, { text: 'Merge it?', mergePr: 'https://github.com/acme/widgets/pull/7', now: AT });
  assert.equal(closeMergedAsks(task, () => ({ state: 'OPEN' })).length, 0);
  assert.equal(closeMergedAsks(task, () => ({ error: 'gh not installed' })).length, 0);
  assert.equal(closeMergedAsks(task, () => ({ state: 'MERGED' }), { now: AT }).length, 1);
  assert.equal(task.asks[0].state, 'done');
  assert.match(task.decisions[0].text, /PR merged/);
  assert.equal(taskAsks(task).length, 0);
});

test('asksNotice wording', () => {
  assert.equal(asksNotice(0), '');
  assert.equal(asksNotice(1), '1 ask for Tal is on the Plan page');
  assert.equal(asksNotice(3), '3 asks for Tal are on the Plan page');
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('CLI: ask -> asks -> answer / dismiss round-trip, decision on the ticket', () => {
  const dir = makeTmpDir();
  let r = runCli(['tasks', 'ask', 'T1', 'Keep the old layout?', '--ask-by', '2026-03-10'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 ask for Tal is on the Plan page/);
  r = runCli(['tasks', 'ask', 'T2', 'Second question?'], dir);
  assert.equal(r.status, 0, r.stderr);

  r = runCli(['tasks', 'asks', '--json'], dir);
  const rows = JSON.parse(r.stdout).asks;
  assert.deepEqual(rows.map(x => [x.id, x.key, x.text]), [['T1', '1', 'Keep the old layout?'], ['T2', '1', 'Second question?']]);

  r = runCli(['tasks', 'answer', 'T1', '1', 'Yes, keep it'], dir);
  assert.equal(r.status, 0, r.stderr);
  const t1 = readTask(dir, 'T1');
  assert.equal(t1.asks[0].state, 'answered');
  assert.equal(t1.asks[0].answer, 'Yes, keep it');
  assert.match(t1.decisions.at(-1).text, /asked "Keep the old layout\?": Yes, keep it/);

  r = runCli(['tasks', 'answer', 'T2', '1', '--dismiss'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readTask(dir, 'T2').asks[0].state, 'dismissed');
  assert.equal((readTask(dir, 'T2').decisions || []).length, 0);
  r = runCli(['tasks', 'asks'], dir);
  assert.match(r.stdout, /No asks for Tal/);

  assert.notEqual(runCli(['tasks', 'answer', 'T2', '1', 'again'], dir).status, 0, 'a resolved ask cannot be answered twice');
  assert.notEqual(runCli(['tasks', 'ask', 'T1', 'x', '--merge-pr', 'not-a-url'], dir).status, 0);
  r = runCli(['tasks', 'get', 'T1'], dir);
  assert.match(r.stdout, /Ask: Keep the old layout\? \(answered: Yes, keep it\)/);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
});

test('CLI: a legacy Left question is answered once and stays answered (resolvedAsks)', () => {
  const dir = makeTmpDir();
  writeTask(dir, 'T5', { result: result({ left: ['Should it also animate?'], unverified: ['needs-tal: taste: speed'] }) });
  let rows = JSON.parse(runCli(['tasks', 'asks', '--json'], dir).stdout).asks;
  assert.deepEqual(rows.map(x => [x.id, x.key]), [['T5', 'L1'], ['T5', 'T']]);
  let r = runCli(['tasks', 'answer', 'T5', 'L1', 'No'], dir);
  assert.equal(r.status, 0, r.stderr);
  r = runCli(['tasks', 'answer', 'T5', 'T', '--done'], dir);
  assert.equal(r.status, 0, r.stderr);
  rows = JSON.parse(runCli(['tasks', 'asks', '--json'], dir).stdout).asks;
  assert.deepEqual(rows, []);
  const t5 = readTask(dir, 'T5');
  assert.deepEqual(t5.result.left, ['Should it also animate?'], 'the result is left as it was');
  assert.equal(t5.resolvedAsks.length, 2);
  assert.equal(t5.decisions.length, 2);
});

test('CLI: review --ask carries asks (repeatable) and prints the Plan page count; done prints it too', () => {
  const dir = makeTmpDir();
  let r = runCli(['tasks', 'review', 'T3', '--shipped', 'added A', '--check', 'Look at A',
    '--ask', 'Ship it to everyone?', '--ask', 'Rename the button?', '--ask-by', '2026-03-09'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 asks for Tal are on the Plan page/);
  const t3 = readTask(dir, 'T3');
  assert.deepEqual(t3.asks.map(a => [a.n, a.text, a.by, a.state]), [
    [1, 'Ship it to everyone?', '2026-03-09', 'open'], [2, 'Rename the button?', '2026-03-09', 'open'],
  ]);
  r = runCli(['tasks', 'done', 'T1'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 asks for Tal are on the Plan page/);
  assert.notEqual(runCli(['tasks', 'review', 'T4', '--shipped', 'x', '--check', 'y', '--ask-by', '2026-03-09'], dir).status, 0, '--ask-by needs --ask');
  // Done keeps the asks open.
  r = runCli(['tasks', 'asks', '--json'], dir);
  assert.equal(JSON.parse(r.stdout).asks.length, 2);
});

test('CLI: review / done print nothing about asks when there are none', () => {
  const dir = makeTmpDir();
  const r = runCli(['tasks', 'done', 'T1'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /asks? for Tal/);
});

// ---------------------------------------------------------------------------
// Dashboard: load/save keeps asks; a save conflict keeps both sides' asks
// ---------------------------------------------------------------------------

test('dashboard tasks-json round-trips asks and resolvedAsks, dropping malformed ones', () => {
  const doc = { sections: [{ id: 'todo', name: 'To Do', tasks: [{
    id: 'T1', title: 'x', checked: false,
    asks: [{ n: 1, at: AT, text: 'Q?', state: 'open', by: '2026-03-02' }, { n: 0, text: 'bad' }],
    resolvedAsks: [{ kind: 'left', text: 'Old?', state: 'answered', at: AT }, { kind: 'nope', text: 'x', state: 'done' }],
  }] }] };
  const mem = loadTasksJson(JSON.stringify(doc));
  const out = JSON.parse(serializeTasksJson(mem.sections, mem.tasks, mem.ticketTypes, mem.meta));
  const t = out.sections[0].tasks[0];
  assert.deepEqual(t.asks, [{ n: 1, at: AT, text: 'Q?', state: 'open', by: '2026-03-02' }]);
  assert.deepEqual(t.resolvedAsks, [{ kind: 'left', text: 'Old?', state: 'answered', at: AT }]);
});

test('save conflict: an answer made on the page and an ask added by a session both survive', () => {
  const ticket = (asks, decisions) => ({ sections: [{ id: 'todo', tasks: [{ id: 'T1', title: 'x', asks, ...(decisions ? { decisions } : {}) }] }] });
  const q1 = { n: 1, at: AT, text: 'Q1?', state: 'open' };
  const base = ticket([q1]);
  const local = ticket([{ ...q1, state: 'answered', answer: 'yes' }], [{ at: AT, text: 'Tal: asked "Q1?": yes' }]);
  const current = ticket([q1, { n: 2, at: AT, text: 'Q2?', state: 'open' }]);
  const merged = mergeTasksDocs(base, local, current).sections[0].tasks[0];
  assert.deepEqual(merged.asks.map(a => [a.n, a.state]), [[1, 'answered'], [2, 'open']]);
  assert.equal(merged.decisions.length, 1);
});
