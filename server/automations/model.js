// plist JSON -> the model the Automations page shows. Pure except readSidecar.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { calendarEntries, formatSchedule } from '../../shared/automation-schedule.js';
import { HARNESSES, normalizeHarness, harnessForBinary } from '../../shared/harnesses.js';

export const LABEL_PREFIX = 'local.opencode.';
export const AGENT_LABEL_PREFIX = 'local.agent-automation.';
const TEXT_MAX = 256 * 1024;
const ID_RE = /^[A-Za-z0-9_.-]+$/;

export const launchAgentsDir = () => process.env.LAUNCH_AGENTS_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents');
export const logDir = () => process.env.AUTOMATION_LOG_DIR || path.join(os.homedir(), 'Library', 'Logs', 'opencode-automations');

export function automationId(label = '') {
  if (label.startsWith(AGENT_LABEL_PREFIX)) return label.slice(AGENT_LABEL_PREFIX.length);
  if (label.startsWith(LABEL_PREFIX)) return label.slice(LABEL_PREFIX.length);
  return label;
}

export function logDirsFor(env = {}) {
  if (process.env.AUTOMATION_LOG_DIR) {
    return [...new Set([process.env.AUTOMATION_LOG_DIR, env?.AUTOMATION_LOG_DIR].filter(Boolean))];
  }
  const home = os.homedir();
  const defaults = [
    path.join(home, 'Library', 'Logs', 'agent-automations'),
    path.join(home, 'Library', 'Logs', 'opencode-automations'),
  ];
  if (env?.AUTOMATION_LOG_DIR && !defaults.includes(env.AUTOMATION_LOG_DIR)) {
    return [env.AUTOMATION_LOG_DIR];
  }
  return [...new Set([env?.AUTOMATION_LOG_DIR, ...defaults].filter(Boolean))];
}

/** Known harness id or 'other', resolved declaratively from env, program arguments, script text, and label. */
export function detectTool(args = [], scriptText = '', label = '', env = {}) {
  const fromEnv = normalizeHarness(env?.AUTOMATION_HARNESS);
  if (fromEnv && fromEnv !== 'custom') return fromEnv;
  const fromCli = env?.AUTOMATION_CLI ? harnessForBinary(path.basename(env.AUTOMATION_CLI)) : null;
  if (fromCli) return fromCli;
  const argHits = new Set(args.map(t => harnessForBinary(path.basename(t))).filter(Boolean));
  for (const id of HARNESSES) if (argHits.has(id)) return id;
  const scriptHits = new Set(String(scriptText).split(/[\s"';|&()=]+/).map(t => harnessForBinary(path.basename(t))).filter(Boolean));
  for (const id of HARNESSES) if (scriptHits.has(id)) return id;
  if (label.startsWith(LABEL_PREFIX)) return 'opencode';
  return 'other';
}

/** First absolute argument that is a readable text file under TEXT_MAX (not a binary or .app resource). */
export function findScript(args = []) {
  for (const a of args) {
    if (typeof a !== 'string' || !path.isAbsolute(a) || a.includes('.app/')) continue;
    try {
      const st = fs.statSync(a);
      if (!st.isFile() || st.size > TEXT_MAX) continue;
      const buf = fs.readFileSync(a);
      if (buf.includes(0)) continue;
      return { path: a, content: buf.toString('utf8') };
    } catch { /* not a file */ }
  }
  return null;
}

export function readSidecar(label, env = {}) {
  const id = automationId(label);
  for (const dir of logDirsFor(env)) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, `${id}.last.json`), 'utf8')); } catch { /* try next */ }
  }
  return null;
}

export function readRunningSidecar(label, env = {}) {
  const id = automationId(label);
  for (const dir of logDirsFor(env)) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, `${id}.running.json`), 'utf8'));
      const pid = Number(r?.pid);
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          return r;
        } catch { /* stale running sidecar */ }
      }
    } catch { /* try next */ }
  }
  return null;
}

export function readRecordedRuns(label, env = {}) {
  const id = automationId(label);
  const byKey = new Map();
  const keyOf = r => (ID_RE.test(r?.sessionID || '') ? r.sessionID : (r?.startedAt && r?.exitCode ? `failed:${r.startedAt}` : null));
  for (const dir of [...logDirsFor(env)].reverse()) {
    const file = path.join(dir, `${id}.runs.jsonl`);
    try {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
        try {
          const r = JSON.parse(line);
          const k = keyOf(r);
          if (k) byKey.set(k, r);
        } catch { /* skip malformed line */ }
      }
    } catch { /* missing */ }
  }
  const sidecar = readSidecar(label, env);
  const sk = keyOf(sidecar);
  if (sk && !byKey.has(sk)) byKey.set(sk, sidecar);
  return [...byKey.values()];
}

export function programArguments(p) {
  return p.ProgramArguments || (p.Program ? [p.Program] : []);
}

export function buildModel(p, file, { loaded, disabled } = {}) {
  const args = programArguments(p);
  const env = p.EnvironmentVariables || {};
  const script = findScript(args);
  const schedule = {
    calendar: calendarEntries(p.StartCalendarInterval),
    interval: p.StartInterval || null,
    runAtLoad: !!p.RunAtLoad,
  };
  const runningSession = readRunningSidecar(p.Label, env);
  let state = disabled?.has(p.Label) ? 'disabled' : loaded?.has(p.Label) ? (loaded.get(p.Label).pid ? 'running' : 'loaded') : 'not loaded';
  if (runningSession && state !== 'disabled') state = 'running';
  return {
    label: p.Label,
    path: file,
    arguments: args,
    environment: env,
    workingDirectory: p.WorkingDirectory || null,
    schedule,
    scheduleText: formatSchedule(schedule),
    state,
    lastExit: loaded?.get(p.Label)?.status ?? null,
    stdoutPath: p.StandardOutPath || null,
    stderrPath: p.StandardErrorPath || null,
    script,
    tool: detectTool(args, script?.content, p.Label, env),
    runningSession,
    lastSession: readSidecar(p.Label, env),
    recentRuns: readRecordedRuns(p.Label, env),
  };
}
