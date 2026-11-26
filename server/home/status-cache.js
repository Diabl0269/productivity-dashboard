/**
 * The status answers behind GET /api/home/automations and /api/home/services (PRO122, PRO123).
 *
 * Every entry's readers (cli/lib/automation-status.js) run in parallel, each on its own, and the answer is
 * cached for 60 s per project and config. A request waits at most `waitMs` (2.5 s): an entry still being
 * read comes back as { checking: true } and fills in for the next request, so one slow reader (a gh call,
 * a far web address) never holds up the page. A refresh keeps the previous answers on show until the new
 * ones arrive, so nothing on the page flickers to "checking" every minute.
 */

import path from 'node:path';
import { loadProjectHomeConfig, SLUG_RE } from './project-config.js';
import { readEntryStatus } from '../../cli/lib/automation-status.js';

export const TTL_MS = 60e3;
export const WAIT_MS = 2500;

const cache = new Map(); // key -> { at, results: Map<id, result>, done: Promise }

export function clearStatusCache() { cache.clear(); }

/**
 * Fresh-enough results of `entries`, reading them when the cache is older than ttlMs.
 * @returns {Promise<Array<{ ...entry, result }>>}
 */
export async function cachedStatus(kind, project, entries, { baseDir, ttlMs = TTL_MS, waitMs = WAIT_MS, readOpts = {} } = {}) {
  const key = `${kind}\0${project}\0${baseDir}\0${JSON.stringify(entries.map(e => [e.id, e.status]))}`;
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.at >= ttlMs) {
    const results = new Map(entry ? entry.results : []);
    const done = Promise.all(entries.map(e => readEntryStatus(e, { baseDir, ...readOpts })
      .catch(err => ({ lastRun: null, ok: null, late: false, detail: `could not be read (${err.message})` }))
      .then(r => { results.set(e.id, { ...r, checkedAt: new Date().toISOString() }); })));
    entry = { at: Date.now(), results, done };
    cache.set(key, entry);
  }
  let timer;
  await Promise.race([entry.done, new Promise(resolve => { timer = setTimeout(resolve, waitMs); })]);
  clearTimeout(timer);
  return entries.map(e => ({ ...e, result: entry.results.get(e.id) || { checking: true, lastRun: null, ok: null, late: false, detail: 'checking…' } }));
}

/** The shared body of both routes: { project, path, missing, errors, [kind]: rows, at }. */
export async function statusRoute(kind, { url, deps }, opts = {}) {
  const slug = url.searchParams.get('project') || null;
  if (slug !== null && !SLUG_RE.test(slug)) {
    return { status: 400, body: { error: `"${slug.slice(0, 60)}" is not a project slug (letters, digits, ".", "-", "_").` } };
  }
  const home = loadProjectHomeConfig(deps.dataRoot, slug);
  const entries = home.config?.[kind] || [];
  const freshOpts = url.searchParams.has('fresh') ? { ttlMs: 0 } : {};
  const rows = entries.length
    ? await cachedStatus(kind, home.project, entries, { baseDir: path.dirname(home.path || deps.dataRoot), ...freshOpts, ...opts })
    : [];
  return {
    body: {
      project: home.project,
      path: home.path,
      missing: home.missing,
      errors: home.errors,
      [kind]: rows,
      at: new Date().toISOString(),
    },
  };
}
