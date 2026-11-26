// Automations service: list/edit/create/delete/run/toggle LaunchAgents. Only files directly inside the
// LaunchAgents dir (and the script a plist runs) are ever written. All subprocesses use execFile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCalendar } from '../../shared/automation-schedule.js';
import { readPlist, writePlist } from './plist.js';
import { buildModel, launchAgentsDir, findScript, programArguments } from './model.js';
import * as lc from './launchctl.js';

const REPO_RUN_JOB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'launchagents', 'run-job.sh');

const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });

function plistFiles() {
  const dir = launchAgentsDir();
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.plist')).map(e => path.join(dir, e.name));
  } catch { return []; }
}

async function loadAll() {
  const [loaded, disabled] = await Promise.all([lc.listLoaded(), lc.listDisabled()]);
  const out = [];
  await Promise.all(plistFiles().map(async file => {
    try {
      const p = await readPlist(file);
      if (p.Label) out.push({ p, file });
    } catch (e) { out.push({ error: e.message, file }); }
  }));
  return { loaded, disabled, items: out.sort((a, b) => String(a.p?.Label || a.file).localeCompare(String(b.p?.Label || b.file))) };
}

export async function listAutomations() {
  const { loaded, disabled, items } = await loadAll();
  return items.map(i => i.error ? { label: path.basename(i.file, '.plist'), path: i.file, error: i.error, tool: 'other', state: 'unreadable', arguments: [], schedule: { calendar: [] }, scheduleText: '' }
    : buildModel(i.p, i.file, { loaded, disabled }));
}

async function find(label) {
  if (!LABEL_RE.test(label || '')) throw fail(400, 'Invalid label');
  const { loaded, disabled, items } = await loadAll();
  const hit = items.find(i => i.p?.Label === label);
  if (!hit) throw fail(404, `No automation ${label}`);
  return { ...hit, loaded, disabled };
}

export async function getAutomation(label) {
  const h = await find(label);
  return buildModel(h.p, h.file, h);
}

function applySchedule(p, schedule) {
  if (!schedule) return;
  const bad = validateCalendar(schedule.calendar);
  if (bad) throw fail(400, bad);
  const cal = schedule.calendar || [];
  if (cal.length) p.StartCalendarInterval = cal.length === 1 ? cal[0] : cal; else delete p.StartCalendarInterval;
  if (schedule.interval) p.StartInterval = Number(schedule.interval); else delete p.StartInterval;
  if (schedule.runAtLoad) p.RunAtLoad = true; else delete p.RunAtLoad;
}

function writeScript(args, content) {
  if (typeof content !== 'string') return;
  const script = findScript(args);
  if (!script) throw fail(400, 'This automation does not run a readable text script');
  fs.writeFileSync(script.path, content);
}

async function install(file, label) {
  const r = await lc.reload(file, label);
  return r.code === 0 ? null : (r.stderr || r.stdout).trim() || 'launchctl bootstrap failed';
}

function ensureAgentPath(env) {
  if (!env || typeof env !== 'object' || !env.AUTOMATION_HARNESS) return env;
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const current = String(env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  const parts = current.split(':').filter(Boolean);
  if (!parts.includes(localBin)) parts.unshift(localBin);
  return { ...env, PATH: parts.join(':') };
}

function maybeUpgradeLegacyRunner(args, content, env) {
  if (typeof content !== 'string') return content;
  const script = findScript(args);
  if (!script || path.basename(script.path) !== 'run-job.sh') return content;
  // Legacy OpenCode-only runner script from before multi-harness support: upgrade to scripts/launchagents/run-job.sh.
  if (env?.AUTOMATION_HARNESS && content.includes('# Runs one OpenCode automation') && !content.includes('AUTOMATION_HARNESS') && fs.existsSync(REPO_RUN_JOB)) {
    return fs.readFileSync(REPO_RUN_JOB, 'utf8');
  }
  return content;
}

export async function updateAutomation(label, body) {
  const h = await find(label);
  const p = { ...h.p };
  if (body.arguments) {
    if (!Array.isArray(body.arguments) || !body.arguments.every(a => typeof a === 'string') || !body.arguments.length) throw fail(400, 'arguments must be a non-empty string array');
    p.ProgramArguments = body.arguments;
    delete p.Program;
  }
  if (body.environment && typeof body.environment === 'object') p.EnvironmentVariables = ensureAgentPath(body.environment);
  applySchedule(p, body.schedule);
  const scriptArgs = programArguments(p);
  const nextScript = maybeUpgradeLegacyRunner(scriptArgs, body.scriptContent, p.EnvironmentVariables);
  writeScript(scriptArgs, nextScript);
  if (typeof nextScript === 'string') {
    const s = findScript(scriptArgs);
    if (s) try { fs.chmodSync(s.path, 0o755); } catch { /* ignore */ }
  }
  await writePlist(h.file, p);
  const wasLoaded = h.loaded.has(label) && !h.disabled.has(label);
  const reloadError = wasLoaded ? await install(h.file, label) : null;
  return { automation: await getAutomation(label), reloaded: wasLoaded, reloadError };
}

export async function createAutomation(body) {
  const label = body?.label;
  if (!LABEL_RE.test(label || '')) throw fail(400, 'Invalid label');
  const file = path.join(launchAgentsDir(), `${label}.plist`);
  if (fs.existsSync(file)) throw fail(409, `${label} already exists`);
  if (!Array.isArray(body.arguments) || !body.arguments.length) throw fail(400, 'arguments required');
  const p = { Label: label, ProgramArguments: body.arguments };
  if (body.workingDirectory) p.WorkingDirectory = body.workingDirectory;
  if (body.environment) p.EnvironmentVariables = body.environment;
  if (body.stdoutPath) p.StandardOutPath = body.stdoutPath;
  if (body.stderrPath) p.StandardErrorPath = body.stderrPath;
  applySchedule(p, body.schedule);
  writeScript(p.ProgramArguments, body.scriptContent);
  await writePlist(file, p);
  const loadError = body.load === false ? null : await install(file, label);
  return { automation: await getAutomation(label), loadError };
}

export async function deleteAutomation(label) {
  const h = await find(label);
  await lc.bootout(label);
  fs.unlinkSync(h.file);
  return { deleted: label };
}

export async function runAutomation(label) {
  const h = await find(label);
  if (!h.loaded.has(label)) {
    const err = await install(h.file, label);
    if (err) throw fail(502, err);
  }
  const r = await lc.kickstart(label);
  if (r.code !== 0) throw fail(502, (r.stderr || r.stdout).trim() || 'launchctl kickstart failed');
  return { started: label };
}

export async function toggleAutomation(label, enabled) {
  const h = await find(label);
  const on = typeof enabled === 'boolean' ? enabled : h.disabled.has(label);
  await lc.setEnabled(label, on);
  if (on) { const err = await install(h.file, label); if (err) throw fail(502, err); }
  else await lc.bootout(label);
  return { automation: await getAutomation(label) };
}

export async function tailLog(label, which = 'stdout', maxBytes = 32768) {
  const h = await find(label);
  const file = which === 'stderr' ? h.p.StandardErrorPath : h.p.StandardOutPath || h.p.StandardErrorPath;
  if (!file) return { path: null, text: '' };
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return { path: file, text: buf.toString('utf8'), truncated: size > len };
  } catch { return { path: file, text: '', missing: true }; }
}
