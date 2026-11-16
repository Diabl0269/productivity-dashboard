/**
 * cli/commands/tasks-pages.js
 * `ch tasks pages [--project <slug>] [--stale] [--json]`: every box of the project's Home map with
 * its handbook page state: has a page / stale (n commits) / missing (page set, file absent) / no page
 * set. `--stale` keeps only the stale ones. Read-only; the logic is in server/home/pages-core.js.
 */

import { parse } from '../lib/args.js';
import { print, jsonOut, die } from '../lib/output.js';
import { dataRoot } from '../lib/io.js';
import { loadPagesContext, pageSummary, expectedPathFor } from '../../server/home/pages-core.js';

function describe(row) {
  if (row.state === 'ok') return `has a page (${row.page})`;
  if (row.state === 'stale') return `stale (${row.count}${row.capped ? '+' : ''} commit${row.count === 1 ? '' : 's'}, newest ${row.newest}; ${row.page})`;
  if (row.state === 'missing') return `missing (${row.page} does not exist)`;
  return `no page set (add "page": "${expectedPathFor(row.box)}")`;
}

export default async function cmdPages(argv) {
  const { values } = parse(argv, {
    project: { type: 'string', short: 'p' },
    stale: { type: 'boolean' },
    json: { type: 'boolean', short: 'j' },
  });
  const ctx = loadPagesContext(dataRoot(), values.project || null);
  if (!ctx.loaded.project) die('No project has a Home config: add "home": { "<slug>": "<path to home.config.json>" } to the tracker config.json.');
  if (!ctx.loaded.config) die(ctx.loaded.errors[0] || `Project "${ctx.loaded.project}" has no Home config.`);
  let rows = await pageSummary(ctx);
  if (values.stale) rows = rows.filter(r => r.state === 'stale');
  if (values.json) { jsonOut({ project: ctx.loaded.project, pages: rows }); return; }
  if (!rows.length) { print(values.stale ? 'No page is out of date.' : 'This map has no boxes.'); return; }
  const width = Math.max(...rows.map(r => r.box.length));
  for (const r of rows) {
    print(`${r.box.padEnd(width)}  ${r.state === 'none' ? '-' : r.state === 'ok' ? 'ok' : r.state === 'stale' ? 'STALE' : 'MISSING'}  ${describe(r)}`);
  }
}
