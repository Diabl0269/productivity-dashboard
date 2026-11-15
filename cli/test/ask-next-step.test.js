/**
 * cli/test/ask-next-step.test.js
 * PRO103: nextStep(card, ctx) is the one line under an ask card; it must follow resolveAsk / pendingAnswers
 * (synthetic data only), so it never promises what the code does not do.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextStep, resolveAsk, NOTES_RUN_TIME, openAsks, groupAsks } from '../../shared/asks.js';
import { pendingAnswers } from '../../shared/review-filing.js';

const NOW = '2026-03-02T10:00:00.000Z';
const live = () => true;
const idle = () => false;
const ask = (extra = {}) => ({ n: 1, at: '2026-03-01T10:00:00.000Z', text: 'Which ring?', state: 'open', ...extra });
const ticket = (extra = {}) => ({ id: 'T1', title: 'Ring', checked: false, asks: [ask()], ...extra });
const NOTE = new RegExp(`becomes a ticket at the next daily notes run \\(from ${NOTES_RUN_TIME}\\)`);

test('live run: a decision the run reads before its PR', () => {
  const line = nextStep({ kind: 'ask' }, { task: ticket(), section: 'in-progress', isLive: live });
  assert.match(line, /saved on the ticket as a decision; the live run on it reads it before its PR/);
  assert.doesNotMatch(line, NOTE);
});

test('live unknown: a decision the next run reads, no promise about a live run', () => {
  const line = nextStep({ kind: 'ask' }, { task: ticket(), section: 'todo' });
  assert.match(line, /the next run on it reads it/);
});

test('no live run: a typed answer becomes a ticket at the daily run, and the code agrees', () => {
  const t = ticket();
  const line = nextStep({ kind: 'ask' }, { task: t, section: 'in-progress', isLive: idle });
  assert.match(line, NOTE);
  const r = resolveAsk(t, '1', { action: 'answer', reply: 'a 2px ring', now: NOW, section: 'in-progress', isLive: idle });
  assert.equal(r.file, true);
});

test('no live run with options: option pick is a decision, typed answer a ticket, and the code agrees', () => {
  const options = [{ key: 'A', text: 'two px' }];
  const line = nextStep({ kind: 'ask', options }, { task: ticket(), section: 'in-progress', isLive: idle });
  assert.match(line, /Picking an option is saved on the ticket as a decision; a typed answer becomes a ticket/);
  const t = ticket({ asks: [ask({ options })] });
  const r = resolveAsk(t, '1', { action: 'answer', reply: 'A', now: NOW, section: 'in-progress', isLive: idle });
  assert.equal(r.file, false);
  assert.ok(r.decision);
});

test('ticked ticket counts as finished even with a live run elsewhere', () => {
  const line = nextStep({ kind: 'ask' }, { task: ticket({ checked: true }), section: 'in-progress', isLive: live });
  assert.match(line, NOTE);
});

test('done ticket: any answer, option pick included, becomes a ticket, and the code agrees', () => {
  const options = [{ key: 'A', text: 'two px' }];
  const line = nextStep({ kind: 'ask', options }, { task: ticket(), section: 'done' });
  assert.match(line, NOTE);
  assert.doesNotMatch(line, /Picking an option/);
  const r = resolveAsk(ticket({ asks: [ask({ options })] }), '1', { action: 'answer', reply: 'A', now: NOW, section: 'done' });
  assert.equal(r.file, true);
});

test('review ticket: own ask answer is filed by the notes run; legacy rows only get a decision', () => {
  const own = nextStep({ kind: 'ask', legacy: false }, { task: ticket(), section: 'review' });
  assert.match(own, /saved on the ticket as a decision and becomes a ticket at the next daily notes run/);
  const t = ticket();
  resolveAsk(t, '1', { action: 'answer', reply: 'two px', now: NOW, section: 'review' });
  assert.equal(pendingAnswers({ sections: [{ id: 'review', tasks: [t] }] }).length, 1);
  const legacy = nextStep({ kind: 'question', legacy: true }, { task: ticket(), section: 'review' });
  assert.doesNotMatch(legacy, NOTE);
  assert.match(legacy, /saved on the ticket as a decision\./);
});

test('merge ask: never says the answer merges; names Merged and the auto-close', () => {
  const line = nextStep({ kind: 'merge', mergePr: 'https://github.com/o/r/pull/1' }, { task: ticket(), section: 'review' });
  assert.match(line, /^Nothing merges the PR for you: merge it yourself, then press Merged; the card also closes by itself once the PR merges\./);
  const noPr = nextStep({ kind: 'merge' }, { task: ticket(), section: 'in-progress', isLive: live });
  assert.doesNotMatch(noPr, /closes by itself/);
});

test('waiting-on-Tal row is covered like any ask', () => {
  const line = nextStep({ kind: 'waiting', legacy: true }, { task: ticket({ asks: [] }), section: 'in-progress', isLive: idle });
  assert.match(line, NOTE);
});

test('interpretation card has its own line', () => {
  const line = nextStep({ kind: 'interpretation' });
  assert.match(line, /OK changes nothing/);
  assert.match(line, /newest note/);
});

test('every open card kind gets a non-empty line (kind coverage)', () => {
  const doc = { sections: [{ id: 'in-progress', tasks: [
    ticket({ id: 'T1', asks: [ask({ options: [{ key: 'A', text: 'x' }] })] }),
    ticket({ id: 'T2', asks: [ask({ n: 1, text: 'Merge?', mergePr: 'https://github.com/o/r/pull/2' })] }),
    ticket({ id: 'T3', asks: [], result: { left: ['Pick one?'], at: '2026-03-01' } }),
    ticket({ id: 'T4', asks: [], waitingOn: 'Tal: a call', updated: '2026-03-01' }),
  ] }] };
  const cards = groupAsks(openAsks(doc));
  assert.deepEqual(cards.map(c => c.kind).sort(), ['ask', 'merge', 'question', 'waiting']);
  for (const c of cards) assert.ok(nextStep(c, { task: doc.sections[0].tasks.find(t => t.id === c.id), section: 'in-progress', isLive: live }).length > 20);
});
