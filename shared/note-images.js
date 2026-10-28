/**
 * shared/note-images.js — images attached to ticket notes (Node only: CLI + serve.js).
 *
 * Files live in `<CH_HOME>/attachments/<ticketId>/<sha256-first-16>.<ext>`, never inline in
 * tasks.json and never in git. A note carries `images: ["<ticketId>/<file>"]` (paths relative
 * to attachments/). The type is decided by magic bytes, not by the file name; the file name is
 * the content hash, so the same image added twice is stored once.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
export const ATTACH_DIR = 'attachments';
export const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

const TICKET_ID_SAFE = /^[A-Za-z0-9_-]+$/;
const FILE_RE = /^[0-9a-f]{16}\.(png|jpg|jpeg|webp|gif)$/;

/** Detect an allowed image type from its leading bytes. Returns ext (png|jpg|webp|gif) or null. */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  const head = buf.toString('latin1', 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function isSafeTicketId(id) {
  return typeof id === 'string' && TICKET_ID_SAFE.test(id);
}

/** Relative attachment path `<ticketId>/<hash16>.<ext>` for an image buffer. Throws on bad input. */
export function attachmentRelPath(ticketId, buf) {
  const ext = validateImage(ticketId, buf);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  return `${ticketId}/${hash}.${ext}`;
}

/** Validate ticket id, size and type. Returns the ext, throws Error with a clear message. */
export function validateImage(ticketId, buf) {
  if (!isSafeTicketId(ticketId)) throw new Error(`invalid ticket id "${ticketId}"`);
  if (!buf || !buf.length) throw new Error('image is empty');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`image is too large (${(buf.length / 1048576).toFixed(1)} MB; max ${MAX_IMAGE_BYTES / 1048576} MB)`);
  const ext = sniffImageType(buf);
  if (!ext) throw new Error('not a supported image (png, jpg, webp or gif)');
  return ext;
}

/** True for a well-formed stored path `<ticketId>/<hash16>.<ext>`. */
export function isAttachmentRelPath(rel) {
  if (typeof rel !== 'string') return false;
  const parts = rel.split('/');
  return parts.length === 2 && isSafeTicketId(parts[0]) && FILE_RE.test(parts[1]);
}

/** Absolute path for a stored relative path; throws when malformed or escaping attachments/. */
export function attachmentAbsPath(dataRoot, rel) {
  if (!isAttachmentRelPath(rel)) throw new Error(`invalid attachment path "${rel}"`);
  const base = path.resolve(dataRoot, ATTACH_DIR);
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(base + path.sep)) throw new Error(`invalid attachment path "${rel}"`);
  return abs;
}

/** Validate and write an image buffer under dataRoot/attachments. Returns the relative path. */
export function storeImage(dataRoot, ticketId, buf) {
  const rel = attachmentRelPath(ticketId, buf);
  const abs = attachmentAbsPath(dataRoot, rel);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
  }
  return rel;
}

/** Read a file from disk and store it. Clear errors for missing / unsupported files. */
export function storeImageFile(dataRoot, ticketId, filePath) {
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { throw new Error(`cannot read image file ${filePath}`); }
  try { return storeImage(dataRoot, ticketId, buf); } catch (e) { throw new Error(`${filePath}: ${e.message}`); }
}
