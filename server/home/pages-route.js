/**
 * GET /api/home/pages?project=<slug> -> { project, pages: [{ box, name, level, parent, page, state,
 * count, newest, capped, notices }] }, one row per box; state is ok | stale | missing | none.
 * The map uses it to mark boxes; `ch tasks pages` prints the same rows.
 */

import { SLUG_RE } from './project-config.js';
import { loadPagesContext, pageSummary } from './pages-core.js';

export default {
  method: 'GET',
  path: '/api/home/pages',
  async handle({ url, deps }) {
    const slug = url.searchParams.get('project') || null;
    if (slug !== null && !SLUG_RE.test(slug)) return { status: 400, body: { error: 'That is not a project slug.' } };
    const ctx = loadPagesContext(deps.dataRoot, slug);
    return { body: { project: ctx.loaded.project, pages: ctx.loaded.config ? await pageSummary(ctx) : [] } };
  },
};
