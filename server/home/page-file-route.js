/**
 * GET /api/home/page-file?project=<slug>&path=<relative path> -> an image of a page (svg, png, jpg,
 * webp) from inside the config file's folder. Everything is checked in page-paths.js. An SVG is only
 * ever shown through <img>; the headers below also stop it running script if opened directly.
 */

import fs from 'node:fs';
import { SLUG_RE } from './project-config.js';
import { loadPagesContext } from './pages-core.js';
import { resolveInside, IMAGE_EXTS, IMAGE_TYPES, MAX_IMAGE_BYTES } from './page-paths.js';

export default {
  method: 'GET',
  path: '/api/home/page-file',
  raw: true,
  handle({ url, res, deps }) {
    const send = (status, body) => {
      res.writeHead(status, { ...(deps.corsHeaders || {}), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ error: body }));
    };
    const slug = url.searchParams.get('project') || null;
    if (slug !== null && !SLUG_RE.test(slug)) return send(400, 'That is not a project slug.');
    const ctx = loadPagesContext(deps.dataRoot, slug);
    if (!ctx.configDir) return send(404, 'This project has no home config.');
    const r = resolveInside(ctx.configDir, url.searchParams.get('path'), IMAGE_EXTS, MAX_IMAGE_BYTES);
    if (!r.ok) return send(r.status, r.message);
    let data;
    try { data = fs.readFileSync(r.file); } catch { return send(404, 'That file could not be read.'); }
    res.writeHead(200, {
      ...(deps.corsHeaders || {}),
      'Content-Type': IMAGE_TYPES[r.ext],
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  },
};
