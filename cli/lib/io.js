/**
 * cli/lib/io.js
 * File I/O helpers for the ch CLI.
 *
 * Exports:
 *   dataRoot(): string
 *   tasksJsonPath(): string
 *   tasksMdPath(): string
 *   memoryPath(...sub): string
 *   readText(absPath): string
 *   readJson(absPath): any
 *   exists(absPath): boolean
 *   atomicWrite(absPath, content): void
 *   listMd(absDir): string[]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Walk up from startDir until we find a directory containing serve.js AND dashboard.
function _findRoot(startDir) {
  let dir = startDir;
  while (true) {
    const hasServe = fs.existsSync(path.join(dir, 'serve.js'));
    const hasDashboard = fs.existsSync(path.join(dir, 'dashboard'));
    if (hasServe && hasDashboard) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

// Resolve absolute path of cli/ dir (where this file lives)
const _cliDir = path.dirname(fileURLToPath(import.meta.url));
// cli/lib -> cli -> repo root
const _cliParent = path.dirname(path.dirname(_cliDir));

let _cachedRoot = null;

/**
 * Returns the repo data root (absolute path).
 * Priority:
 *   1. CH_HOME env var
 *   2. Walk up from process.cwd() for serve.js + dashboard
 *   3. Walk up from cli/ location for serve.js + dashboard
 *   4. cli/.. (fallback)
 */
export function dataRoot() {
  if (_cachedRoot) return _cachedRoot;

  if (process.env.CH_HOME) {
    _cachedRoot = path.resolve(process.env.CH_HOME);
    return _cachedRoot;
  }

  const fromCwd = _findRoot(process.cwd());
  if (fromCwd) {
    _cachedRoot = fromCwd;
    return _cachedRoot;
  }

  const fromCli = _findRoot(_cliParent);
  if (fromCli) {
    _cachedRoot = fromCli;
    return _cachedRoot;
  }

  // Fallback: cli/..
  _cachedRoot = _cliParent;
  return _cachedRoot;
}

/** Absolute path to tasks.json */
export function tasksJsonPath() {
  return path.join(dataRoot(), 'tasks.json');
}

/** Absolute path to TASKS.md */
export function tasksMdPath() {
  return path.join(dataRoot(), 'TASKS.md');
}

/** Absolute path inside memory/ */
export function memoryPath(...sub) {
  return path.join(dataRoot(), 'memory', ...sub);
}

/** Absolute path to config.json */
export function configPath() {
  return path.join(dataRoot(), 'config.json');
}

/**
 * Read config.json if present, else return {}.
 * Used for runtime-configurable, gitignored settings (e.g. the team slug list)
 * so no personal data is hardcoded in committed source.
 */
export function readConfig() {
  const p = configPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/** Absolute path to nicknames.json */
export function nicknamesPath() {
  return path.join(dataRoot(), 'nicknames.json');
}

/**
 * Read nicknames.json — a gitignored, per-user list of name spelling-equivalence
 * pairs for fuzzy whois matching, e.g. [["jon","jonathan"], ["liz","elizabeth"]].
 * Accepts either a bare array of pairs or { "aliases": [...] }. Returns [] if
 * missing/invalid. A fictional nicknames.example.json ships as the template.
 */
export function readNicknames() {
  const p = nicknamesPath();
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.aliases)) return data.aliases;
    return [];
  } catch {
    return [];
  }
}

/**
 * Read a file as UTF-8 string. Throws a clean Error if missing.
 */
export function readText(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`not found: ${absPath}`);
  }
  return fs.readFileSync(absPath, 'utf8');
}

/**
 * Read and JSON.parse a file. Throws if missing or invalid JSON.
 */
export function readJson(absPath) {
  const text = readText(absPath);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`invalid JSON in ${absPath}: ${e.message}`);
  }
}

/** Returns true if path exists (file or dir). */
export function exists(absPath) {
  return fs.existsSync(absPath);
}

/**
 * Atomically write content to absPath.
 * Writes to <absPath>.tmp first, then renames (atomic on same filesystem).
 * Creates parent directories if needed.
 */
export function atomicWrite(absPath, content) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = absPath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, absPath);
}

/**
 * List all .md filenames (sorted) in absDir.
 * Returns [] if directory is missing.
 */
export function listMd(absDir) {
  if (!fs.existsSync(absDir)) return [];
  const entries = fs.readdirSync(absDir);
  return entries
    .filter(f => f.endsWith('.md'))
    .sort();
}
