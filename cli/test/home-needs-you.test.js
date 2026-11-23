/**
 * shared/home-needs-you.js (PRO130): the one Needs you rule. Each source, dedupe, scope, and the same number in
 * Overview, Lanes and the flagged Tickets rows. Synthetic bakery data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';
import { openEpicReadiness } from '../../shared/epic-ready.js';
import { needsYou } from '../../shared/home-needs-you.js';
import { overviewModel } from '../../shared/home-overview.js';
import { ticketRows, filterRows, countByState } from '../../shared/home-ticket-rows.js';
import { scopeTest } from '../../shared/plan-scope.js';

const HOW = '## In plain words\n**How to check it:** open the page and look.';
const { config } = normalizeHomeConfig({
  version: 1,
  groups: [{ id: 'shop', name: 'Shop', areas: [{ id: 'counter', name: 'Counter', lanes: ['counter'] }, { id: 'oven', name: 'Oven', lanes: ['oven'] }] }],
});
const ask = text => ({ n: 1, state: 'open', text, at: '2026-03-08T09:00:00Z' });
const t = (id, o = {}) => ({ id, title: `Title ${id}`, type: 'task', description: HOW, ...o });

function fixture() {
  return {
    sections: [
      { id: 'todo', tasks: [
        t('E1', { type: 'epic', lane: 'counter' }),
        t('A1', { parentId: 'E1', asks: [ask('Round or square knob?')] }), // grouped ask: same question on A1 and A2
        t('A2', { parentId: 'E1', asks: [ask('Round or square knob?')] }),
        t('I1', { parentId: 'E1', description: `${HOW}\n- Interpretation: they want a thermal printer` }),
        t('C1', { parentId: 'E1', checks: [{ text: 'prints', checked: false }] }), // a check to tick on open work
        t('E2', { type: 'epic', lane: 'oven' }),
        t('P1', { parentId: 'E2', title: 'Co-task: pick the oven look', labels: ['design'], waitingOn: 'Tal: pick' }),
        t('Q1', { parentId: 'E2', asks: [ask('Fan on the left?')] }),
      ] },
      { id: 'review', tasks: [t('R1', { parentId: 'E1', checks: [{ text: 'cuts', checked: false }], result: { at: '2026-03-09T10:00:00Z', shipped: ['x'] } })] },
    ],
  };
}

test('each source counts, and one ticket is one unit however many sources name it', () => {
  const n = needsYou(fixture());
  assert.deepEqual([...n.ids].sort(), ['A1', 'A2', 'C1', 'I1', 'P1', 'Q1', 'R1']);
  assert.equal(n.count, 7);
  assert.ok(n.parts.asks >= 3); // the grouped card holds A1 and A2, plus Q1 (an interpretation may also read as an ask)
  assert.equal(n.parts.interps, 1);
  assert.equal(n.parts.picks, 1);
  assert.ok(n.parts.review >= 1);
  assert.ok(n.parts.checks >= 1);
  assert.equal(n.decisions + n.reviews, n.count);
  assert.equal(n.decisions, 5); // A1, A2, Q1, I1, P1
  assert.equal(n.reviews, 2); // R1, C1
});

test('a ticket with an ask and a check is one decision, not also a review', () => {
  const doc = fixture();
  doc.sections[0].tasks.find(x => x.id === 'A1').checks = [{ text: 'x', checked: false }];
  const n = needsYou(doc);
  assert.equal(n.count, 7);
  assert.equal(n.decisions, 5);
  assert.equal(n.reviews, 2);
});

test('keep narrows by scope; the default keeps everything', () => {
  const doc = fixture();
  const n = needsYou(doc, scopeTest(doc, new Set(['E2'])));
  assert.deepEqual([...n.ids].sort(), ['P1', 'Q1']);
  assert.equal(n.count, 2);
  assert.equal(needsYou(doc, () => false).count, 0);
});

test('Overview, flagged Tickets rows and the Lanes count agree, with and without a place', () => {
  const doc = fixture();
  const readiness = openEpicReadiness(doc);
  const byEpic = Object.fromEntries(readiness.map(r => [r.id, r]));
  const rows = ticketRows(doc, config, byEpic, {});
  for (const place of [null, new Set(['E2']), new Set(['E1'])]) {
    const test_ = scopeTest(doc, place);
    const over = overviewModel(doc, config, new Map(readiness.map(r => [r.id, r])), null, Date.parse('2026-03-10T12:00:00Z'), { epicIds: place }).needsYou;
    const flagged = filterRows(rows, { place, showDone: true }).filter(r => r.needsYou).length;
    const chip = countByState(filterRows(rows, { place, showDone: true }))['needs you'];
    const lanes = needsYou(doc, test_).count;
    assert.equal(over.count, lanes);
    assert.equal(flagged, lanes);
    assert.equal(chip, lanes);
    assert.equal(over.decisions + over.reviews, over.count);
  }
  assert.equal(needsYou(doc).count, 7);
});

test('Overview lists a ticket counted only for its checks to tick', () => {
  const doc = fixture();
  const m = overviewModel(doc, config, new Map(), null, Date.parse('2026-03-10T12:00:00Z'), { rows: 50 }).needsYou;
  assert.ok(m.items.some(i => i.id === 'C1' && /1 of 1 check to do/.test(i.line)));
});

test('the exclusive state is unchanged: a flagged running ticket still counts as running', () => {
  const doc = fixture();
  const readiness = Object.fromEntries(openEpicReadiness(doc).map(r => [r.id, r]));
  const rows = ticketRows(doc, config, readiness, { A1: { state: 'working' } });
  const a1 = rows.find(r => r.id === 'A1');
  assert.equal(a1.state, 'running');
  assert.equal(a1.needsYou, true);
  assert.equal(countByState(rows).running, 1);
});

test('PRO131: the Needs you chip and its filtered list equal the count when flagged tickets are running or in review', () => {
  // The 36-vs-38 drift: tickets that need you but whose one state is running / in review were dropped by the
  // exclusive state filter. Every call site must agree on the same fixture, with live work in the mix.
  const doc = fixture();
  const readiness = Object.fromEntries(openEpicReadiness(doc).map(r => [r.id, r]));
  const rows = ticketRows(doc, config, readiness, { A1: { state: 'working' }, Q1: { state: 'waiting on CI' } });
  const total = needsYou(doc).count;
  assert.equal(total, 7);
  assert.equal(rows.find(r => r.id === 'R1').state, 'in review');
  const only = filterRows(rows, { states: new Set(['needs you']), showDone: false });
  assert.equal(only.length, total);
  assert.deepEqual(only.map(r => r.id).sort(), [...needsYou(doc).ids].sort());
  assert.equal(countByState(filterRows(rows, { showDone: true }))['needs you'], total);
});

test('PRO134: the Lanes nav and the strip make the same call: a precomputed plan and none give the same count, per scope', async () => {
  const { computeRunPlan } = await import('../../shared/run-plan.js');
  const doc = fixture();
  for (const place of [null, new Set(['E2']), new Set(['E1'])]) {
    const keep = scopeTest(doc, place);
    assert.equal(needsYou(doc, keep, { plan: computeRunPlan(doc) }).count, needsYou(doc, keep).count);
  }
});
