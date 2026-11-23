/**
 * cli/test/gaps.test.js
 * Manual verification tests for the gaps command.
 *
 * Run: node cli/test/gaps.test.js
 *
 * Note: These are conceptual tests showing expected behavior.
 * For integration testing, run the ch gaps commands directly.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('Testing gaps.js functionality:\n');

// Test 1: Parse basic gaps file format
console.log('✓ Test: gaps file format');
const samplePath = path.join(__dirname, 'fixtures/pending-gaps.sample.md');
const sampleContent = fs.readFileSync(samplePath, 'utf8');
assert(sampleContent.includes('# Pending Memory Gap Questions'), 'Has main title');
assert(sampleContent.includes('## People'), 'Has category');
assert(sampleContent.includes('- [ ]'), 'Has unchecked items');
assert(sampleContent.includes('- [x]'), 'Has checked items');
console.log('  Sample file format is valid\n');

// Test 2: Verify parse logic (inline)
console.log('✓ Test: parse gaps file');
function parseGapsFile(content) {
  const lines = content.split('\n');
  const result = { header: [], categories: new Map() };
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('##')) {
    result.header.push(lines[i]);
    i++;
  }
  let currentCategory = null;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      currentCategory = line.slice(3).trim();
      result.categories.set(currentCategory, []);
      i++;
      continue;
    }
    if (currentCategory && /^-\s+\[[\sx]\]\s+/.test(line)) {
      const checked = /^\-\s+\[x\]/.test(line);
      const text = line.replace(/^-\s+\[[^\]]\]\s+/, '').trim();
      result.categories.get(currentCategory).push({ checked, text });
    }
    i++;
  }
  return result;
}

const parsed = parseGapsFile(sampleContent);
assert.equal(parsed.categories.size, 2, 'Should have 2 categories');
assert(parsed.categories.has('People'), 'Should have People category');
assert(parsed.categories.has('Projects'), 'Should have Projects category');

const peopleItems = parsed.categories.get('People');
assert.equal(peopleItems.length, 2, 'People should have 2 items');
assert.equal(peopleItems[0].checked, false, 'First People item unchecked');
assert.equal(peopleItems[1].checked, false, 'Second People item unchecked');

const projectsItems = parsed.categories.get('Projects');
assert.equal(projectsItems.length, 2, 'Projects should have 2 items');
assert.equal(projectsItems[0].checked, false, 'First Projects item unchecked');
assert.equal(projectsItems[1].checked, true, 'Second Projects item checked');
console.log('  File parsing works correctly\n');

// Test 3: Verify item numbering logic
console.log('✓ Test: item numbering');
function collectUncheckedItems(parsed) {
  const items = [];
  let num = 1;
  for (const [category, catItems] of parsed.categories) {
    for (const item of catItems) {
      if (!item.checked) {
        items.push({ num, category, text: item.text });
        num++;
      }
    }
  }
  return items;
}

const unchecked = collectUncheckedItems(parsed);
assert.equal(unchecked.length, 3, 'Should have 3 unchecked items');
assert.equal(unchecked[0].num, 1);
assert.equal(unchecked[1].num, 2);
assert.equal(unchecked[2].num, 3);
console.log('  Item numbering is correct\n');

// Test 4: Verify serialization
console.log('✓ Test: file serialization');
function serializeGapsFile(parsed) {
  const lines = [...parsed.header];
  for (const [category, items] of parsed.categories) {
    lines.push(`## ${category}`);
    for (const item of items) {
      const box = item.checked ? '[x]' : '[ ]';
      lines.push(`- ${box} ${item.text}`);
    }
    lines.push('');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n') + '\n';
}

const serialized = serializeGapsFile(parsed);
assert(serialized.includes('# Pending Memory Gap Questions'), 'Serialized has title');
assert(serialized.includes('## People'), 'Serialized has People category');
assert(serialized.includes('- [x]'), 'Serialized preserves checked items');
console.log('  File serialization works\n');

// Test 5: Verify help text
console.log('✓ Test: help text');
const gapsPath = path.join(__dirname, '..', 'commands', 'gaps.js');
const gapsContent = fs.readFileSync(gapsPath, 'utf8');
assert(gapsContent.includes('ch gaps'), 'Has usage info');
assert(gapsContent.includes('list'), 'Documents list command');
assert(gapsContent.includes('resolve'), 'Documents resolve command');
assert(gapsContent.includes('clear'), 'Documents clear command');
assert(gapsContent.includes('add'), 'Documents add command');
console.log('  Help text is complete\n');

console.log('All manual verification tests passed!');
console.log('\nFor integration tests, run:');
console.log('  node -e "import(\'./cli/index.js\').then(m => m.run([\'gaps\', \'list\']))"');

// --- Integration tests (CH_HOME temp dir; never touches live memory) ---
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const CH = path.join(__dirname, '..', 'index.js');
function mk(content) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gaps-'));
  fs.mkdirSync(path.join(home, 'memory'));
  if (content != null) fs.writeFileSync(path.join(home, 'memory', 'pending-gaps.md'), content);
  return home;
}
function ch(home, args, input) {
  const r = spawnSync(process.execPath, [CH, 'gaps', ...args], {
    encoding: 'utf8', input, env: { ...process.env, CH_HOME: home },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const file = home => fs.readFileSync(path.join(home, 'memory', 'pending-gaps.md'), 'utf8');

console.log('✓ Test: stable ids survive index shifts');
{
  const home = mk(sampleContent);
  const list = JSON.parse(ch(home, ['list', '--json']).out);
  assert.equal(list.length, 3);
  assert(/^g-[0-9a-f]{8}$/.test(list[2].id));
  // Another writer resolves item 1 first; resolving by id still hits the right gap.
  assert.equal(ch(home, ['resolve', list[0].id]).code, 0);
  assert.equal(ch(home, ['resolve', list[2].id]).code, 0);
  const after = file(home);
  assert(after.includes('- [x] What is Alex'));
  assert(after.includes('- [ ] Does Osher'));
  assert(after.includes('- [x] What is the target release'));
  // Unknown id / out-of-range position abort without writing.
  const before = file(home);
  assert.notEqual(ch(home, ['resolve', 'g-00000000']).code, 0);
  assert.notEqual(ch(home, ['resolve', '9']).code, 0);
  assert.notEqual(ch(home, ['resolve', '1', 'g-00000000']).code, 0);
  assert.equal(file(home), before);
}
console.log('  ok\n');

console.log('✓ Test: legacy positional resolve still works');
{
  const home = mk(sampleContent);
  assert.equal(ch(home, ['resolve', '2']).code, 0);
  assert(file(home).includes('- [x] Does Osher'));
}
console.log('  ok\n');

console.log('✓ Test: reconcile classifies and (dry run) does not write');
{
  const home = mk(sampleContent.replace('## Projects', '## Projects\n\n- [x] Old resolved question — evidence A'));
  const cands = [
    '# Pending Memory Gap Questions', 'Generated: 2099-01-01', '',
    '## People', '- [ ] what is alex\'s last name and github username? — new evidence',
    '- [ ] Brand new question? — x',
    '## Projects', '- [ ] Old resolved question — evidence B',
    '- [ ] Brand new question? — dup', '',
  ].join('\n');
  const before = file(home);
  const r = JSON.parse(ch(home, ['reconcile', '--candidates', '-', '--json'], cands).out);
  assert.equal(r.new.length, 1);
  assert.equal(r.open.length, 1);
  assert.equal(r.resolved.length, 1);
  assert.equal(r.stale.length, 2); // Osher, target release
  assert.equal(r.written, false);
  assert.equal(file(home), before);
}
console.log('  ok\n');

console.log('✓ Test: reconcile --write merges; --prune drops stale');
{
  const home = mk(sampleContent);
  const cands = '# Pending Memory Gap Questions\nGenerated: 2099-01-01\n\n## People\n- [ ] Brand new question?\n- [ ] Does Osher have a Slack ID on file? — fresh\n';
  assert.equal(ch(home, ['reconcile', '--candidates', '-', '--write'], cands).code, 0);
  let f = file(home);
  assert(f.includes('Generated: 2099-01-01'));
  assert(f.includes('- [ ] Brand new question?'));
  assert(f.includes('- [ ] What is Alex'), 'stale open kept without --prune');
  assert(f.includes('- [x] Confirmed: Demo-Jane'), 'resolved preserved');
  assert.equal(ch(home, ['reconcile', '--candidates', '-', '--write', '--prune'], cands).code, 0);
  f = file(home);
  assert(!f.includes('What is Alex'), 'stale pruned');
  assert(f.includes('- [x] Confirmed: Demo-Jane'));
  // A re-run is idempotent.
  const once = file(home);
  ch(home, ['reconcile', '--candidates', '-', '--write', '--prune'], cands);
  assert.equal(file(home), once);
}
console.log('  ok\n');

console.log('Gaps integration tests passed');
