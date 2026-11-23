/**
 * shared/lifecycle.js (PRO122): each stage's count and rows from a synthetic doc, the selected-place scope,
 * the running data being unknown, config relabels / hides, and the arrows between the shown stages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STAGES, LIFECYCLE_STAGE_IDS, applyLifecycleConfig, lifecycleEdges, lifecycleSnapshot, waitingSessionIds,
} from '../../shared/lifecycle.js';
import { countUnsentNotes } from '../../shared/review-notes.js';
import { openEpicReadiness } from '../../shared/epic-ready.js';

const NOW = Date.parse('2026-06-15T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400e3).toISOString();

function doc() {
  return {
    meta: {},
    sections: [
      { id: 'todo', tasks: [
        { id: 'BKR1', type: 'epic', title: 'Oven epic', lane: 'baking', labels: ['auto'], description: '## In plain words\nx', checks: [] },
        { id: 'BKR2', title: 'Fix the proofing timer', parentId: 'BKR1', created: daysAgo(2).slice(0, 10), labels: ['model:sonnet'] },
        { id: 'BKR3', type: 'epic', title: 'Till epic', lane: 'counter', description: '## In plain words\nx' },
        { id: 'BKR4', title: 'Receipt font', parentId: 'BKR3', created: daysAgo(20).slice(0, 10), labels: ['model:sonnet'] },
      ] },
      { id: 'in-progress', tasks: [
        { id: 'BKR5', title: 'Steam valve', parentId: 'BKR1', asks: [{ n: 1, at: daysAgo(1), text: 'Which valve brand should we buy?', state: 'open' }] },
      ] },
      { id: 'review', tasks: [
        { id: 'BKR6', title: 'Deck oven heat map', parentId: 'BKR1', checks: [{ text: 'open it', checked: true }, { text: 'heat it', checked: false }],
          reviewNotes: [
            { n: 1, at: daysAgo(1), text: 'The map is too small', kind: 'fix', state: 'new' },
            { n: 2, at: daysAgo(3), text: 'Proofing timer is off', kind: 'fix', state: 'filed', filed: 'BKR2' },
            { n: 3, at: daysAgo(30), text: 'Old', kind: 'idea', state: 'filed', filed: 'BKR4' },
          ] },
        { id: 'BKR7', title: 'Till sound', parentId: 'BKR3', checks: [{ text: 'listen', checked: false }],
          reviewNotes: [{ n: 1, at: daysAgo(1), text: 'Too loud', kind: 'fix', state: 'new' }, { n: 2, at: daysAgo(1), text: 'gone', kind: 'fix', state: 'dismissed' }] },
      ] },
      { id: 'done', tasks: [
        { id: 'BKR8', title: 'Flour order', parentId: 'BKR3', checked: true, history: [{ at: daysAgo(2), event: 'moved', from: 'review', to: 'done' }] },
        { id: 'BKR9', title: 'Old thing', parentId: 'BKR3', checked: true, history: [{ at: daysAgo(10), event: 'moved', from: 'review', to: 'done' }] },
        { id: 'BKR10', type: 'epic', title: 'Closed epic', checked: true, history: [{ at: daysAgo(1), event: 'moved', to: 'done' }] },
      ] },
    ],
  };
}

const live = { running: [
  { id: 'BKR5', title: 'Steam valve', state: 'waiting-you' },
  { id: 'BKR4', title: 'Receipt font', state: 'working' },
] };

test('every stage counts from the same source as the rest of the tracker', () => {
  const d = doc();
  const s = lifecycleSnapshot(d, live, { now: NOW });
  assert.deepEqual(Object.keys(s), LIFECYCLE_STAGE_IDS);
  assert.equal(s.note.count, countUnsentNotes(d)); // the same number as `ch tasks notes`
  assert.equal(s.note.count, 2);
  assert.deepEqual(s.note.items.map(i => i.handle), ['BKR6#1', 'BKR7#1']);
  assert.equal(s.note.detail, 'on 2 tickets');
  assert.deepEqual(s.filed.items.map(i => i.id), ['BKR2']); // BKR4 was filed 20 days ago
  assert.equal(s.filed.items[0].from, 'BKR6#2');
  assert.deepEqual(s.running.items.map(i => [i.id, i.state]), [['BKR5', 'waiting-you'], ['BKR4', 'working']]);
  assert.equal(s.running.detail, '1 working · 1 waiting for you');
  assert.equal(s.asks.count, 1);
  assert.equal(s.asks.items[0].question, 'Which valve brand should we buy?');
  assert.deepEqual(s.review.items.map(i => i.id).sort(), ['BKR6', 'BKR7']);
  assert.equal(s.review.detail, '2 with open notes');
  assert.deepEqual(s.done.items.map(i => i.id), ['BKR8']); // not the 10-day-old one, not the epic
  for (const st of DEFAULT_STAGES) {
    assert.equal(st.count(d, live, { now: NOW }), s[st.id].count, st.id);
    assert.ok(st.label && st.what && st.source && ['you', 'session', 'script', 'tracker'].includes(st.who), st.id);
  }
});

test('ready counts Ready epics and says how many are on Auto', () => {
  const d = doc();
  const s = lifecycleSnapshot(d, live, { now: NOW });
  assert.equal(s.ready.count, openEpicReadiness(d).filter(r => r.ready).length);
  assert.deepEqual(s.ready.items.map(r => r.id), openEpicReadiness(d).filter(r => r.ready).map(r => r.id));
  for (const r of s.ready.items) assert.equal(r.type, 'epic');
  assert.equal(s.ready.detail, `${s.ready.items.filter(r => r.auto).length} on Auto`);
});

test('running data unknown: the running count is null, everything else still counts', () => {
  const s = lifecycleSnapshot(doc(), null, { now: NOW });
  assert.equal(s.running.count, null);
  assert.deepEqual(s.running.items, []);
  assert.equal(s.running.detail, 'running data unavailable');
  assert.equal(s.note.count, 2);
});

test('a selected place keeps only work inside its epics', () => {
  const s = lifecycleSnapshot(doc(), live, { now: NOW, epicIds: new Set(['BKR3']) });
  assert.deepEqual(s.note.items.map(i => i.id), ['BKR7']);
  assert.deepEqual(s.running.items.map(i => i.id), ['BKR4']);
  assert.equal(s.asks.count, 0);
  assert.deepEqual(s.review.items.map(i => i.id), ['BKR7']);
  assert.deepEqual(s.done.items.map(i => i.id), ['BKR8']);
  assert.equal(s.filed.count, 0);
  assert.equal(lifecycleSnapshot(doc(), live, { now: NOW, epicIds: new Set() }).note.count, 0);
});

test('a config relabels and hides stages; the arrows join across a hidden one', () => {
  const stages = applyLifecycleConfig(DEFAULT_STAGES, { stages: [{ id: 'filed', hide: true }, { id: 'ready', label: 'Queued' }] });
  assert.deepEqual(stages.map(s => s.id), ['note', 'ready', 'running', 'asks', 'review', 'done']);
  assert.equal(stages.find(s => s.id === 'ready').label, 'Queued');
  assert.equal(DEFAULT_STAGES.find(s => s.id === 'ready').label, 'Ready to start'); // defaults untouched
  const edges = lifecycleEdges(stages);
  assert.deepEqual(edges.filter(e => e.kind === 'flow').map(e => `${e.from}>${e.to}`), ['note>ready', 'ready>running', 'running>review', 'review>done']);
  assert.deepEqual(edges.find(e => e.kind === 'side'), { from: 'running', to: 'asks', kind: 'side', label: 'asks you', travels: 'A question a session cannot answer alone.' });
  assert.equal(edges.find(e => e.kind === 'loop').to, 'note');
  assert.equal(lifecycleEdges(applyLifecycleConfig(DEFAULT_STAGES, { stages: [{ id: 'note', hide: true }] })).some(e => e.kind === 'loop'), false);
  assert.equal(lifecycleEdges(DEFAULT_STAGES).length, 8);
});

test('an empty doc gives zeros, never throws', () => {
  const s = lifecycleSnapshot({ sections: [] }, { running: [] }, { now: NOW });
  for (const id of LIFECYCLE_STAGE_IDS) assert.equal(s[id].count, 0, id);
  assert.equal(lifecycleSnapshot(null, null).note.count, 0);
});

test('AGE199: a stage config carries its job, skill and page links; unknown or empty ones are dropped', () => {
  const stages = applyLifecycleConfig(DEFAULT_STAGES, { stages: [
    { id: 'running', job: 'skill-ship-task', skill: '.claude/skills/ship-task/SKILL.md', page: 'pages/workspace.md' },
    { id: 'ready', label: 'Queued', job: 'autorun', bogus: 'x' },
    { id: 'done', job: '' },
  ] });
  const by = id => stages.find(s => s.id === id);
  assert.equal(by('running').job, 'skill-ship-task');
  assert.equal(by('running').skill, '.claude/skills/ship-task/SKILL.md');
  assert.equal(by('running').page, 'pages/workspace.md');
  assert.equal(by('ready').label, 'Queued');
  assert.equal(by('ready').job, 'autorun');
  assert.equal('bogus' in by('ready'), false);
  assert.equal('job' in by('done'), false);
  assert.equal('job' in by('note'), false);
  assert.equal(typeof by('running').count, 'function'); // still a working stage
});

test('AGE199: every arrow says what travels on it; a "waits on" arrow runs from the questions to the waiting sessions', () => {
  const live = { running: [
    { id: 'BKR5', state: 'waiting-you' }, { id: 'BKR2', state: 'working' }, { id: 'BKR9', state: 'waiting-you' }, { id: 'BKR3', state: 'idle' },
  ] };
  assert.deepEqual(waitingSessionIds(live), ['BKR5', 'BKR9']);
  assert.deepEqual(waitingSessionIds(null), []);
  const edges = lifecycleEdges(DEFAULT_STAGES, live);
  for (const e of edges) assert.ok(e.travels && e.travels.length <= 90, `${e.from}>${e.to} needs one short travels line`);
  const wait = edges.find(e => e.kind === 'wait');
  assert.deepEqual({ from: wait.from, to: wait.to, ids: wait.ids }, { from: 'asks', to: 'running', ids: ['BKR5', 'BKR9'] });
  assert.deepEqual(lifecycleEdges(DEFAULT_STAGES, null).find(e => e.kind === 'wait').ids, []);
  // Without the question step there is no side step and so no way back.
  const noAsks = lifecycleEdges(applyLifecycleConfig(DEFAULT_STAGES, { stages: [{ id: 'asks', hide: true }] }), live);
  assert.equal(noAsks.some(e => e.kind === 'wait' || e.kind === 'side'), false);
});
