/**
 * cli/test/plan-later.test.js
 * PRO82: every open epic shows on the Plan page exactly once; backlog, "later" and not-ready epics fold
 * into their lane's Later group with one plain reason line; Auto never picks them. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRunPlan, UNASSIGNED_LANE } from '../../shared/run-plan.js';
import { openEpicReadiness, plainReasonLine } from '../../shared/epic-ready.js';
import { autoQueue } from '../../shared/auto-queue.js';
import { computeNextStart } from '../../shared/next-start.js';
import { textWithIdButtons } from '../../dashboard/js/run-plan-reason-text.js';

const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look at it\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, lane: 'mixer', description: '', labels: ['model:sonnet'], ...extra });
const mk = bySection => ({ version: 1, meta: {}, sections: Object.entries(bySection).map(([id, tasks]) => ({ id, name: id, tasks })) });

function fixture() {
  return mk({
    todo: [
      epic('E1'), task('T1', { parentId: 'E1' }),                                       // ready
      epic('E2', { labels: ['model:sonnet', 'auto'] }), task('T2', { parentId: 'E2', description: 'no plain words' }), // not ready: no check
      epic('E3', { title: 'Mixer: later' }), task('T3', { parentId: 'E3' }),            // later bucket
      epic('E4'),                                                                        // only backlog children (below)
      epic('E5', { lane: undefined, labels: ['auto'] }), task('T5', { parentId: 'E5', blockedBy: ['T1'] }), // no lane, waits
    ],
    'in-progress': [epic('E6', { lane: 'canvas' }), task('T6', { parentId: 'E6' })],
    backlog: [
      epic('E7', { lane: 'canvas', labels: ['auto'] }), task('T7', { parentId: 'E7' }),
      task('T4', { parentId: 'E4' }), task('T4b', { parentId: 'E4' }),
    ],
    done: [epic('E8'), task('T8', { parentId: 'E8', checked: true })],
  });
}

test('every open epic renders in exactly one place across lanes', () => {
  const doc = fixture();
  const plan = computeRunPlan(doc);
  const open = openEpicReadiness(doc).map(r => r.id).sort();
  const where = new Map();
  const seen = (id, spot) => where.set(id, [...(where.get(id) || []), spot]);
  for (const l of plan.lanes) {
    for (const c of l.now) if (!c.ticketIds) seen(c.id, `${l.lane}/now`);
    for (const c of l.laterEpics) seen(c.id, `${l.lane}/laterEpics`);
    // cards in lane.later are live epics already shown in `now` or alone; count each epic once
    for (const c of l.later) if (!l.now.some(n => n.id === c.id)) seen(c.id, `${l.lane}/later`);
  }
  assert.deepEqual([...where.keys()].sort(), open);
  for (const [id, spots] of where) assert.equal(spots.length, 1, `${id} shown in ${spots.join(', ')}`);
  assert.ok(!where.has('E8'), 'done epics stay off the lanes');
});

test('Later epics land in their lane, no-lane ones under No lane yet; not ready ones carry one reason line', () => {
  const plan = computeRunPlan(fixture());
  const laterOf = lane => (plan.lanes.find(l => l.lane === lane)?.laterEpics || []).map(c => c.id).sort();
  assert.deepEqual(laterOf('mixer'), ['E2', 'E3', 'E4']);
  assert.deepEqual(laterOf('canvas'), ['E7']);
  assert.deepEqual(laterOf(UNASSIGNED_LANE), ['E5']);
  assert.equal(plan.lanes.find(l => l.lane === UNASSIGNED_LANE).name, 'No lane yet');
  for (const l of plan.lanes) for (const c of l.laterEpics) {
    assert.ok(c.why && !c.why.includes('\n') && c.why.length < 120, `${c.id}: ${c.why}`);
    assert.ok(['notready', 'backlog'].includes(c.state));
  }
  const byId = Object.fromEntries(plan.lanes.flatMap(l => l.laterEpics).map(c => [c.id, c]));
  assert.equal(byId.E7.state, 'backlog');
  assert.match(byId.E3.why, /^Ideas waiting for your go/);
  assert.match(byId.E4.why, /^Not ready: its only tickets, .*T4.* are in backlog/);
});

test('Ready epics look as before: in now, not in laterEpics', () => {
  const plan = computeRunPlan(fixture());
  const mixer = plan.lanes.find(l => l.lane === 'mixer');
  assert.ok(mixer.now.some(c => c.id === 'E1' && c.state === 'ready'));
  assert.ok(!mixer.laterEpics.some(c => c.id === 'E1'));
});

test('Later epics are never started: not in now, not Ready, not picked by next-start or the queue', () => {
  const doc = fixture();
  const plan = computeRunPlan(doc);
  const laterIds = new Set(plan.lanes.flatMap(l => l.laterEpics.map(c => c.id)));
  for (const l of plan.lanes) for (const c of l.now) assert.ok(!laterIds.has(c.id), `${c.id} in now`);
  for (const r of plan.readiness) if (laterIds.has(r.id)) assert.equal(r.ready, false);
  // E2, E5, E7 carry Auto but sit in Later: next-start must not pick them (only the Ready Auto epic would run).
  const out = computeNextStart({ doc, liveEpics: [], now: Date.parse('2026-11-12T10:00:00Z'), lastTickMs: Date.parse('2026-11-12T09:50:00Z'), tickMin: 30 });
  assert.ok(!out.next || !laterIds.has(out.next.epic), JSON.stringify(out.next));
  // Even when they are the only Auto epics.
  doc.sections[0].tasks.find(t => t.id === 'E1').labels = ['model:sonnet'];
  const only = computeNextStart({ doc, liveEpics: [], now: Date.parse('2026-11-12T10:00:00Z'), lastTickMs: Date.parse('2026-11-12T09:50:00Z'), tickMin: 30 });
  assert.equal(only.next, null);
  assert.ok(autoQueue(plan.readiness).filter(r => r.ready).every(r => !laterIds.has(r.id)));
});

test('plainReasonLine: one plain sentence per reason kind', () => {
  const line = (reasons, extra = {}) => plainReasonLine({ ready: false, reasons, ...extra });
  assert.equal(plainReasonLine({ ready: true, reasons: [] }), '');
  assert.equal(line(['in backlog']), 'Ideas waiting for your go: move one to To do to start');
  assert.equal(line(['a later bucket']), 'Ideas waiting for your go: move one to To do to start');
  assert.equal(line(['waits on FRO1507 in backlog'], { parked: ['FRO1507'] }), 'Not ready: its only ticket, FRO1507, is in backlog; move it to To do');
  assert.match(line(['waits on A1, A2 in backlog'], { parked: ['A1', 'A2'] }), /only tickets, A1 and A2, are in backlog/);
  assert.equal(line(['waits on your pick P1']), 'Waits for your design pick on P1');
  assert.equal(line(['waits on your co-task C1']), 'Waits for your co-task C1');
  assert.equal(line(['waits on E9, E10']), 'Waits on E9 and E10 to finish');
  assert.match(line(['marked blocked']), /^Marked blocked/);
  assert.equal(line(['T2 has no How to check it']), "T2 needs a 'How to check it' line (in its In plain words section)");
  assert.match(line(['nothing open to run']), /^Nothing open to run/);
  assert.match(line(['no ticket is free to run']), /^No ticket is free to run/);
  assert.match(line(['every open ticket is held for your go-ahead']), /^Every open ticket waits for your go-ahead/);
});

// PRO85: a ticket named in a reason is a button; PRO84: the page proves it lists every open epic.
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._text = ''; }
  appendChild(c) { this.children.push(c); return c; }
  set textContent(t) { this._text = t; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
}
const fakeDocument = { createElement: t => new FakeNode(t), createTextNode: t => Object.assign(new FakeNode('#text'), { _text: t }) };

test('ticket ids inside a reason line are buttons; the rest stays text', () => {
  globalThis.document = fakeDocument;
  try {
    const mkBtn = id => Object.assign(new FakeNode('button'), { _text: id, isId: true });
    const node = textWithIdButtons("T1 needs a 'How to check it' line, T10 too", ['T1', 'T10'], mkBtn);
    const buttons = node.children.filter(c => c.isId).map(c => c.textContent);
    assert.deepEqual(buttons, ['T1', 'T10']);
    assert.equal(node.textContent, "T1 needs a 'How to check it' line, T10 too");
  } finally { delete globalThis.document; }
});

test('cards carry structured reasons with the blocking ticket ids', () => {
  const plan = computeRunPlan(fixture());
  const e2 = plan.lanes.flatMap(l => l.laterEpics).find(c => c.id === 'E2');
  assert.deepEqual(e2.reasons.map(r => [r.kind, r.ids]), [['no-check', ['T2']]]);
  assert.equal(e2.why, "T2 needs a 'How to check it' line (in its In plain words section)");
  const e4 = plan.lanes.flatMap(l => l.laterEpics).find(c => c.id === 'E4');
  assert.deepEqual(e4.promoteIds, ['T4', 'T4b']);
  const e3 = plan.lanes.flatMap(l => l.laterEpics).find(c => c.id === 'E3');
  assert.deepEqual(e3.promoteIds, [], 'a later bucket is never promoted');
});

