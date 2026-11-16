// home-lanes.js — Home's Lanes view (PRO118): everything the Plan tab does, in Home's centre zone, narrowed
// to the selected place. Same pipeline (toDoc -> computeRunPlan, in run-plan-page.js preparePlan) and the
// same renderers as the Plan tab (run-plan-review / -notes-bar / -lanes), with this view's own ctx, so
// open cards, folds and pending focus never leak between the two pages. Also the strip's "For you" item.
//
// The place filter comes from ONE function, placeScope(): `?hmEpics=ID1,ID2` in the address forces a
// set (a link or test hook; kept for the session until Clear, even when a tab switch drops it from the
// address); else ./home-where.js selectedEpicIds(ctx), the selected place; else none.

import { registerHomeView, registerStripItem, setView } from './home-state.js';
import { boxOfWhere } from '../../shared/home-config.js';
import { computeRunPlan } from '../../shared/run-plan.js';
import { scopePlan, scopeForYou, scopeLine, scopeTest, scopeNotes, epicsFromSearch } from '../../shared/plan-scope.js';
import { selectedEpicIds } from './home-where.js';
import { asksFromState } from './asks-strip.js';
import { interpretationsFromState } from './interpretation-card.js';
import { fillEpicEstimates } from './ticket-cost-ui.js';
import { renderNextStartLine } from './next-start-line.js';
import { createPlanCtx, preparePlan, renderPlanAutoQueue, renderPlanReady, restoreAutoFocus } from './run-plan-page.js';
import { renderReview } from './run-plan-review.js';
import { renderRules, renderLegend, renderTotals, renderTracks, renderDoneNote } from './run-plan-lanes.js';
import { installHover, hidePreview } from './run-plan-hover.js';
import { el, makeToast } from './run-plan-util.js';

const SECTIONS = [['foryou', 'For you'], ['ready', 'Ready'], ['auto', 'Auto queue'], ['lanes', 'Lanes']];
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ===== the place filter (the one place the selection module is read) =====

let forcedIds = null; // the last ?hmEpics= set, until Clear

/** "Kitchen › Oven" style name of the selected place, or ''. */
function placeName(ctx) {
  const config = ctx.config?.();
  const box = config && boxOfWhere(config, ctx.selection?.() || {});
  return box?.name || '';
}

/** The epics to show: { set: Set<string>, place, forced } or null for everything. */
function placeScope(ctx) {
  forcedIds = epicsFromSearch(window.location.search) || forcedIds;
  if (forcedIds) return { set: forcedIds, place: 'the linked epics', forced: true };
  const set = selectedEpicIds(ctx) || null;
  return set ? { set, place: placeName(ctx) || 'the selected place', forced: false } : null;
}

/** Drop ?hmEpics= from the address (keeps the rest) and draw again. */
function clearForced(redraw) {
  const url = new URL(window.location.href);
  forcedIds = null;
  url.searchParams.delete('hmEpics');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  redraw();
}

// ===== the view =====

let mounted = null; // { root, ctx, page, cleanup: [] } of the mounted Lanes view
let pendingSection = null; // a section to scroll to after the next draw (from the strip)
let lastNextStart = '';

/** A section of the view; the nav scrolls to it and focuses it (each block inside keeps the Plan tab's own heading). */
function section(id, label) {
  const sec = el('div', 'hl-sec');
  sec.dataset.hlSec = id;
  sec.tabIndex = -1;
  sec.setAttribute('role', 'region');
  sec.setAttribute('aria-label', label);
  return sec;
}

function scrollToSection(root, id, { focus = true } = {}) {
  const sec = root.querySelector(`[data-hl-sec="${id}"]`);
  if (!sec) return;
  sec.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (focus) sec.focus({ preventScroll: true });
  markNav(root, id);
}

function markNav(root, id) {
  root.querySelectorAll('.hl-nav-btn').forEach(b => b.setAttribute('aria-current', b.dataset.sec === id ? 'true' : 'false'));
}

/** Sticky section nav: one Tab stop, arrows move between buttons, Enter/click scrolls to the section. */
function renderNav(root, counts) {
  const nav = el('nav', 'hl-nav');
  nav.setAttribute('aria-label', 'Sections of the Lanes view');
  const buttons = SECTIONS.map(([id, label], i) => {
    const b = el('button', 'hl-nav-btn');
    b.type = 'button';
    b.dataset.sec = id;
    b.dataset.hmKey = `hl-nav-${id}`;
    b.tabIndex = i === 0 ? 0 : -1;
    b.setAttribute('aria-current', 'false');
    b.append(el('span', null, label), el('span', 'hl-nav-count', String(counts[id] ?? 0)));
    b.addEventListener('click', () => scrollToSection(root, id));
    nav.appendChild(b);
    return b;
  });
  nav.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    buttons.forEach((b, j) => { b.tabIndex = j === next ? 0 : -1; });
    buttons[next].focus();
  });
  return nav;
}

/** "Showing Mixer: 4 of 61 epics. Clear" (only while a filter is on). */
function renderScopeLine(ctx, scope, shown, total) {
  const p = el('p', 'hl-scope');
  p.setAttribute('role', 'status');
  p.appendChild(document.createTextNode(`${scopeLine({ place: scope.place, shown, total })} `));
  const clear = el('button', 'rp-btn hl-scope-clear', 'Clear');
  clear.type = 'button';
  clear.dataset.hmKey = 'hl-scope-clear';
  clear.addEventListener('click', () => (scope.forced ? clearForced(ctx.redraw) : ctx.clearSelection()));
  p.appendChild(clear);
  return p;
}

/** The next-start line keeps its last text while it asks again, so a poll does not shift the page. */
function nextStartLine() {
  const p = renderNextStartLine();
  if (!p.textContent && lastNextStart) p.textContent = lastNextStart;
  new MutationObserver(() => { lastNextStart = p.textContent; }).observe(p, { childList: true, characterData: true, subtree: true });
  return p;
}

function draw(root, ctx, page, { animate = false } = {}) {
  root.textContent = '';
  const wrap = el('div', 'hl' + (animate && !reducedMotion() ? ' hl-swap' : ''));
  root.appendChild(wrap);
  installHover(wrap, ctx.state);
  hidePreview();
  const state = ctx.state();
  if (!state?.tasks) {
    wrap.appendChild(el('p', 'rp-empty', 'Load tasks to see the lanes.'));
    return;
  }
  const { plan: whole, asks: allAsks, interps: allInterps } = preparePlan(page, wrap, state);
  const scope = placeScope(ctx);
  const set = scope?.set || null;
  page.notesShown = set ? pending => scopeNotes(pending, page.doc, set) : null;
  const plan = scopePlan(whole, page.doc, set);
  const { asks, interps } = scopeForYou(page.doc, set, allAsks, allInterps);
  const review = plan.review || [];
  const forYouCount = review.length + asks.length + interps.length;
  const shows = set ? scopeTest(page.doc, set) : undefined;
  const autoCount = (whole.readiness || []).filter(r => r.auto && (!shows || shows(r.id))).length;
  const readyCount = (plan.readiness || []).filter(r => r.ready).length;

  wrap.appendChild(renderNav(wrap, { foryou: forYouCount, ready: readyCount, auto: autoCount, lanes: plan.lanes.length }));
  if (scope) wrap.appendChild(renderScopeLine(ctx, scope, (plan.readiness || []).length, (whole.readiness || []).length));

  const forYou = section('foryou', 'For you');
  forYou.appendChild(renderReview(page, review, plan.openChecks || [], asks, interps));
  wrap.appendChild(forYou);

  const ready = section('ready', 'Ready');
  ready.appendChild(renderPlanReady(page, plan.readiness || []));
  wrap.appendChild(ready);

  const auto = section('auto', 'Auto queue');
  auto.appendChild(nextStartLine());
  auto.appendChild(renderPlanAutoQueue(page, whole.readiness || [], shows));
  wrap.appendChild(auto);

  const lanes = section('lanes', 'Lanes');
  lanes.appendChild(el('h2', 'hl-lanes-title', `Lanes (${plan.lanes.length})`));
  if (!plan.lanes.length) {
    lanes.appendChild(el('p', 'rp-empty', set ? 'No lane has work in this place.' : 'No epic is in progress or Ready, and none is pinned.'));
  } else {
    lanes.appendChild(renderRules(plan));
    lanes.appendChild(renderLegend());
    if (plan.totals) {
      const totals = renderTotals(plan.totals);
      if (set) totals.textContent = `Whole project: ${totals.textContent}`; // a check on the whole plan, not this place
      lanes.appendChild(totals);
    }
    lanes.appendChild(renderTracks(page, plan.lanes, plan.picks));
    if (plan.doneEpics.length) lanes.appendChild(renderDoneNote(plan.doneEpics));
  }
  wrap.appendChild(lanes);
  fillEpicEstimates(wrap);
  restoreAutoFocus(page, wrap);
  if (pendingSection) {
    const id = pendingSection;
    pendingSection = null;
    requestAnimationFrame(() => scrollToSection(wrap, id));
  }
}

/** Track which section is at the top of the centre zone and mark it in the nav. */
function watchScroll(root) {
  const scroller = root.closest('.hm-centre');
  if (!scroller) return () => {};
  let raf = 0;
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const nav = root.querySelector('.hl-nav');
      const line = (nav?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top) + 8;
      let current = SECTIONS[0][0];
      root.querySelectorAll('[data-hl-sec]').forEach((s) => { if (s.getBoundingClientRect().top <= line) current = s.dataset.hlSec; });
      markNav(root, current);
    });
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  return () => scroller.removeEventListener('scroll', onScroll);
}

/** Home's renderHomeView keeps a mounted view as it is: draw again when the Home tab is shown. */
function watchTabShown(ctx) {
  const panel = document.getElementById('homePanel');
  if (!panel || typeof MutationObserver === 'undefined') return () => {};
  let was = panel.classList.contains('active');
  const obs = new MutationObserver(() => {
    const now = panel.classList.contains('active');
    if (now && !was) ctx.redraw();
    was = now;
  });
  obs.observe(panel, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}

registerHomeView({
  id: 'lanes',
  label: 'Lanes',
  key: 3,
  render(root, ctx) {
    const page = createPlanCtx({
      getState: ctx.state,
      toast: makeToast('homeLanesToast'),
      openTicket: ctx.openTicket,
      redraw: () => ctx.redraw(),
      surface: 'home',
      keyPrefix: 'home:',
      idPrefix: 'hl-',
    });
    mounted = { root, ctx, page, cleanup: [], lastSel: JSON.stringify(ctx.selection?.() || {}) + window.location.search };
    draw(root, ctx, page);
    mounted.cleanup.push(watchScroll(root), watchTabShown(ctx));
    ctx.subscribe((e) => { if (e.type === 'selection') ctx.redraw(); });
  },
  update(root, ctx) {
    if (mounted?.root !== root) return this.render(root, ctx);
    const sel = JSON.stringify(ctx.selection?.() || {}) + window.location.search;
    const animate = mounted.lastSel !== undefined && mounted.lastSel !== sel;
    mounted.lastSel = sel;
    draw(root, ctx, mounted.page, { animate });
  },
  dispose(root) {
    if (mounted?.root !== root) return;
    mounted.cleanup.forEach(off => off());
    mounted = null;
    hidePreview();
  },
});

// ===== strip item: For you =====

registerStripItem({
  id: 'for-you',
  render(root, ctx) {
    const state = ctx.state();
    const asks = state?.tasks ? asksFromState(state) : [];
    let reviews = 0;
    try { reviews = state?.tasks ? (computeRunPlan(ctx.doc()).review || []).length + interpretationsFromState(state).length : 0; } catch { reviews = 0; }
    const btn = el('button', 'hl-strip-btn');
    btn.type = 'button';
    btn.dataset.hmKey = 'strip-for-you';
    btn.append(el('span', 'hm-strip-label', 'For you'), el('span', 'hm-strip-count hl-strip-count', String(asks.length)));
    btn.appendChild(el('span', 'hm-strip-note', `${asks.length === 1 ? 'decision' : 'decisions'} · ${reviews} to review`));
    btn.setAttribute('aria-label', `For you: ${asks.length} decision${asks.length === 1 ? '' : 's'} and ${reviews} to review. Open the Lanes view at For you`);
    btn.addEventListener('click', () => {
      if (mounted) { scrollToSection(mounted.root.querySelector('.hl') || mounted.root, 'foryou'); return; }
      pendingSection = 'foryou';
      setView('lanes');
    });
    root.appendChild(btn);
  },
});
