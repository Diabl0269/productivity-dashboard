/**
 * GET /api/home/page?project=<slug>&box=<id> -> { box, name, page, title, updated, covers, markdown,
 * imageBase, problems, stale: { count, newest, commits, capped, since }|null, notices }.
 * A box with no `page` answers { none: true, expectedPath }; a page whose file is absent answers
 * { missing: { expectedPath } }. The markdown is the page without its front matter.
 */

import { SLUG_RE } from './project-config.js';
import { loadPagesContext, pageInfo } from './pages-core.js';

export default {
  method: 'GET',
  path: '/api/home/page',
  async handle({ url, deps }) {
    const slug = url.searchParams.get('project') || null;
    if (slug !== null && !SLUG_RE.test(slug)) return { status: 400, body: { error: 'That is not a project slug.' } };
    const box = url.searchParams.get('box');
    if (!box) return { status: 400, body: { error: 'A "box" id is needed.' } };
    return { body: await pageInfo(loadPagesContext(deps.dataRoot, slug), box) };
  },
};
