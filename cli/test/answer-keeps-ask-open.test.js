/**
 * cli/test/answer-keeps-ask-open.test.js
 * Guard: an answer that produced a review note can never leave its ask open or its ticket still
 * "waiting on Tal" (FRO1875: the answer became note 1 and FRO1939, yet the For you card kept coming back).
 * Covers the answer itself (CLI and dashboard-shaped ticket) and the dashboard save's three-way merge,
 * which used to keep the other side's waitingOn after the answer cleared it (synthetic data only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { answerAsk, resolveAsk, openAsks } from '../../shared/asks.js';
import { mergeTasksDocs } from '../../shared/tasks-merge.js';

const Q = 'Which direction should we build?';
const mkAsk = () => ({ n: 1, at: '2026-11-15T13:57:00.244Z', text: Q, state: 'open', options: [{ key: 'A', text: 'Soft light' }] });
const SECTIONS = ['in-progress', 'done', 'review'];
const docOf = (section, task) => ({
  sections: SECTIONS.map(id => ({ id, tasks: id === section && task ? [task] : [] })),
});
const ticket = (extra = {}) => ({ id: 'T1', title: 'Depth', waitingOn: `Tal: ${Q}`, asks: [mkAsk()], ...extra });

/** Every invariant of the bug in one place: a ticket whose answer became a note has no open ask and no wait on Tal. */
function assertSettled(task, label) {
  const note = (task.reviewNotes || []).find(n => n.text.includes(`Tal answered "${Q}"`));
  assert.ok(note, `${label}: the answer's review note exists`);
  const ask = task.asks.find(a => a.n === 1);
  assert.equal(ask.state, 'answered', `${label}: ask answered`);
  assert.ok(ask.answer && ask.resolvedAt && ask.filedAs, `${label}: ask keeps answer, resolvedAt and filedAs`);
  assert.equal(task.waitingOn, undefined, `${label}: no longer waiting on Tal`);
  assert.deepEqual(openAsks(docOf('done', task)), [], `${label}: no For you card`);
}

test('answerAsk on a done ticket: free text becomes a note and settles the ask', () => {
  const doc = docOf('done', ticket());
  answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'A looks fine, tweak it' });
  assertSettled(doc.sections[1].tasks[0], 'answerAsk');
});

test('resolveAsk on a dashboard ticket (taskId, numeric id): filedAs names the ticket, not the internal id', () => {
  const task = ticket({ id: 1794817397514.3486, taskId: 'T1' });
  const r = resolveAsk(task, '1', { action: 'answer', reply: 'free text', section: 'done' });
  assert.equal(task.asks[0].filedAs, `T1#${r.note.n}`);
  assertSettled(task, 'dashboard shape');
});

test('save merge: an answered ask never comes back open and waitingOn stays cleared, whatever the other side did', () => {
  const answered = (t) => {
    const doc = docOf('done', t);
    answerAsk(doc, 'T1', '1', { action: 'answer', reply: 'A looks fine, tweak it' });
    return doc;
  };
  const baseTickets = { none: null, open: ticket() };
  const currents = {
    same: {},
    history: { history: [{ at: '2026-11-15T13:58:00.000Z', event: 'moved' }] },
    waiting: { waitingOn: 'Tal: something else' },
    detailsAdded: { asks: [{ ...mkAsk(), details: 'Open the board and compare' }] },
    sectionReview: { _section: 'review' },
  };
  for (const [bk, bt] of Object.entries(baseTickets)) {
    for (const [ck, cx] of Object.entries(currents)) {
      const { _section: cs = 'done', ...fields } = cx;
      const local = answered(ticket());
      const merged = mergeTasksDocs(docOf('done', bt), local, docOf(cs, ticket(fields)));
      const task = merged.sections.flatMap(s => s.tasks).find(t => t.id === 'T1');
      assertSettled(task, `base ${bk}, current ${ck}`);
    }
  }
});
