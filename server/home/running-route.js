/**
 * GET /api/home/running?project=<slug> -> { project, at, running[], loose[], epics{}, byTicket{}, warnings[] }.
 *
 * The project's home config -> its repos (server/home/repos.js) -> the live-work readers
 * (cli/lib/running-inputs.js) -> computeRunning (shared/running.js) over the tracker's tasks doc.
 * One answer per project is shared for 15 s. It never fails on a reader: a reader that throws leaves its
 * part out and adds a plain-words line to `warnings`. A bad slug is a 400.
 */

import { loadProjectHomeConfig, SLUG_RE } from './project-config.js';
import { resolveRepos } from './repos.js';
import { computeRunning } from '../../shared/running.js';
import { readTasksDoc } from '../../shared/tasks-files.js';
import { normalizeTasksDoc } from '../../cli/lib/schema.js';
import {
  collectRunningInputs, readLiveSessions, readBranches, readAutorunTick, readPrs,
} from '../../cli/lib/running-inputs.js';

export const CACHE_MS = 15000;
const cache = new Map(); // `${dataRoot}\0${slug}` -> { at, promise }

/** Forget every cached answer (tests). */
export function clearRunningCache() { cache.clear(); }

/** Each reader on its own, so one failing reader costs only its part. */
async function partialInputs(repos, now, warnings) {
  const guard = async (label, fn, fallback) => {
    try { return await fn(); } catch (e) { warnings.push(`${label} could not be read (${e.message}).`); return fallback; }
  };
  const branches = await guard('Branches and worktrees', () => readBranches({ repos: repos.map(r => r.path), now }), []);
  return {
    sessions: await guard('Live sessions', () => readLiveSessions({ now }), []),
    branches,
    autorun: await guard('The automatic run state', () => readAutorunTick({ now }), null),
    prs: await guard('Pull requests', () => readPrs(branches), {}),
    now,
  };
}

const EMPTY = { running: [], loose: [], epics: {}, byTicket: {} };

/** `collect` is the reader bundle (collectRunningInputs); tests pass one that throws. */
export async function buildRunning(dataRoot, slug, now = Date.now(), collect = collectRunningInputs) {
  const warnings = [];
  const home = loadProjectHomeConfig(dataRoot, slug);
  warnings.push(...home.errors);
  let repos = [];
  if (home.config) {
    repos = resolveRepos(home.config, home.path);
    warnings.push(...repos.warnings);
  }
  let inputs;
  try {
    inputs = await collect({ repos: repos.map(r => r.path), now });
  } catch (e) {
    warnings.push(`Some live-work sources could not be read (${e.message}); showing what could be.`);
    inputs = await partialInputs(repos, now, warnings);
  }
  let result = EMPTY;
  try {
    const doc = normalizeTasksDoc(readTasksDoc(dataRoot));
    result = computeRunning(doc, inputs, home.project ? { project: home.project } : {});
  } catch (e) {
    warnings.push(`The tracker's tasks could not be read (${e.message}).`);
  }
  return { project: home.project, at: new Date(now).toISOString(), ...result, warnings };
}

export default {
  method: 'GET',
  path: '/api/home/running',
  async handle({ url, deps }) {
    const slug = url.searchParams.get('project') || null;
    if (slug !== null && !SLUG_RE.test(slug)) {
      return { status: 400, body: { error: `"${slug.slice(0, 60)}" is not a project slug (letters, digits, ".", "-", "_").` } };
    }
    const key = `${deps.dataRoot}\0${slug || ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { body: await hit.promise };
    const promise = buildRunning(deps.dataRoot, slug).catch(e => ({
      project: slug, at: new Date().toISOString(), ...EMPTY, warnings: [`Running work could not be worked out (${e.message}).`],
    }));
    cache.set(key, { at: Date.now(), promise });
    return { body: await promise };
  },
};
