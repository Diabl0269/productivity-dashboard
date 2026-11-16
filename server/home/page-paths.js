/**
 * Which files the page routes may read. Pages and their images are served only from inside the
 * folder that holds the project's home.config.json: the path asked for must be relative, free of
 * "..", NUL and dot-folders, end in an allowed extension, and (after resolving symlinks) still sit
 * inside the real config folder. Everything else is refused in plain words.
 */

import fs from 'node:fs';
import path from 'node:path';

export const PAGE_EXTS = ['.md'];
export const IMAGE_EXTS = ['.svg', '.png', '.jpg', '.webp'];
export const MAX_PAGE_BYTES = 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_TYPES = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

function inside(root, file) {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * @param {string} configDir the folder of home.config.json
 * @param {string} rel the path asked for (relative to configDir)
 * @param {string[]} exts allowed extensions, lower case with the dot
 * @param {number} maxBytes
 * @returns {{ ok: true, file: string, ext: string } | { ok: false, status: number, reason: 'bad'|'denied'|'missing', message: string }}
 */
export function resolveInside(configDir, rel, exts, maxBytes) {
  const no = (status, reason, message) => ({ ok: false, status, reason, message });
  if (typeof rel !== 'string' || !rel) return no(400, 'bad', 'A path is needed.');
  if (rel.includes('\0')) return no(400, 'bad', 'That path is not usable.');
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)) {
    return no(403, 'denied', 'The path must be relative to the project config\'s folder.');
  }
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.includes('..')) return no(403, 'denied', 'The path must stay inside the project config\'s folder.');
  if (parts.some(p => p.startsWith('.'))) return no(403, 'denied', 'Hidden files and folders are not served.');
  const ext = path.extname(rel).toLowerCase();
  if (!exts.includes(ext)) return no(415, 'denied', `Only ${exts.join(', ')} files can be served here.`);
  let root;
  try { root = fs.realpathSync(configDir); } catch { return no(404, 'missing', 'The project config\'s folder is gone.'); }
  const joined = path.resolve(root, ...parts);
  if (!inside(root, joined)) return no(403, 'denied', 'The path must stay inside the project config\'s folder.');
  let real;
  try {
    real = fs.realpathSync(joined);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return no(404, 'missing', `${rel} does not exist.`);
    return no(403, 'denied', `${rel} cannot be read.`);
  }
  if (!inside(root, real)) return no(403, 'denied', 'That file is outside the project config\'s folder (a link leads out of it).');
  let st;
  try { st = fs.statSync(real); } catch { return no(404, 'missing', `${rel} does not exist.`); }
  if (!st.isFile()) return no(404, 'missing', `${rel} is not a file.`);
  if (st.size > maxBytes) return no(413, 'bad', `${rel} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  return { ok: true, file: real, ext };
}
