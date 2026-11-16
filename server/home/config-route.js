/**
 * GET /api/home?project=<slug> -> { project, projects, path, config, errors[], legacy, missing }.
 * `missing` is true when the tracker config.json has no "home" entry for the project (the page then
 * shows its "Set up this project" card). A bad slug is a 400; everything else is a 200 whose
 * `errors` say in plain words what is wrong, so the page can show them.
 */

import { loadProjectHomeConfig, SLUG_RE } from './project-config.js';

export default {
  method: 'GET',
  path: '/api/home',
  handle({ url, deps }) {
    const slug = url.searchParams.get('project') || null;
    if (slug !== null && !SLUG_RE.test(slug)) {
      return { status: 400, body: { error: `"${slug.slice(0, 60)}" is not a project slug (letters, digits, ".", "-", "_").` } };
    }
    return { body: loadProjectHomeConfig(deps.dataRoot, slug) };
  },
};
