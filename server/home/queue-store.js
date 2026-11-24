/**
 * Reading and writing a Home queue's markdown file for server/home/queue-route.js (node:fs).
 * The file is reached only through a queue id from the project's home config, never through a path from
 * the request; it must be a regular .md file of at most 1 MB. Writes are atomic (temp file, then rename).
 * One undo is kept per queue, in memory: the text before the last write, valid only while the file is
 * still exactly what that write produced.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_BYTES = 1024 * 1024;
const undoOf = new Map(); // `${config path}|${queue id}` -> { token, before, afterEtag }

export const etagOf = text => crypto.createHash('sha1').update(text).digest('hex');

/** The queue file's path (relative to the config file), or throws { status, message } in plain words. */
export function queuePath(configPath, queue) {
  const abs = path.resolve(path.dirname(configPath), queue.file);
  if (!/\.md$/i.test(abs)) throw Object.assign(new Error('A queue file must be a .md file.'), { status: 400 });
  return abs;
}

/** { text, etag } or throws an Error with .status and a plain-words message. */
export function readQueueFile(file, queue) {
  let real;
  try {
    real = fs.realpathSync(file);
    const st = fs.statSync(real);
    if (!st.isFile() || !/\.md$/i.test(real)) throw Object.assign(new Error('not a .md file'), { code: 'ENOTFILE' });
    if (st.size > MAX_BYTES) throw Object.assign(new Error('too big'), { code: 'EBIG' });
    const text = fs.readFileSync(real, 'utf8');
    return { text, etag: etagOf(text), real };
  } catch (e) {
    const message = e.code === 'ENOENT' ? `The file for "${queue.title}" (${queue.file}) does not exist.`
      : e.code === 'ENOTFILE' ? `"${queue.file}" is not a regular .md file.`
        : e.code === 'EBIG' ? `"${queue.file}" is larger than 1 MB, which is too big for a queue.`
          : `"${queue.file}" could not be read (${e.message}).`;
    throw Object.assign(new Error(message), { status: e.code === 'ENOENT' ? 404 : 409 });
  }
}

export function writeQueueFile(real, text) {
  const tmp = `${real}.${process.pid}.tmp`;
  let mode;
  try { mode = fs.statSync(real).mode & 0o777; } catch { mode = 0o644; }
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, real);
}

export function rememberUndo(key, before, afterText) {
  const token = crypto.randomBytes(8).toString('hex');
  undoOf.set(key, { token, before, afterEtag: etagOf(afterText) });
  return token;
}

export function forgetUndo(key) { undoOf.delete(key); }

/** The text to put back for `token`, or throws a 409 in plain words when it no longer applies. */
export function takeUndo(key, token, currentEtag) {
  const u = undoOf.get(key);
  if (!u || typeof token !== 'string' || u.token !== token) throw Object.assign(new Error('There is nothing to undo any more.'), { status: 409 });
  if (u.afterEtag !== currentEtag) {
    undoOf.delete(key);
    throw Object.assign(new Error('The file changed after that edit, so it cannot be undone safely.'), { status: 409 });
  }
  undoOf.delete(key);
  return u.before;
}
