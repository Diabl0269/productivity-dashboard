// Daemon self-reload: when server code changes on disk (e.g. after `git pull`), exit non-zero so launchd's
// KeepAlive {SuccessfulExit:false} starts a fresh process (the ES-module cache cannot be cleared in place).
// Enabled only by DASHBOARD_AUTORELOAD=1, which the LaunchAgent plist sets; manual runs and tests are unaffected.
// Polls file mtimes instead of fs.watch: no platform quirks, and a few hundred stats every 2s cost nothing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const RELOAD_EXIT_CODE = 75;
const WATCHED = ['serve.js', 'server', 'shared', 'cli/lib'];
const CODE_FILE = /\.(c|m)?js(on)?$/;

function signature(root) {
  let sig = '';
  const visit = abs => {
    let st;
    try { st = fs.statSync(abs); } catch { return; }
    if (st.isDirectory()) {
      let names = [];
      try { names = fs.readdirSync(abs).sort(); } catch { return; }
      for (const n of names) if (n !== 'node_modules') visit(path.join(abs, n));
    } else if (CODE_FILE.test(abs)) sig += `${abs}:${st.mtimeMs}:${st.size};`;
  };
  for (const rel of WATCHED) visit(path.join(root, rel));
  return sig;
}

export function watchForCodeChanges({ root, server, pollMs = 2000, quietMs = 1500, exit = process.exit, log = console.log, check = true } = {}) {
  let last = signature(root);
  let changedAt = 0;
  const reload = () => {
    if (check) {
      try { execFileSync(process.execPath, ['--check', path.join(root, 'serve.js')], { stdio: 'pipe' }); }
      catch { log('code changed but serve.js fails a syntax check; keeping the running server'); return; }
    }
    log('code changed; exiting for launchd restart');
    setTimeout(() => exit(RELOAD_EXIT_CODE), 3000).unref?.();
    server.close(() => exit(RELOAD_EXIT_CODE));
    server.closeIdleConnections?.();
  };
  const timer = setInterval(() => {
    const now = signature(root);
    if (now !== last) { last = now; changedAt = Date.now(); return; } // still changing: wait for a quiet period
    if (changedAt && Date.now() - changedAt >= quietMs) { changedAt = 0; clearInterval(timer); reload(); }
  }, pollMs);
  timer.unref?.();
  return { close: () => clearInterval(timer) };
}
