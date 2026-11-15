/**
 * cli/test/answer-becomes-note.test.js
 * PRO102: a free-text answer nobody will read becomes a review note (synthetic data only).
 * Finished = ticked, in done / archive, or open with no live run; option picks stay decisions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveAsk, answerAsk, liveOwnerOf, cleanAsks, askErrors } from '../../shared/asks.js';
import { liveEpicsNow } from '../lib/next-start-inputs.js';

const NOW = '2026-03-02T10:00:00.000Z';
const ask = (extra = {}) => ({ n: 1, at: '2026-03-01T10:00:00.000Z', text: 'Which focus ring should the strip use?', state: 'open', ...extra });
const ticket = (extra = {}) => ({ id: 'T1', title: 'Strip focus', checked: false, asks: [ask()], ...extra });

test('ticked ticket in an in-progress section: a free-text answer becomes a note', () => {
  const t = ticket({ checked: true });
  const r = resolveAsk(t, '1', { action: 'answer', reply: 'use a 2px ring', now: NOW, section: 'in-progress', isLive: () => true });
  assert.ok(r.note);
  assert.equal(r.file, true);
  assert.equal(r.decision, null);
  assert.equal(t.reviewNotes.length, 1);
  assert.match(t.reviewNotes[0].text, /use a 2px ring/);
  assert.equal(t.asks[0].filedAs, 'T1#1');
});

test('ticket in done or archive: a note, as before', () => {
  for (const section of ['done', 'archive']) {
    const t = ticket();
    const r = resolveAsk(t, '1', { action: 'answer', reply: 'blue', now: NOW, section });
    assert.ok(r.note, section);
  }
});

test('open ticket with a live run: decision only', () => {
  const t = ticket();
  const r = resolveAsk(t, '1', { action: 'answer', reply: 'blue', now: NOW, section: 'in-progress', isLive: () => true });
  assert.equal(r.note, null);
  assert.equal(r.file, false);
  assert.match(r.decision.text, /blue/);
  assert.equal(t.asks[0].filedAs, undefined);
});

test('open ticket with no live run: a note', () => {
  const t = ticket();
  const r = resolveAsk(t, '1', { action: 'answer', reply: 'blue', now: NOW, section: 'in-progress', isLive: () => false });
  assert.ok(r.note);
  assert.equal(r.decision, null);
});

test('without isLive an open ticket counts as live (old behaviour)', () => {
  const t = ticket();
  assert.equal(resolveAsk(t, '1', { action: 'answer', reply: 'blue', now: NOW, section: 'todo' }).note, null);
});

test('an option pick is a decision, never a note, on a finished open ticket', () => {
  const t = ticket({ checked: true, asks: [ask({ options: [{ key: 'A', text: 'Thin ring' }, { key: 'B', text: 'Thick ring' }] })] });
  const r = resolveAsk(t, '1', { action: 'answer', reply: 'b', now: NOW, section: 'in-progress', isLive: () => false });
  assert.equal(r.note, null);
  assert.match(r.decision.text, /B: Thick ring/);
});

test('liveOwnerOf: the ticket or its epic is live', () => {
  const doc = { sections: [{ id: 'in-progress', tasks: [{ id: 'E1', type: 'epic' }, { id: 'T1', parentId: 'E1' }, { id: 'T2' }] }] };
  const live = liveOwnerOf(doc, ['E1']);
  assert.equal(live(doc.sections[0].tasks[1]), true);
  assert.equal(live(doc.sections[0].tasks[2]), false);
});

test('answerAsk: a twin card files one note, not two', () => {
  const q = 'Should both strips share one focus ring colour?';
  const doc = {
    sections: [{ id: 'in-progress', tasks: [
      { id: 'T1', title: 'One', checked: true, asks: [ask({ text: q })] },
      { id: 'T2', title: 'Two', checked: true, asks: [ask({ text: q })] },
    ] }],
  };
  const out = answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'yes, blue', now: NOW, newId: () => 'T9', isLive: () => false });
  const notes = doc.sections[0].tasks.flatMap(t => t.reviewNotes || []);
  assert.equal(notes.length, 1);
  assert.equal(out.resolved.filter(r => r.note).length, 1);
  const [a, b] = doc.sections[0].tasks.map(t => t.asks[0].filedAs);
  assert.ok(a && b, 'both asks are marked filed');
});

test('answerAsk: answering twice is refused (no second note)', () => {
  const doc = { sections: [{ id: 'done', tasks: [ticket({ checked: true })] }] };
  answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'blue', now: NOW });
  assert.throws(() => answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'blue', now: NOW }));
  assert.equal(doc.sections[0].tasks[0].reviewNotes.length, 1);
});

test('filedAs survives cleaning and passes the ask schema', () => {
  const t = ticket({ asks: [ask({ state: 'answered', answer: 'blue', filedAs: 'T1#1' })] });
  assert.equal(cleanAsks(t).asks[0].filedAs, 'T1#1');
  assert.deepEqual(askErrors(t, 'T1'), []);
  t.asks[0].filedAs = 5;
  assert.ok(askErrors(t, 'T1').some(e => /filedAs/.test(e)));
});

test('liveEpicsNow: missing tick.json means nobody is live; a stale one too; a fresh one lists epics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-live-test-'));
  const prev = process.env.AUTORUN_STATE_DIR;
  process.env.AUTORUN_STATE_DIR = dir;
  try {
    assert.deepEqual(liveEpicsNow({ now: Date.parse(NOW) }), []);
    fs.writeFileSync(path.join(dir, 'tick.json'), JSON.stringify({ at: NOW, intervalMin: 10, liveEpics: ['E1'] }));
    assert.deepEqual(liveEpicsNow({ now: Date.parse(NOW) + 60e3 }), ['E1']);
    assert.deepEqual(liveEpicsNow({ now: Date.parse(NOW) + 3 * 3600e3 }), []);
    fs.writeFileSync(path.join(dir, 'tick.json'), '{not json');
    assert.deepEqual(liveEpicsNow({ now: Date.parse(NOW) }), []);
  } finally {
    if (prev === undefined) delete process.env.AUTORUN_STATE_DIR; else process.env.AUTORUN_STATE_DIR = prev;
  }
});
