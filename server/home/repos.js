/**
 * The repositories a project's home config names, as absolute existing directories (server side, node:fs).
 *
 *   resolveRepos(config, configPath) -> [{ name, path }]  (an array that also carries `.warnings`: string[])
 *
 * `config` is the parsed (raw or normalised) home config, `configPath` the file it came from.
 * A `repos` entry is a text path or { name, path }.
 *  - object form: `path` is relative to the config file's directory;
 *  - text form, version 1 file: relative to the config file's directory;
 *  - text form, older flat-shape file: relative to the nearest git top-level directory at or above the
 *    config file (a project whose config sits in docs/ names its repos from the repo root).
 * Absolute paths are used as they are. `name` defaults to the folder's name. Entries that are not an
 * existing directory are left out, each with a plain-words warning; repeats of one directory are dropped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isLegacyShape } from '../../shared/home-config.js';

/** The nearest directory at or above `start` that holds a `.git` entry, or null. */
export function gitTopLevel(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

export function resolveRepos(config, configPath) {
  const repos = [];
  const warnings = [];
  const list = Array.isArray(config?.repos) ? config.repos : [];
  repos.warnings = warnings;
  if (!list.length) return repos;
  const configDir = path.dirname(path.resolve(configPath || '.'));
  const legacy = config.legacy === true || isLegacyShape(config);
  const gitBase = legacy ? (gitTopLevel(configDir) || configDir) : configDir;
  const seen = new Set();
  list.forEach((entry, i) => {
    const isText = typeof entry === 'string';
    const raw = isText ? entry : entry?.path;
    if (typeof raw !== 'string' || !raw.trim()) {
      warnings.push(`repos[${i}] has no usable path; skipped.`);
      return;
    }
    const abs = path.resolve(isText ? gitBase : configDir, raw);
    if (!isDir(abs)) {
      warnings.push(`repos[${i}] "${raw}" is not a folder (looked at ${abs}); skipped.`);
      return;
    }
    if (seen.has(abs)) return;
    seen.add(abs);
    const name = !isText && typeof entry.name === 'string' && entry.name.trim() ? entry.name : path.basename(abs);
    repos.push({ name, path: abs });
  });
  return repos;
}
