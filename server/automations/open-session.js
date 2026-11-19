// "Open session" for an automation: jump to the tool's record of its last run. execFile only.
import { run } from './exec.js';
import { getAutomation } from './service.js';

const OPENCODE_APP = '/Applications/OpenCode.app';
const OPENCODE_CLI = `${OPENCODE_APP}/Contents/Resources/opencode-cli`;
const OPEN = () => process.env.OPEN_BIN || 'open';
const ID_RE = /^[A-Za-z0-9_.-]+$/;

// Terminal via AppleScript; `cmd` is built only from validated pieces.
function terminal(cmd) {
  const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(cmd)}\nend tell`;
  return run(process.env.OSASCRIPT_BIN || 'osascript', ['-e', script]);
}

export async function openSession(label) {
  const a = await getAutomation(label);
  const id = a.lastSession?.sessionID;
  if (id && !ID_RE.test(id)) return { done: 'none', note: 'Stored session id looks invalid' };
  switch (a.tool) {
    case 'opencode': {
      // OpenCode has no documented deep link, attach or web command for a session id
      // (checked `opencode-cli --help`): open the desktop app; the session is findable by its title.
      const r = await run(OPEN(), ['-a', OPENCODE_APP]);
      return { done: 'open-app', app: 'OpenCode', sessionID: id || null, exitCode: r.code, cli: id ? `${OPENCODE_CLI} run -s ${id}` : null,
        note: id ? `Opened OpenCode; find the session ${id}` : 'Opened OpenCode (no recorded session yet)' };
    }
    case 'copilot': {
      const r = await run(OPEN(), ['-a', 'GitHub Copilot']);
      return { done: 'open-app', app: 'GitHub Copilot', sessionID: id || null, exitCode: r.code };
    }
    case 'claude':
    case 'codex': {
      if (!id) return { done: 'none', note: `No recorded ${a.tool} session id for this automation` };
      const cmd = a.tool === 'claude' ? `claude --resume ${id}` : `codex resume ${id}`;
      const r = await terminal(cmd);
      return { done: 'terminal', command: cmd, exitCode: r.code };
    }
    default: {
      const log = a.stdoutPath || a.stderrPath;
      if (!log) return { done: 'none', note: 'No log file configured' };
      const r = await run(OPEN(), [log]);
      return { done: 'open-log', path: log, exitCode: r.code };
    }
  }
}
