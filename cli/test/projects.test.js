import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectTree,
  isProjectAncestor,
  wouldCreateProjectCycle,
  projectPrefixConflicts,
  effectiveProjectPrefix,
} from '../../shared/projects.js';
import { projectPrefix } from '../../shared/task-ids.js';

test('buildProjectTree nests by parentId', () => {
  const meta = [
    { id: 'platform', name: 'Platform', prefix: 'PLT' },
    { id: 'mobile', name: 'Mobile', parentId: 'platform' },
    { id: 'solo', name: 'Solo' },
  ];
  const { roots } = buildProjectTree(meta);
  assert.equal(roots.length, 2);
  const platform = roots.find(r => r.id === 'platform');
  assert.equal(platform.children.length, 1);
  assert.equal(platform.children[0].id, 'mobile');
});

test('isProjectAncestor detects parent chain', () => {
  const meta = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B', parentId: 'a' },
    { id: 'c', name: 'C', parentId: 'b' },
  ];
  assert.equal(isProjectAncestor(meta, 'a', 'c'), true);
  assert.equal(isProjectAncestor(meta, 'c', 'a'), false);
});

test('wouldCreateProjectCycle blocks self-parent', () => {
  const meta = [{ id: 'a', name: 'A' }];
  assert.equal(wouldCreateProjectCycle(meta, 'a', 'a'), true);
});

test('prefix inherits from parent when child has no explicit prefix', () => {
  const meta = [
    { id: 'platform', name: 'Platform', prefix: 'PLT' },
    { id: 'mobile', name: 'Mobile', parentId: 'platform' },
  ];
  assert.equal(projectPrefix(meta[1], meta), 'PLT');
  assert.equal(effectiveProjectPrefix(meta[1], meta), 'PLT');
});

test('projectPrefixConflicts allows parent-child same prefix', () => {
  const meta = [
    { id: 'platform', name: 'Platform', prefix: 'PLT' },
    { id: 'mobile', name: 'Mobile', parentId: 'platform' },
  ];
  assert.equal(projectPrefixConflicts(meta[0], meta[1], meta), false);
});

test('projectPrefixConflicts flags unrelated siblings with same derived prefix', () => {
  const meta = [
    { id: 'my-app', name: 'My App' },
    { id: 'my-app-2', name: 'My App 2' },
  ];
  assert.equal(projectPrefixConflicts(meta[0], meta[1], meta), true);
});
