/**
 * cli/test/tasks-merge.test.js
 * mergeTasksDocs: the dashboard's edits survive a save conflict with a background `ch` write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTasksDocs } from '../../shared/tasks-merge.js';

const tk = (id, extra = {}) => ({ id, title: `Ticket ${id}`, checked: false, priority: 'medium', ...extra });
const doc = (sections) => ({ version: 1, sections: Object.entries(sections).map(([id, tasks]) => ({ id, name: id, tasks })) });
const clone = (v) => JSON.parse(JSON.stringify(v));
const find = (d, id) => { for (const s of d.sections) { const t = s.tasks.find(x => x.id === id); if (t) return { task: t, section: s.id }; } return null; };
const note = (n, extra = {}) => ({ n, at: `2026-01-0${n}T00:00:00.000Z`, text: `note ${n}`, kind: 'fix', state: 'new', ...extra });

function threeWay(fn) {
  const base = doc({ todo: [tk('T1'), tk('T2')], review: [tk('T3', { checks: [{ text: 'a', checked: false }, { text: 'b', checked: false }] })], done: [] });
  const local = clone(base); const current = clone(base);
  fn({ local, current });
  return mergeTasksDocs(base, local, current);
}

test('ticket changed only locally keeps the local edit; only remotely keeps the remote edit', () => {
  const m = threeWay(({ local, current }) => {
    find(local, 'T1').task.title = 'local title';
    find(current, 'T2').task.title = 'remote title';
  });
  assert.equal(find(m, 'T1').task.title, 'local title');
  assert.equal(find(m, 'T2').task.title, 'remote title');
});

test('tickets added on either side are kept', () => {
  const m = threeWay(({ local, current }) => {
    local.sections[0].tasks.push(tk('T8'));
    current.sections[0].tasks.push(tk('T9'));
  });
  assert.ok(find(m, 'T8')); assert.ok(find(m, 'T9'));
});

test('a section move from either side is respected', () => {
  const m = threeWay(({ local, current }) => {
    const t1 = local.sections[0].tasks.shift(); local.sections[2].tasks.push(t1);
    const t2 = current.sections[0].tasks.pop(); current.sections[1 + 0].tasks.push(t2); // review
  });
  assert.equal(find(m, 'T1').section, 'done');
  assert.equal(find(m, 'T2').section, 'review');
});

test('a ticket moved remotely and edited locally keeps both', () => {
  const m = threeWay(({ local, current }) => {
    find(local, 'T1').task.title = 'edited';
    const t = current.sections[0].tasks.shift(); current.sections[2].tasks.push(t);
  });
  assert.equal(find(m, 'T1').section, 'done');
  assert.equal(find(m, 'T1').task.title, 'edited');
});

test('both changed: review notes are unioned, a sent note beats a new one, same n renumbers local', () => {
  const m = threeWay(({ local, current }) => {
    find(local, 'T3').task.reviewNotes = [note(1, { text: 'mine' })];
    find(current, 'T3').task.reviewNotes = [note(1, { text: 'theirs' }), note(2)];
  });
  const notes = find(m, 'T3').task.reviewNotes;
  assert.equal(notes.length, 3);
  assert.equal(notes.find(x => x.n === 1).text, 'theirs');
  assert.ok(notes.some(x => x.text === 'mine' && x.n === 3));
  assert.equal(new Set(notes.map(x => x.n)).size, 3);

  const base = doc({ review: [tk('T3', { reviewNotes: [note(1)] })] });
  const local = clone(base); const current = clone(base);
  find(local, 'T3').task.reviewNotes[0].state = 'dismissed';
  find(current, 'T3').task.title = 'other';
  const m2 = mergeTasksDocs(base, local, current);
  assert.equal(find(m2, 'T3').task.reviewNotes[0].state, 'dismissed');
  assert.equal(find(m2, 'T3').task.title, 'other');
  // and the other way round
  const l2 = clone(base); const c2 = clone(base);
  find(c2, 'T3').task.reviewNotes[0].state = 'filed';
  find(l2, 'T3').task.title = 'mine';
  assert.equal(find(mergeTasksDocs(base, l2, c2), 'T3').task.reviewNotes[0].state, 'filed');
});

test('both changed: checks merge by text and a tick from the side that changed it wins', () => {
  const m = threeWay(({ local, current }) => {
    find(local, 'T3').task.checks[0].checked = true;          // local ticks a
    find(current, 'T3').task.checks[1].checked = true;        // remote ticks b
    find(current, 'T3').task.checks.push({ text: 'c', checked: false });
  });
  const checks = find(m, 'T3').task.checks;
  assert.deepEqual(checks.map(c => [c.text, c.checked]), [['a', true], ['b', true], ['c', false]]);
});

test('both changed: other fields come from current unless only local changed them', () => {
  const m = threeWay(({ local, current }) => {
    const l = find(local, 'T1').task; const c = find(current, 'T1').task;
    l.title = 'local title'; l.priority = 'high';
    c.title = 'remote title'; c.description = 'remote desc';
  });
  const t = find(m, 'T1').task;
  assert.equal(t.title, 'remote title');
  assert.equal(t.priority, 'high');
  assert.equal(t.description, 'remote desc');
});

test('a ticket deleted remotely stays gone unless edited locally; edits to meta merge', () => {
  const base = doc({ todo: [tk('T1'), tk('T2')] }); base.meta = { a: 1 };
  const local = clone(base); const current = clone(base);
  current.sections[0].tasks = [];
  local.sections[0].tasks[1].title = 'edited';
  local.meta = { a: 2 };
  const m = mergeTasksDocs(base, local, current);
  assert.equal(find(m, 'T1'), null);
  assert.equal(find(m, 'T2').task.title, 'edited');
  assert.deepEqual(m.meta, { a: 2 });
});

test('does not mutate its inputs', () => {
  const base = doc({ todo: [tk('T1')] }); const local = clone(base); const current = clone(base);
  local.sections[0].tasks[0].title = 'x';
  const snap = JSON.stringify([base, local, current]);
  mergeTasksDocs(base, local, current);
  assert.equal(JSON.stringify([base, local, current]), snap);
});
