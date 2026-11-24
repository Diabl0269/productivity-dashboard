// Terminal preference storage (config.json `terminalApp`, default 'default') and launcher for macOS terminals.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.js';

export const TERMINALS = ['default', 'cmux', 'iterm', 'ghostty'];
const CMUX_APP = '/Applications/cmux.app';
const CMUX_CLI_DEFAULT = `${CMUX_APP}/Contents/Resources/bin/cmux`;

const fail = (status, message) => Object.assign(new Error(message), { status });

function configPath(dataRoot) {
  const root = dataRoot || process.env.CH_HOME || process.cwd();
  return path.join(path.resolve(root), 'config.json');
}

export function normalizeTerminal(value) {
  const v = String(value || '').trim().toLowerCase();
  return TERMINALS.includes(v) ? v : 'default';
}

export function readTerminalSetting(dataRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(dataRoot), 'utf8'));
    return normalizeTerminal(raw?.terminalApp);
  } catch {
    return 'default';
  }
}

export function writeTerminalSetting(dataRoot, value) {
  const v = String(value || '').trim().toLowerCase();
  if (!TERMINALS.includes(v)) throw fail(400, `terminalApp must be one of ${TERMINALS.join(', ')}`);
  const file = configPath(dataRoot);
  let existing = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
      throw fail(409, 'config.json is not valid JSON');
    }
  }
  const next = { ...existing };
  if (v === 'default') delete next.terminalApp;
  else next.terminalApp = v;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return normalizeTerminal(next.terminalApp);
}

function findCmuxCli() {
  if (process.env.CMUX_BIN && fs.existsSync(process.env.CMUX_BIN)) return process.env.CMUX_BIN;
  if (fs.existsSync(CMUX_CLI_DEFAULT)) return CMUX_CLI_DEFAULT;
  for (const dir of [...(process.env.PATH || '').split(':'), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']) {
    if (!dir) continue;
    const candidate = path.join(dir, 'cmux');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findCmuxSocket() {
  if (process.env.CMUX_BIN) return null;
  if (process.env.CMUX_SOCKET_PATH && fs.existsSync(process.env.CMUX_SOCKET_PATH)) return process.env.CMUX_SOCKET_PATH;
  const stateDir = path.join(os.homedir(), '.local', 'state', 'cmux');
  try {
    const last = fs.readFileSync(path.join(stateDir, 'last-socket-path'), 'utf8').trim();
    if (last && fs.existsSync(last)) return last;
  } catch { /* try default sock */ }
  const def = path.join(stateDir, 'cmux.sock');
  return fs.existsSync(def) ? def : null;
}

async function openInCmuxAppleScript(cmd, { title = null } = {}) {
  if (!fs.existsSync(CMUX_APP)) return null;
  const fullCmd = title
    ? `command -v cmux >/dev/null 2>&1 && cmux rename-workspace ${JSON.stringify(title)} >/dev/null 2>&1; ${cmd}`
    : cmd;
  const script = [
    `tell application ${JSON.stringify(CMUX_APP)}`,
    '  activate',
    '  if (count of windows) = 0 then',
    '    set w to new window',
    '    set ws to selected tab of w',
    '  else',
    '    set ws to new tab in front window',
    '  end if',
    '  repeat 20 times',
    '    try',
    '      set term to focused terminal of ws',
    '      if exists term then exit repeat',
    '    end try',
    '    delay 0.15',
    '  end repeat',
    '  set term to focused terminal of ws',
    '  delay 0.25',
    '  focus term',
    `  input text ${JSON.stringify(`${fullCmd}\n`)} to term`,
    'end tell',
  ].join('\n');
  const res = await run(process.env.OSASCRIPT_BIN || 'osascript', ['-e', script]);
  return { ...res, terminal: 'cmux' };
}

async function openInCmux(cmd, { cwd = null, title = null } = {}) {
  const cmux = findCmuxCli();
  const openBin = process.env.OPEN_BIN || 'open';
  if (cmux) {
    const runCmux = args => {
      const sock = findCmuxSocket();
      return run(cmux, sock ? ['--socket', sock, ...args] : args);
    };
    const ws = await runCmux(['current-workspace']);
    if (ws.code === 0) {
      const wsRef = ws.stdout.trim().split(/\s+/)[0];
      let res;
      if (wsRef) {
        const args = ['new-surface', '--type', 'terminal', '--workspace', wsRef];
        if (cwd) args.push('--working-directory', cwd);
        args.push('--command', cmd, '--focus', 'true');
        res = await runCmux(args);
        const surfaceRef = res.stdout.match(/\bsurface:[A-Za-z0-9_-]+/)?.[0] || '';
        if (res.code === 0 && title && surfaceRef) {
          await runCmux(['rename-tab', '--workspace', wsRef, '--surface', surfaceRef, title]).catch(() => {});
        }
      } else {
        const args = ['new-workspace'];
        if (title) args.push('--name', title);
        if (cwd) args.push('--cwd', cwd);
        args.push('--command', cmd, '--focus', 'true');
        res = await runCmux(args);
      }
      if (res.code === 0) {
        if (fs.existsSync(CMUX_APP) && !process.env.CMUX_BIN) {
          await run(openBin, ['-a', CMUX_APP]).catch(() => {});
        }
        return { ...res, terminal: 'cmux' };
      }
    }
  }
  // Under launchd (PPID 1), cmux's default "cmuxOnly" socket control mode rejects direct socket commands;
  // use cmux.app's official AppleScript dictionary (cmux.sdef) so sessions still open directly in cmux.
  if (!process.env.CMUX_BIN) {
    return openInCmuxAppleScript(cmd, { title });
  }
  return null;
}

async function openInITerm(cmd) {
  const script = `tell application "iTerm"\nactivate\nif (count of windows) = 0 then\ncreate window with default profile command ${JSON.stringify(`/bin/zsh -lic ${JSON.stringify(cmd)}`)}\nelse\ntell current window\ncreate tab with default profile command ${JSON.stringify(`/bin/zsh -lic ${JSON.stringify(cmd)}`)}\nend tell\nend if\nend tell`;
  const res = await run(process.env.OSASCRIPT_BIN || 'osascript', ['-e', script]);
  return { ...res, terminal: 'iterm' };
}

async function openInGhostty(cmd, { cwd = null } = {}) {
  const openBin = process.env.OPEN_BIN || 'open';
  const args = ['-na', 'Ghostty.app', '--args'];
  if (cwd) args.push(`--working-directory=${cwd}`);
  args.push('-e', '/bin/zsh', '-lic', cmd);
  const res = await run(openBin, args);
  return { ...res, terminal: 'ghostty' };
}

async function openInAppleTerminal(cmd) {
  const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(cmd)}\nend tell`;
  const res = await run(process.env.OSASCRIPT_BIN || 'osascript', ['-e', script]);
  return { ...res, terminal: 'default' };
}

export async function openInTerminal(cmd, { cwd = null, title = null, terminal = null, dataRoot = null } = {}) {
  // When OSASCRIPT_BIN is explicitly mocked in tests without CMUX_BIN, honor OSASCRIPT_BIN directly unless terminal was explicitly passed.
  const chosen = terminal
    ? normalizeTerminal(terminal)
    : (process.env.OSASCRIPT_BIN && !process.env.CMUX_BIN ? 'default' : readTerminalSetting(dataRoot));

  if (chosen === 'cmux') {
    const r = await openInCmux(cmd, { cwd, title });
    if (r && r.code === 0) return r;
  } else if (chosen === 'iterm') {
    const r = await openInITerm(cmd);
    if (r.code === 0) return r;
  } else if (chosen === 'ghostty') {
    const r = await openInGhostty(cmd, { cwd });
    if (r.code === 0) return r;
  }
  return openInAppleTerminal(cmd);
}
