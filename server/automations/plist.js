// Read/write launchd plists through plutil (execFile only, never a shell string).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.js';

const PLUTIL = () => process.env.PLUTIL_BIN || 'plutil';

export async function readPlist(file) {
  const r = await run(PLUTIL(), ['-convert', 'json', '-o', '-', file]);
  if (r.code !== 0) throw Object.assign(new Error(`plutil could not read ${file}: ${r.stderr.trim()}`), { status: 422 });
  return JSON.parse(r.stdout);
}

export async function lintPlist(file) {
  const r = await run(PLUTIL(), ['-lint', file]);
  return r.code === 0 ? null : (r.stdout + r.stderr).trim() || 'plutil -lint failed';
}

/** Write obj as an XML plist: JSON to a temp file, convert, lint. Leaves any old file alone on failure. */
export async function writePlist(file, obj) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plist-'));
  try {
    const json = path.join(tmpDir, 'in.json');
    const xml = path.join(tmpDir, 'out.plist');
    fs.writeFileSync(json, JSON.stringify(obj));
    const r = await run(PLUTIL(), ['-convert', 'xml1', '-o', xml, json]);
    if (r.code !== 0) throw Object.assign(new Error(`plutil convert failed: ${r.stderr.trim()}`), { status: 422 });
    const bad = await lintPlist(xml);
    if (bad) throw Object.assign(new Error(`plutil -lint: ${bad}`), { status: 422 });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(xml, file);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
