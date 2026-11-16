/**
 * Handbook pages in a Home config (pure, no fs, no DOM). A box (group, area or part) may carry
 * `page` (a path relative to the config file) and `covers[]`; a top-level `pages` map
 * { "<box id>": "<path>" } gives a page to a box without restructuring the file (a `page` on the box wins).
 * Rules and the page format: docs/home-page.md.
 */

import { isPlainObject, shown } from './home-config-check.js';

/** The box id of the project's own top-level `page` (not a real box: ids cannot start with "_"). */
export const PROJECT_BOX = '_project';

/** Every box of a config, depth first: [{ id, name, level, parent, page, covers }]. */
export function allBoxes(config) {
  const out = [];
  for (const g of config?.groups || []) {
    out.push({ id: g.id, name: g.name, level: 'group', parent: null, page: g.page || null, covers: g.covers || [] });
    for (const a of g.areas || []) {
      out.push({ id: a.id, name: a.name, level: 'area', parent: g.id, page: a.page || null, covers: a.covers || [] });
      for (const p of a.parts || []) {
        out.push({ id: p.id, name: p.name, level: 'part', parent: a.id, page: p.page || null, covers: p.covers || [] });
      }
    }
  }
  return out;
}

/** Why a page path is not usable, or null. Only relative .md paths inside the config's folder. */
export function pagePathProblem(p) {
  if (typeof p !== 'string' || !p.trim()) return 'should be the path of a .md file';
  if (p.includes('\0')) return 'is not a usable path';
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return 'should be a path relative to the config file, not a link';
  if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) return 'should be relative to the config file, not absolute';
  if (p.split(/[\\/]/).includes('..')) return 'must stay inside the config file\'s folder (no "..")';
  if (!/\.md$/i.test(p)) return 'should end in .md';
  return null;
}

/**
 * Fold the top-level `pages` map into the boxes and check every `page`; problems go on `errors`.
 * A bad page path is dropped (the box then has no page).
 */
export function applyPages(config, raw, errors) { // sets config.page only when the file has a valid top-level page
  const boxes = new Map();
  for (const g of config.groups) {
    boxes.set(g.id, g);
    for (const a of g.areas) { boxes.set(a.id, a); for (const p of a.parts) boxes.set(p.id, p); }
  }
  if (raw?.page !== undefined && raw.page !== null) {
    const bad = typeof raw.page === 'string' ? pagePathProblem(raw.page) : 'should be the path of a .md file';
    if (bad) errors.push(`the file: "page" ${bad}, got ${shown(raw.page)}; ignored.`); else config.page = raw.page;
  }
  const pages = raw?.pages;
  if (pages !== undefined && pages !== null) {
    if (!isPlainObject(pages)) {
      errors.push(`the file: "pages" should be an object of box id -> page path, got ${shown(pages)}.`);
    } else {
      for (const [id, p] of Object.entries(pages)) {
        if (id.startsWith('$')) continue;
        const box = boxes.get(id);
        if (!box) { errors.push(`pages: "${id}" is not a group, area or part id; ignored.`); continue; }
        if (typeof p !== 'string') errors.push(`pages > "${id}": should be the path of a .md file, got ${shown(p)}.`);
        else if (!box.page) box.page = p;
      }
    }
  }
  for (const [id, box] of boxes) {
    if (!box.page) continue;
    const bad = pagePathProblem(box.page);
    if (bad) { errors.push(`"${id}": "page" ${bad}, got ${shown(box.page)}; ignored.`); box.page = null; }
  }
}

/** The box's own page, else its nearest ancestor's: { box, name, page, inherited } or null. */
export function nearestPage(config, boxId) {
  if (boxId === PROJECT_BOX) return config?.page ? { box: PROJECT_BOX, name: config.title || 'This project', page: config.page, inherited: false } : null;
  const byId = new Map(allBoxes(config).map(b => [b.id, b]));
  for (let b = byId.get(boxId); b; b = b.parent ? byId.get(b.parent) : null) {
    if (b.page) return { box: b.id, name: b.name, page: b.page, inherited: b.id !== boxId };
  }
  return null;
}
