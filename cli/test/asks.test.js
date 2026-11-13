/**
 * cli/test/asks.test.js
 * PRO73 / PRO86 decisions for Tal: shared/asks.js, the ask / answer / asks commands, review --ask and
 * needs-tal taste lines turned into checks, scope (open work only), answers that drive work (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  openAsks, addAsk, resolveAsk, closeMergedAsks, askErrors, askLines, asksNotice, answerAsk, groupAsks, countAsks, taskAsks,
} from '../../shared/asks.js';
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
// Scope (PRO86): only asks on open work show; needs-tal lines are checks, never asks
// ---------------------------------------------------------------------------

test('legacy Left questions on done tickets are dropped; an open ticket\'s still show (epic copy once)', () => {
  const rows = openAsks(legacyDoc());
  assert.deepEqual(rows.map(r => [r.id, r.key, r.text]), [['E1', 'L3', 'Own question on the epic?']]);
  assert.ok(!rows.some(r => r.id === 'T11' || r.id === 'C1'), 'done tickets C1 / T11 carry no asks any more');
});

test('needs-tal Unverified lines are never asks, on open or done work', () => {
  const doc = legacyDoc();
  doc.sections[0].tasks[0].result = result({ unverified: ['needs-tal: taste: the hues'] });
  const rows = openAsks(doc);
  assert.ok(!rows.some(r => /hues|glide|to judge/.test(r.text)), JSON.stringify(rows));
  assert.ok(!rows.some(r => r.kind === 'taste'));
});

test('an ask on a done ticket shows while its epic is open, and leaves once the epic closes', () => {
  const doc = legacyDoc();
  const c1 = doc.sections[2].tasks[0];
  addAsk(c1, { text: 'Keep the glide?', options: ['A: keep', 'B: drop'], now: AT });
  assert.deepEqual(openAsks(doc).filter(r => r.id === 'C1').map(r => r.key), ['1']);
  const epic = doc.sections[1].tasks.pop();
  doc.sections[2].tasks.push(epic); // the epic is reviewed and closed
  assert.deepEqual(openAsks(doc).filter(r => r.id === 'C1'), []);
});

test('an open ticket whose waitingOn names Tal is listed (W); done ones and other people are not', () => {
  const doc = legacyDoc();
  doc.sections[0].tasks.push(
    { id: 'T12', title: 'Warp', waitingOn: 'Tal: pick A (live warp) or B (re-render)', updated: '2026-03-02' },
    { id: 'T13', title: 'Vendor', waitingOn: 'vendor reply' },
  );
  doc.sections[2].tasks.push({ id: 'T14', title: 'Old', waitingOn: 'Tal: something old' });
  const w = openAsks(doc).filter(r => r.key === 'W');
  assert.deepEqual(w.map(r => [r.id, r.text]), [['T12', 'pick A (live warp) or B (re-render)']]);
  const t12 = doc.sections[0].tasks.find(t => t.id === 'T12');
  const out = resolveAsk(t12, 'W', { action: 'answer', reply: 'A', section: 'todo', now: AT });
  assert.equal(t12.waitingOn, undefined, 'answering clears waitingOn');
  assert.match(out.decision.text, /asked "pick A \(live warp\) or B \(re-render\)": A$/);
  assert.equal(openAsks(doc).filter(r => r.id === 'T12').length, 0);
});

test('resolving a legacy Left question persists in resolvedAsks and leaves the result alone', () => {
  const doc = legacyDoc();
  const e1 = doc.sections[1].tasks[0];
  const before = JSON.stringify(e1.result);
  const out = resolveAsk(e1, 'l3', { action: 'answer', reply: 'Yes', section: 'review', now: AT });
  assert.equal(out.state, 'answered');
  assert.match(e1.decisions[0].text, /asked "Own question on the epic\?": Yes$/);
  assert.equal(JSON.stringify(e1.result), before);
  assert.deepEqual(e1.resolvedAsks.map(r => r.text), ['Own question on the epic?']);
  assert.throws(() => resolveAsk(e1, 'L3', { action: 'done' }), /no open ask "L3"/);
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

// ---------------------------------------------------------------------------
// PRO86: answers drive work, short questions with media, one card per question
// ---------------------------------------------------------------------------

/** An open epic (lane "ui") with a done child and an open child, plus backlog. */
function workDoc() {
  return {
    meta: {},
    sections: [
      { id: 'backlog', tasks: [] },
      { id: 'todo', tasks: [
        { id: 'P2', title: 'Open child', parentId: 'P1', checked: false },
        { id: 'P3', title: 'Width twin', checked: false },
      ] },
      { id: 'in-progress', tasks: [{ id: 'P1', title: 'Epic', type: 'epic', lane: 'ui', checked: false }] },
      { id: 'done', tasks: [{ id: 'P4', title: 'Done child', parentId: 'P1', checked: true }] },
    ],
  };
}
const byId = (doc, id) => doc.sections.flatMap(s => s.tasks.map(t => ({ t, s: s.id }))).find(x => x.t.id === id);
const counter = (doc) => () => `P${doc.sections.flatMap(s => s.tasks).length + 10}`;

test('addAsk sets waitingOn to Tal; answering by option records it and clears waitingOn', () => {
  const doc = workDoc();
  const p2 = byId(doc, 'P2').t;
  addAsk(p2, { text: 'Rework the wiring or drop Width?', options: ['A: rework', 'B: drop'], recommend: 'a', now: AT });
  assert.match(p2.waitingOn, /^Tal: Rework the wiring/);
  assert.deepEqual(openAsks(doc).map(r => [r.id, r.key]), [['P2', '1']], 'no extra W row for the ask-set waitingOn');
  const out = answerAsk(doc, 'P2', '1', { action: 'answer', reply: 'b', now: AT });
  assert.equal(out.state, 'answered');
  assert.equal(p2.waitingOn, undefined);
  assert.equal(p2.asks[0].answer, 'B: drop');
  assert.match(p2.decisions.at(-1).text, /: B: drop$/);
});

test('an answer on a done ticket files a follow-up through review filing, not a dead decision', () => {
  const doc = workDoc();
  const p4 = byId(doc, 'P4').t;
  addAsk(p4, { text: 'Gain makeup: A or B?', options: ['A: fixed makeup', 'B: quieter'], now: AT });
  assert.equal(openAsks(doc).length, 1, 'listed: its epic is still open');
  const out = answerAsk(doc, 'P4', '1', { action: 'answer', reply: 'A', newId: counter(doc), now: AT });
  assert.equal((p4.decisions || []).length, 0, 'no decision on the done ticket');
  assert.equal(out.filed.length, 1);
  const filed = byId(doc, out.filed[0].id);
  assert.equal(filed.s, 'todo');
  assert.equal(filed.t.reviewOf, 'P4');
  assert.match(filed.t.title, /Tal answered "Gain makeup: A or B\?": A: fixed makeup/);
  assert.equal(p4.reviewNotes[0].state, 'filed');
});

test('Park moves the ticket to backlog with the reason as a decision', () => {
  const doc = workDoc();
  addAsk(byId(doc, 'P2').t, { text: 'Sleep/wake experiment now?', now: AT });
  const out = answerAsk(doc, 'P2', '1', { action: 'park', reply: 'after v1', now: AT });
  assert.deepEqual(out.parked, ['P2']);
  const p2 = byId(doc, 'P2');
  assert.equal(p2.s, 'backlog');
  assert.match(p2.t.decisions.at(-1).text, /parked "Sleep\/wake experiment now\?": after v1$/);
  assert.equal(p2.t.waitingOn, undefined);
  assert.deepEqual(p2.t.history.at(-1), { at: AT, event: 'moved', from: 'todo', to: 'backlog' });
});

test('question length, taste and media gates', () => {
  const t = { id: 'X1' };
  assert.throws(() => addAsk(t, { text: 'x'.repeat(141) }), /141 characters; keep it to 140.*--details/);
  assert.doesNotThrow(() => addAsk(t, { text: 'y'.repeat(140), details: 'z'.repeat(2000) }));
  assert.throws(() => addAsk(t, { text: 'taste: does the glow look right?' }), /taste question is a check, not an ask/);
  assert.throws(() => addAsk(t, { text: 'Q?', media: { video: 'a.mov' } }), /must end with \.mp4/);
  assert.throws(() => addAsk(t, { text: 'Q?', media: { image: '../x.png' } }), /\.\./);
  assert.throws(() => addAsk(t, { text: 'Q?', options: ['A: one'], recommend: 'C' }), /not one of the options/);
  const ask = addAsk(t, { text: 'Q?', media: { image: 'X1/shot.png', project: 'X1/p.agsproj' } });
  assert.deepEqual(ask.media, { image: 'X1/shot.png', project: 'X1/p.agsproj' });
  assert.deepEqual(askErrors(t, 'x'), []);
});

test('the same question on two tickets (text or --same-as) is one card, and one answer answers both', () => {
  const doc = workDoc();
  addAsk(byId(doc, 'P2').t, { text: 'Width on one cable: rework stereo?', options: ['A: rework', 'B: drop'], now: AT });
  addAsk(byId(doc, 'P3').t, { text: 'width on one cable:  rework stereo', now: AT });
  let cards = groupAsks(openAsks(doc));
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].ids.sort(), ['P2', 'P3']);
  answerAsk(doc, 'P3', '1', { action: 'answer', reply: 'a', now: AT });
  assert.deepEqual(openAsks(doc), []);
  assert.equal(byId(doc, 'P2').t.asks[0].answer, 'A: rework');
  assert.equal(byId(doc, 'P3').t.asks[0].answer, 'A: rework', 'the twin without options records the card option too');
  // --same-as joins differently worded asks; a waitingOn row joins too.
  const d2 = workDoc();
  byId(d2, 'P3').t.waitingOn = 'Tal: Width with joined jacks, A or B';
  addAsk(byId(d2, 'P2').t, { text: 'Mono Width needs both legs: rework?', sameAs: 'P3', now: AT });
  cards = groupAsks(openAsks(d2));
  assert.equal(cards.length, 1);
  assert.equal(countAsks(d2), 1);
  answerAsk(d2, 'P2', '1', { action: 'answer', reply: 'rework', now: AT });
  assert.equal(byId(d2, 'P3').t.waitingOn, undefined);
});

test('a legacy "Merge it" line closes once the PR on the ticket\'s links has merged', () => {
  const task = { id: 'M1', links: [{ url: 'https://github.com/acme/site/pull/235', label: 'PR' }], result: result({ left: ['Catalog PR is ready. Merge it?'] }) };
  const doc = { sections: [{ id: 'review', tasks: [task] }] };
  assert.equal(openAsks(doc)[0].mergePr, 'https://github.com/acme/site/pull/235');
  assert.equal(closeMergedAsks(task, () => ({ state: 'OPEN' })).length, 0);
  assert.equal(closeMergedAsks(task, url => (url.endsWith('/235') ? { state: 'MERGED' } : {}), { now: AT }).length, 1);
  assert.deepEqual(openAsks(doc), []);
});

/** A tmp home with evidence files under evidence/<rel>. */
function homeWithEvidence(files) {
  const dir = makeTmpDir();
  for (const rel of files) {
    const abs = path.join(dir, 'evidence', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }
  return dir;
}

test('CLI: ask with options + media, answer by letter (key optional), refusals for long / taste / missing media', () => {
  const dir = homeWithEvidence(['T1/shot.png', 'T1/clip.mp4']);
  let r = runCli(['tasks', 'ask', 'T1', 'Keep it or drop it?', '--option', 'A: keep', '--option', 'B: drop', '--recommend', 'A',
    '--image', 'T1/shot.png', '--video', path.join(dir, 'evidence/T1/clip.mp4'), '--details', 'Long context here.'], dir);
  assert.equal(r.status, 0, r.stderr);
  let t1 = readTask(dir, 'T1');
  assert.deepEqual(t1.asks[0].media, { video: 'T1/clip.mp4', image: 'T1/shot.png' });
  assert.match(t1.waitingOn, /^Tal: /);
  r = runCli(['tasks', 'asks'], dir);
  assert.match(r.stdout, /A: keep \(recommended\)/);
  assert.equal(runCli(['tasks', 'lint'], dir).status, 0);
  r = runCli(['tasks', 'answer', 'T1', 'B'], dir);
  assert.equal(r.status, 0, r.stderr);
  t1 = readTask(dir, 'T1');
  assert.equal(t1.asks[0].answer, 'B: drop');
  assert.equal(t1.waitingOn, undefined);

  r = runCli(['tasks', 'ask', 'T2', 'q'.repeat(150)], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--details/);
  r = runCli(['tasks', 'ask', 'T2', 'taste: is the glow right?', '--video', 'T1/clip.mp4'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /taste question is a check/);
  r = runCli(['tasks', 'ask', 'T2', 'Which one?', '--image', 'T2/missing.png'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not found/);
  r = runCli(['tasks', 'ask', 'T2', 'Ship now?'], dir);
  assert.equal(r.status, 0, r.stderr);
  r = runCli(['tasks', 'answer', 'T2', '--park', 'later'], dir);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
  assert.ok(doc.sections.find(s => s.id === 'backlog').tasks.some(t => t.id === 'T2'), 'parked to backlog');
});

test('CLI: asks --refresh closes a legacy Merge it line once the linked PR merged (fake gh)', () => {
  const dir = makeTmpDir();
  writeTask(dir, 'T3', { links: [{ url: 'https://github.com/acme/site/pull/9', label: 'PR' }], result: result({ left: ['PR ready. Merge it?'] }) });
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-fake-gh-'));
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho \'{"state":"MERGED","headRefName":"x"}\'\n', { mode: 0o755 });
  const r = spawnSync(process.execPath, [CH_SCRIPT, 'tasks', 'asks', '--refresh', '--json'], { env: { ...process.env, CH_HOME: dir, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.closed.map(c => [c.id, c.key]), [['T3', 'L1']]);
  assert.deepEqual(out.asks, []);
});

test('CLI: review turns a needs-tal taste line into a check (folded on the same project); no media is refused', () => {
  const dir = homeWithEvidence(['T3/a.agsproj', 'T3/a.mp4', 'T4/b.mp4']);
  let r = runCli(['tasks', 'review', 'T3', '--shipped', 'glow', '--check', 'Open the glow project', '--check-project', '1=T3/a.agsproj',
    '--unverified', 'needs-tal: taste: does the glow feel right | project=T3/a.agsproj video=T3/a.mp4'], dir);
  assert.equal(r.status, 0, r.stderr);
  const t3 = readTask(dir, 'T3');
  assert.equal(t3.checks.length, 1, 'folded into the check on the same project');
  assert.match(t3.checks[0].text, /Also judge: does the glow feel right/);
  assert.equal(t3.checks[0].video, 'T3/a.mp4');
  assert.ok(!(t3.result.unverified || []).some(l => /needs-tal/.test(l)), 'the line left the result');

  r = runCli(['tasks', 'review', 'T4', '--shipped', 'x', '--check', 'Look at it', '--unverified', 'needs-tal: taste: caption colour | video=T4/b.mp4'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readTask(dir, 'T4').checks.map(c => [c.text, c.video]), [['Look at it', undefined], ['caption colour', 'T4/b.mp4']]);

  r = runCli(['tasks', 'review', 'T1', '--shipped', 'x', '--check', 'y', '--unverified', 'needs-tal: taste: the hues'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /needs the thing to judge/);
});
