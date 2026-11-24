// "Open session" and interactive ticket launch: jump to a tool's recorded run or start a new session. execFile only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.js';
import { executable } from './capabilities.js';
import { getAutomation } from './service.js';
import { automationRuns } from './history.js';
import { openInTerminal } from './terminal-settings.js';

const OPENCODE_APP = '/Applications/OpenCode.app';
const OPENCODE_CLI = `${OPENCODE_APP}/Contents/Resources/opencode-cli`;
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

function resolveCli(a, name, envKeys = []) {
  const env = a.environment || {};
  for (const key of ['AUTOMATION_CLI', ...envKeys]) {
    const candidate = env[key];
    if (candidate && path.basename(candidate).startsWith(name)) return shellQuote(candidate);
  }
  const found = executable(name, envKeys);
  return shellQuote(found || name);
}

function geminiConversationExists(id) {
  // Skip disk check when GEMINI_CLI is overridden in unit tests.
  if (process.env.GEMINI_CLI || process.env.AGY_CLI) return true;
  const base = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  if (!fs.existsSync(base)) return true;
  return fs.existsSync(path.join(base, 'conversations', `${id}.db`))
    || fs.existsSync(path.join(base, 'brain', id));
}

export async function openSession(label, sessionID = null, { mode = null, terminal = null, dataRoot = null } = {}) {
  const a = await getAutomation(label);
  const runs = await automationRuns(label, { cwd: a.workingDirectory || process.cwd() }).catch(() => a.recentRuns || []);
  const id = sessionID || a.lastSession?.sessionID || runs[0]?.sessionID || null;
  if (id && !ID_RE.test(id)) return { done: 'none', note: 'Stored session id looks invalid' };

  const matchedRun = id ? runs.find(r => r.sessionID === id) : null;
  const runTool = matchedRun?.harness
    || (id?.startsWith('ses_') ? 'opencode' : null)
    || a.tool;
  const cwd = validDir(a.workingDirectory);
  const title = `${label.replace(/^local\.(agent-automation|opencode)\./, '')}${id ? ` (${id.slice(0, 8)})` : ''}`;

  switch (runTool) {
    case 'gemini': {
      if (!id) return { done: 'none', note: a.state === 'running' ? 'Gemini run is still in progress — wait for it to finish' : 'No recorded Gemini conversation id yet' };
      if (!geminiConversationExists(id)) {
        return { done: 'none', note: `Gemini conversation ${id} was not found in ~/.gemini/antigravity-cli` };
      }
      const cli = resolveCli(a, 'agy', ['GEMINI_CLI', 'AGY_CLI']);
      const cmd = withWorkingDir(cwd, `${cli} --conversation=${id}`);
      const r = await openInTerminal(cmd, { cwd, title, terminal, dataRoot });
      return { done: 'terminal', terminal: r.terminal, command: cmd, sessionID: id, harness: 'gemini', exitCode: r.code };
    }
    case 'opencode': {
      const ocEnvCli = a.environment?.OPENCODE_CLI
        || (a.environment?.AUTOMATION_CLI && path.basename(a.environment.AUTOMATION_CLI).startsWith('opencode') ? a.environment.AUTOMATION_CLI : null);
      const ocCli = ocEnvCli || executable('opencode', []) || OPENCODE_CLI;
      const cliCmd = id ? withWorkingDir(cwd, `${shellQuote(ocCli)} -s ${id}`) : null;
      const useTerminal = mode === 'terminal' || (!process.env.OPEN_BIN && !fs.existsSync(OPENCODE_APP) && id);
      if (useTerminal) {
        if (!id) return { done: 'none', note: 'No recorded OpenCode session id for this automation' };
        const r = await openInTerminal(cliCmd, { cwd, title, terminal, dataRoot });
        return { done: 'terminal', terminal: r.terminal, command: cliCmd, sessionID: id, harness: 'opencode', exitCode: r.code };
      }
      const openArgs = cwd ? ['-a', OPENCODE_APP, cwd] : ['-a', OPENCODE_APP];
      const r = await run(OPEN(), openArgs);
      return {
        done: 'open-app', app: 'OpenCode', sessionID: id || null, harness: 'opencode', exitCode: r.code,
        cli: cliCmd,
        note: id ? `Opened OpenCode; find session ${id} (or use Open in Terminal)` : 'Opened OpenCode (no recorded session yet)',
      };
    }
    case 'copilot': {
      if (id && (mode === 'terminal' || (!process.env.OPEN_BIN && !fs.existsSync('/Applications/GitHub Copilot.app')))) {
        const cli = resolveCli(a, 'copilot', ['COPILOT_CLI']);
        const cmd = withWorkingDir(cwd, `${cli} --resume=${id}`);
        const r = await openInTerminal(cmd, { cwd, title, terminal, dataRoot });
        return { done: 'terminal', terminal: r.terminal, command: cmd, sessionID: id, harness: 'copilot', exitCode: r.code };
      }
      const r = await run(OPEN(), ['-a', 'GitHub Copilot']);
      return { done: 'open-app', app: 'GitHub Copilot', sessionID: id || null, harness: 'copilot', exitCode: r.code };
    }
    case 'claude':
    case 'codex': {
      if (!id) return { done: 'none', note: `No recorded ${runTool} session id for this automation` };
      const cli = runTool === 'claude' ? resolveCli(a, 'claude', ['CLAUDE_CLI']) : resolveCli(a, 'codex', ['CODEX_CLI']);
      const base = runTool === 'claude' ? `${cli} --resume ${id}` : `${cli} resume ${id}`;
      const cmd = withWorkingDir(cwd, base);
      const r = await openInTerminal(cmd, { cwd, title, terminal, dataRoot });
      return { done: 'terminal', terminal: r.terminal, command: cmd, sessionID: id, harness: runTool, exitCode: r.code };
    }
    default: {
      const log = a.stdoutPath || a.stderrPath;
      if (!log) return { done: 'none', note: 'No log file configured' };
      const r = await run(OPEN(), [log]);
      return { done: 'open-log', path: log, exitCode: r.code };
    }
  }
}

/** Launch a new interactive coding-agent session (e.g. Antigravity `agy -i`) for a dashboard ticket/card. */
export async function launchAgentSession(body = {}, { dataRoot = null } = {}) {
  const provider = String(body.provider || 'gemini').toLowerCase();
  if (provider !== 'gemini') throw fail(400, `Unsupported interactive launch provider: ${provider}`);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, MAX_LAUNCH_PROMPT) : '';
  if (!prompt) throw fail(400, 'prompt is required');
  const model = body.model ? String(body.model).trim() : '';
  if (model && !MODEL_RE.test(model)) throw fail(400, 'Invalid model identifier');
  const folder = typeof body.folder === 'string' && path.isAbsolute(body.folder.trim()) ? body.folder.trim() : '';
  const dir = validDir(folder);

  const agy = executable('agy', ['GEMINI_CLI', 'AGY_CLI']) || 'agy';
  const promptFile = path.join(os.tmpdir(), `agy-launch-${crypto.randomUUID()}.prompt`);
  fs.writeFileSync(promptFile, prompt, { encoding: 'utf8', mode: 0o600 });

  const modelFlag = model ? ` --model ${shellQuote(model)}` : '';
  const cdPart = dir ? `cd ${shellQuote(dir)} && ` : '';
  const qFile = shellQuote(promptFile);
  const cmd = `_agy_p="$(cat ${qFile})"; rm -f ${qFile}; ${cdPart}${shellQuote(agy)}${modelFlag} -i "$_agy_p"`;
  const title = prompt.split('\n')[0].slice(0, 48) || 'Antigravity';
  const r = await openInTerminal(cmd, { cwd: dir, title, terminal: body.terminal || null, dataRoot });
  if (r.code !== 0) {
    fs.rmSync(promptFile, { force: true });
    throw fail(502, (r.stderr || r.stdout).trim() || 'Could not launch Terminal session');
  }
  return { done: 'terminal', terminal: r.terminal, provider: 'gemini', folder: dir, exitCode: r.code };
}
