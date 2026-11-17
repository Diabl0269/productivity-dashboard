/**
 * GET /api/home/usage?project=<slug> -> the usage meter (shared/usage-meter.js): this week's cost, the percent
 * of the limit (estimated, or set with `ch metrics usage --set`), the reset time, per-day, per-epic and
 * per-running-session cost and the pace. Session cost is read fresher than the last `ch metrics collect`
 * (cli/lib/usage-live.js, in memory only). Cached 60 s per project; `?fresh=1` skips the cache.
 * PRO127: an older cached answer is served at once (`stale: true`) while a fresh one is read in the background,
 * so the chip never waits on a transcript scan after the first one.
 */
import { SLUG_RE } from './project-config.js';

const TTL_MS = 60e3;
const cache = new Map(); // project -> { at, body, refreshing? }

async function read(project, key) {
  const { usageNow } = await import('../../cli/lib/usage-live.js');
  const body = await usageNow({ project });
  cache.set(key, { at: Date.now(), body });
  return body;
}

export default {
  method: 'GET',
  path: '/api/home/usage',
  async handle({ url }) {
    const project = url.searchParams.get('project') || null;
    if (project !== null && !SLUG_RE.test(project)) {
      return { status: 400, body: { error: `"${project.slice(0, 60)}" is not a project slug (letters, digits, ".", "-", "_").` } };
    }
    const key = project || '';
    const hit = cache.get(key);
    if (hit && !url.searchParams.has('fresh')) {
      const stale = Date.now() - hit.at >= TTL_MS;
      if (stale && !hit.refreshing) hit.refreshing = read(project, key).catch(() => { hit.refreshing = null; });
      return { body: { ...hit.body, cached: true, stale } };
    }
    return { body: { ...(await read(project, key)), cached: false } };
  },
};
