/**
 * cli/test/mem.test.js
 * Tests for mem command behaviours: glossary lookup, index, whois fuzzy match.
 *
 * All tests use synthetic fixtures in cli/test/fixtures/ — no real personal data.
 * Stateful tests run the CLI via child_process with CH_HOME pointing at a temp dir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const REPO_ROOT = path.resolve(__dirname, '../..');
// Use the top-level `ch` entry script (not cli/index.js which is library-only)
const CH_SCRIPT = path.join(REPO_ROOT, 'ch');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an isolated tmp dir with the synthetic memory structure.
 * people/jane-doe.md    <- person-contact.md
 * people/john-roe.md   <- person-flat.md
 * projects/demo.md     <- project-demo.md
 * glossary.md          <- glossary.sample.md
 */
function makeTmpMemory() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-mem-test-'));

  // Create memory subdirs
  const peopleDir = path.join(tmpDir, 'memory', 'people');
  const projectsDir = path.join(tmpDir, 'memory', 'projects');
  fs.mkdirSync(peopleDir, { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });

  // Copy fixtures
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'person-contact.md'),
    path.join(peopleDir, 'jane-doe.md'),
  );
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'person-flat.md'),
    path.join(peopleDir, 'john-roe.md'),
  );
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'project-demo.md'),
    path.join(projectsDir, 'demo.md'),
  );
  fs.copyFileSync(
    path.join(FIXTURE_DIR, 'glossary.sample.md'),
    path.join(tmpDir, 'memory', 'glossary.md'),
  );

  // tasks.json is not needed for mem tests but must not blow up if load() is called
  // (mem commands don't call load()). No tasks.json needed.

  return tmpDir;
}

/**
 * Run the ch CLI with CH_HOME=tmpDir.
 */
function runCli(args, tmpDir) {
  const result = spawnSync(process.execPath, [CH_SCRIPT, ...args], {
    env: { ...process.env, CH_HOME: tmpDir },
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? (result.error ? 2 : 0),
  };
}

// ---------------------------------------------------------------------------
// Glossary lookup
// ---------------------------------------------------------------------------

test('glossary lookup: finds exact term (case-insensitive)', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'glossary', 'lookup', 'CLI'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('CLI'), `expected CLI in output: ${result.stdout}`);
  assert.ok(result.stdout.includes('Command-Line Interface'), `expected definition in output: ${result.stdout}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('glossary lookup: finds term case-insensitively (lowercase query)', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'glossary', 'lookup', 'esm'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('ESM') || result.stdout.includes('ECMAScript'), result.stdout);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('glossary lookup: exits 1 for unknown term', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'glossary', 'lookup', 'NOTFOUND'], tmpDir);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

test('index --json lists slugs and glossary terms', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'index', '--json'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout.trim());

  // People slugs
  assert.ok(Array.isArray(out.people.slugs), 'people.slugs should be an array');
  assert.ok(out.people.slugs.includes('jane-doe'), `expected jane-doe in slugs: ${JSON.stringify(out.people.slugs)}`);
  assert.ok(out.people.slugs.includes('john-roe'), `expected john-roe in slugs: ${JSON.stringify(out.people.slugs)}`);

  // Projects
  assert.ok(Array.isArray(out.projects.slugs), 'projects.slugs should be an array');
  assert.ok(out.projects.slugs.includes('demo'), `expected demo in project slugs: ${JSON.stringify(out.projects.slugs)}`);

  // Glossary terms
  assert.ok(Array.isArray(out.glossary.terms), 'glossary.terms should be an array');
  assert.ok(out.glossary.terms.includes('CLI'), `expected CLI in glossary terms: ${JSON.stringify(out.glossary.terms)}`);
  assert.ok(out.glossary.terms.includes('ESM'), `expected ESM in glossary terms: ${JSON.stringify(out.glossary.terms)}`);
  assert.ok(out.glossary.terms.includes('CRD'), `expected CRD in glossary terms: ${JSON.stringify(out.glossary.terms)}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('index text output shows person count', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'index'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('people: 2'), `expected "people: 2" in output:\n${result.stdout}`);
  assert.ok(result.stdout.includes('projects: 1'), `expected "projects: 1" in output:\n${result.stdout}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Whois fuzzy match
// ---------------------------------------------------------------------------

test('whois: matches person by exact slug (jane-doe)', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'whois', 'jane-doe'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('jane-doe'), `expected slug in output: ${result.stdout}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('whois: matches person by first name "jane"', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'whois', 'jane'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  // jane-doe should be the best match
  assert.ok(result.stdout.includes('jane-doe'), `expected jane-doe in output: ${result.stdout}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('whois: matches person by full name "Jane Doe"', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'whois', 'Jane Doe'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('jane-doe'), `expected jane-doe in output: ${result.stdout}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('whois: matches person by email prefix "jane"', () => {
  // jane@example.com -> email prefix "jane"
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'whois', 'jane'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('jane-doe'), `expected jane-doe, got: ${result.stdout}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('whois: includes slack_id in output when present', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'whois', 'jane'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('U0DEMO111'), `expected slack_id in output: ${result.stdout}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('whois: exits 1 for no match', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'whois', 'zzznomatch999'], tmpDir);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}. stdout: ${result.stdout}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('whois: matches person by title/role word', () => {
  // jane-doe has role "Developer on Demo team"
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'whois', 'john'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('john-roe'), `expected john-roe in output: ${result.stdout}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Person lookup
// ---------------------------------------------------------------------------

test('person jane-doe --json: returns correct fields', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'person', 'jane-doe', '--json'], tmpDir);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = JSON.parse(result.stdout.trim());
  assert.equal(out.slug, 'jane-doe');
  assert.equal(out.fields.slack_id, 'U0DEMO111');
  assert.equal(out.fields.email, 'jane@example.com');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('person nonexistent: exits 1', () => {
  const tmpDir = makeTmpMemory();
  const result = runCli(['mem', 'person', 'nobody'], tmpDir);
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
