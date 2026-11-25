/**
 * cli/test/pick-without-board.test.js
 * FRO2329 guard: `ch tasks ready` lists every open design pick ("Co-task: pick", label design) with no board
 * link, in any epic; `--json` carries `pickWithoutBoard`; `--check-picks` exits 1 when there is one. Synthetic data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { pickWithoutBoard } from '../../shared/pick-without-board.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const BOARD = 'https://claude.ai/artifact/abc123';
const t = (id, title, extra = {}) => ({ id, title, checked: false, priority: 'medium', subtasks: [], labels: ['design'], ...extra });

const doc = (fixed) => ({
  version: 1,
  sections: [
    { id: 'todo', name: 'Todo', tasks: [
      t('T1', 'Co-task: pick the knob shape', fixed ? { links: [{ url: BOARD }] } : {}),
      t('T2', 'Co-task: pick the theme', { links: [{ url: BOARD }] }),
      t('T3', 'Design: knob board', {}),
      t('T4', 'Co-task: pick without label', { labels: [] }),
    ] },
    { id: 'in-progress', name: 'In Progress', tasks: [t('T5', 'Co-task: pick the font', {})] },
    { id: 'done', name: 'Done', tasks: [t('T6', 'Co-task: pick the old thing')] },
  ],
});

test('pickWithoutBoard lists open picks with no artifact link, in any epic', () => {
  assert.deepEqual(pickWithoutBoard(doc(false)).map(p => p.id), ['T1', 'T5']);
  assert.deepEqual(pickWithoutBoard(doc(true)).map(p => p.id), ['T5']);
});

const run = (d, args) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-picks-'));
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(d));
  return spawnSync(process.execPath, [CH_SCRIPT, 'tasks', 'ready', ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
};

test('ready prints the section, --json adds the array, --check-picks exits 1 then 0', () => {
  const text = run(doc(false), []);
  assert.match(text.stdout, /Pick without board:\nT1 Co-task: pick the knob shape\nT5 /);
  const json = JSON.parse(run(doc(false), ['--json']).stdout);
  assert.deepEqual(json.pickWithoutBoard.map(p => p.id), ['T1', 'T5']);
  assert.equal(run(doc(false), ['--check-picks']).status, 1);
  const d = doc(true);
  d.sections[1].tasks[0].links = [{ url: BOARD }];
  const ok = run(d, ['--check-picks']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});
