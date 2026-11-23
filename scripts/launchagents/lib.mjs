// LaunchAgent installer for coding-agent automations (no shell: every value reaches launchctl/plutil as an argv entry
// and the plist as XML-escaped text). Used by scripts/launchagents/install.mjs and the Home edit route.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEFAULT_SCHEDULES, HARNESS_DEFAULTS, effectiveRun } from '../../shared/automation-run.js';

export const LABEL_PREFIX = 'local.agent-automation';
export const LEGACY_LABEL_PREFIX = 'local.opencode';

const escapeXml = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const str = v => `\t\t<string>${escapeXml(v)}</string>`;
const expandHome = (v, home) => v === '~' ? home : v?.startsWith('~/') ? path.join(home, v.slice(2)) : v;

export function defaultPrompt(skill) {
  return `Run the "${skill}" automation: read and follow the instructions in .agents/skills/${skill}/SKILL.md (relative to the working directory) exactly. This is an unattended scheduled run; do not ask questions.`;
}

export function dirsFor(home = os.homedir()) {
  return {
    home,
    supportDir: path.join(home, 'Library', 'Application Support', 'agent-automations'),
    launchDir: path.join(home, 'Library', 'LaunchAgents'),
    logDir: path.join(home, 'Library', 'Logs', 'agent-automations'),
  };
}

function calendar(s) {
  const base = `\t\t\t<key>Hour</key><integer>${s.hour}</integer>\n\t\t\t<key>Minute</key><integer>${s.minute}</integer>\n`;
  if (s.weekdays && s.weekdays.length < 7) {
    return `\t<array>\n${s.weekdays.map(d => `\t\t<dict>\n${base}\t\t\t<key>Weekday</key><integer>${d}</integer>\n\t\t</dict>`).join('\n')}\n\t</array>`;
  }
  const day = s.day !== undefined ? `\t\t\t<key>Day</key><integer>${s.day}</integer>\n` : '';
  return `\t<dict>\n${base.replaceAll('\t\t\t', '\t\t')}${day.replaceAll('\t\t\t', '\t\t')}\t</dict>`;
}

/**
 * The LaunchAgent plist text of one job.
 * @param {{ id, schedule, model?, effort?, skill?, prompt? }} job
 * @param {{ repoRoot, cli?, dirs }} opts
 */
export function buildPlist(job, { repoRoot, cli, dirs = dirsFor() }) {
  const label = `${LABEL_PREFIX}.${job.id}`;
  const log = path.join(dirs.logDir, `${job.id}.log`);
  const prompt = job.prompt || defaultPrompt(job.skill || job.id);
  const harness = job.harness || '';
  const executable = job.cli || cli || HARNESS_DEFAULTS[harness]?.cli || '';
  if (!harness || !executable) throw new Error(`The automation "${job.id}" needs both harness and cli values.`);
  const argumentLines = (job.arguments || []).map(arg => escapeXml(arg)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>AUTOMATION_HARNESS</key><string>${escapeXml(harness)}</string>
\t\t<key>AUTOMATION_CLI</key><string>${escapeXml(expandHome(executable, dirs.home || os.homedir()))}</string>
\t\t<key>AUTOMATION_EFFORT</key><string>${escapeXml(job.effort || 'medium')}</string>
\t\t<key>AUTOMATION_MODEL</key><string>${escapeXml(job.model || '')}</string>
\t\t<key>AUTOMATION_ARGUMENTS</key><string>${argumentLines}</string>
\t\t<key>AUTOMATION_LOG_DIR</key><string>${escapeXml(dirs.logDir)}</string>
\t\t<key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
\t</dict>
\t<key>Label</key><string>${escapeXml(label)}</string>
\t<key>ProgramArguments</key>
\t<array>
${str('/bin/bash')}
${str(path.join(dirs.supportDir, 'run-job.sh'))}
${str(job.id)}
${str(prompt)}
\t</array>
\t<key>StandardErrorPath</key><string>${escapeXml(log)}</string>
\t<key>StandardOutPath</key><string>${escapeXml(log)}</string>
\t<key>StartCalendarInterval</key>
${calendar(job.schedule)}
\t<key>WorkingDirectory</key><string>${escapeXml(repoRoot)}</string>
</dict>
</plist>
`;
}

/** Turn an automation entry (home config) into an installer job, or null when it has no schedule. */
export function jobFromEntry(entry, effort, defaults = {}) {
  const run = effectiveRun(entry, defaults);
  if (!run.schedule) return null;
  return { id: entry.id, schedule: run.schedule, harness: run.harness, model: run.model, effort: run.effort || effort, cli: run.cli, runner: run.runner, arguments: run.arguments, skill: run.skill || entry.id, prompt: run.prompt, enabled: run.enabled };
}

/** The four built-in jobs, for a fresh install. */
export function defaultJobs({ harness, model, cli, effort, runner, arguments: args = [] } = {}) {
  if (!harness || !cli) throw new Error('Automation defaults must include harness and cli.');
  return Object.entries(DEFAULT_SCHEDULES).map(([id, schedule]) => ({ id, schedule, harness, model, cli, effort, runner, arguments: args, enabled: true }));
}

/**
 * Write the runner and plist of one job and (re)load it, or unload it when `enabled` is false.
 * @param {object} job see buildPlist; `enabled: false` leaves the agent unloaded
 * @param {{ repoRoot, runnerSource?, cli?, home?, exec?, uid?, log? }} opts exec(file, args) defaults to execFileSync
 * @returns {{ id, label, plistPath, loaded: boolean, warning?: string }}
 */
export function installJob(job, opts) {
  const { repoRoot, cli, home = os.homedir(), uid = process.getuid?.() ?? 0 } = opts;
  const exec = opts.exec || ((file, args) => execFileSync(file, args, { stdio: 'ignore' }));
  const runnerSource = expandHome(job.runner || opts.runnerSource || path.join(path.dirname(new URL(import.meta.url).pathname), 'run-job.sh'), home);
  const dirs = dirsFor(home);
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const runner = path.join(dirs.supportDir, 'run-job.sh');
  fs.copyFileSync(runnerSource, runner);
  fs.chmodSync(runner, 0o755);

  const label = `${LABEL_PREFIX}.${job.id}`;
  const legacyPlistPath = path.join(dirs.launchDir, `${LEGACY_LABEL_PREFIX}.${job.id}.plist`);
  const plistPath = path.join(dirs.launchDir, `${label}.plist`);
  const tmp = `${plistPath}.tmp`;
  fs.writeFileSync(tmp, buildPlist(job, { repoRoot, cli: job.cli || cli, dirs }));
  try {
    exec('/usr/bin/plutil', ['-lint', tmp]);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`The LaunchAgent for "${job.id}" did not pass plutil -lint: ${e.message}`);
  }
  fs.renameSync(tmp, plistPath);
  const domain = `gui/${uid}`;
  try { exec('launchctl', ['bootout', domain, legacyPlistPath]); } catch { /* legacy agent was not loaded */ }
  fs.rmSync(legacyPlistPath, { force: true });
  try { exec('launchctl', ['bootout', domain, plistPath]); } catch { /* it was not loaded */ }
  if (job.enabled === false) return { id: job.id, label, plistPath, loaded: false };
  try {
    exec('launchctl', ['bootstrap', domain, plistPath]);
  } catch {
    return { id: job.id, label, plistPath, loaded: false, warning: `${job.id}: plist updated, but launchd could not load it; run launchctl bootstrap ${domain} ${plistPath}` };
  }
  return { id: job.id, label, plistPath, loaded: true };
}
