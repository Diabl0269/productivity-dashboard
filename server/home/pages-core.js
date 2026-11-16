/**
 * Handbook pages of one project: find the config, read a box's page, work out its staleness.
 * Used by the page routes and by `ch tasks pages`. Nothing here writes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadProjectHomeConfig } from './project-config.js';
import { resolveRepos } from './repos.js';
import { resolveInside, PAGE_EXTS, MAX_PAGE_BYTES } from './page-paths.js';
import { parsePageFile } from '../../shared/home-page-front.js';
import { allBoxes, PROJECT_BOX } from '../../shared/home-pages-config.js';
import { pageStaleness } from '../../cli/lib/page-staleness.js';

/** The page template, when the project keeps one next to its pages. */
export const TEMPLATE_PATH = 'pages/_template.md';

/** The suggested file for a box that has no page yet. */
export function expectedPathFor(boxId) {
  return `pages/${boxId}.md`;
}

/**
 * Load a project's config plus what the page code needs.
 * @returns {{ loaded: object, configPath: string|null, configDir: string|null, repos: {name,path}[] }}
 */
export function loadPagesContext(dataRoot, slug) {
  const loaded = loadProjectHomeConfig(dataRoot, slug);
  const out = { loaded, configPath: loaded.path, configDir: loaded.path ? path.dirname(loaded.path) : null, repos: [] };
  if (loaded.config && loaded.path) {
    out.repos = resolveRepos(loaded.config, loaded.path);
  }
  return out;
}

function boxOf(ctx, boxId) {
  if (boxId === PROJECT_BOX && ctx.loaded.config.page) return { id: PROJECT_BOX, name: ctx.loaded.config.title || 'This project', level: 'project', parent: null, page: ctx.loaded.config.page, covers: [] };
  return allBoxes(ctx.loaded.config).find(b => b.id === boxId) || null;
}

/** Read and parse one box's page file (no git). */
function readPageFile(ctx, box) {
  const r = resolveInside(ctx.configDir, box.page, PAGE_EXTS, MAX_PAGE_BYTES);
  if (!r.ok) return r;
  try {
    return { ok: true, front: parsePageFile(fs.readFileSync(r.file, 'utf8')) };
  } catch (e) {
    return { ok: false, status: 403, reason: 'denied', message: `${box.page} could not be read (${e.message}).` };
  }
}

function staleOf(ctx, front, box, key) {
  const covers = front.covers.length ? front.covers : box.covers;
  return pageStaleness({ updated: front.updated, covers, repos: ctx.repos, key });
}

/** Everything the panel needs for one box's page. Throws { status } errors for bad requests. */
export async function pageInfo(ctx, boxId) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  if (!ctx.loaded.config) throw fail(404, 'This project has no usable home config.');
  const box = boxOf(ctx, boxId);
  if (!box) throw fail(404, `"${String(boxId).slice(0, 60)}" is not a group, area or part of this map.`);
  if (!box.page) {
    const t = resolveInside(ctx.configDir, TEMPLATE_PATH, PAGE_EXTS, MAX_PAGE_BYTES);
    return { box: box.id, name: box.name, page: null, none: true, expectedPath: expectedPathFor(box.id), template: t.ok ? TEMPLATE_PATH : null };
  }
  const base = { box: box.id, name: box.name, page: box.page };
  const r = readPageFile(ctx, box);
  if (!r.ok) {
    if (r.reason === 'missing') return { ...base, missing: { expectedPath: box.page } };
    throw fail(r.status, r.message);
  }
  const f = r.front;
  const stale = await staleOf(ctx, f, box, `${ctx.configPath}#${box.id}`);
  return {
    ...base,
    title: f.title || box.name,
    updated: f.updated,
    covers: f.covers.length ? f.covers : box.covers,
    markdown: f.body,
    imageBase: path.posix.dirname(box.page.replace(/\\/g, '/')),
    problems: f.problems,
    stale: stale.count > 0 ? stale : null,
    notices: stale.notices,
  };
}

/** One row per box: state 'ok' | 'stale' | 'missing' | 'none' (no page set), with its numbers. */
export async function pageSummary(ctx) {
  const rows = [];
  const boxes = allBoxes(ctx.loaded.config);
  if (ctx.loaded.config.page) boxes.unshift(boxOf(ctx, PROJECT_BOX));
  for (const box of boxes) {
    const row = { box: box.id, name: box.name, level: box.level, parent: box.parent, page: box.page, state: 'none', count: 0, newest: null, capped: false, notices: [] };
    if (box.page) {
      const r = readPageFile(ctx, box);
      if (!r.ok) {
        row.state = 'missing'; // absent or not allowed: either way there is no page to show
        row.notices.push(r.message);
      } else {
        const stale = await staleOf(ctx, r.front, box, `${ctx.configPath}#${box.id}`);
        Object.assign(row, { state: stale.count > 0 ? 'stale' : 'ok', count: stale.count, newest: stale.newest, capped: stale.capped, notices: [...r.front.problems, ...stale.notices] });
      }
    }
    rows.push(row);
  }
  return rows;
}
