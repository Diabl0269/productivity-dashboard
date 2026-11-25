/**
 * cli/test/ask-tags.test.js
 * AGE220: tags on decision and review cards (area + action), the --tag override, the filter and the CLI output.
 * Synthetic data only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  areaOfTicket, tagOfAsk, tagOfReview, tagText, tagCounts, filterByTag, tagError, actionOfMedia,
} from '../../shared/ask-tags.js';
import { addAsk, openAsks, groupAsks, askErrors, cleanAsks } from '../../shared/asks.js';

process.env.CH_NO_CHECK_PROJECT_GATE = '1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const D = 'Open the Reverb panel on the master bus and compare the setting before and after; it decides the default.';
const AT = '2026-03-01T10:00:00.000Z';

test('area derivation table', () => {
  const rows = [
    [{ project: 'marketing' }, undefined, 'marketing'],
    [{ lane: 'brand' }, undefined, 'marketing'],
    [{ project: 'agentsynth' }, { lane: 'marketing' }, 'marketing'],
    [{ labels: ['design'] }, undefined, 'design'],
    [{ title: 'Co-task: create the API token' }, undefined, 'account'],
    [{ labels: ['co-task'], project: 'marketing' }, undefined, 'account'],
    [{ checks: [{ text: 'FRO9: Taste: judge the map', checked: false }] }, undefined, 'taste'],
    [{ checks: [{ text: 'Taste: judge the map', checked: true }] }, undefined, ''],
    [{ result: { unverified: ['needs-tal: taste: does it feel calm'] } }, undefined, 'taste'],
    [{ project: 'agentsynth' }, undefined, ''],
  ];
  for (const [task, epic, want] of rows) assert.equal(areaOfTicket(task, epic), want, JSON.stringify(task));
});

test('action comes from the attachment', () => {
  assert.equal(actionOfMedia({ video: 'a.mp4' }), 'watch');
  assert.equal(actionOfMedia({ audio: 'a.wav' }), 'listen');
  assert.equal(actionOfMedia({ image: 'a.png' }), 'read');
  assert.equal(actionOfMedia({ board: 'https://claude.ai/artifact/x' }), 'read');
  assert.equal(actionOfMedia({}, { options: [{ key: 'A', text: 'x' }] }), 'pick');
  assert.equal(actionOfMedia({}, { account: true }), 'sign-in');
  assert.equal(actionOfMedia({}), '');
});

test('ask tag: merge, override, board, text', () => {
  const m = tagOfAsk({ mergePr: 'https://github.com/o/r/pull/1', media: { video: 'a.mp4' } }, { project: 'marketing' });
  assert.deepEqual([m.area, m.action], ['merge', '']);
  const mk = tagOfAsk({ media: { video: 'a.mp4' } }, { project: 'marketing' });
  assert.deepEqual([mk.area, mk.action, tagText(mk)], ['marketing', 'watch', 'Marketing · Watch']);
  assert.equal(tagOfAsk({ tag: 'taste' }, { project: 'marketing' }).area, 'taste');
  assert.equal(tagOfAsk({ tag: 'taste' }, { project: 'marketing' }).overridden, true);
  assert.equal(tagOfAsk({ media: { board: 'https://claude.ai/artifact/x' } }, {}).area, 'design');
  assert.equal(tagOfAsk({}, {}).area, '');
  assert.equal(tagText({ area: '', action: '' }), '');
});

test('review tag: area from ticket or children, action from open checks', () => {
  const epic = { id: 'M1', checks: [{ text: 'Watch the reel', video: 'a.mp4' }, { text: 'done', checked: true, audio: 'a.wav' }] };
  const t = tagOfReview(epic, undefined, [{ id: 'M2', parentId: 'M1', project: 'marketing' }]);
  assert.deepEqual([t.area, t.action], ['marketing', 'watch']);
  assert.equal(tagOfReview({ id: 'X', checks: [] }, undefined, []).area, '');
});

test('counts and filter', () => {
  const items = [{ t: { area: 'marketing' } }, { t: { area: 'merge' } }, { t: { area: 'marketing' } }, { t: { area: '' } }];
  assert.deepEqual(tagCounts(items.map(i => i.t)).map(c => [c.slug, c.count]), [['merge', 1], ['marketing', 2]]);
  assert.equal(filterByTag(items, 'marketing', i => i.t).length, 2);
  assert.equal(filterByTag(items, '', i => i.t).length, 4);
  assert.equal(filterByTag(items, 'all', i => i.t).length, 4);
});

test('addAsk stores a valid --tag and refuses a bad one; schema and loader keep it', () => {
  const task = { id: 'T1', title: 'x' };
  assert.throws(() => addAsk(task, { text: 'Which?', details: D, tag: 'nope' }), /--tag must be one of/);
  const a = addAsk(task, { text: 'Which?', details: D, tag: 'Marketing', now: AT });
  assert.equal(a.tag, 'marketing');
  assert.deepEqual(askErrors(task, 'T1'), []);
  assert.equal(cleanAsks(task).asks[0].tag, 'marketing');
  task.asks[0].tag = 'bogus';
  assert.match(askErrors(task, 'T1').join(), /tag/);
  assert.equal(tagError('design'), '');
});

test('openAsks carries the derived tag; groupAsks keeps it', () => {
  const doc = {
    sections: [{ id: 'todo', tasks: [
      { id: 'E1', title: 'Epic', type: 'epic', lane: 'marketing' },
      { id: 'M1', title: 'Post', parentId: 'E1' },
      { id: 'T2', title: 'Code', project: 'agentsynth' },
    ] }],
  };
  addAsk(doc.sections[0].tasks[1], { text: 'Approve the post?', details: D, options: ['A: Yes', 'B: No'], now: AT });
  addAsk(doc.sections[0].tasks[2], { text: 'Merge it?', details: D, mergePr: 'https://github.com/o/r/pull/9', now: AT });
  const cards = groupAsks(openAsks(doc));
  const by = id => cards.find(c => c.id === id).tag;
  assert.deepEqual([by('M1').area, by('M1').action], ['marketing', 'pick']);
  assert.equal(by('T2').area, 'merge');
});

test('ch tasks ask --tag and ch tasks asks --tag / output / --json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-age220-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(home, 'tasks.json'));
  const run = (...args) => spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  const [a, b] = ['T1', 'T2']; // tickets of the sample fixture
  const bad = run('tasks', 'ask', a, 'Which?', '--details', D, '--tag', 'nope');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr + bad.stdout, /--tag must be one of/);
  assert.equal(run('tasks', 'ask', a, 'Approve the reel?', '--details', D, '--tag', 'marketing', '--option', 'A: Yes').status, 0);
  assert.equal(run('tasks', 'ask', b, 'Which default?', '--details', D, '--tag', 'taste').status, 0);
  const json = JSON.parse(run('tasks', 'asks', '--json').stdout);
  assert.deepEqual(json.asks.map(r => r.tag.area).sort(), ['marketing', 'taste']);
  const only = JSON.parse(run('tasks', 'asks', '--tag', 'marketing', '--json').stdout);
  assert.deepEqual(only.asks.map(r => r.id), [a]);
  const text = run('tasks', 'asks').stdout;
  assert.match(text, /\[Marketing · Pick\] Approve the reel\?/);
  assert.notEqual(run('tasks', 'asks', '--tag', 'nope').status, 0);
});
