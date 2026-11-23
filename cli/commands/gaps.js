/**
 * cli/commands/gaps.js
 *
 * ch gaps <subcommand> [args...]
 *
 * Subcommands:
 *   list [--all]       — print pending (unchecked) gaps, numbered 1..N across all categories
 *                        --all includes checked items too
 *   resolve <ref...>  — mark item(s) resolved; ref is a stable id (g-xxxxxxxx) or a 1-based
 *                        position among unchecked items (legacy; unstable under concurrent edits)
 *   reconcile --candidates <file|-> [--write] [--prune] [--json]
 *                      — diff candidate gaps (same markdown format) against the current file
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

import fs from 'node:fs';
import crypto from 'node:crypto';
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
 * Stable id: hash of the normalized question (text before the first " — " evidence
 * separator), so it survives index shifts, category moves and evidence rewrites.
 */
function normalizeQuestion(text) {
  const q = text.split(' — ')[0];
  return q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function gapId(text) {
  return 'g-' + crypto.createHash('sha1').update(normalizeQuestion(text)).digest('hex').slice(0, 8);
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
        items.push({ num, id: gapId(item.text), category, text: item.text });
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
      items.push({ num, id: gapId(item.text), category, text: item.text, checked: item.checked });
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
    json: { type: 'boolean' },
  });

  if (!exists(GAPS_FILE)) {
    if (values.json) print('[]');
    else ok('no pending gaps');
    return;
  }

  const content = readText(GAPS_FILE);
  const parsed = parseGapsFile(content);

  const items = values.all
    ? collectAllItems(parsed)
    : collectUncheckedItems(parsed);

  if (values.json) {
    print(JSON.stringify(items, null, 2));
    return;
  }

  if (items.length === 0) {
    ok('no pending gaps');
    return;
  }

  for (const item of items) {
    const mark = values.all && item.checked ? '[x]' : '[ ]';
    print(`${item.num} ${mark} ${item.category}: ${item.text} (${item.id})`);
  }
}

/**
 * Subcommand: resolve <n...>
 * Marks the nth unchecked item(s) as resolved.
 */
async function cmdResolve(argv) {
  if (argv.length === 0) {
    die('usage: ch gaps resolve <ref...>  (ref = g-xxxxxxxx id from `ch gaps list`, or legacy position number)');
  }

  if (!exists(GAPS_FILE)) {
    die('no pending gaps file', 1);
  }

  const parsed = parseGapsFile(readText(GAPS_FILE));
  const unchecked = collectUncheckedItems(parsed);

  // Resolve every ref to a stable id up front, so one bad ref aborts before any write.
  const ids = new Set();
  const labels = [];
  for (const arg of argv) {
    if (/^g-[0-9a-f]{8}$/.test(arg)) {
      if (!unchecked.some(it => it.id === arg)) die(`no open gap with id: ${arg}`);
      ids.add(arg);
      labels.push(arg);
    } else if (/^\d+$/.test(arg) && parseInt(arg, 10) >= 1) {
      const num = parseInt(arg, 10);
      const item = unchecked[num - 1];
      if (!item) die(`no open gap at position ${num}`);
      ids.add(item.id);
      labels.push(arg);
    } else {
      die(`invalid gap ref: ${arg}`);
    }
  }

  let resolved = 0;
  for (const catItems of parsed.categories.values()) {
    for (const item of catItems) {
      if (!item.checked && ids.has(gapId(item.text))) {
        item.checked = true;
        resolved++;
      }
    }
  }

  const remaining = unchecked.length - resolved;
  atomicWrite(GAPS_FILE, serializeGapsFile(parsed));
  ok(`resolved: ${labels.join(',')} (${remaining} remaining)`);
}

/**
 * Subcommand: reconcile --candidates <file|-> [--write] [--prune] [--json]
 *
 * Candidates use the same markdown format. Each candidate is classified by stable id:
 *   new        — not in the current file
 *   open       — already an unchecked item (kept as is)
 *   resolved   — matches a checked item (dropped, never re-listed)
 * Existing unchecked items absent from candidates are "stale"; kept unless --prune.
 * Read-only unless --write; --write replaces the file with: candidate items that are
 * new/open + (unless --prune) stale open items + existing resolved items.
 */
async function cmdReconcile(argv) {
  const { values } = parse(argv, {
    candidates: { type: 'string' },
    write: { type: 'boolean' },
    prune: { type: 'boolean' },
    json: { type: 'boolean' },
  });
  if (!values.candidates) {
    die('usage: ch gaps reconcile --candidates <file|-> [--write] [--prune] [--json]');
  }

  let candText;
  try {
    candText = values.candidates === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(values.candidates, 'utf8');
  } catch (e) {
    die(`cannot read candidates: ${e.message}`);
  }
  const cand = parseGapsFile(candText);
  const current = exists(GAPS_FILE)
    ? parseGapsFile(readText(GAPS_FILE))
    : { header: [], categories: new Map() };

  const resolvedIds = new Set();
  const openIds = new Set();
  for (const items of current.categories.values()) {
    for (const it of items) (it.checked ? resolvedIds : openIds).add(gapId(it.text));
  }

  const report = { new: [], open: [], resolved: [], stale: [] };
  const seen = new Set();
  const merged = new Map();
  const push = (cat, item) => {
    if (!merged.has(cat)) merged.set(cat, []);
    merged.get(cat).push(item);
  };

  for (const [category, items] of cand.categories) {
    for (const it of items) {
      const id = gapId(it.text);
      if (seen.has(id)) continue; // duplicate within candidates
      seen.add(id);
      const entry = { id, category, text: it.text };
      if (resolvedIds.has(id)) {
        report.resolved.push(entry);
      } else if (openIds.has(id)) {
        report.open.push(entry);
        push(category, { checked: false, text: it.text });
      } else {
        report.new.push(entry);
        push(category, { checked: false, text: it.text });
      }
    }
  }

  for (const [category, items] of current.categories) {
    for (const it of items) {
      const id = gapId(it.text);
      if (it.checked) {
        push(category, it);
      } else if (!seen.has(id)) {
        report.stale.push({ id, category, text: it.text });
        if (!values.prune) push(category, it);
      }
    }
  }

  if (values.write) {
    const header = cand.header.some(l => l.trim()) ? cand.header : current.header.length
      ? current.header
      : ['# Pending Memory Gap Questions', '', `Generated: ${new Date().toISOString().split('T')[0]}`, ''];
    atomicWrite(GAPS_FILE, serializeGapsFile({ header, categories: merged }));
  }

  if (values.json) {
    print(JSON.stringify({ ...report, written: !!values.write }, null, 2));
    return;
  }
  for (const kind of ['new', 'open', 'resolved', 'stale']) {
    for (const e of report[kind]) print(`${kind} ${e.id} ${e.category}: ${e.text}`);
  }
  ok(`new ${report.new.length}, open ${report.open.length}, resolved-skipped ${report.resolved.length}, stale ${report.stale.length}${values.write ? ' (written)' : ' (dry run)'}`);
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
  list --json             — machine-readable list including stable ids
  resolve <ref...>        — resolve by stable id (g-xxxxxxxx) or legacy position number
  reconcile --candidates <file|-> [--write] [--prune] [--json]
                          — diff candidate gaps vs current/resolved; --write merges
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
    case 'reconcile':
      return cmdReconcile(rest);
    default:
      die(`unknown gaps subcommand: ${sub}`);
  }
}
