// plist JSON -> the model the Automations page shows. Pure except readSidecar.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { calendarEntries, formatSchedule } from '../../shared/automation-schedule.js';
import { recordedRuns } from './history.js';

export const LABEL_PREFIX = 'local.opencode.';
const TEXT_MAX = 256 * 1024;

export const launchAgentsDir = () => process.env.LAUNCH_AGENTS_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents');
export const logDir = () => process.env.AUTOMATION_LOG_DIR || path.join(os.homedir(), 'Library', 'Logs', 'opencode-automations');

const TOOLS = { opencode: 'opencode', 'opencode-cli': 'opencode', copilot: 'copilot', claude: 'claude', codex: 'codex' };

/** opencode | copilot | claude | codex | other, from program arguments, the script text, and the label. */
export function detectTool(args = [], scriptText = '', label = '') {
  const tokens = [...args, ...String(scriptText).split(/[\s"';|&()=]+/)].map(t => path.basename(t));
  const hits = new Set(tokens.map(t => TOOLS[t]).filter(Boolean));
  for (const t of ['opencode', 'copilot', 'claude', 'codex']) if (hits.has(t)) return t;
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

export function readSidecar(label) {
  const id = label.startsWith(LABEL_PREFIX) ? label.slice(LABEL_PREFIX.length) : label;
  try { return JSON.parse(fs.readFileSync(path.join(logDir(), `${id}.last.json`), 'utf8')); } catch { return null; }
}

export function programArguments(p) {
  return p.ProgramArguments || (p.Program ? [p.Program] : []);
}

export function buildModel(p, file, { loaded, disabled } = {}) {
  const args = programArguments(p);
  const script = findScript(args);
  const schedule = {
    calendar: calendarEntries(p.StartCalendarInterval),
    interval: p.StartInterval || null,
    runAtLoad: !!p.RunAtLoad,
  };
  const state = disabled?.has(p.Label) ? 'disabled' : loaded?.has(p.Label) ? (loaded.get(p.Label).pid ? 'running' : 'loaded') : 'not loaded';
  return {
    label: p.Label,
    path: file,
    arguments: args,
    environment: p.EnvironmentVariables || {},
    workingDirectory: p.WorkingDirectory || null,
    schedule,
    scheduleText: formatSchedule(schedule),
    state,
    lastExit: loaded?.get(p.Label)?.status ?? null,
    stdoutPath: p.StandardOutPath || null,
    stderrPath: p.StandardErrorPath || null,
    script,
    tool: detectTool(args, script?.content, p.Label),
    lastSession: readSidecar(p.Label),
    recentRuns: recordedRuns(p.Label),
  };
}
