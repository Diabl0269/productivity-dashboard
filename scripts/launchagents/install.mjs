#!/usr/bin/env node
// Installs automation LaunchAgents. Jobs come from the "run" blocks of the automations in home.config.json
// (HOME_CONFIG, default <repo>/home.config.json); a job with no block uses the built-in schedule.
// Env: REPO_ROOT, AUTOMATION_HARNESS, AUTOMATION_CLI, AUTOMATION_MODEL, AUTOMATION_EFFORT.
import fs from 'node:fs';
import path from 'node:path';
import { defaultJobs, installJob, jobFromEntry } from './lib.mjs';

const repoRoot = path.resolve(process.env.REPO_ROOT || process.cwd());
const cli = process.env.AUTOMATION_CLI;
const model = process.env.AUTOMATION_MODEL;
const effort = process.env.AUTOMATION_EFFORT;
const harness = process.env.AUTOMATION_HARNESS;
const configPath = process.env.HOME_CONFIG || path.join(repoRoot, 'home.config.json');

let jobs;
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const entries = config.automations || [];
  const defaults = config.automationDefaults || {};
  jobs = entries.filter(e => e && e.kind === 'launchd').map(e => jobFromEntry(e, defaults.effort || effort, defaults)).filter(Boolean);
  if (!jobs.length) jobs = defaultJobs({ ...defaults, harness: defaults.harness || harness, model: defaults.model || model, cli: defaults.cli || cli, effort: defaults.effort || effort });
  for (const job of jobs) if (!job.harness || !job.cli) throw new Error(`Automation "${job.id}" needs explicit automationDefaults.harness and automationDefaults.cli (or per-job overrides).`);
} catch (error) {
  throw new Error(`Could not read automation configuration at ${configPath}: ${error.message}`);
}

for (const job of jobs) {
  const r = installJob(job, { repoRoot, cli });
  if (r.warning) console.warn(r.warning);
  else console.log(`${job.id}: ${job.enabled === false ? 'disabled' : job.model}`);
}
