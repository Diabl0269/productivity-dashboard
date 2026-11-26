// "Open session" and interactive ticket launch, driven declaratively by shared/harnesses.js. execFile only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.js';
import { executable } from './capabilities.js';
import { getAutomation } from './service.js';
import { automationRuns } from './history.js';
import { openInTerminal } from './terminal-settings.js';
import { getHarnessSpec, harnessEnvKeys, inferRunHarness } from '../../shared/harnesses.js';

const OPEN = () => process.env.OPEN_BIN || 'open';
const ID_RE = /^[A-Za-z0-9_.-]+$/;
const MODEL_RE = /^[A-Za-z0-9_./:-]{1,120}$/;
const MAX_LAUNCH_PROMPT = 64 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });

/** Safe POSIX single-quoted token: `'a'\''b'`. Simple tokens stay unquoted for readability. */
export function shellQuote(value) {
  const s = String(value ?? '');
  if (/^[A-Za-z0-9_./:@=-]+$/.test(s)) return s;
  return `'${s.replaceAll("'", "'\\''")}'`;
}

function validDir(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir.trim())) return null;
  const clean = dir.trim();
  try { return fs.statSync(clean).isDirectory() ? clean : null; } catch { return null; }
}

function withWorkingDir(cwd, cmd) {
  const dir = validDir(cwd);
  return dir ? `cd ${shellQuote(dir)} && ${cmd}` : cmd;
}

function resolveSpecCli(spec, automationEnv = {}) {
  const keys = harnessEnvKeys(spec.id);
  const envNames = [keys.cli, ...keys.extraCli];
  for (const key of ['AUTOMATION_CLI', ...envNames]) {
    const candidate = automationEnv[key];
    if (candidate && spec.binaries.some(b => path.basename(candidate).startsWith(b))) {
      return candidate;
    }
  }
  for (const bin of spec.binaries) {
    const found = executable(bin, envNames);
    if (found) return found;
  }
  return spec.fallbackCli || spec.defaultCli || spec.binaries[0] || spec.id;
}

function sessionExistsOnDisk(spec, id) {
  if (!spec?.sessionStore) return true;
  const keys = harnessEnvKeys(spec.id);
  if ([keys.cli, ...keys.extraCli].some(k => process.env[k])) return true;
  const home = os.homedir();
  const root = path.join(home, spec.sessionStore.rootRel);
  if (!fs.existsSync(root)) return true;
  return spec.sessionStore.pathsRel(id).some(rel => fs.existsSync(path.join(home, rel)));
}

function desktopAppAvailable(desktopApp) {
  if (!desktopApp) return false;
  if (process.env.OPEN_BIN) return true;
  const checkPath = desktopApp.checkPath || desktopApp.app;
  return path.isAbsolute(checkPath) ? fs.existsSync(checkPath) : true;
}

export async function openSession(label, sessionID = null, { mode = null, terminal = null, dataRoot = null } = {}) {
  const a = await getAutomation(label);
  const runs = await automationRuns(label, { cwd: a.workingDirectory || process.cwd() }).catch(() => a.recentRuns || []);
  const id = sessionID || a.lastSession?.sessionID || runs.find(r => r.sessionID)?.sessionID || null;
  if (id && !ID_RE.test(id)) return { done: 'none', note: 'Stored session id looks invalid' };

  const matchedRun = id ? runs.find(r => r.sessionID === id) : null;
  const runTool = inferRunHarness(matchedRun || (id ? { sessionID: id } : null), a.tool);
  const spec = getHarnessSpec(runTool);
  const cwd = validDir(a.workingDirectory);
  const title = `${label.replace(/^local\.(agent-automation|opencode)\./, '')}${id ? ` (${id.slice(0, 8)})` : ''}`;

  if (!spec || !spec.resumeArgs) {
    const log = a.stdoutPath || a.stderrPath;
    if (!log) return { done: 'none', note: 'No log file configured' };
    const r = await run(OPEN(), [log]);
    return { done: 'open-log', path: log, exitCode: r.code };
  }

  const cli = resolveSpecCli(spec, a.environment);
  const resumeCmd = id
    ? withWorkingDir(cwd, [shellQuote(cli), ...spec.resumeArgs(id).map(shellQuote)].join(' '))
    : null;
  const canOpenApp = spec.desktopApp && mode !== 'terminal' && (desktopAppAvailable(spec.desktopApp) || !id);

  if (canOpenApp) {
    const appArgs = ['-a', spec.desktopApp.app, ...(spec.desktopApp.passCwd && cwd ? [cwd] : [])];
    const r = await run(OPEN(), appArgs);
    return {
      done: 'open-app',
      app: spec.desktopApp.name,
      sessionID: id || null,
      harness: spec.id,
      exitCode: r.code,
      ...(resumeCmd ? { cli: resumeCmd } : {}),
      note: id
        ? `Opened ${spec.desktopApp.name}; find session ${id} (or use Open in Terminal)`
        : `Opened ${spec.desktopApp.name} (no recorded session yet)`,
    };
  }

  if (!id) {
    return {
      done: 'none',
      note: a.state === 'running'
        ? `${spec.shortLabel} run is still in progress — wait for it to finish`
        : `No recorded ${spec.shortLabel} session id yet`,
    };
  }
  if (!sessionExistsOnDisk(spec, id)) {
    return { done: 'none', note: `${spec.shortLabel} session ${id} was not found on disk` };
  }
  const r = await openInTerminal(resumeCmd, { cwd, title, terminal, dataRoot });
  return { done: 'terminal', terminal: r.terminal, command: resumeCmd, sessionID: id, harness: spec.id, exitCode: r.code };
}

/** Launch a new interactive coding-agent session in the configured terminal for any harness with interactiveArgs. */
export async function launchAgentSession(body = {}, { dataRoot = null } = {}) {
  const spec = getHarnessSpec(body.provider || 'gemini');
  if (!spec || !spec.interactiveArgs) throw fail(400, `Unsupported interactive launch provider: ${body.provider}`);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_LAUNCH_PROMPT) : '';
  if (!prompt) throw fail(400, 'prompt is required');
  const model = body.model ? String(body.model).trim() : '';
  if (model && !MODEL_RE.test(model)) throw fail(400, 'Invalid model identifier');
  const folder = typeof body.folder === 'string' && path.isAbsolute(body.folder.trim()) ? body.folder.trim() : '';
  const dir = validDir(folder);

  const cli = resolveSpecCli(spec);
  const promptFile = path.join(os.tmpdir(), `agent-launch-${crypto.randomUUID()}.prompt`);
  fs.writeFileSync(promptFile, prompt, { encoding: 'utf8', mode: 0o600 });

  const modelFlag = model ? ` --model ${shellQuote(model)}` : '';
  const cdPart = dir ? `cd ${shellQuote(dir)} && ` : '';
  const qFile = shellQuote(promptFile);
  const tplArgs = spec.interactiveArgs('__PROMPT__').map(a => (a === '__PROMPT__' ? '"$_agent_p"' : shellQuote(a))).join(' ');
  const cmd = `_agent_p="$(cat ${qFile})"; rm -f ${qFile}; ${cdPart}${shellQuote(cli)}${modelFlag} ${tplArgs}`;
  const title = prompt.split('\n')[0].slice(0, 48) || spec.shortLabel;
  const r = await openInTerminal(cmd, { cwd: dir, title, terminal: body.terminal || null, dataRoot });
  if (r.code !== 0) {
    fs.rmSync(promptFile, { force: true });
    throw fail(502, (r.stderr || r.stdout).trim() || 'Could not launch Terminal session');
  }
  return { done: 'terminal', terminal: r.terminal, provider: spec.id, folder: dir, exitCode: r.code };
}
