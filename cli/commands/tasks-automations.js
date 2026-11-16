/**
 * cli/commands/tasks-automations.js (PRO122, PRO123)
 * `ch tasks automations [--project <slug>] [--json]`: every automation and outside service of a project's
 * home.config.json with its state (ok, late, failed, off, unknown), last run, next run and the detail behind
 * it. Read-only: the readers live in cli/lib/automation-status.js; the config is found through the tracker
 * config.json "home" map, like GET /api/home. Without --project the first configured project is used.
 */
import path from 'node:path';
import { parse } from '../lib/args.js';
import { print, jsonOut, die } from '../lib/output.js';
import { dataRoot } from '../lib/io.js';
import { loadProjectHomeConfig } from '../../server/home/project-config.js';
import { readEntryStatus } from '../lib/automation-status.js';
import { healthState, relTime, GROUP_ORDER } from '../../shared/home-config-runs.js';

const pad = (s, n) => String(s).padEnd(n);

/** Rows grouped by `group`, known groups first. */
function grouped(rows) {
  const groups = new Map();
  for (const r of rows) (groups.get(r.group) || groups.set(r.group, []).get(r.group)).push(r);
  const rank = g => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

export function automationLines(automations, services, now = Date.now()) {
  const lines = [];
  const row = (r) => {
    const res = r.result;
    const last = relTime(res.lastRun, now) || '-';
    const next = res.nextRun ? `  next ${relTime(res.nextRun, now)}` : '';
    lines.push(`  ${pad(healthState(res), 8)} ${pad(r.name, 28)} last ${pad(last, 12)}${next}`);
    if (res.detail) lines.push(`           ${res.detail}`);
  };
  if (!automations.length) lines.push('No automations in this project\'s home.config.json (add "automations": [...]; see docs/home-page.md).');
  for (const [group, rows] of grouped(automations)) {
    lines.push(`${group}:`);
    rows.forEach(row);
  }
  lines.push('', 'Services:');
  if (!services.length) lines.push('  none in the config (add "services": [...]).');
  services.forEach(row);
  return lines;
}

export default async function cmdAutomations(argv) {
  const { values } = parse(argv, {
    project: { type: 'string' },
    json: { type: 'boolean', short: 'j' },
  });
  const home = loadProjectHomeConfig(dataRoot(), values.project || null);
  if (home.missing) die(`no home config for ${home.project ? `"${home.project}"` : 'any project'}: add "home": { "<slug>": "/path/to/home.config.json" } to the tracker config.json (docs/home-page.md).`);
  if (!home.config) die(home.errors.join('\n') || 'the home config could not be read');
  const baseDir = path.dirname(home.path);
  const now = Date.now();
  const read = list => Promise.all(list.map(async e => {
    const result = await readEntryStatus(e, { baseDir, now });
    return { ...e, result, state: healthState(result) };
  }));
  const [automations, services] = await Promise.all([read(home.config.automations), read(home.config.services)]);
  if (values.json) { jsonOut({ project: home.project, path: home.path, errors: home.errors, automations, services }); return; }
  print(`${home.config.title || home.project} (${home.path})`);
  for (const e of home.errors) print(`  config problem: ${e}`);
  for (const line of automationLines(automations, services, now)) print(line);
}
