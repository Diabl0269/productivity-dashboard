/**
 * PUT /api/home/automation?project=<slug>  body { id, description?, enabled?, schedule?, model?, skill?, prompt? }
 * -> { project, automation, launchAgent }.
 *
 * Saves the edit into the project's home.config.json (atomic write, every other key kept) and, when a runtime
 * field really changed on a launchd automation, rewrites and reloads its LaunchAgent. If that fails the file
 * is put back as it was. Fields are validated by shared/automation-run.js; nothing reaches a shell.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProjectHomeConfig, SLUG_RE } from './project-config.js';
import { clearStatusCache } from './status-cache.js';
import { ID_RE } from '../../shared/home-config-check.js';
import { validateEdit, effectiveRun, describeSchedule, RUNTIME_FIELDS } from '../../shared/automation-run.js';

const MAX_BODY = 32 * 1024;

function fail(status, message) { return Object.assign(new Error(message), { status }); }

async function defaultInstall(job, ctx) {
  const lib = await import(pathToFileURL(path.join(ctx.root, 'scripts', 'launchagents', 'lib.mjs')).href);
  return lib.installJob(job, {
    repoRoot: ctx.repoRoot,
    runnerSource: job.runner || path.join(ctx.root, 'scripts', 'launchagents', 'run-job.sh'),
    cli: job.cli || process.env.AUTOMATION_CLI,
    effort: job.effort || process.env.AUTOMATION_EFFORT || 'medium',
  });
}

function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export default {
  method: 'PUT',
  path: '/api/home/automation',
  async handle({ req, url, deps }) {
    if (!/^application\/json\b/i.test(req.headers?.['content-type'] || '')) throw fail(415, 'Send the edit as application/json.');
    const slug = url.searchParams.get('project') || null;
    if (slug !== null && !SLUG_RE.test(slug)) throw fail(400, `"${slug.slice(0, 60)}" is not a project slug (letters, digits, ".", "-", "_").`);
    let body;
    try { body = JSON.parse(await deps.readBody(req, MAX_BODY)); } catch (e) {
      throw fail(e.status || 400, e.status ? e.message : 'The request is not valid JSON.');
    }
    if (typeof body?.id !== 'string' || !ID_RE.test(body.id)) throw fail(400, '"id" should be the automation id.');
    const { patch, errors } = validateEdit(body);
    if (errors.length) throw fail(400, errors.join(' '));

    const home = loadProjectHomeConfig(deps.dataRoot, slug);
    if (home.missing) throw fail(404, 'This project has no Home config to edit.');
    if (!home.path || !home.config) throw fail(409, home.errors[0] || 'The home config could not be read.');
    const before = fs.readFileSync(home.path, 'utf8');
    let raw;
    try { raw = JSON.parse(before); } catch { throw fail(409, 'The home config is not valid JSON; fix it by hand first.'); }
    const list = Array.isArray(raw.automations) ? raw.automations : null;
    const idx = list ? list.findIndex(a => a && a.id === body.id) : -1;
    if (idx < 0) throw fail(404, `No automation "${body.id}" in this project's home config.`);
    const entry = list[idx];
    const runtime = RUNTIME_FIELDS.filter(k => patch[k] !== undefined);
    if (runtime.length && entry.kind !== 'launchd') throw fail(400, 'Only scheduled (launchd) automations have a schedule, model, skill, prompt or enabled switch.');

    const oldRun = effectiveRun(entry, raw.automationDefaults || {});
    const run = { ...(entry.run && typeof entry.run === 'object' ? entry.run : {}) };
    for (const k of runtime) { if (patch[k] === null) delete run[k]; else run[k] = patch[k]; }
    const next = { ...entry };
    if (runtime.length) next.run = run;
    if (patch.description !== undefined) next.what = patch.description;
    if (patch.schedule) next.trigger = describeSchedule(patch.schedule);
    list[idx] = next;
    const newRun = effectiveRun(next, raw.automationDefaults || {});
    const runtimeChanged = entry.kind === 'launchd' && JSON.stringify(oldRun) !== JSON.stringify(newRun);

    const noChange = JSON.stringify(entry) === JSON.stringify(next);
    if (!noChange) atomicWrite(home.path, `${JSON.stringify(raw, null, 2)}\n`);

    let launchAgent = { changed: false };
    if (runtimeChanged) {
      const install = deps.installLaunchAgent || (process.platform === 'darwin' ? defaultInstall : null);
      if (!install) {
        launchAgent = { changed: true, skipped: 'LaunchAgents are only installed on macOS.' };
      } else {
        const job = { id: next.id, schedule: newRun.schedule, harness: newRun.harness, model: newRun.model, effort: newRun.effort, cli: newRun.cli, runner: newRun.runner, arguments: newRun.arguments, skill: newRun.skill || next.id, prompt: newRun.prompt, enabled: newRun.enabled };
        if (!job.schedule) {
          atomicWrite(home.path, before);
          throw fail(400, 'This automation has no schedule yet; set one before changing its model, prompt or enabled switch.');
        }
        try {
          const r = await install(job, { root: deps.root, repoRoot: path.dirname(home.path) });
          launchAgent = { changed: true, loaded: r?.loaded ?? null, ...(r?.warning ? { warning: r.warning } : {}) };
        } catch (e) {
          atomicWrite(home.path, before);
          throw fail(500, `The LaunchAgent could not be updated, so nothing was saved (${e.message}).`);
        }
      }
    }
    clearStatusCache();
    const after = loadProjectHomeConfig(deps.dataRoot, slug);
    const automation = (after.config?.automations || []).find(a => a.id === body.id) || null;
    return { body: { project: home.project, automation, launchAgent } };
  },
};
