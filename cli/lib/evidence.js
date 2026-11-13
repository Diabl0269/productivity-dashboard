/**
 * cli/lib/evidence.js
 * Review evidence: the saved projects (.agsproj) and short videos (.mp4) a check can point at,
 * all under $CH_HOME/evidence. Used by `ch tasks review` (validate paths) and serve.js
 * (play a video, open a project). Everything touching the disk takes dataRoot, so tests use a
 * throwaway folder and an injected launcher, and nothing here ever opens an app on its own.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { projectPathError, videoPathError, audioPathError, evidencePathError, tidyEvidencePath } from '../../shared/review.js';
import { imagePathError } from '../../shared/asks.js';

export const EVIDENCE_DIR = 'evidence';

// 'file' (PRO37 `review --evidence`): any saved proof file (screenshot, AX dump, render, run log).
const anyFilePathError = (v, label = 'evidence') => evidencePathError(v, '', label);
// 'image' (PRO86): a screenshot on a decision for Tal (ch tasks ask --image).
const pathErrorFor = (kind) => (kind === 'project' ? projectPathError : kind === 'audio' ? audioPathError : kind === 'image' ? imagePathError
  : kind === 'file' ? anyFilePathError : videoPathError);
const AUDIO_TYPES = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

const inside = (root, abs) => abs === root || abs.startsWith(root + path.sep);

/**
 * A check path (absolute or relative) as the relative path stored on the check. An absolute path
 * must lie inside <dataRoot>/evidence. Throws Error naming the path otherwise.
 */
export function toEvidenceRel(dataRoot, input, kind) {
  const value = String(input ?? '').trim();
  if (path.isAbsolute(value)) {
    const lexical = path.resolve(dataRoot, EVIDENCE_DIR);
    const roots = [lexical];
    try { roots.push(fs.realpathSync(lexical)); } catch { /* missing folder: lexical only */ }
    const abs = path.resolve(value);
    const root = roots.find(r => inside(r, abs));
    if (!root) throw new Error(`${value} is outside the evidence folder (${lexical})`);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const err = pathErrorFor(kind)(rel, kind);
    if (err) throw new Error(`${value}: ${err}`);
    return tidyEvidencePath(rel);
  }
  const err = pathErrorFor(kind)(value, kind);
  if (err) throw new Error(err);
  return tidyEvidencePath(value);
}

/**
 * Absolute real path of an existing evidence item. Throws { status: 400 } for a bad path or one
 * that escapes the evidence folder (symlinks included), { status: 404 } when missing.
 */
export function resolveEvidence(dataRoot, relPath, kind) {
  const err = pathErrorFor(kind)(relPath, kind);
  if (err) throw fail(400, err);
  let root;
  try { root = fs.realpathSync(path.join(dataRoot, EVIDENCE_DIR)); } catch { throw fail(404, 'not found'); }
  const lexical = path.join(root, ...tidyEvidencePath(relPath).split('/'));
  if (!inside(root, lexical)) throw fail(400, 'path escapes the evidence folder');
  let real;
  try { real = fs.realpathSync(lexical); } catch { throw fail(404, 'not found'); }
  if (!inside(root, real)) throw fail(400, 'path escapes the evidence folder');
  return real;
}

/** Parse a Range header against a file size: null (none), 'invalid' (416), or { start, end }. */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

/**
 * GET/HEAD /evidence/<rel>: { status, headers, file?: { abs, start, end }, error? }.
 * `file` is set when a body is to be streamed (never for HEAD).
 */
export function evidenceVideoResponse({ dataRoot, relPath, method = 'GET', range }) {
  let abs;
  const ext = path.extname(String(relPath || '')).toLowerCase();
  const audioType = AUDIO_TYPES[ext];
  const imageType = IMAGE_TYPES[ext];
  try { abs = resolveEvidence(dataRoot, relPath, audioType ? 'audio' : imageType ? 'image' : 'video'); } catch (e) {
    return { status: e.status || 400, headers: {}, error: e.message };
  }
  const st = fs.statSync(abs);
  if (!st.isFile()) return { status: 404, headers: {}, error: 'not found' };
  const base = { 'Content-Type': audioType || imageType || 'video/mp4', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
  const r = parseRange(range, st.size);
  if (r === 'invalid') return { status: 416, headers: { ...base, 'Content-Range': `bytes */${st.size}` }, error: 'range not satisfiable' };
  const start = r ? r.start : 0;
  const end = r ? r.end : st.size - 1;
  const headers = { ...base, 'Content-Length': String(st.size === 0 ? 0 : end - start + 1) };
  if (r) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  const file = method === 'HEAD' || st.size === 0 ? undefined : { abs, start, end };
  return { status: r ? 206 : 200, headers, file };
}

/** Same-origin guard: an Origin header, when present, must name this server's own host. */
export function originAllowed(origin, host) {
  if (origin === undefined || origin === null || origin === '') return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

const expandHome = (p) => (p === '~' || String(p).startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p);

/** config.json `reviewProjectApps`: a list of .app paths (empty when unset or unreadable). */
export function readReviewApps(dataRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dataRoot, 'config.json'), 'utf8'));
    return Array.isArray(cfg.reviewProjectApps)
      ? cfg.reviewProjectApps.filter(a => typeof a === 'string' && a.trim()).map(expandHome)
      : [];
  } catch { return []; }
}

/** The configured app that exists and was built last (newest mtime under Contents/MacOS), or null. */
export function pickReviewApp(apps) {
  let best = null;
  for (const app of apps || []) {
    const dir = path.join(app, 'Contents', 'MacOS');
    let mtime = 0;
    try {
      for (const name of fs.readdirSync(dir)) {
        const t = fs.statSync(path.join(dir, name)).mtimeMs;
        if (t > mtime) mtime = t;
      }
    } catch { continue; }
    if (mtime && (!best || mtime > best.mtime)) best = { app, mtime };
  }
  return best ? { app: best.app, builtAt: new Date(best.mtime).toISOString() } : null;
}

function defaultLaunch(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Open a saved project: `open -a <newest build> <bundle>`, or plain `open <bundle>` when no app is
 * configured or found. `launch(cmd, args)` is injectable. Throws { status } on a bad path.
 * @returns {Promise<{ ok: true, app: string|null, builtAt: string|null }>}
 */
export async function openProject({ dataRoot, relPath, apps = [], launch = defaultLaunch }) {
  const bundle = resolveEvidence(dataRoot, relPath, 'project');
  const picked = pickReviewApp(apps);
  await launch('open', picked ? ['-a', picked.app, bundle] : [bundle]);
  return { ok: true, app: picked ? picked.app : null, builtAt: picked ? picked.builtAt : null };
}

/**
 * POST /api/open-project: { status, json } from the request's headers and raw body text.
 * Refuses a foreign Origin (403), because this launches an app.
 */
export async function handleOpenProject({ origin, host, bodyText, dataRoot, apps, launch }) {
  if (!originAllowed(origin, host)) return { status: 403, json: { error: 'cross-origin request refused' } };
  let body;
  try { body = JSON.parse(bodyText || '{}'); } catch { return { status: 400, json: { error: 'invalid JSON' } }; }
  if (!body || typeof body.path !== 'string') return { status: 400, json: { error: 'path is required' } };
  try {
    const out = await openProject({ dataRoot, relPath: body.path, apps: apps ?? readReviewApps(dataRoot), launch });
    return { status: 200, json: out };
  } catch (e) {
    return { status: e.status || 500, json: { error: e.message } };
  }
}
