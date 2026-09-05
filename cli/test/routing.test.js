/**
 * Smoke tests for dashboard/js/routing.js (parse/build path helpers).
 * Runs in Node with a mocked window.location — no browser needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

function mockWindow(pathname) {
  global.window = {
    location: { pathname },
    history: { replaceState() {}, pushState() {} },
    addEventListener() {},
  };
}

test('parseRoute: overview default', async () => {
  mockWindow('/dashboard/');
  const { parseRoute, buildPath } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.tab, 'overview');
  assert.equal(buildPath(route), '/dashboard/');
});

test('parseRoute: tasks with task id', async () => {
  mockWindow('/dashboard/tasks/T7');
  const { parseRoute, buildPath } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.tab, 'tasks');
  assert.equal(route.taskId, 'T7');
  assert.equal(buildPath(route), '/dashboard/tasks/T7');
});

test('parseRoute: tasks list view', async () => {
  mockWindow('/dashboard/tasks/list');
  const { parseRoute, buildPath } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.tab, 'tasks');
  assert.equal(route.taskView, 'list');
  assert.equal(buildPath(route), '/dashboard/tasks/list');
});

test('parseRoute: settings subtab', async () => {
  mockWindow('/dashboard/settings/ticket-types');
  const { parseRoute } = await import('../../dashboard/js/routing.js');
  const route = parseRoute();
  assert.equal(route.tab, 'settings');
  assert.equal(route.settingsSubtab, 'ticket-types');
});
