/**
 * Home tab API: every /api/home* route, as a table. serve.js calls handleHomeRoute once for paths
 * under /api/home; a new route is its own file under server/home/ plus one line in `routes` below.
 *
 * A route module default-exports { method, path, handle }:
 *   - path: an exact string ('/api/home/running') or a RegExp tested against url.pathname
 *   - handle({ req, res, url, deps, match }) returns (or resolves to) { status?, body } and the
 *     table writes it as JSON (no-store). Throw an Error with .status for a plain-words error reply.
 *     Set `raw: true` on the route to write the response yourself through `res` instead.
 * deps (from serve.js): { dataRoot, root, corsHeaders, readBody }.
 */

import configRoute from './home/config-route.js';
import runningRoute from './home/running-route.js';
import usageRoute from './home/usage-route.js';
import pageRoutes from './home/page-routes.js';
import automationsRoute from './home/automations-route.js';
import servicesRoute from './home/services-route.js';
import automationEditRoute from './home/automation-edit-route.js';
import automationDefaultsRoute from './home/automation-defaults-route.js';

const routes = [
  configRoute, // GET /api/home?project=<slug> -> the project's home.config.json, validated
  runningRoute, // GET /api/home/running?project=<slug> -> running work (PRO117)
  usageRoute, // GET /api/home/usage?project=<slug> -> this week's usage meter
  ...pageRoutes, // GET /api/home/page, /api/home/pages, /api/home/page-file: handbook pages (PRO126)
  automationsRoute, // GET /api/home/automations?project=<slug> -> each automation with its last run (60 s cache)
  automationEditRoute, // PUT /api/home/automation?project=<slug> -> edit one automation, reinstall its LaunchAgent when needed
  automationDefaultsRoute, // PUT /api/home/automation-defaults?project=<slug> -> project-wide model/effort/runner defaults
  servicesRoute, // GET /api/home/services?project=<slug> -> each outside service with its status (60 s cache)
];

function sendJson(res, deps, status, body) {
  res.writeHead(status, { ...(deps.corsHeaders || {}), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function matchPath(route, pathname) {
  if (typeof route.path === 'string') return route.path === pathname ? [pathname] : null;
  return route.path.exec(pathname);
}

/**
 * Answer a /api/home* request from the route table.
 * @returns {boolean} true when a route (or a 405 for a known path) answered; false to let serve.js go on
 */
export function handleHomeRoute(req, res, url, deps) {
  let pathKnown = false;
  for (const route of routes) {
    const match = matchPath(route, url.pathname);
    if (!match) continue;
    pathKnown = true;
    if (route.method !== req.method) continue;
    Promise.resolve()
      .then(() => route.handle({ req, res, url, deps, match }))
      .then(out => { if (!route.raw) sendJson(res, deps, out?.status || 200, out?.body ?? {}); })
      .catch(e => {
        if (res.headersSent) { res.end(); return; }
        sendJson(res, deps, e.status || 500, { error: e.message });
      });
    return true;
  }
  if (pathKnown) {
    sendJson(res, deps, 405, { error: `${req.method} is not allowed on ${url.pathname}` });
    return true;
  }
  return false;
}

/** The route table, read-only (tests and docs list it). */
export function homeRoutes() {
  return routes.map(r => ({ method: r.method, path: String(r.path) }));
}
