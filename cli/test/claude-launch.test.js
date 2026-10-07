import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCopilotLaunchUrl,
  isValidCopilotRepository,
  readAiProvider,
  readCopilotRepository,
  resolveLaunch,
  writeAiProvider,
  writeCopilotRepository,
} from '../../dashboard/js/claude-launch.js';

async function withStorage(fn) {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

test('provider settings default to Claude and persist the selected provider and Copilot repo', async () => {
  await withStorage(() => {
    assert.equal(readAiProvider(), 'claude');
    writeAiProvider('copilot');
    writeCopilotRepository('owner/repo');
    assert.equal(readAiProvider(), 'copilot');
    assert.equal(readCopilotRepository(), 'owner/repo');
    writeAiProvider('unknown');
    assert.equal(readAiProvider(), 'claude');
  });
});

test('Copilot repository validation accepts owner/repo only', () => {
  assert.equal(isValidCopilotRepository('owner/repo'), true);
  assert.equal(isValidCopilotRepository('owner/repo-name.git'), true);
  assert.equal(isValidCopilotRepository('https://github.com/owner/repo'), false);
  assert.equal(isValidCopilotRepository('owner'), false);
  assert.equal(isValidCopilotRepository('owner/repo/extra'), false);
});

test('task GitHub issue repository takes precedence over the configured fallback', async () => {
  await withStorage(() => {
    writeAiProvider('copilot');
    writeCopilotRepository('fallback/repo');
    const launch = resolveLaunch({
      taskId: 'T12',
      title: 'Example',
      issueUrl: 'https://github.com/task-owner/task-repo/issues/12',
    }, {});
    assert.equal(launch.repo, 'task-owner/task-repo');
    assert.equal(launch.aiProvider, 'copilot');
  });
});

test('Copilot app link opens an interactive repository session with a prefilled prompt', () => {
  const prompt = 'Fix ticket T12: spaces & query=value';
  const link = buildCopilotLaunchUrl({ repo: 'owner/repo', prompt });
  const parsed = new URL(link);
  assert.equal(parsed.protocol, 'ghapp:');
  assert.equal(parsed.hostname, 'session');
  assert.equal(parsed.pathname, '/new/owner/repo');
  assert.equal(parsed.searchParams.get('mode'), 'interactive');
  assert.equal(parsed.searchParams.get('prompt'), prompt);
  assert.equal(buildCopilotLaunchUrl({ repo: '', prompt }), '');
});
