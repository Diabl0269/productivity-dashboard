/**
 * cli/test/turnkey-open-checks.test.js
 * AGE215: every open check is turnkey. `turnkeyOpenChecksProblems(doc)` and `ch tasks checks --turnkey` run the
 * turnkey rules over every unticked, not-handed-off check on open tickets and epics. Synthetic fixture only
 * (never the real tracker file).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { turnkeyOpenChecksProblems } from '../../shared/turnkey-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

const withPriority = (d) => { for (const s of d.sections) for (const t of s.tasks) t.priority = 'medium'; return d; };
const doc = (good) => withPriority({
  version: 1,
  sections: [
    { id: 'todo', name: 'Todo', tasks: [
      { id: 'T10', title: 'AI epic', type: 'epic', checked: false, subtasks: [], labels: ['ai'], checks: [
        { text: 'Is the bass warm?', checked: false, project: 'p.agsproj', noVideo: 'taste only' },
        { text: 'Ticked old check', checked: true },
        { text: 'Handed off check', checked: false, handedTo: 'T9' },
      ] },
    ] },
    { id: 'review', name: 'Ready for review', tasks: [
      { id: 'T1', title: 'Plain', checked: false, subtasks: [], parentId: 'T10', project: 'backend', checks: good
        ? [{ text: 'Does the panel read well?', checked: false, project: 'p.agsproj', noVideo: 'backend panel, no clip' }]
        : [{ text: 'Press the button', checked: false }] },
    ] },
  ],
});

test('a doc with one bad open check lists it; ticked and handed-off checks are skipped', () => {
  const lines = turnkeyOpenChecksProblems(doc(false));
  assert.ok(lines.length >= 1);
  assert.ok(lines.every(l => l.startsWith('T1#1 ')), lines.join('\n'));
  assert.ok(lines.some(l => /no clip or still/.test(l)));
});

test('a doc whose open checks are all turnkey has no problems (the epic AI label applies to its child)', () => {
  assert.deepEqual(turnkeyOpenChecksProblems(doc(true)), []);
});

test('ch tasks checks --turnkey exits 1 on the bad doc and 0 on the good one', () => {
  const run = (d) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-turnkey-open-'));
    fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(d));
    return spawnSync(process.execPath, [CH_SCRIPT, 'tasks', 'checks', '--turnkey'], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  };
  const bad = run(doc(false));
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stdout, /T1#1/);
  const good = run(doc(true));
  assert.equal(good.status, 0, good.stdout + good.stderr);
});
