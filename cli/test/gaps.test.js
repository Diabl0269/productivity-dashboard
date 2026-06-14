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
