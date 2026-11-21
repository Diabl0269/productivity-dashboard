#!/usr/bin/env node
// Generate and load the OpenCode automation LaunchAgents (local.opencode.<id>).
//   node scripts/launchagents/install.mjs [--dry-run] [--no-load] [--uninstall] [--only id,id]
// Env: LAUNCH_AGENTS_DIR (default ~/Library/LaunchAgents), REPO_ROOT (default: this checkout; set it to
//      the real checkout, e.g. "$HOME/path/to/checkout"),
//      OPENCODE_MODEL (optional), AUTOMATION_LOG_DIR, COPILOT_TASKS_DIR (skill source), LAUNCHCTL_BIN, PLUTIL_BIN.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePlist } from '../../server/automations/plist.js';
import * as lc from '../../server/automations/launchctl.js';
import { LABEL_PREFIX, launchAgentsDir, logDir } from '../../server/automations/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const repoRoot = path.resolve(process.env.REPO_ROOT || path.join(here, '..', '..'));
const jobs = JSON.parse(fs.readFileSync(path.join(here, 'jobs.json'), 'utf8')).filter(j => !only || only.includes(j.id));
const installHome = process.env.AUTOMATION_HOME_DIR || os.homedir();
const copilotTasks = process.env.COPILOT_TASKS_DIR || path.join(os.homedir(), '.copilot', 'scheduled-tasks');

export function promptFor(id) {
  return `Run the "${id}" automation: read and follow the instructions in .agents/skills/${id}/SKILL.md (relative to the working directory) exactly. This is an unattended scheduled run; do not ask questions.`;
}

export function buildPlist(job, { root = repoRoot, model = process.env.OPENCODE_MODEL, logs = logDir() } = {}) {
  const label = LABEL_PREFIX + job.id;
  const env = { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', AUTOMATION_LOG_DIR: logs };
  const harness = job.harness || process.env.AUTOMATION_HARNESS;
  if (harness) env.AUTOMATION_HARNESS = harness;
  const prefix = harness === 'claude' ? 'CLAUDE' : harness === 'copilot' ? 'COPILOT' : 'OPENCODE';
  const selectedModel = job.model || model;
  if (selectedModel) env[`${prefix}_MODEL`] = selectedModel;
  if (job.agent) env[`${prefix}_AGENT`] = job.agent;
  if (job.effort) env[`${prefix}_EFFORT`] = job.effort;
  return {
    Label: label,
    ProgramArguments: ['/bin/bash', path.join(root, 'scripts', 'launchagents', 'run-job.sh'), job.id, promptFor(job.id)],
    WorkingDirectory: root,
    EnvironmentVariables: env,
    StartCalendarInterval: job.schedule.length === 1 ? job.schedule[0] : job.schedule,
    StandardOutPath: path.join(logs, `${job.id}.log`),
    StandardErrorPath: path.join(logs, `${job.id}.log`),
  };
}

/** Copy the skill prompt from the Copilot app into the repo when the repo has none. */
function syncSkill(id) {
  const dest = path.join(repoRoot, '.agents', 'skills', id);
  if (fs.existsSync(path.join(dest, 'SKILL.md'))) return 'present';
  const src = path.join(copilotTasks, id);
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) return 'MISSING (no copy in repo or ' + src + ')';
  if (flag('--dry-run')) return 'would copy from ' + src;
  fs.cpSync(src, dest, { recursive: true });
  return 'copied from ' + src;
}

async function main() {
  const dir = launchAgentsDir();
  const installedRunner = path.join(installHome, 'Library', 'Application Support', 'opencode-automations', 'run-job.sh');
  if (!flag('--dry-run') && !flag('--uninstall')) {
    fs.mkdirSync(path.dirname(installedRunner), { recursive: true });
    fs.copyFileSync(path.join(here, 'run-job.sh'), installedRunner);
    fs.chmodSync(installedRunner, 0o755);
  }
  for (const job of jobs) {
    const plist = buildPlist(job);
    const file = path.join(dir, `${plist.Label}.plist`);
    if (flag('--uninstall')) {
      if (!flag('--dry-run')) { await lc.bootout(plist.Label); fs.rmSync(file, { force: true }); }
      console.log(`${plist.Label}: removed`);
      continue;
    }
    const skill = syncSkill(job.id);
    if (flag('--dry-run')) { console.log(`${plist.Label}: would write ${file} (skill ${skill})\n${JSON.stringify(plist, null, 2)}`); continue; }
    fs.mkdirSync(logDir(), { recursive: true });
    await writePlist(file, plist);
    let loaded = 'not loaded (--no-load)';
    if (!flag('--no-load')) {
      const r = await lc.reload(file, plist.Label);
      loaded = r.code === 0 ? 'loaded' : `load FAILED: ${(r.stderr || r.stdout).trim()}`;
    }
    console.log(`${plist.Label}: ${file} — skill ${skill}; ${loaded}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
