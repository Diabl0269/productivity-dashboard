import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  globMatch,
  matchesDocFilter,
  filterDocEntries,
  scanAbsoluteDocDir,
  normalizeProjectDocDirs,
} from '../../shared/project-docs.js';

test('globMatch supports ** and *', () => {
  assert.equal(globMatch('agents/backend.md', '**/agents/**'), true);
  assert.equal(globMatch('CLAUDE.md', 'CLAUDE.md'), true);
  assert.equal(globMatch('src/index.js', '**/agents/**'), false);
});

test('matchesDocFilter uses default memory patterns', () => {
  assert.equal(matchesDocFilter('agents/foo.md', ['**/agents/**']), true);
  assert.equal(matchesDocFilter('src/app.ts', ['**/agents/**']), false);
});

test('filterDocEntries hides non-memory files unless showAll', () => {
  const entries = [
    { treePath: 'repo/CLAUDE.md', name: 'CLAUDE' },
    { treePath: 'repo/src/index.js', name: 'index' },
  ];
  const filtered = filterDocEntries(entries, { showAll: false, patterns: ['**/CLAUDE.md', 'CLAUDE.md'] });
  assert.equal(filtered.length, 1);
  assert.equal(filterDocEntries(entries, { showAll: true }).length, 2);
});

test('scanAbsoluteDocDir reads nested markdown', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-docs-'));
  fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# hi');
  fs.writeFileSync(path.join(tmp, 'agents', 'backend.md'), '# backend');
  fs.writeFileSync(path.join(tmp, 'bundle.js'), 'console.log(1)');

  const focused = scanAbsoluteDocDir(tmp, { fs, rootLabel: 'demo', showAll: false });
  assert.ok(focused.some(e => e.treePath === 'demo/CLAUDE.md'));
  assert.ok(focused.some(e => e.treePath === 'demo/agents/backend.md'));
  assert.equal(filterDocEntries(focused, { showAll: false, patterns: ['**/CLAUDE.md', 'CLAUDE.md', '**/agents/**'] }).some(e => e.treePath.includes('bundle.js')), false);

  const all = scanAbsoluteDocDir(tmp, { fs, rootLabel: 'demo', showAll: true });
  assert.ok(all.some(e => e.treePath.includes('bundle.js')));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('normalizeProjectDocDirs strips blanks', () => {
  assert.deepEqual(normalizeProjectDocDirs([' /tmp/a ', '', null]), ['/tmp/a']);
});
