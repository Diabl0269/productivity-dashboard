/**
 * cli/test/field-extractor.test.js
 * Tests for cli/lib/field-extractor.js — extractFields, writeField, getSlugName.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFields, writeField, getSlugName } from '../lib/field-extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

// ---------------------------------------------------------------------------
// person-contact.md: contact-block format
// ---------------------------------------------------------------------------

test('contact fixture: slack_id extracted correctly', () => {
  const content = readFixture('person-contact.md');
  const { fields } = extractFields(content);
  assert.equal(fields.slack_id, 'U0DEMO111');
});

test('contact fixture: email extracted correctly', () => {
  const content = readFixture('person-contact.md');
  const { fields } = extractFields(content);
  assert.equal(fields.email, 'jane@example.com');
});

test('contact fixture: github extracted correctly', () => {
  const content = readFixture('person-contact.md');
  const { fields } = extractFields(content);
  assert.equal(fields.github, 'demo-jane');
});

test('contact fixture: atlassian_id extracted correctly', () => {
  const content = readFixture('person-contact.md');
  const { fields } = extractFields(content);
  assert.equal(fields.atlassian_id, '600000:abc-123');
});

test('contact fixture: canvas_id derived from canvas url last segment', () => {
  const content = readFixture('person-contact.md');
  const { fields } = extractFields(content);
  // url: https://example.slack.com/docs/T0DEMO/F0CANVAS9
  assert.equal(fields.canvas_id, 'F0CANVAS9');
});

test('contact fixture: name is Jane Doe from H1', () => {
  const content = readFixture('person-contact.md');
  const { name } = extractFields(content);
  assert.equal(name, 'Jane Doe');
});

test('contact fixture: role extracted from top-level bold kv', () => {
  const content = readFixture('person-contact.md');
  const { fields } = extractFields(content);
  assert.equal(fields.role, 'Developer on Demo team');
});

// ---------------------------------------------------------------------------
// person-flat.md: frontmatter + flat bold bullets
// ---------------------------------------------------------------------------

test('flat+frontmatter fixture: slack_id from flat bold bullet', () => {
  const content = readFixture('person-flat.md');
  const { fields } = extractFields(content);
  assert.equal(fields.slack_id, 'U0DEMO222');
});

test('flat+frontmatter fixture: name from frontmatter', () => {
  const content = readFixture('person-flat.md');
  const { name } = extractFields(content);
  assert.equal(name, 'John Roe');
});

test('flat+frontmatter fixture: github from flat bold bullet', () => {
  const content = readFixture('person-flat.md');
  const { fields } = extractFields(content);
  assert.equal(fields.github, 'demo-john');
});

// ---------------------------------------------------------------------------
// project-demo.md: frontmatter + top-level bullets
// ---------------------------------------------------------------------------

test('project fixture: epic reduces markdown link to text', () => {
  const content = readFixture('project-demo.md');
  const { fields } = extractFields(content);
  // "- **Epic:** [DEMO-1](https://...)" -> epic = 'DEMO-1'
  assert.equal(fields.epic, 'DEMO-1');
});

test('project fixture: task_id extracted', () => {
  const content = readFixture('project-demo.md');
  const { fields } = extractFields(content);
  assert.equal(fields.task_id, 'T99');
});

test('project fixture: status extracted', () => {
  const content = readFixture('project-demo.md');
  const { fields } = extractFields(content);
  assert.equal(fields.status, 'In Progress');
});

test('project fixture: name from frontmatter', () => {
  const content = readFixture('project-demo.md');
  const { name } = extractFields(content);
  assert.equal(name, 'Demo Project');
});

// ---------------------------------------------------------------------------
// Markdown link stripping
// ---------------------------------------------------------------------------

test('extractFields strips markdown links in values', () => {
  const content = `# Test Person\n\n**Contact:**\n- GitHub: [my-handle](https://github.com/my-handle)\n`;
  const { fields } = extractFields(content);
  assert.equal(fields.github, 'my-handle');
});

test('extractFields: bare URL value preserved as-is (no markdown link)', () => {
  const content = `# Test Person\n\n**Contact:**\n- Email: user@host.com\n`;
  const { fields } = extractFields(content);
  assert.equal(fields.email, 'user@host.com');
});

// ---------------------------------------------------------------------------
// Missing fields -> undefined/null (not throw)
// ---------------------------------------------------------------------------

test('extractFields: missing field returns undefined (not throw)', () => {
  const content = readFixture('person-flat.md');
  const { fields } = extractFields(content);
  // person-flat has no atlassian_id
  assert.equal(fields.atlassian_id, undefined);
});

test('extractFields: empty content does not throw', () => {
  assert.doesNotThrow(() => extractFields(''));
  const { fields, name } = extractFields('');
  assert.equal(name, '');
  assert.deepEqual(fields, {});
});

test('extractFields: content with only frontmatter does not throw', () => {
  const content = '---\nname: Test\ntype: user\n---\n';
  assert.doesNotThrow(() => extractFields(content));
  const { fields, name } = extractFields(content);
  assert.equal(name, 'Test');
});

// ---------------------------------------------------------------------------
// writeField
// ---------------------------------------------------------------------------

test('writeField: updates slack_id in contact-block format', () => {
  const content = readFixture('person-contact.md');
  const updated = writeField(content, 'slack_id', 'U0UPDATED');
  assert.ok(updated !== null, 'writeField should not return null for contact format');
  assert.ok(updated.includes('U0UPDATED'), 'updated content should include new value');
  // Old value should be gone
  assert.ok(!updated.includes('U0DEMO111'), 'old slack_id should be replaced');
});

test('writeField: updates github in flat bold bullet format', () => {
  const content = readFixture('person-flat.md');
  const updated = writeField(content, 'github', 'updated-handle');
  assert.ok(updated !== null);
  assert.ok(updated.includes('updated-handle'));
});

test('writeField: updates epic in project top-level format', () => {
  const content = readFixture('project-demo.md');
  const updated = writeField(content, 'epic', 'NEW-99');
  assert.ok(updated !== null);
  assert.ok(updated.includes('NEW-99'));
});

// ---------------------------------------------------------------------------
// getSlugName
// ---------------------------------------------------------------------------

test('getSlugName converts kebab-case to Title Case', () => {
  assert.equal(getSlugName('demo-jane'), 'Demo Jane');
});

test('getSlugName converts underscore_case to Title Case', () => {
  assert.equal(getSlugName('demo_project'), 'Demo Project');
});

test('getSlugName handles single word', () => {
  const result = getSlugName('alice');
  assert.equal(result, 'Alice');
});
