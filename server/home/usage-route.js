/**
 * GET /api/home/usage?project=<slug> -> the usage meter (shared/usage-meter.js): this week's cost, the percent
 * of the limit (estimated, or set with `ch metrics usage --set`), the reset time, per-day, per-epic and
 * per-running-session cost and the pace. Session cost is read fresher than the last `ch metrics collect`
 * (cli/lib/usage-live.js, in memory only). Cached 60 s per project; `?fresh=1` skips the cache.
 */
import { SLUG_RE } from './project-config.js';

const TTL_MS = 60e3;
const cache = new Map(); // project -> { at, body }

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
    if (hit && Date.now() - hit.at < TTL_MS && !url.searchParams.has('fresh')) return { body: { ...hit.body, cached: true } };
    const { usageNow } = await import('../../cli/lib/usage-live.js');
    const body = await usageNow({ project });
    cache.set(key, { at: Date.now(), body });
    return { body: { ...body, cached: false } };
  },
};
