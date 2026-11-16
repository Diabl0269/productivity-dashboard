/**
 * GET /api/home/automations?project=<slug> -> { project, path, missing, errors, automations: [{ ...entry,
 * result }], at }. Each automation of the project's home.config.json with its status (server/home/status-cache.js:
 * readers in parallel, 60 s cache, a slow one answers { checking: true }).
 */

import { statusRoute } from './status-cache.js';

export default {
  method: 'GET',
  path: '/api/home/automations',
  handle: (req) => statusRoute('automations', req),
};
