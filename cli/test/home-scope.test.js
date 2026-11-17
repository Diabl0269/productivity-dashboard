/**
 * PRO127: one scope rule for every Home view (shared/home-scope.js), and the running numbers that follow it:
 * the running answer, Overview's running count and health card, and How it runs' "Being built" count.
 * Synthetic bakery data; before this, Overview's Needs you counted every project while Running counted one,
 * the fallback area pulled other projects into a place, and "running" counted idle work in some views only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHomeConfig } from '../../shared/home-config.js';
import { epicIdsForBox } from '../../shared/home-areas.js';
import { projectScope, narrowTo } from '../../shared/home-scope.js';
import { computeRunning } from '../../shared/running.js';
import { overviewModel } from '../../shared/home-overview.js';
import { lifecycleSnapshot } from '../../shared/lifecycle.js';

const NOW = Date.parse('2026-03-10T12:00:00Z');
const { config } = normalizeHomeConfig({
  version: 1,
  groups: [
    { id: 'shop', name: 'Shop floor', areas: [{ id: 'counter', name: 'Counter', lanes: ['counter'] }] },
    { id: 'office', name: 'Office', areas: [{ id: 'books', name: 'Books', lanes: ['books'] }, { id: 'other', name: 'Other' }] },
  ],
  fallback: 'other',
});

function doc() {
  return {
    meta: { projects: [{ id: 'bakery' }, { id: 'bakery-site', parentId: 'bakery' }, { id: 'garden' }] },
    sections: [
      { id: 'todo', tasks: [
        { id: 'E1', type: 'epic', title: 'New till', lane: 'counter', project: 'bakery' },
        { id: 'T1', type: 'task', title: 'Till drawer', parentId: 'E1', project: 'bakery' },
        { id: 'E2', type: 'epic', title: 'Web menu', project: 'bakery-site' },
        { id: 'T2', type: 'task', title: 'Menu font', parentId: 'E2', project: 'bakery-site',
          asks: [{ n: 1, state: 'open', text: 'Serif?', at: '2026-03-08T09:00:00Z' }] },
        { id: 'E3', type: 'epic', title: 'Ledger', lane: 'books', project: 'garden' },
        { id: 'E4', type: 'epic', title: 'Seed order', project: 'garden' },
        { id: 'T4', type: 'task', title: 'Pick seeds', parentId: 'E4', project: 'garden',
          asks: [{ n: 1, state: 'open', text: 'Tomatoes?', at: '2026-03-08T09:00:00Z' }] },
        { id: 'L1', type: 'task', title: 'Loose bakery chore', project: 'bakery' },
        { id: 'L2', type: 'task', title: 'Loose garden chore', project: 'garden' },
      ] },
    ],
  };
}

test('projectScope: the family, epics the map claims by lane, and the family\'s loose tickets', () => {
  const s = projectScope(config, doc(), 'bakery');
  assert.deepEqual([...s.epics].sort(), ['E1', 'E2', 'E3']); // E3 is another project's, but the Books area claims its lane
  assert.ok(s.hasId('T1') && s.hasId('T2') && s.hasId('L1'));
  assert.ok(!s.hasId('E4') && !s.hasId('T4') && !s.hasId('L2')); // garden epic only the fallback would take: not ours
  assert.equal(projectScope(config, doc(), null), null);
  // without a config only the family counts
  assert.deepEqual([...projectScope(null, doc(), 'bakery').epics].sort(), ['E1', 'E2']);
});

test('narrowTo: the fallback area keeps only the project\'s epics', () => {
  const d = doc();
  const box = epicIdsForBox(config, d, 'other');
  assert.ok(box.has('E4')); // the raw rule: the fallback takes every unclaimed epic of any project
  assert.deepEqual([...narrowTo(box, projectScope(config, d, 'bakery'))], ['E2']);
  assert.equal(narrowTo(null, null), null);
});

test('computeRunning with a scope counts the same tickets as the Home page', () => {
  const d = doc();
  const inputs = { now: NOW, sessions: [{ mtime: NOW, ticketIds: ['T1', 'T4', 'E3'] }], branches: [], autorun: null, prs: {} };
  const famOnly = computeRunning(d, inputs, { project: 'bakery' }).running.map(i => i.id).sort();
  const scoped = computeRunning(d, inputs, { project: 'bakery', scope: projectScope(config, d, 'bakery') }).running.map(i => i.id).sort();
  assert.deepEqual(famOnly, ['T1']);
  assert.deepEqual(scoped, ['E3', 'T1']); // E3 sits on this map (Books), as the map shows it
});

test('Overview: Needs you, running and the sentence use the project scope; idle work is not "running"', () => {
  const d = doc();
  const s = projectScope(config, d, 'bakery');
  const running = { running: [
    { id: 'T1', state: 'working', epicId: 'E1', sources: ['session'] },
    { id: 'E3', state: 'idle', epicId: 'E3', sources: ['worktree'] },
  ], epics: {} };
  const m = overviewModel(d, config, new Map(), running, NOW, { epicIds: s.ids, projectIds: s.ids });
  assert.deepEqual(m.needsYou.items.map(i => i.id), ['T2']); // T4's question belongs to another project
  assert.equal(m.running.count, 1);
  assert.equal(m.running.idle, 1);
  assert.equal(m.running.items.length, 2); // idle work is still listed
  assert.match(m.summary.text, /1 thing needs you\. 1 running/);
  assert.equal(m.place, null); // no place picked: no "In X:" prefix even though a set narrows the cards
});

test('Overview health: unknown and checking are not problems; services read "down" like the strip', () => {
  const h = overviewModel(doc(), config, new Map(), null, NOW, {
    health: { automations: { ok: 2, unknown: 18, checking: 1, late: 1 }, services: { ok: 1, unknown: 14, failed: 1, late: 1 } },
  }).health;
  assert.deepEqual(h.lines.map(l => l.text), ['1 automation late', '2 services down']);
});

test('How it runs: "Being built" counts live work only and names idle work in its line', () => {
  const live = { running: [{ id: 'T1', state: 'working' }, { id: 'E3', state: 'idle' }] };
  const snap = lifecycleSnapshot(doc(), live, { now: NOW });
  assert.equal(snap.running.count, 1);
  assert.equal(snap.running.items.length, 2);
  // a loose ticket named by the project scope counts inside it
  const s = projectScope(config, doc(), 'bakery');
  const loose = lifecycleSnapshot(doc(), { running: [{ id: 'L1', state: 'working' }, { id: 'L2', state: 'working' }] }, { epicIds: s.ids, now: NOW });
  assert.deepEqual(loose.running.items.map(i => i.id), ['L1']);
});

test('a title word claims another project\'s epic only when its group lists keywordProjects (PRO127)', () => {
  const d = doc();
  const words = (keywordProjects) => normalizeHomeConfig({
    version: 1,
    groups: [{ id: 'shop', name: 'Shop', ...(keywordProjects ? { keywordProjects } : {}), areas: [{ id: 'seeds', name: 'Seeds', match: 'seed' }, { id: 'rest', name: 'Rest' }] }],
    fallback: 'rest',
  }).config;
  assert.ok(!projectScope(words(null), d, 'bakery').epics.has('E4')); // "Seed order" is garden's: a loose word does not take it
  assert.ok(projectScope(words(['garden']), d, 'bakery').epics.has('E4')); // the group says garden's titles are fair game
});

test('Overview open notes: a free note of another project stays out (PRO127)', () => {
  const d = doc();
  d.meta.freeNotes = [
    { n: 1, state: 'new', kind: 'fix', text: 'Crumbs on the till', project: 'bakery', at: '2026-03-09T09:00:00Z' },
    { n: 2, state: 'new', kind: 'idea', text: 'Plant basil', project: 'garden', at: '2026-03-09T10:00:00Z' },
  ];
  const s = projectScope(config, d, 'bakery');
  const m = overviewModel(d, config, new Map(), null, NOW, { epicIds: s.ids, projectIds: s.ids, noteProjects: s.family });
  assert.deepEqual(m.notes.items.map(i => i.title), ['Crumbs on the till']);
});
