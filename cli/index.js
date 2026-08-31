#!/usr/bin/env node
/**
 * cli/index.js
 * Entry point for the ch CLI.
 *
 * Usage: ch <group> [args...]
 * Groups: tasks | mem | gaps | context | manifest
 *
 * Works three ways: imported by the root ./ch wrapper, imported by tests,
 * or executed directly / via the npm-linked `ch` bin (see main-module guard below).
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { print, printErr, die } from './lib/output.js';

const GROUPS = ['tasks', 'mem', 'gaps', 'context', 'manifest', 'slack'];

const USAGE = `ch <group> [args...]

Groups:
  tasks     — manage tasks (list, add, move, edit, done, etc.)
  mem       — query memory files (people, projects, glossary)
  gaps      — pending memory gap questions
  context   — context/session artifacts
  manifest  — memory manifest operations
  slack     — query Slack messages (recent, channels, thread, reactions)

Options:
  --help    — show this help
  --json    — machine-readable JSON output (supported per command)`;

/**
 * Main entry point called by the ch executable.
 * @param {string[]} argv - process.argv.slice(2)
 */
export async function run(argv) {
  const group = argv[0];

  if (!group || group === '--help' || group === 'help') {
    print(USAGE);
    process.exit(0);
  }

  if (!GROUPS.includes(group)) {
    die(`unknown command: ${group}\ngroups: ${GROUPS.join(' | ')}`);
  }

  // Dynamically import the command module — errors only on invocation
  let mod;
  try {
    mod = await import(`./commands/${group}.js`);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      die(`command "${group}" is not yet implemented`, 2);
    }
    throw e;
  }

  await mod.default(argv.slice(1));
}

// Self-run when executed directly or via the npm-linked `ch` bin.
// realpathSync resolves the bin symlink to this file; skipped when imported.
let _isMain = false;
try {
  _isMain = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch { /* argv[1] missing or unreadable — treat as not-main */ }
if (_isMain) {
  run(process.argv.slice(2)).catch(e => { printErr(e?.message || String(e)); process.exit(2); });
}
