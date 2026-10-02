import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeCodeSessionUrl, MAX_PROMPT_CHARS } from '../../shared/claude-deeplink.js';

test('builds a code/new URL with an encoded prompt and folder', () => {
  const url = new URL(claudeCodeSessionUrl('/ship-task FRO508', '/Users/me/my project'));
  assert.equal(url.protocol, 'claude:');
  assert.equal(url.host, 'code');
  assert.equal(url.pathname, '/new');
  assert.equal(url.searchParams.get('prompt'), '/ship-task FRO508');
  assert.equal(url.searchParams.get('folder'), '/Users/me/my project');
});

test('spaces are %20 and the folder is optional', () => {
  const raw = claudeCodeSessionUrl('a b');
  assert.equal(raw, 'claude://code/new?prompt=a%20b');
});

test('empty prompt gives null; long prompt is capped', () => {
  assert.equal(claudeCodeSessionUrl('  ', '/x'), null);
  const url = new URL(claudeCodeSessionUrl('x'.repeat(MAX_PROMPT_CHARS + 50)));
  assert.equal(url.searchParams.get('prompt').length, MAX_PROMPT_CHARS);
});
