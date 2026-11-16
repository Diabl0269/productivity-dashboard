/**
 * Find and load a project's home.config.json (server side, node:fs).
 *
 * The tracker's config.json maps project slugs to config files: "home": { "<slug>": "<absolute path>" }.
 * Only paths listed there are ever read, each must be absolute and end in .json, and the slug in the
 * request is only a key into that map, never part of a path. Every Home route that needs the map or
 * the areas loads it through here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizeHomeConfig } from '../../shared/home-config.js';

export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_BYTES = 1024 * 1024;

/** The tracker config.json "home" map ({} when missing), plus a plain-words problem if unreadable. */
export function readHomeMap(dataRoot) {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(dataRoot, 'config.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { map: {}, error: null };
    return { map: {}, error: `The tracker config.json could not be read (${e.message}).` };
  }
  const home = cfg && cfg.home;
  if (home === undefined || home === null) return { map: {}, error: null };
  if (typeof home !== 'object' || Array.isArray(home)) {
    return { map: {}, error: 'The tracker config.json key "home" should be an object of project slug -> path to home.config.json.' };
  }
  return { map: home, error: null };
}

/** Why a mapped path is not allowed, or null when it is fine. */
export function pathProblem(slug, p) {
  const key = `config.json "home" > "${slug}"`;
  if (typeof p !== 'string' || !p.trim()) return `${key} should be the absolute path of a home.config.json file.`;
  if (p.includes('\0')) return `${key} is not a usable path.`;
  if (!path.isAbsolute(p)) return `${key} should be an absolute path (it starts with "/"), got "${p}".`;
  if (path.extname(p).toLowerCase() !== '.json') return `${key} should point at a .json file, got "${p}".`;
  return null;
}

/**
 * Load the Home config of one project.
 * @param {string} dataRoot the tracker data dir (CH_HOME)
 * @param {string|null} slug the project; null picks the first configured one
 * @returns {{ project: string|null, projects: string[], path: string|null, config: object|null,
 *   errors: string[], legacy: boolean, missing: boolean }}
 */
export function loadProjectHomeConfig(dataRoot, slug) {
  const { map, error } = readHomeMap(dataRoot);
  const projects = Object.keys(map);
  const project = slug || projects[0] || null;
  const out = { project, projects, path: null, config: null, errors: [], legacy: false, missing: false };
  if (error) out.errors.push(error);
  if (!project || !Object.prototype.hasOwnProperty.call(map, project)) {
    out.missing = true;
    return out;
  }
  const file = map[project];
  const bad = pathProblem(project, file);
  if (bad) {
    out.errors.push(bad);
    return out;
  }
  out.path = file;
  let text;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOTFILE' });
    if (st.size > MAX_BYTES) {
      out.errors.push(`${file} is larger than 1 MB; a home config should be a few kilobytes.`);
      return out;
    }
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    out.errors.push(e.code === 'ENOENT' || e.code === 'ENOTFILE'
      ? `config.json "home" > "${project}" points at ${file}, which does not exist.`
      : `${file} could not be read (${e.message}).`);
    return out;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    out.errors.push(`${path.basename(file)} is not valid JSON (${e.message}).`);
    return out;
  }
  const r = normalizeHomeConfig(raw);
  out.config = r.config;
  out.legacy = r.legacy;
  out.errors.push(...r.errors);
  return out;
}
