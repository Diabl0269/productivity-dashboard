// home-pages-data.js — what the Home page knows about handbook pages: the per-box summary
// (/api/home/pages) and single pages (/api/home/page), cached so a redraw never refetches and
// nothing jumps. The map can draw a book mark from pageStateFor(boxId).

import { getProject } from './home-state.js';

const SUMMARY_TTL_MS = 5 * 60 * 1000;
const PAGE_TTL_MS = 60 * 1000;

const summaries = new Map(); // project -> { at, rows: Map(boxId -> row), promise }
const pages = new Map(); // `${project}\n${box}` -> { at, value, promise }
const listeners = new Set();

/** Call fn() whenever fresh page data arrives (a redraw can use it). Returns the unsubscribe. */
export function onPagesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed() { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error(e); } } }

const q = (project) => (project ? `project=${encodeURIComponent(project)}&` : '');

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
  return body;
}

/** Fetch (or reuse) the summary rows of the current project; resolves to Map(boxId -> row). */
export function loadPageSummary({ force = false } = {}) {
  const project = getProject();
  const key = project || '';
  const have = summaries.get(key);
  if (have && !force && (have.promise || Date.now() - have.at < SUMMARY_TTL_MS)) return have.promise || Promise.resolve(have.rows);
  const entry = { at: have?.at || 0, rows: have?.rows || new Map(), promise: null };
  entry.promise = getJson(`/api/home/pages?${q(project)}`.replace(/\?$/, ''))
    .then(body => {
      entry.rows = new Map((body.pages || []).map(r => [r.box, r]));
      entry.at = Date.now();
      return entry.rows;
    })
    .catch(() => entry.rows)
    .finally(() => { entry.promise = null; changed(); });
  summaries.set(key, entry);
  return entry.promise;
}

/** 'ok' | 'stale' | 'missing' | 'none' for a box; 'none' until the summary has arrived (then onPagesChange fires). */
export function pageStateFor(boxId) {
  const have = summaries.get(getProject() || '');
  if (!have || (!have.promise && Date.now() - have.at > SUMMARY_TTL_MS)) loadPageSummary();
  return have?.rows.get(boxId)?.state || 'none';
}

/** The summary row of a box ({ state, count, newest, page, ... }) or null. */
export function pageRowFor(boxId) {
  return summaries.get(getProject() || '')?.rows.get(boxId) || null;
}

/** A cached page answer for a box, or null (nothing fetched yet). */
export function cachedPage(boxId) {
  const hit = pages.get(`${getProject() || ''}\n${boxId}`);
  return hit && hit.value && Date.now() - hit.at < PAGE_TTL_MS ? hit.value : null;
}

/** Fetch (or reuse) one box's page: the /api/home/page answer, or { error }. */
export function loadPage(boxId, { force = false } = {}) {
  const project = getProject();
  const key = `${project || ''}\n${boxId}`;
  const hit = pages.get(key);
  if (hit && !force && (hit.promise || (hit.value && Date.now() - hit.at < PAGE_TTL_MS))) return hit.promise || Promise.resolve(hit.value);
  const entry = { at: 0, value: hit?.value || null, promise: null };
  entry.promise = getJson(`/api/home/page?${q(project)}box=${encodeURIComponent(boxId)}`)
    .then(v => { entry.value = v; entry.at = Date.now(); return v; })
    .catch(e => { entry.value = null; return { error: e.message }; })
    .finally(() => { entry.promise = null; changed(); });
  pages.set(key, entry);
  return entry.promise;
}

/** A relative path joined onto the page's folder, "." and ".." folded; null when it is not relative or leaves the root. */
function joinRel(base, rel) {
  if (!rel || /^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith('/')) return null;
  const parts = [];
  for (const seg of `${base === '.' ? '' : base}/${rel.split(/[?#]/)[0]}`.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/');
}

/** The file-route URL of a page image: `src` is relative to the page's folder (`imageBase`). */
export function imageUrl(imageBase, src) {
  const rel = joinRel(imageBase, src);
  return rel ? `/api/home/page-file?${q(getProject())}path=${encodeURIComponent(rel)}` : null;
}

/** A relative link like "other.md" as a config-relative path, or null. */
export function pagePathOf(imageBase, href) {
  return joinRel(imageBase, href) || null;
}

/** Forget everything (tests, project switch). */
export function resetPagesData() { summaries.clear(); pages.clear(); }
