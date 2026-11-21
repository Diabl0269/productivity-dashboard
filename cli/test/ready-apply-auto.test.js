/**
 * cli/test/ready-apply-auto.test.js
 * PRO138: `ch tasks update --parent` promotes a backlog ticket under an open epic, `ch tasks ready --apply-auto`
 * promotes parked tickets and adds `auto` to Ready epics (never `no-auto`; --dry-run writes nothing), and the
 * `ready` line names soft blockers. Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CH_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ch');
const PLAIN = '## In plain words\n**What you\'ll notice:** x\n**Why it matters:** y\n**How to check it:** look\n\n## Technical detail (for Claude)\nz';
const task = (id, extra = {}) => ({ id, title: `Task ${id}`, checked: false, priority: 'medium', type: 'task', subtasks: [], description: PLAIN, ...extra });
const epic = (id, extra = {}) => task(id, { type: 'epic', title: `Epic ${id}`, description: '', ...extra });
const mk = by => ({ version: 1, meta: { dailyPlan: { date: '2026-01-01', taskIds: [], carriedIds: [] } }, sections: Object.entries(by).map(([id, tasks]) => ({ id, name: id, tasks })) });
const home = doc => { const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-pro138-')); fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc)); return h; };
const ch = (h, ...a) => { const r = spawnSync(process.execPath, [CH_SCRIPT, ...a], { env: { ...process.env, CH_HOME: h }, encoding: 'utf8' }); return { status: r.status, out: r.stdout, err: r.stderr }; };
const find = (h, id) => { const d = JSON.parse(fs.readFileSync(path.join(h, 'tasks.json'), 'utf8')); for (const s of d.sections) { const t = s.tasks.find(x => x.id === id); if (t) return { t, s: s.id }; } return null; };

test('update --parent: a backlog ticket under an open epic moves to todo; a later bucket or backlog epic does not', () => {
  const h = home(mk({
    todo: [epic('T11'), epic('T15', { title: 'Timeline: later' })],
    backlog: [task('T1'), task('T2'), task('T3'), epic('T12')],
  }));
  const r = ch(h, 'tasks', 'update', 'T1', '--parent', 'T11');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /moved T1 backlog -> todo: its new epic T11 is open/);
  const t1 = find(h, 'T1');
  assert.equal(t1.s, 'todo');
  assert.equal(t1.t.parentId, 'T11');
  assert.ok(t1.t.history.some(e => e.event === 'moved' && e.from === 'backlog' && e.to === 'todo'));
  ch(h, 'tasks', 'update', 'T2', '--parent', 'T15');
  assert.equal(find(h, 'T2').s, 'backlog');
  ch(h, 'tasks', 'update', 'T3', '--parent', 'T12');
  assert.equal(find(h, 'T3').s, 'backlog');
});

const autoDoc = () => mk({
  todo: [
    epic('T11'), epic('T12'), task('T2', { parentId: 'T12' }),
    epic('T13', { labels: ['no-auto'] }), task('T3', { parentId: 'T13' }),
    epic('T14', { title: 'Later work' }),
    epic('T16', { blockedBy: ['T17'] }), task('T5', { parentId: 'T16' }),
    epic('T17'), task('T18', { parentId: 'T17', waitingOn: 'Tal' }),
  ],
  backlog: [task('T1', { parentId: 'T11' }), task('T4', { parentId: 'T14' })],
});

test('ready --apply-auto --dry-run prints the changes and writes nothing', () => {
  const h = home(autoDoc());
  const before = fs.readFileSync(path.join(h, 'tasks.json'), 'utf8');
  const r = ch(h, 'tasks', 'ready', '--apply-auto', '--dry-run');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /dry run: promoted T1 under T11/);
  assert.match(r.out, /dry run: auto added T11/);
  assert.equal(fs.readFileSync(path.join(h, 'tasks.json'), 'utf8'), before);
});

test('ready --apply-auto promotes parked tickets, labels Ready epics, skips no-auto and later buckets', () => {
  const h = home(autoDoc());
  const r = ch(h, 'tasks', 'ready', '--apply-auto');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /promoted T1 under T11/);
  assert.match(r.out, /auto added T11/);
  assert.match(r.out, /auto added T12/);
  assert.match(r.out, /auto added T16/, 'T16 waits only softly on T17');
  assert.doesNotMatch(r.out, /T13/);
  assert.doesNotMatch(r.out, /T14|T4/);
  assert.equal(find(h, 'T1').s, 'todo');
  assert.match(find(h, 'T1').t.notes.at(-1).text, /^Promoted from backlog: parked under open epic T11/);
  assert.equal(find(h, 'T4').s, 'backlog');
  assert.ok(find(h, 'T11').t.labels.includes('auto'));
  assert.ok(!(find(h, 'T13').t.labels || []).includes('auto'));
  assert.ok(!(find(h, 'T14').t.labels || []).includes('auto'));
  // Second run: nothing left to do.
  assert.match(ch(h, 'tasks', 'ready', '--apply-auto').out, /Nothing to promote or label/);
  // The plain list names the soft blocker.
  assert.match(ch(h, 'tasks', 'ready').out, /Runs now: T17 only wait on you/);
});
