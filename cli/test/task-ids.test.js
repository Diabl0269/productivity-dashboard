import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaskId,
  nextTaskId,
  derivePrefixFromSlug,
  projectPrefix,
} from '../../shared/task-ids.js';

test('parseTaskId: legacy T prefix', () => {
  assert.deepEqual(parseTaskId('T1'), { prefix: 'T', num: 1 });
  assert.deepEqual(parseTaskId('T42'), { prefix: 'T', num: 42 });
});

test('parseTaskId: project prefix', () => {
  assert.deepEqual(parseTaskId('APP1', ['APP', 'T']), { prefix: 'APP', num: 1 });
  assert.deepEqual(parseTaskId('MYA12', ['MYA', 'T']), { prefix: 'MYA', num: 12 });
});

test('derivePrefixFromSlug', () => {
  assert.equal(derivePrefixFromSlug('my-app'), 'MYA');
  assert.equal(derivePrefixFromSlug('cli'), 'CLI');
});

test('projectPrefix uses custom or derived', () => {
  assert.equal(projectPrefix({ id: 'my-app', prefix: 'APP' }), 'APP');
  assert.equal(projectPrefix({ id: 'my-app' }), 'MYA');
});

test('nextTaskId scopes by project prefix', () => {
  const meta = [{ id: 'my-app', name: 'My App', prefix: 'APP' }];
  const flat = [{ id: 'T1' }, { id: 'T2' }, { id: 'APP3' }];
  assert.equal(nextTaskId(flat, 'my-app', meta), 'APP4');
  assert.equal(nextTaskId(flat, null, meta), 'T3');
});
