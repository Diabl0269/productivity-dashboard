// home-pages.js — the inspector's "How it works" tab: the selected place's handbook page (text,
// tables, diagrams), a line when the code it covers changed after the page was last updated, "Open
// wide" for a centred reading overlay, and a click on a diagram opens it large. Replaces the
// placeholder with the same tab id. Data and caching: home-pages-data.js; format: docs/home-page.md.

import { registerInspectorTab } from './home-state.js';
import { renderMarkdown } from './home-markdown.js';
import { openReader, openDiagram } from './home-pages-overlay.js';
import { allBoxes, nearestPage, PROJECT_BOX } from '../../shared/home-pages-config.js';
import { boxOfWhere } from '../../shared/home-config.js';
import { cachedPage, loadPage, loadPageSummary, imageUrl, pagePathOf, pageStateFor, onPagesChange } from './home-pages-data.js';

const FRESH_MS = 60 * 1000;
const fetchedAt = new Map(); // box -> when this tab last asked the server

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Nov" (with the year when it is not this year). */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const label = `${+m[3]} ${MONTHS[+m[2] - 1]}`;
  return +m[1] === new Date().getFullYear() ? label : `${label} ${m[1]}`;
}

const BOOK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h13"/></svg>';

/** A small book mark for a page state (ok, stale, missing); '' nodes for none. */
export function bookMark(state) {
  if (state === 'none') return null;
  const m = el('span', `hp-mark hp-mark-${state}`);
  m.innerHTML = BOOK; // a fixed icon, never page text
  m.title = state === 'stale' ? 'Has a page; it may be out of date' : state === 'missing' ? 'A page is set but its file is missing' : 'Has a page';
  return m;
}

function pageBoxFor(config, path) {
  const norm = p => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const hit = allBoxes(config).find(b => b.page && norm(b.page) === path);
  return hit?.id || (config.page && norm(config.page) === path ? PROJECT_BOX : null);
}

function renderPage(root, page, ctx, { wide = false, close = null } = {}) {
  const config = ctx.config();
  const frag = renderMarkdown(page.markdown || '', {
    headingOffset: wide ? 1 : 2,
    imageUrl: (src) => imageUrl(page.imageBase, src),
    pageFor: (href) => {
      const path = pagePathOf(page.imageBase, href);
      const box = path && pageBoxFor(config, path);
      return box && box !== PROJECT_BOX ? box : null;
    },
    onPage: (box) => { close?.(); ctx.setSelection(box); },
    onImage: (img, alt) => openDiagram({ src: img.src, alt, trigger: img.closest('button') || img }),
  });
  root.appendChild(frag);
}

function staleBlock(page) {
  const s = page.stale;
  const wrap = el('details', 'hp-stale');
  const sum = el('summary', 'hp-stale-sum');
  const n = `${s.count}${s.capped ? '+' : ''}`;
  sum.append(el('span', 'hp-stale-dot'), el('span', 'hp-stale-text', `may be out of date: ${n} commit${s.count === 1 ? '' : 's'} since ${shortDate(page.updated)}`));
  wrap.appendChild(sum);
  const list = el('ul', 'hp-commits');
  for (const c of s.commits) {
    const li = el('li', 'hp-commit');
    li.append(el('code', 'hp-commit-hash', c.hash), el('span', 'hp-commit-date', shortDate(c.date)), el('span', 'hp-commit-repo', c.repo), el('span', 'hp-commit-subject', c.subject));
    list.appendChild(li);
  }
  wrap.appendChild(list);
  if (s.capped) wrap.appendChild(el('p', 'hp-note', `Showing the newest ${s.commits.length}.`));
  return wrap;
}

function emptyBlock(name, page) {
  const box = el('div', 'hp-empty');
  box.appendChild(el('h3', 'hm-insp-title', 'No page yet'));
  const file = page?.expectedPath || page?.missing?.expectedPath;
  const p = el('p', 'hm-muted');
  p.append(page?.missing ? `The page for ${name} is set, but ` : `Nothing explains ${name} yet. Create `);
  p.appendChild(el('code', '', file || 'pages/<id>.md'));
  p.append(page?.missing ? ' does not exist. Create it' : '');
  p.append(' (next to the project\'s home.config.json), then');
  p.append(page?.missing ? ' it shows here.' : ' set it as this box\'s "page".');
  box.appendChild(p);
  const t = el('p', 'hm-muted');
  if (page?.template) { t.append('Start from '); t.appendChild(el('code', '', page.template)); t.append('.'); }
  else t.append('The page format is in docs/home-page.md.');
  box.appendChild(t);
  return box;
}

/** Child boxes (areas of a group, parts of an area) as small buttons with their book mark. */
function insideNav(config, boxId, ctx) {
  const box = boxId ? boxOfWhere(config, ctx.selection()) : null;
  const kids = box ? box.areas || box.parts || [] : config.groups;
  if (!kids.length) return null;
  const nav = el('nav', 'hp-inside');
  nav.setAttribute('aria-label', box ? `Inside ${box.name}` : 'Groups');
  nav.appendChild(el('h4', 'hm-insp-sub', box ? (box.areas ? 'Areas' : 'Parts') : 'Groups'));
  const row = el('div', 'hp-chips');
  for (const k of kids) {
    const b = el('button', 'hp-chip');
    b.type = 'button';
    b.dataset.hmKey = `place-${k.id}`;
    const state = pageStateFor(k.id);
    b.appendChild(el('span', 'hp-chip-name', k.name));
    const mark = bookMark(state);
    if (mark) b.appendChild(mark);
    b.setAttribute('aria-label', `${k.name}${state === 'none' ? '' : state === 'stale' ? ', has a page that may be out of date' : state === 'missing' ? ', page file missing' : ', has a page'}`);
    b.addEventListener('click', () => ctx.setSelection(k.id));
    row.appendChild(b);
  }
  nav.appendChild(row);
  return nav;
}

/** A quiet fold "About this box": what, lanes, projects, covers, matches and the way back up. */
function aboutBlock(config, box, ctx) {
  const w = ctx.selection();
  const d = el('details', 'hp-about');
  d.appendChild(el('summary', 'hp-about-sum', 'About this box'));
  if (box.what) d.appendChild(el('p', 'hm-muted', box.what));
  const dl = el('dl', 'hm-details');
  for (const [term, v] of [['Lanes', box.lanes], ['Projects', box.projects], ['Covers', box.covers], ['Matches', box.match], ['Page', box.page]]) {
    if (!v || (Array.isArray(v) && !v.length)) continue;
    dl.append(el('dt', '', term), el('dd', '', Array.isArray(v) ? v.join(', ') : v));
  }
  if (dl.children.length) d.appendChild(dl);
  const up = w.part ? { group: w.group, area: w.area } : w.area ? { group: w.group } : null;
  const upBox = up && boxOfWhere(config, up);
  const nav = el('div', 'hm-place-nav');
  if (upBox) {
    const b = el('button', 'hm-place hm-place-up', `\u2191 ${upBox.name}`);
    b.type = 'button';
    b.dataset.hmKey = `place-${upBox.id}`;
    b.addEventListener('click', () => ctx.setSelection(upBox.id));
    nav.appendChild(b);
  }
  const all = el('button', 'hm-place hm-place-up', 'All places');
  all.type = 'button';
  all.dataset.hmKey = 'place-all';
  all.addEventListener('click', () => ctx.clearSelection());
  nav.appendChild(all);
  d.appendChild(nav);
  return d;
}

function renderHow(root, ctx) {
  const config = ctx.config();
  root.classList.add('hp-panel');
  if (!config) {
    root.appendChild(el('p', 'hm-muted', ctx.home() ? 'This project has no map yet.' : 'Loading the map...'));
    return;
  }
  loadPageSummary(); // fills the book marks; onPagesChange redraws once
  const w = ctx.selection();
  const boxId = w.part || w.area || w.group || null;
  const box = boxId ? boxOfWhere(config, w) : null;
  const target = nearestPage(config, boxId || PROJECT_BOX);

  const head = el('h3', 'hm-insp-title', box ? box.name : config.title || 'Everything');
  if (!target) {
    root.appendChild(head);
    if (box) {
      const cached = cachedPage(box.id);
      if (!cached) loadPage(box.id).then(() => ctx.redraw());
      root.appendChild(emptyBlock(box.name, cached));
    } else root.appendChild(el('p', 'hm-muted', 'Pick a place to read how it works.'));
    const nav = insideNav(config, boxId, ctx);
    if (nav) root.appendChild(nav);
    if (box) root.appendChild(aboutBlock(config, box, ctx));
    return;
  }

  const page = cachedPage(target.box);
  const age = Date.now() - (fetchedAt.get(`${ctx.project()}\n${target.box}`) || 0);
  if (!page || age > FRESH_MS) {
    fetchedAt.set(`${ctx.project()}\n${target.box}`, Date.now());
    loadPage(target.box, { force: !!page }).then(next => { if (!page || JSON.stringify(next) !== JSON.stringify(page)) ctx.redraw(); });
  }
  if (!page) {
    root.appendChild(head);
    root.appendChild(el('p', 'hm-muted hp-loading', 'Loading the page...'));
    if (box) root.appendChild(aboutBlock(config, box, ctx));
    return;
  }
  if (page.error) { root.appendChild(head); root.appendChild(el('p', 'hm-muted', `The page could not be loaded: ${page.error}`)); return; }
  if (page.missing) {
    root.appendChild(head);
    root.appendChild(emptyBlock(target.name, page));
    if (box) root.appendChild(aboutBlock(config, box, ctx));
    return;
  }

  root.appendChild(el('h3', 'hm-insp-title', page.title || target.name));
  const meta = el('p', 'hp-meta');
  const when = page.updated ? `updated ${shortDate(page.updated)}` : 'no update date';
  meta.textContent = target.inherited
    ? `No page for ${box.name}: showing ${target.name}'s page (${when}).`
    : `${target.name} · ${when}`;
  root.appendChild(meta);
  if (page.stale) root.appendChild(staleBlock(page));
  const notes = [...(page.problems || []), ...(page.notices || [])];
  if (notes.length) {
    const d = el('details', 'hp-notes');
    d.appendChild(el('summary', 'hp-notes-sum', `${notes.length} note${notes.length === 1 ? '' : 's'} about this page`));
    const ul = el('ul', 'hp-notes-list');
    for (const n of notes) ul.appendChild(el('li', '', n));
    d.appendChild(ul);
    root.appendChild(d);
  }
  const bar = el('div', 'hp-actions');
  const wide = el('button', 'hp-btn', 'Open wide');
  wide.type = 'button';
  wide.dataset.hmKey = 'page-wide';
  wide.title = 'Read the page in a wide view';
  wide.addEventListener('click', () => openReader({
    title: page.title || target.name,
    trigger: wide,
    build: (body, close) => {
      if (page.stale) body.appendChild(staleBlock(page));
      renderPage(body, page, ctx, { wide: true, close });
    },
  }));
  bar.appendChild(wide);
  root.appendChild(bar);
  const doc = el('div', 'hp-doc hp-doc-narrow');
  renderPage(doc, page, ctx);
  root.appendChild(doc);
  const nav = insideNav(config, boxId, ctx);
  if (nav) root.appendChild(nav);
  if (box) root.appendChild(aboutBlock(config, box, ctx));
}

registerInspectorTab({
  id: 'how',
  label: 'How it works',
  render(root, ctx) {
    // Fresh page data redraws this tab in place (only while it is the shown tab).
    root._hpOff?.();
    root._hpOff = onPagesChange(() => { if (root.isConnected && root.getAttribute('aria-label') === 'How it works') ctx.redraw(); });
    renderHow(root, ctx);
  },
});
