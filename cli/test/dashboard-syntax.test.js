// Every browser module must parse as an ES module: a duplicate import or other early
// SyntaxError kills the whole dashboard at load, and plain `node --check` misses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dirs = ['dashboard/js', 'shared'];

test('dashboard and shared modules parse as ES modules', () => {
  const failures = [];
  for (const dir of dirs) {
    for (const name of readdirSync(join(root, dir)).filter(n => n.endsWith('.js'))) {
      const file = join(dir, name);
      const r = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: readFileSync(join(root, file)),
        encoding: 'utf8',
      });
      if (r.status !== 0) failures.push(`${file}: ${(r.stderr.match(/SyntaxError[^\n]*/) || [r.stderr])[0]}`);
    }
  }
  assert.deepEqual(failures, []);
});
