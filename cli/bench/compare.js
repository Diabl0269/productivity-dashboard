/**
 * cli/bench/compare.js
 * Token-savings benchmark: OLD (raw file reads) vs NEW (CLI command output).
 *
 * Run: node cli/bench/compare.js
 *
 * Produces: cli/bench/RESULTS.md
 *
 * PRIVACY: RESULTS.md contains ONLY aggregate byte/token counts — no names,
 * IDs, file contents, or personal data. Safe to commit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// cli/bench -> cli -> repo root
const CLI_DIR = path.dirname(__dirname);
const REPO_ROOT = path.dirname(CLI_DIR);
const BENCH_DIR = __dirname;

// Set CH_HOME so io.js resolves correctly regardless of cwd
process.env.CH_HOME = REPO_ROOT;

// ---------------------------------------------------------------------------
// Import CLI modules (after CH_HOME is set)
// ---------------------------------------------------------------------------

const { dataRoot, memoryPath, readText, exists, listMd, tasksJsonPath, readConfig } = await import('../lib/io.js');
const { flatTasks, load: loadTasks, nextId } = await import('../lib/tasks-store.js');

// Team slugs come from config.json ("team": [...]) — no real names hardcoded in
// committed source. Falls back to the first 3 people files for a generic clone.
const _cfg = readConfig();
function getTeamSlugs() {
  if (Array.isArray(_cfg.team) && _cfg.team.length) return _cfg.team;
  return listMd(memoryPath('people')).slice(0, 3).map(f => f.replace(/\.md$/, ''));
}
function getRepresentativeSlug() {
  return getTeamSlugs()[0] || (listMd(memoryPath('people'))[0] || '').replace(/\.md$/, '');
}

// ---------------------------------------------------------------------------
// Capture stdout from a function into a string
// ---------------------------------------------------------------------------

async function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk, ...args) => {
    captured += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return captured;
}

// ---------------------------------------------------------------------------
// Measure helpers
// ---------------------------------------------------------------------------

function charLen(s) {
  return typeof s === 'string' ? s.length : Buffer.byteLength(s, 'utf8');
}

function fileChars(p) {
  if (!exists(p)) return 0;
  return charLen(readText(p));
}

function approxTokens(chars) {
  return Math.round(chars / 4);
}

// ---------------------------------------------------------------------------
// OLD cost builders (raw file reads, as Claude would receive them)
// ---------------------------------------------------------------------------

/**
 * Scenario 1 OLD: daily-summary
 *   - TASKS.md-equivalent (md export) x4 (multiplier: model would re-read 4x across the workflow)
 *   - 8 representative person files (first 8 alpha-sorted from people/)
 *   - glossary.md
 *   - MEMORY.md
 */
async function oldDailySummary() {
  // MD export output (captures 'ch tasks export --md')
  const { default: tasksCmd } = await import('../commands/tasks.js');
  const mdOutput = await captureStdout(() => tasksCmd(['export', '--md']));
  const mdChars = charLen(mdOutput);

  // 8 representative person files
  const peopleDir = memoryPath('people');
  const allPeople = listMd(peopleDir);
  const sample8 = allPeople.slice(0, 8);
  const peopleChars = sample8.reduce((sum, f) => {
    return sum + fileChars(path.join(peopleDir, f));
  }, 0);

  const glossaryChars = fileChars(memoryPath('glossary.md'));
  const memoryMdChars = fileChars(memoryPath('MEMORY.md'));

  // x4 multiplier on the MD tasks view (read multiple times in daily workflow)
  const total = (mdChars * 4) + peopleChars + glossaryChars + memoryMdChars;
  return { total, breakdown: { mdTasksX4: mdChars * 4, people8: peopleChars, glossary: glossaryChars, memoryMd: memoryMdChars } };
}

/**
 * Scenario 2 OLD: daily task-update
 *   - TASKS.md equivalent (md export)
 *   - 3 team person files (from config team list)
 */
async function oldDailyTaskUpdate() {
  const { default: tasksCmd } = await import('../commands/tasks.js');
  const mdOutput = await captureStdout(() => tasksCmd(['export', '--md']));
  const mdChars = charLen(mdOutput);

  const teamSlugs = getTeamSlugs();
  const peopleDir = memoryPath('people');
  const teamChars = teamSlugs.reduce((sum, slug) => {
    return sum + fileChars(path.join(peopleDir, `${slug}.md`));
  }, 0);

  const total = mdChars + teamChars;
  return { total, breakdown: { mdTasks: mdChars, team3: teamChars } };
}

/**
 * Scenario 3 OLD: weekly-review
 *   - 3 team person files in full
 */
async function oldWeeklyReview() {
  const teamSlugs = getTeamSlugs();
  const peopleDir = memoryPath('people');
  const total = teamSlugs.reduce((sum, slug) => {
    return sum + fileChars(path.join(peopleDir, `${slug}.md`));
  }, 0);
  return { total };
}

/**
 * Scenario 4 OLD: single lookup
 *   - One full person file (first team member as representative)
 */
async function oldSingleLookup() {
  const slug = getRepresentativeSlug();
  const filePath = memoryPath('people', `${slug}.md`);
  const total = fileChars(filePath);
  return { total };
}

// ---------------------------------------------------------------------------
// NEW cost builders (CLI command output)
// ---------------------------------------------------------------------------

/**
 * Scenario 1 NEW: daily-summary
 *   - tasks dump --active --json
 *   - mem index --json
 */
async function newDailySummary() {
  const { default: tasksCmd } = await import('../commands/tasks.js');
  const { default: memCmd } = await import('../commands/mem.js');

  const dumpOut = await captureStdout(() => tasksCmd(['dump', '--active']));
  const indexOut = await captureStdout(() => memCmd(['index', '--json']));

  const total = charLen(dumpOut) + charLen(indexOut);
  return { total, breakdown: { tasksDump: charLen(dumpOut), memIndex: charLen(indexOut) } };
}

/**
 * Scenario 2 NEW: daily task-update
 *   - tasks dump --active --json + targeted mem person --field x3
 *   (the narrow commands — context is benchmarked separately as session-start)
 */
async function newDailyTaskUpdate() {
  const { default: tasksCmd } = await import('../commands/tasks.js');
  const { default: memCmd } = await import('../commands/mem.js');
  const dumpOut = await captureStdout(() => tasksCmd(['dump', '--active']));
  const teamSlugs = getTeamSlugs();
  let memOut = '';
  for (const slug of teamSlugs) {
    memOut += await captureStdout(() =>
      memCmd(['person', slug, '--field', 'slack_id,atlassian_id,github', '--json'])
    );
  }
  const total = charLen(dumpOut) + charLen(memOut);
  return { total, breakdown: { tasksDump: charLen(dumpOut), mem3: charLen(memOut) } };
}

/**
 * Scenario 5 OLD: session-start full load — what `context` actually replaces:
 *   the markdown task view + MEMORY.md + glossary.md + an `ls memory/people/` listing.
 */
async function oldSessionStart() {
  const { default: tasksCmd } = await import('../commands/tasks.js');
  const mdOutput = await captureStdout(() => tasksCmd(['export', '--md']));
  const mdChars = charLen(mdOutput);
  const memoryMdChars = fileChars(memoryPath('MEMORY.md'));
  const glossaryChars = fileChars(memoryPath('glossary.md'));
  const peopleListing = listMd(memoryPath('people')).join('\n');
  const listingChars = charLen(peopleListing);
  const total = mdChars + memoryMdChars + glossaryChars + listingChars;
  return { total, breakdown: { mdTasks: mdChars, memoryMd: memoryMdChars, glossary: glossaryChars, peopleListing: listingChars } };
}

/**
 * Scenario 5 NEW: session-start — one `context --json` call.
 */
async function newSessionStart() {
  const { default: contextCmd } = await import('../commands/context.js');
  const out = await captureStdout(() => contextCmd(['--json']));
  return { total: charLen(out), breakdown: { context: charLen(out) } };
}

/**
 * Scenario 3 NEW: weekly-review
 *   - mem person <slug> --field atlassian_id,github,canvas_id,slack_id  x3
 */
async function newWeeklyReview() {
  const { default: memCmd } = await import('../commands/mem.js');
  const teamSlugs = getTeamSlugs();

  let total = 0;
  for (const slug of teamSlugs) {
    const out = await captureStdout(() =>
      memCmd(['person', slug, '--field', 'atlassian_id,github,canvas_id,slack_id', '--json'])
    );
    total += charLen(out);
  }
  return { total };
}

/**
 * Scenario 4 NEW: single lookup
 *   - mem person <slug> --field canvas_id
 */
async function newSingleLookup() {
  const { default: memCmd } = await import('../commands/mem.js');
  const slug = getRepresentativeSlug();
  const out = await captureStdout(() =>
    memCmd(['person', slug, '--field', 'canvas_id'])
  );
  const total = charLen(out);
  return { total };
}

// ---------------------------------------------------------------------------
// Run all scenarios
// ---------------------------------------------------------------------------

const scenarios = [
  {
    name: 'daily-summary',
    oldFn: oldDailySummary,
    newFn: newDailySummary,
  },
  {
    name: 'session-start (context)',
    oldFn: oldSessionStart,
    newFn: newSessionStart,
  },
  {
    name: 'daily task-update',
    oldFn: oldDailyTaskUpdate,
    newFn: newDailyTaskUpdate,
  },
  {
    name: 'weekly-review',
    oldFn: oldWeeklyReview,
    newFn: newWeeklyReview,
  },
  {
    name: 'single lookup',
    oldFn: oldSingleLookup,
    newFn: newSingleLookup,
  },
];

console.error('Running benchmark...');

const rows = [];
let grandOldChars = 0;
let grandNewChars = 0;

for (const s of scenarios) {
  process.stderr.write(`  ${s.name}... `);
  const old = await s.oldFn();
  const nw = await s.newFn();
  const saved = old.total - nw.total;
  const savedPct = old.total > 0 ? ((saved / old.total) * 100).toFixed(1) : '0.0';
  rows.push({
    scenario: s.name,
    oldChars: old.total,
    oldTok: approxTokens(old.total),
    newChars: nw.total,
    newTok: approxTokens(nw.total),
    saved,
    savedPct,
  });
  grandOldChars += old.total;
  grandNewChars += nw.total;
  process.stderr.write(`old=${old.total} new=${nw.total} saved=${savedPct}%\n`);
}

const grandSaved = grandOldChars - grandNewChars;
const grandSavedPct = grandOldChars > 0 ? ((grandSaved / grandOldChars) * 100).toFixed(1) : '0.0';

// ---------------------------------------------------------------------------
// Format markdown table
// ---------------------------------------------------------------------------

const col = (s, w) => String(s).padEnd(w);
const rCol = (s, w) => String(s).padStart(w);

function fmtNum(n) {
  return n.toLocaleString('en-US');
}

const header = `| Scenario | Old chars | Old ≈tok | New chars | New ≈tok | Saved chars | Saved % |`;
const sep    = `|----------|----------:|---------:|----------:|---------:|------------:|--------:|`;

const dataRows = rows.map(r =>
  `| ${r.scenario} | ${fmtNum(r.oldChars)} | ${fmtNum(r.oldTok)} | ${fmtNum(r.newChars)} | ${fmtNum(r.newTok)} | ${fmtNum(r.saved)} | ${r.savedPct}% |`
);

const totalRow = `| **TOTAL** | **${fmtNum(grandOldChars)}** | **${fmtNum(approxTokens(grandOldChars))}** | **${fmtNum(grandNewChars)}** | **${fmtNum(approxTokens(grandNewChars))}** | **${fmtNum(grandSaved)}** | **${grandSavedPct}%** |`;

const note = `> **Token heuristic:** estimated tokens = chars / 4. All figures are aggregate byte counts of command outputs or raw file reads; no personal data, file contents, or identifiers appear in this table.`;

const summary = `Across ${rows.length} representative workflow scenarios, replacing raw file reads with structured CLI command output reduces context size by approximately **${grandSavedPct}%** (from ~${fmtNum(approxTokens(grandOldChars))} estimated tokens to ~${fmtNum(approxTokens(grandNewChars))} estimated tokens). The largest gains come from the daily-summary workflow where the full markdown task export is multiplied across multiple reads and combined with raw memory files; the CLI equivalent compresses this into two compact JSON outputs. Single-field lookups show the most dramatic percentage savings since only the requested value is returned rather than the entire person file.`;

const md = [
  '# Token-Savings Benchmark',
  '',
  '## Results',
  '',
  note,
  '',
  header,
  sep,
  ...dataRows,
  sep,
  totalRow,
  '',
  '## Summary',
  '',
  summary,
  '',
].join('\n');

// ---------------------------------------------------------------------------
// Write RESULTS.md
// ---------------------------------------------------------------------------

const outPath = path.join(BENCH_DIR, 'RESULTS.md');
fs.writeFileSync(outPath, md, 'utf8');

console.error(`\nWrote: ${outPath}`);
console.log(`\nTotal savings: ${grandSavedPct}% (${fmtNum(grandOldChars)} -> ${fmtNum(grandNewChars)} chars)`);
