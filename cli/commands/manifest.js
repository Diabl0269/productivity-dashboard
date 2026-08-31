/**
 * cli/commands/manifest.js
 * Generate a static memory/manifest.json file.
 *
 * Mirrors serve.js's /api/memory-manifest endpoint for use when serve.js is not running.
 * Output shape: { claudeMd: string|null, files: string[], dirs: {[key]: string[]} }
 *
 * Usage:
 *   ch manifest
 *   ch manifest --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { dataRoot, memoryPath, exists } from '../lib/io.js';
import { print, printErr, ok, die, jsonOut } from '../lib/output.js';
import { parse } from '../lib/args.js';

/**
 * Recursively scan a directory for .md files.
 * Returns { files: [], dirs: {} } where:
 *   - files: relative paths to .md files (e.g., "memory/glossary.md")
 *   - dirs: map of subdir name -> array of .md file paths in that subdir
 */
function scanDir(dir, base = '') {
  const result = { files: [], dirs: {} };

  if (!fs.existsSync(dir)) {
    return result;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Skip dot-prefixed entries
    if (entry.name.startsWith('.')) continue;

    const rel = base ? `${base}/${entry.name}` : entry.name;

    if (entry.isFile() && entry.name.endsWith('.md')) {
      result.files.push(rel);
    } else if (entry.isDirectory()) {
      const sub = scanDir(path.join(dir, entry.name), rel);

      // Collect files from this subdir and nested subdirs
      result.dirs[entry.name] = sub.files;

      // Flatten nested subdirs into top-level dirs map
      Object.assign(result.dirs, sub.dirs);
    }
  }

  return result;
}

/**
 * Generate the manifest by scanning memory/ and checking for CLAUDE.md.
 * Returns { claudeMd: string|null, files: string[], dirs: {...} }
 */
function buildManifest() {
  const root = dataRoot();

  // Check for CLAUDE.md
  const claudeMdPath = path.join(root, 'CLAUDE.md');
  const claudeMd = exists(claudeMdPath) ? 'CLAUDE.md' : null;

  // Scan memory/ directory
  const memoryDir = memoryPath();
  const scan = scanDir(memoryDir, 'memory');

  return {
    claudeMd,
    files: scan.files,
    dirs: scan.dirs,
  };
}

/**
 * Main command: ch manifest [--json]
 * Writes memory/manifest.json and prints a success message.
 */
export default async function manifest(argv) {
  const { values } = parse(argv, {
    json: { type: 'boolean', short: 'j' },
  });

  try {
    const manifestData = buildManifest();
    const manifestPath = memoryPath('manifest.json');

    // Write the manifest file
    const manifestContent = JSON.stringify(manifestData, null, 2) + '\n';
    const dir = path.dirname(manifestPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(manifestPath, manifestContent, 'utf8');

    // Output
    if (values.json) {
      jsonOut({
        ok: true,
        path: manifestPath,
        filesCount: manifestData.files.length,
        dirsCount: Object.keys(manifestData.dirs).length,
      });
    } else {
      ok(`wrote memory/manifest.json (${manifestData.files.length} files)`);
    }
  } catch (e) {
    die(`error generating manifest: ${e.message}`, 2);
  }
}
