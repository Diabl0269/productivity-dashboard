/**
 * shared/home-overview.js (PRO129): the Home Overview's sections as plain data, from a synthetic bakery doc.
 * Each section, its empty state, the place filter, the sentence on top and the 7-day window's edges.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';
import { openEpicReadiness } from '../../shared/epic-ready.js';
import { computeNextStart } from '../../shared/next-start.js';
import { epicIdsForBox } from '../../shared/home-areas.js';
import { overviewModel, summaryOf, closedAtMs, FINISHED_DAYS } from '../../shared/home-overview.js';

const NOW = Date.parse('2026-03-10T12:00:00Z');
const DAY = 86400e3;
const iso = ms => new Date(ms).toISOString();
const HOW = '## In plain words\n**How to check it:** open the page and look.';

const { config } = normalizeHomeConfig({
  version: 1,
  groups: [
    { id: 'shop', name: 'Shop floor', areas: [{ id: 'counter', name: 'Counter', lanes: ['counter'] }, { id: 'web', name: 'Website', lanes: ['web'] }] },
    { id: 'kitchen', name: 'Kitchen', areas: [{ id: 'oven', name: 'Oven', lanes: ['oven'] }] },
  ],
});

function bakery() {
  return {
    meta: { dailyPlan: { date: '2026-03-10', taskIds: ['E3'], carriedIds: [] } },
    sections: [
      { id: 'todo', tasks: [
        { id: 'E1', type: 'epic', title: 'New till', lane: 'counter', labels: ['auto'] },
        { id: 'T1', type: 'task', title: 'Till drawer', parentId: 'E1', description: HOW },
        { id: 'E2', type: 'epic', title: 'Oven timer', lane: 'oven' },
        { id: 'T2', type: 'task', title: 'Timer knob', parentId: 'E2', description: HOW,
          asks: [{ n: 1, state: 'open', text: 'Round or square knob?', at: '2026-03-08T09:00:00Z' }] },
        { id: 'E3', type: 'epic', title: 'Menu page', lane: 'web', blocked: true },
        { id: 'T3', type: 'task', title: 'Allergen list', parentId: 'E3', description: HOW,
          reviewNotes: [{ n: 1, at: '2026-03-09T10:00:00Z', text: 'Bigger font', kind: 'fix', state: 'new' },
            { n: 2, at: '2026-03-09T11:00:00Z', text: 'Add gluten', kind: 'idea', state: 'new' },
            { n: 3, at: '2026-03-09T12:00:00Z', text: 'old', kind: 'fix', state: 'filed' }] },
      ] },
      { id: 'in-progress', tasks: [] },
      { id: 'review', tasks: [
        { id: 'T4', type: 'task', title: 'Receipt printer', parentId: 'E1',
          checks: [{ text: 'prints', checked: false }, { text: 'cuts', checked: true }],
          result: { at: iso(NOW - 2 * DAY), shipped: ['Receipts print with the logo'], ci: 'all passed' } },
      ] },
      { id: 'done', tasks: [
        { id: 'E9', type: 'epic', title: 'Bread shelf', lane: 'counter', history: [{ event: 'moved', to: 'done', at: iso(NOW - DAY) }] },
        { id: 'T9', type: 'task', title: 'Shelf labels', parentId: 'E9', checked: true, history: [{ event: 'moved', to: 'done', at: iso(NOW - 3 * DAY) }] },
        { id: 'T8', type: 'task', title: 'Old oven fix', parentId: 'E2', checked: true, history: [{ event: 'moved', to: 'done', at: iso(NOW - 10 * DAY) }] },
      ] },
    ],
  };
}

const running = {
  running: [{ id: 'T1', title: 'Till drawer', state: 'working', since: iso(NOW - 3600e3), sources: ['session'], epicId: 'E1' }],
  epics: { E1: { state: 'running' } },
};

function model(doc = bakery(), extras = {}, run = running) {
  const readiness = new Map(openEpicReadiness(doc).map(r => [r.id, r]));
  const nextStart = computeNextStart({ doc, now: NOW, lastTickMs: NOW - 10 * 60e3, tickMin: 30 });
  return overviewModel(doc, config, readiness, run, NOW, { nextStart, ...extras });
}

test('Needs you: reviews, questions and readings, oldest first, each a link', () => {
  const n = model().needsYou;
  assert.equal(n.count, 2);
  assert.equal(n.decisions, 1); // the question; the review is the other one
  assert.equal(n.reviews, 1);
  // the question (asked 09:00) waits longer than the review (shipped 12:00 the same day)
  assert.deepEqual(n.items.map(i => [i.kind, i.id]), [['question', 'T2'], ['review', 'T4']]);
  assert.equal(n.items[1].line, '1 of 2 checks to do');
  assert.equal(n.items[0].line, 'Round or square knob?');
  assert.deepEqual(n.items[0].target, { view: 'lanes', ticket: 'T2' });
});

test('Running now: the running answer, with counts per state', () => {
  const r = model().running;
  assert.equal(r.count, 1);
  assert.deepEqual(r.counts, { working: 1 });
  assert.equal(r.items[0].line, 'session');
  assert.equal(model(bakery(), {}, null).running.known, false);
});

test('On the agenda: next start first, then Ready epics, then pins', () => {
  const a = model().agenda;
  assert.equal(a.next.id, 'E1'); // computeNextStart's own answer (it was given no live runs)
  assert.equal(a.ready, 2);
  assert.ok(!a.items.some(i => i.id === 'E1')); // shown once, as the next start
  assert.ok(a.items.some(i => i.kind === 'pinned' && i.id === 'E3' && i.line === '0 of 1 done'));
});

test('On the agenda: the next-start row says when, and a Ready epic says why it is next', () => {
  const a = model(bakery(), {}, { running: [], epics: {} }).agenda;
  assert.equal(a.next.id, 'E1');
  assert.match(a.next.line, /^Starts (today|tomorrow|\w{3}) \d\d:\d\d$/);
  const e2 = a.items.find(i => i.id === 'E2');
  assert.equal(e2.line, 'Ready; starts when you run it (Auto is off)');
});

test('Finished lately: epics closed in 7 days, newest first, grouped by day', () => {
  const f = model().finished;
  assert.equal(f.epics, 1);
  assert.equal(f.tickets, 2); // T4 (shipped into review) and T9; T8 closed 10 days ago
  assert.equal(f.rowsAre, 'epics');
  assert.deepEqual(f.items.map(i => i.id), ['E9']);
  assert.equal(f.days[0].label, 'Yesterday');
  assert.equal(f.items[0].line, '1 ticket done');
});

test('Finished lately: tickets show when no epic closed, with what shipped', () => {
  const doc = bakery();
  doc.sections.find(s => s.id === 'done').tasks.shift();
  const f = model(doc).finished;
  assert.equal(f.rowsAre, 'tickets');
  assert.deepEqual(f.items.map(i => i.id), ['T4', 'T9']);
  assert.equal(f.items[0].line, 'Receipts print with the logo');
});

test('the 7-day window: exactly 7 days ago is in, a minute more is out, the future is out', () => {
  const at = ms => ({ id: 'X', type: 'task', title: 'x', history: [{ event: 'moved', to: 'done', at: iso(ms) }] });
  const one = ms => { const d = bakery(); d.sections.find(s => s.id === 'done').tasks = [at(ms)]; d.sections.find(s => s.id === 'review').tasks = []; return model(d).finished.count; };
  assert.equal(one(NOW - FINISHED_DAYS * DAY), 1);
  assert.equal(one(NOW - FINISHED_DAYS * DAY - 60e3), 0);
  assert.equal(one(NOW + 60e3), 0);
  assert.equal(one(NOW), 1);
});

test('closedAtMs: the last move into review or done, else the result time, else unknown', () => {
  assert.equal(closedAtMs({ history: [{ to: 'review', at: '2026-03-01T00:00:00Z' }, { to: 'done', at: '2026-03-02T00:00:00Z' }, { to: 'archive', at: '2026-03-05T00:00:00Z' }] }), Date.parse('2026-03-02T00:00:00Z'));
  assert.equal(closedAtMs({ result: { at: '2026-03-03T00:00:00Z' } }), Date.parse('2026-03-03T00:00:00Z'));
  assert.equal(closedAtMs({ updated: '2026-03-04' }), null);
});

test('Where the work is: open epics per area, running dots, selected place', () => {
  const p = model(bakery(), { where: { group: 'shop', area: 'counter', part: null }, epicIds: epicIdsForBox(config, bakery(), 'counter') }).places;
  const counter = p.groups[0].areas[0];
  assert.deepEqual([counter.open, counter.running, counter.selected], [1, 1, true]); // E9 is closed: not counted
  assert.equal(p.groups[1].areas[0].open, 1);
  assert.deepEqual(counter.target, { view: 'map', where: 'counter' });
  assert.equal(p.max, 1);
  assert.deepEqual(model(bakery()).places.groups.length, 2);
});

test('Open notes: unfiled notes only, newest two first, the note first and its ticket under it', () => {
  const n = model().notes;
  assert.equal(n.count, 2);
  assert.deepEqual(n.items.map(i => i.title), ['Add gluten', 'Bigger font']);
  assert.deepEqual(n.items.map(i => i.line), ['Allergen list', 'Allergen list']);
  assert.deepEqual(n.items[0].target, { ticket: 'T3' });
});

test('Open notes: a free note says so, opens the Notes tab and follows its own place', () => {
  const doc = bakery();
  doc.meta.freeNotes = [{ n: 1, at: '2026-03-09T13:00:00Z', text: 'Oven door squeaks', kind: 'fix', state: 'new', area: 'oven', where: 'oven' },
    { n: 2, at: '2026-03-09T09:00:00Z', text: 'gone', kind: 'fix', state: 'filed' }];
  const n = model(doc).notes;
  assert.deepEqual([n.count, n.tickets, n.free], [3, 1, 1]);
  assert.deepEqual([n.items[0].kind, n.items[0].title, n.items[0].line], ['free-note', 'Oven door squeaks', 'free note']);
  assert.deepEqual(n.items[0].target, { inspector: 'notes' });
  const kitchen = { epicIds: epicIdsForBox(config, doc, 'kitchen'), where: { group: 'kitchen' } };
  assert.equal(model(doc, { ...kitchen, noteScope: { ids: new Set(['kitchen', 'oven']), lanes: new Set(['oven']) } }).notes.count, 1);
  assert.equal(model(doc, { ...kitchen, noteScope: { ids: new Set(['shop']), lanes: new Set(['web']) } }).notes.count, 0);
});

test('Needs you: a "Co-task:" prefix is dropped (the card already says it waits on you)', () => {
  const doc = bakery();
  doc.sections[0].tasks.find(t => t.id === 'T2').title = 'Co-task: Timer knob';
  assert.equal(model(doc).needsYou.items.find(i => i.id === 'T2').title, 'Timer knob');
});

test('Health: only what is wrong, linked to How it runs', () => {
  assert.deepEqual(model().health.lines, []);
  const h = model(bakery(), { health: { automations: { ok: 3, late: 2, failed: 0 }, services: { ok: 1, down: 1 }, problems: ['Backup missed'] } }).health;
  assert.deepEqual(h.lines.map(l => l.text), ['2 automations late', '1 service down', 'Backup missed']);
  assert.equal(h.lines[0].target.view, 'how-it-runs');
});

test('the place filter narrows every section to the selected place', () => {
  const doc = bakery();
  const m = model(doc, { epicIds: epicIdsForBox(config, doc, 'kitchen'), placeName: 'Kitchen', where: { group: 'kitchen' } });
  assert.deepEqual(m.needsYou.items.map(i => i.id), ['T2']);
  assert.equal(m.running.count, 0);
  assert.equal(m.agenda.ready, 1);
  assert.equal(m.finished.count, 0); // T8 is in the kitchen but 10 days old
  assert.equal(m.notes.count, 0);
  assert.equal(m.places.groups[1].selected, true);
  assert.match(m.summary.text, /^In Kitchen: 1 thing needs you\. 0 running, 1 ready\./);
});

test('an empty doc gives empty sections and a calm sentence', () => {
  const m = overviewModel({ sections: [] }, null, new Map(), null, NOW, {});
  assert.equal(m.needsYou.count, 0);
  assert.equal(m.running.count, 0);
  assert.equal(m.agenda.ready, 0);
  assert.equal(m.agenda.next, null);
  assert.equal(m.finished.count, 0);
  assert.equal(m.notes.count, 0);
  assert.deepEqual(m.places.groups, []);
  assert.equal(m.summary.text, 'Nothing needs you. 0 running, 0 ready.');
});

test('the sentence: numbers as their own segments, and every kind of next start', () => {
  const s = summaryOf({ needs: 3, running: 5, ready: 12, next: { kind: 'next', id: 'E1', when: 'today 14:30', atKind: 'tick' } });
  assert.equal(s.text, '3 things need you. 5 running, 12 ready. Next start today 14:30.');
  assert.deepEqual(s.segments.filter(x => typeof x === 'number'), [3, 5, 12]);
  assert.equal(summaryOf({ needs: 1, running: 0, ready: 0, next: { kind: 'next', id: 'E1', atKind: 'slot' } }).text,
    '1 thing needs you. 0 running, 0 ready. Next start when a run slot frees.');
  assert.equal(summaryOf({ needs: 0, running: 0, ready: 0, next: { kind: 'next', id: null, title: 'Autorun is paused' } }).text,
    'Nothing needs you. 0 running, 0 ready. Autorun is paused.');
  assert.equal(summaryOf({ needs: 0, running: 1, ready: 2, next: { kind: 'next', id: 'E1', when: 'Tue 11:00', atKind: 'reset' } }).text,
    'Nothing needs you. 1 running, 2 ready. Next start about Tue 11:00.');
});

test('rows: at most four per card, the rest counted as more', () => {
  const doc = bakery();
  const todo = doc.sections.find(s => s.id === 'todo').tasks;
  for (let i = 0; i < 7; i++) todo.push({ id: `Q${i}`, type: 'task', title: `Q${i}`, asks: [{ n: 1, state: 'open', text: `Question ${i}?`, at: `2026-03-0${i + 1}T00:00:00Z` }] });
  const n = model(doc).needsYou;
  assert.equal(n.items.length, 4);
  assert.equal(n.more, n.count - 4);
});

test('Running now (AGE200): sessions first, idle epics say why and carry their button data', () => {
  const run = {
    running: [{ id: 'T1', title: 'Till drawer', state: 'working', since: iso(NOW - 3600e3), sources: ['session'], epicId: 'E1' },
      { id: 'T2', title: 'Timer knob', state: 'idle', sources: ['worktree'], epicId: 'E2', idleWhy: 'Idle: only a worktree names it' }],
    epics: { E1: { state: 'running' }, E2: { state: 'idle', idleWhy: 'Idle: waits on E1 to finish', promoteIds: ['T2'], ready: false, auto: false } },
    sessions: [{ id: 's1', ticketIds: ['T1'] }, { id: 's2', ticketIds: [] }],
  };
  const r = model(bakery(), {}, run).running;
  assert.equal(r.sessions, 2, 'every live session, not one per ticket');
  assert.equal(r.tickets, 1);
  assert.equal(r.items.find(i => i.id === 'T2').line, 'Idle: only a worktree names it');
  const quiet = r.items.find(i => i.id === 'E2');
  assert.equal(quiet.line, 'Idle: waits on E1 to finish');
  assert.deepEqual(quiet.epicState.promoteIds, ['T2']);
});
