/**
 * cli/lib/automation-status.js (PRO122, PRO123): read-only status readers for a project's automations and
 * services (home.config.json `status`). Each reader is small, has a timeout and never throws: when it cannot
 * tell, it answers { ok: null, detail: 'why unknown' }.
 *
 *   mtime        newest modification time of a file or folder, against maxAgeMin
 *   json-file    a timestamp field (default "at") and an optional ok field of a JSON file
 *   log-tail     the last non-empty line of a log, its leading timestamp (else the file's mtime), ok/fail patterns
 *   launchctl    `launchctl print gui/<uid>/<label>`: loaded, last exit code, run interval or calendar times.
 *                Note: on a sandboxed shell launchctl answers "Operation not permitted"; the server must run outside it.
 *   gh-workflow  `gh run list --repo <r> --workflow <w> -L 1` (cached 60 s per workflow, like running-inputs.js)
 *   http         GET with a 3 s timeout: https, or http to this computer only; never a user, token or key
 *   none         nothing to read
 *
 * Result: { lastRun: ISO|null, ok: true|false|null, late: bool, nextRun?: ISO, detail: string, off?: true }.
 * readEntryStatus(entry) reads every source of one automation or service and joins them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { httpUrlProblem } from '../../shared/home-config-runs.js';

export const READER_TIMEOUT_MS = 5000;
const HTTP_TIMEOUT_MS = 3000;
const TAIL_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_DIR_ENTRIES = 5000;

const unknown = detail => ({ lastRun: null, ok: null, late: false, detail });
const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const clip = (s, n = 200) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** "~/x" -> home dir; a relative path -> against baseDir (the config file's folder). */
export function expandPath(p, baseDir = process.cwd()) {
  if (typeof p !== 'string' || !p) return null;
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1));
  return path.resolve(baseDir || process.cwd(), p);
}

/** A time value from a file: ISO text, or epoch seconds / milliseconds. */
export function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v) { const n = Date.parse(v); return Number.isFinite(n) ? n : null; }
  return null;
}

function run(cmd, args, timeout) {
  return new Promise(resolve => {
    try {
      execFile(cmd, args, { timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ err, stdout: stdout || '', stderr: stderr || '' });
      });
    } catch (err) { resolve({ err, stdout: '', stderr: '' }); }
  });
}

// ===== readers =====

export async function readMtime(src, { baseDir } = {}) {
  const file = expandPath(src.path, baseDir);
  let st;
  try { st = fs.statSync(file); } catch (e) { return unknown(e.code === 'ENOENT' ? `${src.path} does not exist` : `${src.path} could not be read (${e.code || e.message})`); }
  // `match` (folders only): count just the entries whose name matches, not the folder's own time, so a
  // job's own trace (say ".git" of a backup repo) is not hidden by other writers to the same folder.
  let re = null;
  if (src.match) { try { re = new RegExp(src.match); } catch { return unknown(`"match" ${JSON.stringify(src.match)} is not a valid pattern`); } }
  const dir = st.isDirectory();
  let newest = re && dir ? null : st.mtimeMs;
  if (dir) {
    let names = [];
    try { names = fs.readdirSync(file).filter(n => !re || re.test(n)).slice(0, MAX_DIR_ENTRIES); } catch { /* the folder's own time */ }
    for (const n of names) {
      try { newest = Math.max(newest ?? 0, fs.statSync(path.join(file, n)).mtimeMs); } catch { /* vanished */ }
    }
    if (newest === null) return unknown(`nothing in ${src.path} matches ${JSON.stringify(src.match)}`);
  }
  const detail = !dir ? `last change of ${src.path}` : re ? `newest entry of ${src.path} matching ${src.match}` : `newest file in ${src.path}`;
  return { lastRun: iso(newest), ok: null, late: false, detail };
}

function field(obj, dotted) {
  return String(dotted).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

export async function readJsonFile(src, { baseDir } = {}) {
  const file = expandPath(src.path, baseDir);
  let data;
  try {
    if (fs.statSync(file).size > MAX_JSON_BYTES) return unknown(`${src.path} is larger than 1 MB`);
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return unknown(e.code === 'ENOENT' ? `${src.path} does not exist` : `${src.path} could not be read (${e.code || e.message.slice(0, 80)})`);
  }
  const key = src.field || 'at';
  const at = toMs(field(data, key));
  let ok = null;
  if (src.okField) {
    const v = field(data, src.okField);
    if (v === true || /^(ok|success|passed|true)$/i.test(String(v))) ok = true;
    else if (v === false || /^(fail|failed|failure|error|false)$/i.test(String(v))) ok = false;
  }
  if (at === null) return { ...unknown(`${src.path} has no time in "${key}"`), ok };
  const interval = Number(data?.intervalMin);
  const out = { lastRun: iso(at), ok, late: false, detail: `${path.basename(file)} "${key}"${src.okField ? `, "${src.okField}" = ${JSON.stringify(field(data, src.okField))}` : ''}` };
  if (Number.isFinite(interval) && interval > 0) out.intervalMin = interval;
  return out;
}

const TS_RE = /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/;

/** The last non-empty line of a text, and the time it starts with (or null). */
export function lastLine(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const line = lines[lines.length - 1] || '';
  const m = TS_RE.exec(line);
  return { line, at: m ? toMs(m[1].replace(' ', 'T')) : null };
}

export async function readLogTail(src, { baseDir } = {}) {
  const file = expandPath(src.path, baseDir);
  let text;
  let st;
  try {
    st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      const len = Math.min(st.size, TAIL_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch (e) {
    return unknown(e.code === 'ENOENT' ? `${src.path} does not exist` : `${src.path} could not be read (${e.code || e.message})`);
  }
  const { line, at } = lastLine(text);
  if (!line) return { lastRun: iso(st.mtimeMs), ok: null, late: false, detail: `${src.path} is empty` };
  let ok = null;
  if (src.failPattern && new RegExp(src.failPattern, 'i').test(line)) ok = false;
  else if (src.okPattern && new RegExp(src.okPattern, 'i').test(line)) ok = true;
  return { lastRun: iso(at ?? st.mtimeMs), ok, late: false, detail: `last line: ${clip(line)}` };
}

/** Calendar times ({ Minute, Hour }) from `launchctl print`'s descriptors. */
export function calendarTimes(text) {
  const out = [];
  const re = /descriptor = \{([^}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const d = {};
    for (const [, k, v] of m[1].matchAll(/"(\w+)" => (\d+)/g)) d[k] = Number(v);
    if (Number.isFinite(d.Minute) || Number.isFinite(d.Hour)) out.push(d);
  }
  return out;
}

/** The next local time matching any { Minute?, Hour? } after `now` (Weekday / Day are not read). */
export function nextCalendarRun(times, now = Date.now()) {
  let best = null;
  for (const t of times) {
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      const hours = Number.isFinite(t.Hour) ? [t.Hour] : [...Array(24).keys()];
      for (const h of hours) {
        const d = new Date(now);
        d.setDate(d.getDate() + dayOffset);
        d.setHours(h, Number.isFinite(t.Minute) ? t.Minute : 0, 0, 0);
        const ms = d.getTime();
        if (ms > now && (best === null || ms < best)) best = ms;
      }
    }
  }
  return best;
}

export async function readLaunchctl(src, { launchctl = 'launchctl', uid = process.getuid?.() ?? 501, now = Date.now(), timeout = READER_TIMEOUT_MS } = {}) {
  const target = `gui/${uid}/${src.label}`;
  const { err, stdout, stderr } = await run(launchctl, ['print', target], timeout);
  const text = `${stdout}\n${stderr}`;
  if (/Could not find service/i.test(text)) return { ...unknown(`not loaded: launchd has no job ${src.label}`), off: true };
  if (err || !/^\tstate = /m.test(stdout)) {
    const why = /not permitted/i.test(text) ? 'launchctl is not allowed here (run the server outside the sandbox)'
      : err?.code === 'ENOENT' ? 'launchctl is not on this computer' : `launchctl did not answer (${clip(stderr.trim() || err?.message || 'no output', 80)})`;
    return unknown(why);
  }
  const state = /^\tstate = (.+)$/m.exec(stdout)?.[1]?.trim() || 'unknown';
  const exit = /^\tlast exit code = (.+)$/m.exec(stdout)?.[1]?.trim() ?? null;
  const runs = /^\truns = (\d+)$/m.exec(stdout)?.[1] ?? null;
  const interval = Number(/^\trun interval = (\d+) seconds$/m.exec(stdout)?.[1]);
  const ok = exit === null || /never exited/i.test(exit) ? null : exit === '0';
  const out = { lastRun: null, ok, late: false, detail: `${state === 'running' ? 'running now' : 'loaded, not running'}; last exit code ${exit ?? 'unknown'}${runs ? `; ${runs} runs since login` : ''}` };
  if (Number.isFinite(interval) && interval > 0) out.intervalMin = interval / 60;
  const next = nextCalendarRun(calendarTimes(stdout), now);
  if (next !== null) out.nextRun = iso(next);
  return out;
}

const ghCache = new Map();
export function clearGhCache() { ghCache.clear(); }

export async function readGhWorkflow(src, { gh = 'gh', ttlMs = 60e3, timeout = READER_TIMEOUT_MS } = {}) {
  const key = `${gh}\0${src.repo}\0${src.workflow}`;
  const hit = ghCache.get(key);
  let promise = hit && Date.now() - hit.at < ttlMs ? hit.promise : null;
  if (!promise) {
    promise = run(gh, ['run', 'list', '--repo', src.repo, '--workflow', src.workflow, '-L', '1', '--json', 'status,conclusion,createdAt,url,displayTitle'], timeout);
    ghCache.set(key, { at: Date.now(), promise });
  }
  const { err, stdout, stderr } = await promise;
  if (err) {
    ghCache.delete(key);
    return unknown(err.code === 'ENOENT' ? 'gh (GitHub CLI) is not installed' : `gh did not answer (${clip((stderr || err.message).trim().split('\n')[0], 100)})`);
  }
  let r;
  try { r = JSON.parse(stdout)[0]; } catch { return unknown('gh gave an answer that is not JSON'); }
  if (!r) return unknown(`no runs of "${src.workflow}" yet`);
  const done = String(r.status).toLowerCase() === 'completed';
  const concl = String(r.conclusion || '').toLowerCase();
  const ok = !done ? null : concl === 'success' ? true : ['skipped', 'neutral'].includes(concl) ? null : false;
  return { lastRun: r.createdAt || null, ok, late: false, url: r.url || null, detail: `${done ? concl || 'finished' : 'running now'}: ${clip(r.displayTitle || src.workflow, 120)}` };
}

export function readHttp(src, { timeout = HTTP_TIMEOUT_MS } = {}) {
  const bad = httpUrlProblem(src.url);
  if (bad) return Promise.resolve(unknown(`the address ${bad}`));
  const started = Date.now();
  return new Promise(resolve => {
    let u;
    try { u = new URL(src.url); } catch { resolve(unknown('not a valid web address')); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', timeout, headers: { 'User-Agent': 'task-tracker-status-check', Accept: '*/*' } }, (res) => {
      res.resume();
      res.on('end', () => {});
      const code = res.statusCode || 0;
      const ms = Date.now() - started;
      resolve({ lastRun: null, checkedAt: iso(Date.now()), ok: code > 0 && code < 400, late: false, detail: `answered ${code} in ${ms} ms` });
      req.destroy();
    });
    req.on('timeout', () => { req.destroy(); resolve({ ...unknown(`no answer within ${timeout / 1000} s`), ok: false }); });
    req.on('error', e => resolve({ ...unknown(`could not connect (${e.code || e.message})`), ok: false }));
    req.end();
  });
}

const READERS = {
  mtime: readMtime,
  'json-file': readJsonFile,
  'log-tail': readLogTail,
  launchctl: readLaunchctl,
  'gh-workflow': readGhWorkflow,
  http: readHttp,
  none: async () => unknown('no live status (its status is "none"); it runs where its trigger says'),
};

/** One source with its own timeout; never throws. maxAgeMin decides `late`. */
export async function readStatus(src, opts = {}) {
  const now = opts.now ?? Date.now();
  const reader = READERS[src?.type];
  if (!reader) return unknown(`unknown status type ${JSON.stringify(src?.type)}`);
  const timeout = opts.timeout ?? READER_TIMEOUT_MS;
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(() => resolve(unknown(`no answer within ${Math.round(timeout / 1000)} s`)), timeout); });
  let r;
  try { r = await Promise.race([Promise.resolve().then(() => reader(src, { ...opts, now, timeout })), late]); } catch (e) { r = unknown(`could not be read (${clip(e.message, 80)})`); } finally { clearTimeout(timer); }
  const last = toMs(r.lastRun);
  if (src.maxAgeMin && last !== null) r.late = now - last > src.maxAgeMin * 60e3;
  if (src.maxAgeMin && last !== null && !r.nextRun && !r.intervalMin) r.dueBy = iso(last + src.maxAgeMin * 60e3);
  return { type: src.type, ...r };
}

/**
 * Every source of an entry, joined: newest lastRun, ok false if any says false (else true if any says
 * true), late if any is late, off if launchd does not know the job, the first nextRun (or lastRun plus
 * the run interval), every detail. A source that ran with no failure counts as ok.
 */
export function joinStatus(parts, now = Date.now()) {
  if (!parts.length) return { lastRun: null, ok: null, late: false, detail: 'no status in the config', sources: [] };
  const lastMs = parts.map(p => toMs(p.lastRun)).filter(n => n !== null);
  const lastRun = lastMs.length ? iso(Math.max(...lastMs)) : null;
  let ok = parts.some(p => p.ok === false) ? false : parts.some(p => p.ok === true) ? true : null;
  const late = parts.some(p => p.late);
  if (ok === null && lastRun && !late) ok = true;
  const out = { lastRun, ok, late, detail: parts.map(p => p.detail).filter(Boolean).join(' · '), sources: parts };
  if (parts.some(p => p.off)) out.off = true;
  const interval = parts.find(p => p.intervalMin)?.intervalMin;
  const next = parts.find(p => p.nextRun)?.nextRun || (interval && lastRun ? iso(Math.max(toMs(lastRun) + interval * 60e3, now)) : null);
  if (next) out.nextRun = next;
  const url = parts.find(p => p.url)?.url;
  if (url) out.url = url;
  return out;
}

/** Read all of an automation's or service's `status` sources in parallel and join them. */
export async function readEntryStatus(entry, opts = {}) {
  const list = Array.isArray(entry?.status) ? entry.status : entry?.status ? [entry.status] : [];
  const parts = await Promise.all(list.map(src => readStatus(src, opts)));
  return joinStatus(parts, opts.now ?? Date.now());
}
