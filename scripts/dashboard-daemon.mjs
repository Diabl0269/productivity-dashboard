#!/usr/bin/env node
// Install, remove, or inspect the per-user macOS LaunchAgent for the dashboard server.

import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.productivity-dashboard.server';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const UID = process.getuid?.() ?? 0;
const PORT = Number(process.env.DASHBOARD_PORT || 3000);
const DOMAIN = `gui/${UID}`;
const TARGET = `${DOMAIN}/${LABEL}`;
const PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = path.join(HOME, 'Library', 'Logs', 'productivity-dashboard');

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function execFile(command, args) {
  return new Promise((resolve) => {
    execFileCallback(command, args, { encoding: 'utf8' }, (error, stdout = '', stderr = '') => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

function responding(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/dashboard/`, { timeout: 1500 }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 400));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function plist() {
  const env = { HOME, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' };
  if (process.env.CH_HOME) env.CH_HOME = process.env.CH_HOME;
  const envEntries = Object.entries(env)
    .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(path.join(ROOT, 'serve.js'))}</string>
    <string>${PORT}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(path.join(LOG_DIR, 'server.out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(LOG_DIR, 'server.err.log'))}</string>
</dict>
</plist>
`;
}

async function enable() {
  if (process.platform !== 'darwin') throw new Error('dashboard daemon is only supported on macOS (launchd)');
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('DASHBOARD_PORT must be a valid port');
  fs.mkdirSync(path.dirname(PLIST), { recursive: true, mode: 0o755 });
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PLIST, plist(), { mode: 0o644 });
  fs.chmodSync(PLIST, 0o644);
  await execFile('launchctl', ['bootout', TARGET]);
  const boot = await execFile('launchctl', ['bootstrap', DOMAIN, PLIST]);
  if (boot.code !== 0) throw new Error(`launchctl bootstrap failed: ${boot.stderr.trim() || `exit ${boot.code}`}`);
  const kick = await execFile('launchctl', ['kickstart', '-k', TARGET]);
  if (kick.code !== 0) throw new Error(`launchctl kickstart failed: ${kick.stderr.trim() || `exit ${kick.code}`}`);
  const deadline = Date.now() + 10_000;
  while (!(await responding(PORT)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
  if (!(await responding(PORT))) throw new Error(`dashboard did not become ready on port ${PORT}; check ${path.join(LOG_DIR, 'server.err.log')}`);
  console.log(`dashboard daemon enabled: http://127.0.0.1:${PORT}/dashboard/`);
  console.log(`logs: ${LOG_DIR}`);
}

async function disable() {
  if (process.platform !== 'darwin') throw new Error('dashboard daemon is only supported on macOS (launchd)');
  await execFile('launchctl', ['bootout', TARGET]);
  fs.rmSync(PLIST, { force: true });
  console.log('dashboard daemon disabled');
}

async function status() {
  const printed = await execFile('launchctl', ['print', TARGET]);
  const loaded = printed.code === 0;
  const state = /^\s*state = (\S+)/m.exec(printed.stdout)?.[1];
  const pid = /^\s*pid = (\d+)/m.exec(printed.stdout)?.[1];
  console.log(`plist: ${fs.existsSync(PLIST) ? PLIST : 'not installed'}`);
  console.log(`launchd: ${loaded ? `loaded (${state || 'unknown state'}${pid ? `, pid ${pid}` : ''})` : 'not loaded'}`);
  console.log(`dashboard: ${await responding(PORT) ? `responding on port ${PORT}` : `not responding on port ${PORT}`}`);
}

const action = process.argv[2] || 'status';
try {
  if (action === 'enable') await enable();
  else if (action === 'disable') await disable();
  else if (action === 'status') await status();
  else throw new Error('usage: node scripts/dashboard-daemon.mjs enable|disable|status');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
