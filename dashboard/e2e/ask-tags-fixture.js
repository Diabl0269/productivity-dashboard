#!/usr/bin/env node
// Synthetic CH_HOME for the For you tag e2e (AGE220).
//   node dashboard/e2e/ask-tags-fixture.js <dir>     (then CH_HOME=<dir> PORT=3143 node serve.js)
//   MK1   in-progress marketing ticket with a Pick decision      -> Marketing · Pick
//   CODE1 in-progress ticket with a merge ask                    -> Merge
//   RV1   review ticket whose check is a taste call              -> Taste
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: ask-tags-fixture.js <dir>'); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });

const PLAIN = "## In plain words\n**What you'll notice:** x\n**Why it matters:** y\n**How to check it:** look\n\n## Technical detail (for Claude)\nz";
const base = (id, extra) => ({ id, title: `Ticket ${id}`, checked: false, priority: 'medium', subtasks: [], description: PLAIN, created: '2026-10-15', updated: '2026-11-05', type: 'task', ...extra });
const DETAILS = 'Open the post draft on the marketing page and compare both openings; the pick decides which one goes out first.';

const doc = {
  version: 1,
  meta: { dailyPlan: { date: '2026-11-06', taskIds: [], carriedIds: [] } },
  sections: [
    { id: 'review', name: 'Ready for review', tasks: [
      base('RV1', { result: { at: '2026-11-01T10:00:00Z', shipped: ['shipped'], ci: 'all passed' }, checks: [{ text: 'Taste: is the new map calm?', checked: false, addedAt: '2026-11-01T10:00:00Z', noProject: 'synthetic fixture, nothing to open' }] }),
    ] },
    { id: 'in-progress', name: 'In progress', tasks: [
      base('MK1', { project: 'marketing', asks: [{ n: 1, at: '2026-11-02T10:00:00Z', text: 'Which opening for the launch post?', state: 'open', details: DETAILS, options: [{ key: 'A', text: 'Short hook' }, { key: 'B', text: 'Story' }] }] }),
      base('CODE1', { project: 'agentsynth', asks: [{ n: 1, at: '2026-11-03T10:00:00Z', text: 'Merge the tag change?', state: 'open', details: DETAILS, mergePr: 'https://github.com/example/repo/pull/1' }] }),
    ] },
    { id: 'todo', name: 'To do', tasks: [] },
    { id: 'done', name: 'Done', tasks: [] },
  ],
};
fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc, null, 2));
