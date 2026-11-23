/**
 * Unit tests for dashboard/js/external-tabs-validate.js (pure helpers, no DOM needed).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalTabUrl, isValidEntry, slugify } from '../../dashboard/js/external-tabs-validate.js';

test('isValidEntry: accepts a well-formed iframe entry', () => {
  assert.equal(isValidEntry({ label: 'Status page', url: 'https://example.com', mode: 'iframe' }), true);
});

test('isValidEntry: accepts a well-formed link entry', () => {
  assert.equal(isValidEntry({ label: 'Docs', url: 'https://example.com/docs', mode: 'link' }), true);
});

test('isValidEntry: rejects missing label', () => {
  assert.equal(isValidEntry({ url: 'https://example.com', mode: 'iframe' }), false);
});

test('isValidEntry: rejects blank label', () => {
  assert.equal(isValidEntry({ label: '   ', url: 'https://example.com', mode: 'iframe' }), false);
});

test('isValidEntry: rejects missing url', () => {
  assert.equal(isValidEntry({ label: 'Status page', mode: 'iframe' }), false);
});

test('isValidEntry: rejects an unrecognized mode', () => {
  assert.equal(isValidEntry({ label: 'Status page', url: 'https://example.com', mode: 'popup' }), false);
});

test('isValidEntry: rejects non-object entries', () => {
  assert.equal(isValidEntry(null), false);
  assert.equal(isValidEntry('https://example.com'), false);
  assert.equal(isValidEntry(42), false);
});

test('externalTabUrl: aligns loopback iframe hosts while preserving port and path', () => {
  assert.equal(externalTabUrl('http://127.0.0.1:4188/settings', 'http://localhost:3000/dashboard/'), 'http://localhost:4188/settings');
  assert.equal(externalTabUrl('http://localhost:4188/', 'http://127.0.0.1:3000/dashboard/'), 'http://127.0.0.1:4188/');
});

test('externalTabUrl: leaves non-loopback and non-loopback-parent URLs unchanged', () => {
  assert.equal(externalTabUrl('https://example.com/app', 'http://localhost:3000/'), 'https://example.com/app');
  assert.equal(externalTabUrl('http://127.0.0.1:4188/', 'https://dashboard.example.com/'), 'http://127.0.0.1:4188/');
});

test('slugify: lowercases, dashes, and appends the index', () => {
  assert.equal(slugify('Status Page', 0), 'ext-status-page-0');
});

test('slugify: strips punctuation and collapses separators', () => {
  assert.equal(slugify(' Team Channel! (v2) ', 3), 'ext-team-channel-v2-3');
});

test('slugify: falls back to "tab" for a label with no alphanumerics', () => {
  assert.equal(slugify('---', 1), 'ext-tab-1');
});
