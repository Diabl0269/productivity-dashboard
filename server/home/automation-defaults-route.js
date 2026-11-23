import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProjectHomeConfig, SLUG_RE } from './project-config.js';
import { clearStatusCache } from './status-cache.js';
import { validateEdit, effectiveRun } from '../../shared/automation-run.js';

const MAX_BODY = 16 * 1024;
const DEFAULT_FIELDS = ['harness', 'model', 'effort', 'cli', 'runner', 'arguments', 'skill', 'prompt'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const atomicWrite = (file, text) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };

async function install(job, ctx) {
  const lib = await import(pathToFileURL(path.join(ctx.root, 'scripts', 'launchagents', 'lib.mjs')).href);
  return lib.installJob(job, {
    repoRoot: ctx.repoRoot,
    runnerSource: job.runner || path.join(ctx.root, 'scripts', 'launchagents', 'run-job.sh'),
    cli: job.cli,
  });
}

export default {
  method: 'PUT',
  path: '/api/home/automation-defaults',
  async handle({ req, url, deps }) {
    if (!/^application\/json\b/i.test(req.headers?.['content-type'] || '')) throw fail(415, 'Send the defaults as application/json.');
    const slug = url.searchParams.get('project') || null;
    if (slug !== null && !SLUG_RE.test(slug)) throw fail(400, 'That is not a valid project slug.');
    let body;
    try { body = JSON.parse(await deps.readBody(req, MAX_BODY)); } catch (e) { throw fail(e.status || 400, e.status ? e.message : 'The request is not valid JSON.'); }
    const known = Object.fromEntries(DEFAULT_FIELDS.filter(k => body?.[k] !== undefined).map(k => [k, body[k]]));
    const extra = Object.keys(body || {}).filter(k => !DEFAULT_FIELDS.includes(k));
    if (extra.length) throw fail(400, `Unknown fields: ${extra.join(', ')}.`);
    const { patch, errors } = validateEdit(known);
    if (errors.length) throw fail(400, errors.join(' '));
    const home = loadProjectHomeConfig(deps.dataRoot, slug);
    if (home.missing || !home.path || !home.config) throw fail(404, 'This project has no usable Home config.');
    const before = fs.readFileSync(home.path, 'utf8');
    let raw;
    try { raw = JSON.parse(before); } catch { throw fail(409, 'The Home config is not valid JSON.'); }
    raw.automationDefaults = { ...(raw.automationDefaults || {}), ...patch };
    atomicWrite(home.path, `${JSON.stringify(raw, null, 2)}\n`);
    try {
      const warnings = [];
      for (const entry of raw.automations || []) {
        if (entry.kind !== 'launchd') continue;
        const run = effectiveRun(entry, raw.automationDefaults);
        if (!run.schedule || run.enabled === false) continue;
        const r = await (deps.installLaunchAgent || install)({ id: entry.id, schedule: run.schedule, harness: run.harness, model: run.model, effort: run.effort, cli: run.cli, runner: run.runner, arguments: run.arguments, skill: run.skill || entry.id, prompt: run.prompt, enabled: run.enabled }, { root: deps.root, repoRoot: path.dirname(home.path) });
        if (r?.warning) warnings.push(r.warning);
      }
      clearStatusCache();
      return { body: { project: home.project, automationDefaults: raw.automationDefaults, warnings } };
    } catch (e) {
      atomicWrite(home.path, before);
      throw fail(500, `The LaunchAgents could not be updated, so nothing was saved (${e.message}).`);
    }
  },
};
