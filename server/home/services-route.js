/**
 * GET /api/home/services?project=<slug> -> { project, path, missing, errors, services: [{ ...entry, result }],
 * at }. Each outside service of the project's home.config.json with its status (gh-workflow, http, json-file
 * or none; server/home/status-cache.js). The tracker never reads a token for this.
 */

import { statusRoute } from './status-cache.js';

export default {
  method: 'GET',
  path: '/api/home/services',
  handle: (req) => statusRoute('services', req),
};
