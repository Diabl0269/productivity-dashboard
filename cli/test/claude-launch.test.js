import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCopilotLaunchUrl,
  createClaudeLaunchButton,
  isValidCopilotRepository,
  openEditDialog,
  readAiProvider,
  readCopilotRepository,
  resolveLaunch,
  writeAiProvider,
  writeCopilotRepository,
} from '../../dashboard/js/claude-launch.js';

async function withDom(fn) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const launched = [];
  function element() {
    const listeners = new Map();
    const selectors = new Map();
    return {
      children: [], dataset: {}, value: '', checked: false, disabled: false,
      classList: { toggle() {} },
      append(...nodes) { this.children.push(...nodes); },
      appendChild(node) { this.children.push(node); },
      querySelector(selector) {
        if (!selectors.has(selector)) {
          const node = element();
          const act = selector.match(/^\[data-act="([^"]+)"\]$/)?.[1];
          if (act) node.dataset.act = act;
          selectors.set(selector, node);
        }
        return selectors.get(selector);
      },
      setAttribute() {}, focus() {}, setSelectionRange() {},
      remove() { this.removed = true; },
      addEventListener(type, listener) { listeners.set(type, listener); },
      dispatch(type, event = {}) { listeners.get(type)?.(event); },
      click() { if (!this.disabled) this.dispatch('click'); },
    };
  }
  const body = element();
  const settingsRepo = element();
  globalThis.document = {
    body, createElement: element, addEventListener() {},
    getElementById: id => id === 'copilotRepositoryInput' ? settingsRepo : null,
  };
  globalThis.window = { addEventListener() {}, location: { assign: url => launched.push(url) } };
  try {
    return await fn({ body, launched, settingsRepo });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

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

test('Start in Copilot without a repo collects it inline instead of navigating to Settings', async () => {
  await withStorage(() => withDom(({ body, launched, settingsRepo }) => {
    writeAiProvider('copilot');
    let settingsOpened = false;
    const button = createClaudeLaunchButton({
      getTask: () => ({ taskId: 'T12', title: 'Example' }),
      getState: () => ({}),
      onOpenSettings: () => { settingsOpened = true; },
    });
    button.children[0].click();
    assert.equal(settingsOpened, false);
    assert.equal(launched.length, 0);
    const dialog = body.children.at(-1);
    assert.ok(dialog);
    assert.match(dialog.innerHTML, /id="clRepo"/);
    const start = dialog.querySelector('[data-act="start"]');
    assert.equal(start.disabled, true);
    const repo = dialog.querySelector('#clRepo');
    repo.value = 'https://github.com/owner/repo';
    repo.dispatch('input');
    assert.equal(start.disabled, true);
    assert.equal(dialog.querySelector('.cl-repo-warn').hidden, false);
    dialog.dispatch('click', { target: { closest: () => start } });
    assert.equal(readCopilotRepository(), '');
    assert.equal(launched.length, 0);
    repo.value = ' owner/repo ';
    repo.dispatch('input');
    assert.equal(start.disabled, false);
    const preview = dialog.querySelector('.cl-url').textContent;
    dialog.dispatch('click', { target: { closest: () => start } });
    assert.equal(readCopilotRepository(), 'owner/repo');
    assert.equal(settingsRepo.value, 'owner/repo');
    assert.equal(launched.length, 1);
    assert.equal(launched[0], preview);
    const url = new URL(launched[0]);
    assert.equal(url.pathname, '/new/owner/repo');
    assert.equal(url.searchParams.get('mode'), 'interactive');
    assert.match(url.searchParams.get('prompt'), /Work on Task T12: Example/);
    assert.equal(dialog.removed, true);
    button.children[0].click();
    assert.equal(launched.length, 2);
    assert.equal(new URL(launched[1]).pathname, '/new/owner/repo');
    assert.equal(body.children.length, 1);
  }));
});

test('edit-before-start can repair an invalid fallback repository without saving on cancel', async () => {
  await withStorage(() => withDom(({ body, launched }) => {
    writeAiProvider('copilot');
    writeCopilotRepository('invalid');
    openEditDialog({ task: { taskId: 'T12', title: 'Example' }, state: {} });
    const dialog = body.children.at(-1);
    assert.equal(dialog.querySelector('.cl-repo-field').hidden, false);
    assert.equal(dialog.querySelector('[data-act="start"]').disabled, true);
    dialog.querySelector('#clRepo').value = 'owner/repo';
    dialog.querySelector('#clRepo').dispatch('input');
    dialog.dispatch('click', { target: { closest: () => ({ dataset: { act: 'cancel' } }) } });
    assert.equal(readCopilotRepository(), 'invalid');
    assert.equal(launched.length, 0);
    assert.equal(dialog.removed, true);
  }));
});

test('configured Copilot and Claude main buttons still launch directly', async () => {
  await withStorage(() => withDom(({ body, launched }) => {
    const task = { taskId: 'T12', title: 'Example', issueUrl: 'https://github.com/task/repo/issues/12' };
    writeAiProvider('copilot');
    writeCopilotRepository('fallback/repo');
    const button = createClaudeLaunchButton({ getTask: () => task, getState: () => ({}) });
    button.children[0].click();
    assert.equal(new URL(launched[0]).pathname, '/new/task/repo');
    task.issueUrl = '';
    button.children[0].click();
    assert.equal(new URL(launched[1]).pathname, '/new/fallback/repo');
    writeAiProvider('claude');
    button.children[0].click();
    assert.equal(new URL(launched[2]).protocol, 'claude:');
    assert.equal(body.children.length, 0);
  }));
});
