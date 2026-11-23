#!/usr/bin/env node
// Synthetic CH_HOME for the Checks tab e2e (PRO143).
//   node dashboard/e2e/checks-page-fixture.js <dir>     (prints nothing; then CH_HOME=<dir> PORT=3142 node serve.js)
//   C-OPEN   review ticket, 2 checks, one ticked                          -> shows
//   C-DONE   review ticket, all checks ticked, one unsent note (stays in review) -> hidden by default, "finished" with the switch off
//   E-PART   in-progress epic with one unticked check                     -> shows
//   FRO9     done ticket named in C-OPEN's second check, which also carries a board link and a still -> its id is a button (FRO2246)
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: checks-page-fixture.js <dir>'); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });

const PLAIN = "## In plain words\n**What you'll notice:** x\n**Why it matters:** y\n**How to check it:** look\n\n## Technical detail (for Claude)\nz";
const check = (text, checked, addedAt) => ({ text, checked, addedAt, noProject: 'synthetic fixture, nothing to open' });
const base = (id, extra) => ({ id, title: `Ticket ${id}`, checked: false, priority: 'medium', subtasks: [], description: PLAIN, created: '2026-10-15', updated: '2026-11-05', ...extra });
const result = at => ({ at, shipped: ['shipped something'], ci: 'all passed' });

const doc = {
  version: 1,
  meta: { dailyPlan: { date: '2026-11-06', taskIds: [], carriedIds: [] } },
  sections: [
    {
      id: 'review',
      name: 'Ready for review',
      tasks: [
        base('C-OPEN', { type: 'task', result: result('2026-11-01T10:00:00Z'), checks: [check('Open it and look', true, '2026-11-01T10:00:00Z'), { ...check('Try the second thing, as in FRO9 and A4', false, '2026-11-01T10:00:00Z'), link: { label: 'Design board', url: 'https://claude.ai/artifact/example' }, image: 'C-OPEN/still.png' }] }),
        base('C-DONE', {
          type: 'task',
          result: result('2026-10-20T10:00:00Z'),
          checks: [check('Everything looks right', true, '2026-10-20T10:00:00Z')],
          reviewNotes: [{ n: 1, text: 'One thing to file later', state: 'new', at: '2026-11-05T10:00:00Z' }],
        }),
      ],
    },
    { id: 'done', name: 'Done', tasks: [base('FRO9', { type: 'task', checked: true })] },
    {
      id: 'in-progress',
      name: 'In progress',
      tasks: [base('E-PART', { type: 'epic', lane: 'a', result: result('2026-11-03T10:00:00Z'), checks: [check('Listen to the result', false, '2026-11-03T10:00:00Z')] })],
    },
  ],
};
fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc, null, 2));
// A 1x1 PNG for C-OPEN's still.
fs.mkdirSync(path.join(dir, 'evidence', 'C-OPEN'), { recursive: true });
fs.writeFileSync(path.join(dir, 'evidence', 'C-OPEN', 'still.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
