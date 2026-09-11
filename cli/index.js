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

import { realpathSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

// --- Node version guard ----------------------------------------------------
// The `ch` bin's shebang is `#!/usr/bin/env node`, so it runs under whatever
// `node` the caller's PATH resolves first — this can silently be a stale nvm
// version. Confirmed empirically (2026-09-09) against every Node installed
// under ~/.nvm: v16.20.2, v18.20.4 and v20.17.0 all fail deep inside command
// modules with cryptic errors (`fetch is not defined`, `Named export
// 'getDisplayName' not found` — the ESM/CJS interop needed to import
// dashboard/js/memory-parser.js's named exports isn't reliable on them);
// v20.19.6 and every v22.x tested work. Rather than users hitting those
// cryptic errors, re-exec under the newest qualifying Node found under nvm,
// or fail fast with an actionable message if none qualifies.
function nodeVersionSupported(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (major > 22) return true; // future majors — assume the fix persists forward
  if (major === 22) return true;
  if (major === 20) return minor >= 19;
  return false; // 16, 18, and 20.x < 19 all reproduce the failure
}

/**
 * If the running Node is too old, re-exec this file under the newest
 * qualifying Node found under ~/.nvm/versions/node, inheriting stdio.
 * @returns {boolean} true if it re-exec'd (caller must not continue).
 */
function reexecIfNodeTooOld() {
  if (nodeVersionSupported(process.version)) return false;

  const nvmNodeDir = join(homedir(), '.nvm', 'versions', 'node');
  let candidates = [];
  try {
    candidates = readdirSync(nvmNodeDir)
      .filter(v => /^v\d+\.\d+\.\d+$/.test(v) && nodeVersionSupported(v))
      .sort((a, b) => {
        const pa = a.slice(1).split('.').map(Number);
        const pb = b.slice(1).split('.').map(Number);
        return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
      })
      .reverse();
  } catch { /* no ~/.nvm — fall through to the error message below */ }

  for (const v of candidates) {
    const nodeBin = join(nvmNodeDir, v, 'bin', 'node');
    if (!existsSync(nodeBin)) continue;
    const result = spawnSync(nodeBin, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }

  printErr(
    `ch requires a newer Node than ${process.version} (resolved via \`env node\`) — known-good: v20.19+ or v22+.\n` +
    `No qualifying Node was found under ~/.nvm/versions/node either.\n` +
    `Fix: \`nvm install 22 && nvm alias default 22\`, then make sure your shell's PATH resolves that nvm version before invoking ch.`
  );
  process.exit(1);
}

// Self-run when executed directly or via the npm-linked `ch` bin.
// realpathSync resolves the bin symlink to this file; skipped when imported.
let _isMain = false;
try {
  _isMain = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch { /* argv[1] missing or unreadable — treat as not-main */ }
if (_isMain && !reexecIfNodeTooOld()) {
  run(process.argv.slice(2)).catch(e => { printErr(e?.message || String(e)); process.exit(2); });
}
