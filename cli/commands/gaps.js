/**
 * cli/commands/gaps.js
 *
 * ch gaps <subcommand> [args...]
 *
 * Subcommands:
 *   list [--all]       — print pending (unchecked) gaps, numbered 1..N across all categories
 *                        --all includes checked items too
 *   resolve <n...>    — mark nth unchecked item(s) as resolved (checked), accepts multiple numbers
 *   clear             — remove all checked items, keep unchecked
 *   add "<cat>" "<text>" — append new unchecked item under category (create if missing)
 *
 * File format: memory/pending-gaps.md
 *   # Pending Memory Gap Questions
 *   Generated: YYYY-MM-DD HH:MM
 *   ## Category Name
 *   - [ ] item text
 *   - [x] resolved item text
 */

import { parse } from '../lib/args.js';
import { memoryPath, readText, exists, atomicWrite } from '../lib/io.js';
import { print, printErr, ok, die } from '../lib/output.js';

const GAPS_FILE = memoryPath('pending-gaps.md');

/**
 * Read and parse the gaps file.
 * Returns { header, categories: Map<name, items[]> } where items are {checked, text}.
 * Returns null if file doesn't exist.
 */
function parseGapsFile(content) {
  const lines = content.split('\n');
  const result = {
    header: [], // lines before first ## section
    categories: new Map(), // Map<categoryName, items[]>
  };

  let i = 0;
  // Collect header (everything before first ##)
  while (i < lines.length && !lines[i].startsWith('##')) {
    result.header.push(lines[i]);
    i++;
  }

  // Parse categories
  let currentCategory = null;
  while (i < lines.length) {
    const line = lines[i];
    // Detect category header (##)
    if (line.startsWith('## ')) {
      currentCategory = line.slice(3).trim();
      result.categories.set(currentCategory, []);
      i++;
      continue;
    }

    // Detect checkbox item (- [ ] or - [x])
    if (currentCategory && /^-\s+\[[\sx]\]\s+/.test(line)) {
      const checked = /^\-\s+\[x\]/.test(line);
      const text = line.replace(/^-\s+\[[^\]]\]\s+/, '').trim();
      result.categories.get(currentCategory).push({ checked, text });
    }

    i++;
  }

  return result;
}

/**
 * Collect all unchecked items across categories in order.
 * Returns [{num, category, text}]
 */
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

/**
 * Collect all items (checked and unchecked) for --all listing.
 * Returns [{num, category, text, checked}]
 */
function collectAllItems(parsed) {
  const items = [];
  let num = 1;
  for (const [category, catItems] of parsed.categories) {
    for (const item of catItems) {
      items.push({ num, category, text: item.text, checked: item.checked });
      num++;
    }
  }
  return items;
}

/**
 * Serialize parsed structure back to markdown.
 */
function serializeGapsFile(parsed) {
  const lines = [...parsed.header];

  // Add categories and items
  for (const [category, items] of parsed.categories) {
    lines.push(`## ${category}`);
    for (const item of items) {
      const box = item.checked ? '[x]' : '[ ]';
      lines.push(`- ${box} ${item.text}`);
    }
    lines.push(''); // blank line between categories
  }

  // Trim trailing blank lines and add final newline
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n') + '\n';
}

/**
 * Subcommand: list [--all]
 */
async function cmdList(argv) {
  const { values } = parse(argv, {
    all: { type: 'boolean' },
  });

  if (!exists(GAPS_FILE)) {
    ok('no pending gaps');
    return;
  }

  const content = readText(GAPS_FILE);
  const parsed = parseGapsFile(content);

  const items = values.all
    ? collectAllItems(parsed)
    : collectUncheckedItems(parsed);

  if (items.length === 0) {
    ok('no pending gaps');
    return;
  }

  for (const item of items) {
    const mark = values.all && item.checked ? '[x]' : '[ ]';
    print(`${item.num} ${mark} ${item.category}: ${item.text}`);
  }
}

/**
 * Subcommand: resolve <n...>
 * Marks the nth unchecked item(s) as resolved.
 */
async function cmdResolve(argv) {
  if (argv.length === 0) {
    die('usage: ch gaps resolve <n...>  (e.g. ch gaps resolve 1 3 5)');
  }

  if (!exists(GAPS_FILE)) {
    die('no pending gaps file', 1);
  }

  const content = readText(GAPS_FILE);
  const parsed = parseGapsFile(content);

  // Get unchecked items in order
  const uncheckedItems = collectUncheckedItems(parsed);
  const numSet = new Set();

  for (const arg of argv) {
    const num = parseInt(arg, 10);
    if (isNaN(num) || num < 1) {
      die(`invalid item number: ${arg}`);
    }
    numSet.add(num);
  }

  // Mark items
  let resolved = 0;
  for (const { num } of uncheckedItems) {
    if (numSet.has(num)) {
      // Find and mark this item
      for (const catItems of parsed.categories.values()) {
        const item = catItems.find(it => !it.checked && it.text === uncheckedItems[num - 1].text);
        if (item) {
          item.checked = true;
          resolved++;
          break;
        }
      }
    }
  }

  const remaining = uncheckedItems.length - resolved;
  atomicWrite(GAPS_FILE, serializeGapsFile(parsed));
  ok(`resolved: ${Array.from(numSet).sort((a, b) => a - b).join(',')} (${remaining} remaining)`);
}

/**
 * Subcommand: clear
 * Remove all checked items.
 */
async function cmdClear(argv) {
  if (!exists(GAPS_FILE)) {
    ok('no pending gaps file');
    return;
  }

  const content = readText(GAPS_FILE);
  const parsed = parseGapsFile(content);

  // Count checked items
  let checkedCount = 0;
  for (const catItems of parsed.categories.values()) {
    const filtered = catItems.filter(item => {
      if (item.checked) {
        checkedCount++;
        return false;
      }
      return true;
    });
    catItems.length = 0;
    catItems.push(...filtered);
  }

  // Count remaining unchecked
  let remaining = 0;
  for (const catItems of parsed.categories.values()) {
    remaining += catItems.length;
  }

  // Remove empty categories
  for (const [catName] of parsed.categories) {
    if (parsed.categories.get(catName).length === 0) {
      parsed.categories.delete(catName);
    }
  }

  atomicWrite(GAPS_FILE, serializeGapsFile(parsed));
  ok(`cleared ${checkedCount} resolved (${remaining} remaining)`);
}

/**
 * Subcommand: add "<category>" "<text>"
 * Append a new unchecked item under the category.
 */
async function cmdAdd(argv) {
  if (argv.length < 2) {
    die('usage: ch gaps add "<category>" "<text>"');
  }

  const category = argv[0];
  const text = argv[1];

  let parsed;
  if (exists(GAPS_FILE)) {
    const content = readText(GAPS_FILE);
    parsed = parseGapsFile(content);
  } else {
    // Create new file structure
    parsed = {
      header: [
        '# Pending Memory Gap Questions',
        '',
        `Generated: ${new Date().toISOString().split('T')[0]}`,
        '',
      ],
      categories: new Map(),
    };
  }

  // Add or create category
  if (!parsed.categories.has(category)) {
    parsed.categories.set(category, []);
  }

  parsed.categories.get(category).push({ checked: false, text });

  atomicWrite(GAPS_FILE, serializeGapsFile(parsed));
  ok(`added: ${category}: ${text}`);
}

/**
 * Main dispatcher for gaps subcommands
 */
export default async function gaps(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === '--help' || sub === 'help') {
    print(`ch gaps <subcommand> [args...]

Subcommands:
  list [--all]            — list pending (unchecked) gaps numbered 1..N
                            --all includes resolved items too
  resolve <n...>          — mark nth item(s) as resolved (accepts multiple)
  clear                   — remove all resolved items
  add "<cat>" "<text>"    — add new gap under category`);
    return;
  }

  switch (sub) {
    case 'list':
      return cmdList(rest);
    case 'resolve':
      return cmdResolve(rest);
    case 'clear':
      return cmdClear(rest);
    case 'add':
      return cmdAdd(rest);
    default:
      die(`unknown gaps subcommand: ${sub}`);
  }
}
