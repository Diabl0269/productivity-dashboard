// metrics-view.js — "Metrics" tab: where work waits (ticket flow, sessions, build/CI, next up).
// Data: GET /api/metrics?since=30d&project=<slug>; POST /api/metrics/collect refreshes the sources.
// Definitions of every number: docs/metrics.md. Charts: metrics-charts.js.

import {
  lineChart, barChart, fmtPercentileLabel, percentileTip, SECOND_STEPS, HOUR_STEPS, fmtHours, fmtTotalHours, fmtMinutes, fmtSeconds, fmtPct, fmtNum, fmtDay,
} from './metrics-charts.js';
import { renderCost } from './metrics-cost-view.js';
import { renderTimeSplit } from './metrics-time-view.js';
import { renderHealth, renderBacklog } from './metrics-health-view.js';
import { renderQuality } from './metrics-quality-view.js';
import { safe } from './metrics-safe.js';
import { ms, pctDelta, gateStats, passingStats } from './metrics-stats.js';
import { staleBanner } from './metrics-empty.js';
import { buildNav } from './metrics-nav.js';
import { openTicketById } from './routing.js';
import { showStatus } from './state.js';

const RANGES = ['7d', '30d', '90d'];
const PALETTE = ['var(--mc-s1)', 'var(--mc-s2)', 'var(--mc-s3)', 'var(--mc-s4)', 'var(--mc-s5)'];
const STAGE_LABEL = { todo: 'To do', 'in-progress': 'In progress', review: 'Review' };

const view = {
  since: '30d',
  project: '',
  data: null,
  error: null,
  loading: false,
  collecting: false,
  collectNote: null,
  groupBy: 'project',
  groupAll: false,
  recentAll: false,
  sort: { key: 'start', dir: 'desc' },
  req: 0,
  built: false,
  ticker: null,
};

// ---------- small DOM helpers ----------

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function append(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}

function empty(text) {
  return el('p', 'mc-empty', text);
}

/** A ticket id that opens the ticket detail (button, so Enter/Space work). */
function ticketLink(id, extra = '') {
  const b = el('button', `mc-link${extra ? ` ${extra}` : ''}`, id);
  b.type = 'button';
  b.title = `Open ${id}`;
  b.setAttribute('aria-label', `Open ticket ${id}`);
  b.addEventListener('click', () => {
    if (!openTicketById(id)) showStatus(`Ticket ${id} not found`);
  });
  return b;
}

function card(title, subtitle, ...kids) {
  const c = el('section', 'mc-card');
  const head = el('div', 'mc-card-head');
  append(head, el('h4', 'mc-card-title', title));
  if (subtitle) head.appendChild(el('p', 'mc-card-sub', subtitle));
  c.appendChild(head);
  append(c, ...kids);
  return c;
}

function section(id, title, blurb) {
  const s = el('section', 'mc-section');
  s.setAttribute('aria-labelledby', `mcH-${id}`);
  const h = el('div', 'mc-section-head');
  const h2 = el('h3', 'mc-section-title', title);
  h2.id = `mcH-${id}`;
  append(h, h2, blurb ? el('p', 'mc-section-blurb', blurb) : null);
  s.appendChild(h);
  return s;
}

const shortRepo = (r) => String(r || '').split('/').pop();

/** A table cell that truncates with an ellipsis and keeps the full text as a tooltip. */
function cellText(text) {
  const s = el('span', 'mc-trunc', text);
  s.title = text;
  return s;
}

function ago(iso) {
  if (!iso) return 'never';
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} d ago`;
}

function startStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDay(d)} ${hh}:${mm}`;
}

// ---------- URL state (mrange / mproject: distinct from the Tasks tab's facet params) ----------

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const r = p.get('mrange');
  if (RANGES.includes(r)) view.since = r;
  view.project = p.get('mproject') || '';
}

function writeUrl() {
  const p = new URLSearchParams(window.location.search);
  if (view.since !== '30d') p.set('mrange', view.since); else p.delete('mrange');
  if (view.project) p.set('mproject', view.project); else p.delete('mproject');
  const qs = p.toString();
  const next = window.location.pathname + (qs ? `?${qs}` : '');
  if (next !== window.location.pathname + window.location.search) {
    window.history.replaceState(window.history.state || {}, '', next);
  }
}

// ---------- data ----------

async function load() {
  const my = ++view.req;
  view.loading = true;
  view.error = null;
  paintState();
  try {
    const qs = new URLSearchParams({ since: view.since });
    if (view.project) qs.set('project', view.project);
    const res = await fetch(`/api/metrics?${qs}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'The metrics endpoint is not available on this server (restart it, or update serve.js).' : `Server answered ${res.status}.`);
    const data = await res.json();
    if (my !== view.req) return;
    view.data = data;
  } catch (e) {
    if (my !== view.req) return;
    view.error = e.message || 'Could not load metrics.';
  } finally {
    if (my === view.req) {
      view.loading = false;
      render();
    }
  }
}

async function collect() {
  if (view.collecting) return;
  view.collecting = true;
  view.collectNote = null;
  paintState();
  try {
    const res = await fetch('/api/metrics/collect', { method: 'POST' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ok === false) throw new Error(out.error || `Collect failed (${res.status}).`);
    view.collectNote = { ok: true, lines: out.summary || [] };
  } catch (e) {
    view.collectNote = { ok: false, lines: [e.message || 'Collect failed.'] };
  }
  view.collecting = false;
  await load();
}

// ---------- header ----------

function buildHeader() {
  const head = el('div', 'mc-header');
  const left = el('div', 'mc-titlewrap');
  append(left, el('h2', 'mc-title', 'Metrics'), el('p', 'mc-sub', 'Where work waits, so you know what is worth investing in.'));

  const controls = el('div', 'mc-controls');

  const range = el('div', 'mc-seg');
  range.setAttribute('role', 'group');
  range.setAttribute('aria-label', 'Time range');
  for (const r of RANGES) {
    const b = el('button', 'mc-seg-btn', r);
    b.type = 'button';
    b.dataset.range = r;
    b.addEventListener('click', () => {
      if (view.since === r) return;
      view.since = r;
      writeUrl();
      load();
    });
    range.appendChild(b);
  }

  const projLabel = el('label', 'mc-field');
  projLabel.appendChild(el('span', 'mc-field-label', 'Project'));
  const sel = el('select', 'mc-select');
  sel.id = 'mcProject';
  sel.addEventListener('change', () => {
    view.project = sel.value;
    writeUrl();
    load();
  });
  projLabel.appendChild(sel);

  const refresh = el('button', 'mc-refresh');
  refresh.id = 'mcRefresh';
  refresh.type = 'button';
  refresh.innerHTML = '<span class="mc-spinner" aria-hidden="true"></span><span class="mc-refresh-text">Refresh data</span>';
  refresh.addEventListener('click', collect);

  const updated = el('span', 'mc-updated');
  updated.id = 'mcUpdated';
  updated.setAttribute('aria-live', 'polite');

  append(controls, range, projLabel, refresh, updated);
  append(head, left, controls);
  return head;
}

/** Update controls that depend on state without rebuilding (keeps focus, no layout jump). */
function paintState() {
  const root = document.getElementById('metricsMain');
  if (!root || !view.built) return;
  for (const b of root.querySelectorAll('.mc-seg-btn')) {
    b.setAttribute('aria-pressed', b.dataset.range === view.since ? 'true' : 'false');
  }
  const sel = root.querySelector('#mcProject');
  if (sel) {
    const projects = view.data?.filters?.projects || [];
    const want = ['', ...projects];
    if (want.join('|') !== [...sel.options].map(o => o.value).join('|')) {
      sel.textContent = '';
      for (const p of want) {
        const o = el('option', null, p || 'All projects');
        o.value = p;
        sel.appendChild(o);
      }
    }
    if (view.project && !want.includes(view.project)) {
      const o = el('option', null, view.project);
      o.value = view.project;
      sel.appendChild(o);
    }
    sel.value = view.project;
  }
  const btn = root.querySelector('#mcRefresh');
  btn.disabled = view.collecting;
  btn.classList.toggle('is-busy', view.collecting);
  btn.querySelector('.mc-refresh-text').textContent = view.collecting ? 'Collecting… (up to a minute)' : 'Refresh data';
  btn.setAttribute('aria-busy', view.collecting ? 'true' : 'false');
  const upd = root.querySelector('#mcUpdated');
  upd.textContent = view.data ? `updated ${ago(view.data.generatedAt)}` : '';
  if (view.data) upd.title = new Date(view.data.generatedAt).toLocaleString();
  root.classList.toggle('mc-loading', view.loading && !!view.data);
  root.setAttribute('aria-busy', view.loading ? 'true' : 'false');
}

// ---------- insights ----------

const INSIGHT_ICON = {
  bottleneck: '◆', slower: '▲', faster: '▼', warn: '!', good: '✓', info: 'i', missing: '?',
};

function renderInsights(d) {
  const s = section('insights', 'Insights', null);
  const list = d.insights || [];
  if (!list.length) {
    s.appendChild(empty('No insights yet. Collect data and move a few tickets, and findings will show up here.'));
    return s;
  }
  const grid = el('div', 'mc-insights');
  const ordered = [...list].sort((a, b) => (b.kind === 'bottleneck') - (a.kind === 'bottleneck'));
  for (const it of ordered) {
    const c = el('article', `mc-insight mc-k-${it.kind}`);
    const icon = el('span', 'mc-insight-icon', INSIGHT_ICON[it.kind] || 'i');
    icon.setAttribute('aria-hidden', 'true');
    const body = el('div', 'mc-insight-body');
    const det = el('p', 'mc-insight-detail', it.detail);
    det.title = it.detail || '';
    append(body, el('h4', 'mc-insight-title', it.title), det);
    append(c, icon, body, typeof it.value === 'string' && it.value ? el('span', 'mc-insight-value', it.value) : null);
    grid.appendChild(c);
  }
  s.appendChild(grid);
  return s;
}

// ---------- headline numbers ----------

function tile(label, value, sub, delta, hint, cls = '') {
  const t = el('div', `mc-tile${cls ? ` ${cls}` : ''}`);
  if (hint) t.title = hint;
  append(t, el('div', 'mc-tile-label', label), el('div', 'mc-tile-value', value));
  t.appendChild(el('div', 'mc-tile-sub', sub || ' '));
  const d = el('div', `mc-delta${delta ? (delta.good === true ? ' good' : delta.good === false ? ' bad' : '') : ''}`, delta ? delta.text : ' ');
  t.appendChild(d);
  return t;
}

function renderHeadline(d) {
  const s = section('headline', 'Headline numbers', null);
  const grid = el('div', 'mc-tiles');
  const f = d.flow || {};
  const ss = d.sessions?.summary;
  const cw = f.cycleByWeek || [];
  const sw = d.sessions?.byWeek || [];
  const hs = d.health;
  if (hs && hs.n) {
    // One session-health number: the stuck/silent/asked/clean split lives in the Session health section.
    let stuckDelta = null;
    const hw = hs.byWeek || [];
    if (hw.length > 1) {
      const diff = (hw[hw.length - 1].stuck || 0) - (hw[hw.length - 2].stuck || 0);
      stuckDelta = { text: diff === 0 ? '≈ flat vs last week' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} vs last week`, good: diff === 0 ? null : diff < 0 };
    }
    grid.appendChild(tile('Stuck sessions', fmtNum(hs.status.stuck),
      hs.status.stuck ? `of ${hs.n} sessions: a 20+ min silence nothing answered (see Session health)` : 'no session went stuck',
      stuckDelta, 'A session with at least one missed wake-up: idle-stopped, queued or blocked.',
      `mc-tile-wide${hs.status.stuck ? ' is-alert' : ''}`));
  }
  const cyc = f.cycle?.median;
  grid.appendChild(tile('Cycle time', cyc != null ? fmtHours(cyc) : '–', f.cycle?.n ? `median, ${f.cycle.n} tickets` : 'no finished tickets',
    cw.length > 1 ? pctDelta(cw[cw.length - 1].median, cw[cw.length - 2].median, true) : null,
    'First move into in-progress to first move into review or done'));
  const st = f.stages || {};
  grid.appendChild(tile('Wait before start', st.todo?.n ? fmtHours(st.todo.median) : '–', 'median time in to do', null, 'Queue time in the to do column; not a bottleneck, a backlog signal'));
  const rw = f.reviewWait?.epics;
  const rwOpen = rw?.open?.n ? `${rw.open.n} waiting now, oldest ${fmtHours(rw.open.oldestHours)}` : 'none waiting now';
  grid.appendChild(tile('Review wait (epic cards)', rw?.n ? fmtHours(rw.median) : '–', rw?.n ? `median of ${rw.n} epic review cards · ${fmtPercentileLabel('p90', 'leave')} ${fmtHours(rw.p90)} · ${rwOpen}` : rwOpen,
    null, 'How long an epic card sits in Review before it moves on (ticket cards are in the first-look distribution below). When high: review the oldest card first, or finish the epic check in one sitting.'));
  const wip = f.wip || [];
  const wipNow = wip.length ? wip[wip.length - 1].tickets : null;
  const wipPrev = wip.length > 7 ? wip[wip.length - 8].tickets : null;
  let wipDelta = null;
  if (wipNow != null && wipPrev != null) {
    const diff = wipNow - wipPrev;
    wipDelta = { text: diff === 0 ? '≈ flat vs last week' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} vs last week`, good: diff === 0 ? null : diff < 0 };
  }
  grid.appendChild(tile('WIP now', wipNow != null ? fmtNum(wipNow) : '–', wip.length ? `${wip[wip.length - 1].epics} epics in progress` : 'tickets in progress', wipDelta, 'Tickets (not epics) in progress at the end of the day'));
  let autoDelta = null;
  if (sw.length > 1) {
    const diff = Math.round((sw[sw.length - 1].autonomousShare - sw[sw.length - 2].autonomousShare) * 100);
    autoDelta = { text: diff === 0 ? '≈ flat vs last week' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} pts vs last week`, good: diff === 0 ? null : diff > 0 };
  }
  grid.appendChild(tile('Clean sessions', ss ? fmtPct(ss.autonomousShare) : '–', ss ? `of ${ss.n} sessions ran with no question, silence or stop` : 'no sessions collected', autoDelta, 'Sessions with no mid-run question, stall, long tool wait or missed wake-up (Session health)'));
  let qDelta = null;
  if (sw.length > 1) {
    const a = sw[sw.length - 1]; const b = sw[sw.length - 2];
    qDelta = pctDelta(a.questionsMidRun / Math.max(1, a.n), b.questionsMidRun / Math.max(1, b.n), true);
  }
  grid.appendChild(tile('Mid-run questions', ss && ss.n ? fmtNum(ss.questionsMidRun / ss.n, 2) : '–', 'per session', qDelta, 'Questions asked after the first 15 minutes of active time'));
  const gate = gateStats(d);
  grid.appendChild(tile('Gate time', gate.value != null ? fmtSeconds(gate.value) : '–',
    gate.n ? `median passing ${gate.kind === 'build' ? 'local build' : 'gate run'} (${fmtNum(gate.n)} runs)` : 'no passing local runs',
    gate.delta, 'Median of successful local runs only; failed runs end early and would make it look faster. Builds are used when there are no gate runs.'));
  const ciPts = (d.timings?.series || []).filter(x => x.kind === 'ci').flatMap(x => x.points);
  const ci = passingStats(ciPts);
  const ciRepos = d.timings?.ci?.byRepo || [];
  const ciRuns = ciRepos.reduce((a, r) => a + r.runs, 0);
  const ciMed = ci.n ? ci.value : (ciRuns ? ciRepos.reduce((a, r) => a + r.medianSeconds * r.runs, 0) / ciRuns : null);
  grid.appendChild(tile('CI time', ciMed != null ? fmtSeconds(ciMed) : '–',
    ci.n ? `median passing run (${fmtNum(ci.n)} runs)` : (ciRuns ? `median over ${fmtNum(ciRuns)} runs` : 'no CI runs collected'),
    ci.delta, 'GitHub Actions run time, successful runs only'));
  s.appendChild(grid);
  return s;
}

// ---------- table helper ----------

function table(label, columns, rows, opts = {}) {
  const wrap = el('div', 'mc-scroll');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', label);
  const t = el('table', 'mc-table');
  const cap = el('caption', 'mc-sr', label);
  t.appendChild(cap);
  const thead = el('thead');
  const hr = el('tr');
  for (const c of columns) {
    const th = el('th', c.num ? 'num' : '');
    th.scope = 'col';
    if (c.title) th.title = c.title;
    if (opts.sort && c.key) {
      const active = opts.sort.key === c.key;
      th.setAttribute('aria-sort', active ? (opts.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      const b = el('button', 'mc-sort', c.label);
      b.type = 'button';
      append(b, el('span', 'mc-sort-arrow', active ? (opts.sort.dir === 'asc' ? '▲' : '▼') : ''));
      b.addEventListener('click', () => opts.onSort(c.key));
      th.appendChild(b);
    } else {
      th.textContent = c.label;
    }
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    columns.forEach((c, i) => {
      const td = el('td', c.num ? 'num' : '');
      const v = r[i];
      if (v instanceof Node) td.appendChild(v); else td.textContent = v == null ? '–' : v;
      if (c.label) td.dataset.label = c.label;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  append(t, thead, tbody);
  wrap.appendChild(t);
  return wrap;
}

// ---------- ticket flow ----------

function renderStageBar(flow) {
  const stages = flow.stages || {};
  const keys = ['todo', 'in-progress', 'review'];
  const total = keys.reduce((a, k) => a + (stages[k]?.totalHours || 0), 0);
  if (!total) return empty('No finished stays yet in this range. Move a few tickets through the board and the bar fills in.');
  const wrap = el('div', 'mc-stagebar');
  keys.forEach((k, i) => {
    const s = stages[k];
    if (!s) return;
    const isBn = flow.bottleneck?.stage === k;
    const seg = el('div', `mc-stage${isBn ? ' is-bottleneck' : ''}${k === 'todo' ? ' is-queue' : ''}`);
    seg.style.flexGrow = String((Math.sqrt(s.totalHours / total) + 0.4).toFixed(3));
    const top = el('div', 'mc-stage-top');
    append(top, el('span', 'mc-stage-name', STAGE_LABEL[k]));
    if (isBn) top.appendChild(el('span', 'mc-stage-badge', 'Bottleneck'));
    else if (k === 'todo') top.appendChild(el('span', 'mc-stage-queue', 'queue'));
    append(seg, top, el('div', 'mc-stage-median', fmtHours(s.median)), el('div', 'mc-stage-note', 'median'));
    const meta = el('div', 'mc-stage-meta');
    meta.textContent = `${fmtPercentileLabel('p75', 'leave')} ${fmtHours(s.p75)} · ${s.n} ${s.n === 1 ? 'visit' : 'visits'}, ${fmtTotalHours(s.totalHours)} added up`;
    meta.title = 'A quarter of the tickets wait longer than this. A visit is one stay in this column (a ticket that comes back counts again). Added up is every visit end to end, tickets still waiting included, so it can be far more than the median.';
    seg.appendChild(meta);
    if (s.open?.n) seg.appendChild(el('div', 'mc-stage-open', `${s.open.n} waiting now, oldest ${fmtHours(s.open.oldestHours)}`));
    if (isBn && flow.bottleneck.share != null) seg.appendChild(el('div', 'mc-stage-share', `${fmtPct(flow.bottleneck.share)} of in-flight time`));
    wrap.appendChild(seg);
    if (i < keys.length - 1) { const a = el('span', 'mc-stage-arrow', '→'); a.setAttribute('aria-hidden', 'true'); wrap.appendChild(a); }
  });
  return wrap;
}

function renderGroupTable(flow) {
  const groups = flow.groups?.[view.groupBy] || {};
  const names = Object.keys(groups).filter(n => (groups[n].counts?.started || 0) + (groups[n].counts?.shipped || 0) > 0);
  const wrap = el('div');
  const seg = el('div', 'mc-seg mc-seg-small');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Group tickets by');
  for (const g of ['project', 'lane', 'area']) {
    const b = el('button', 'mc-seg-btn', g[0].toUpperCase() + g.slice(1));
    b.type = 'button';
    b.setAttribute('aria-pressed', view.groupBy === g ? 'true' : 'false');
    b.addEventListener('click', () => { view.groupBy = g; render(); });
    seg.appendChild(b);
  }
  wrap.appendChild(seg);
  if (!names.length) {
    wrap.appendChild(empty(`No tickets grouped by ${view.groupBy} in this range.`));
    return wrap;
  }
  const rank = (n) => (groups[n].counts?.shipped || 0) * 1000 + (groups[n].counts?.started || 0);
  names.sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
  const CAP = 8;
  const shown = view.groupAll ? names : names.slice(0, CAP);
  const rows = shown
    .map((n) => {
      const g = groups[n];
      const bn = g.bottleneck;
      const bnCell = bn ? el('span', 'mc-pill', `${STAGE_LABEL[bn.stage] || bn.stage} · ${fmtHours(bn.totalHours)}`) : '–';
      return [cellText(n), fmtNum(g.counts?.started), fmtNum(g.counts?.shipped), g.cycle?.n ? fmtHours(g.cycle.median) : '–', bnCell];
    });
  wrap.appendChild(table(`Flow by ${view.groupBy}`, [
    { label: view.groupBy[0].toUpperCase() + view.groupBy.slice(1) },
    { label: 'Started', num: true }, { label: 'Shipped', num: true },
    { label: 'Cycle median', num: true }, { label: 'Bottleneck' },
  ], rows));
  if (names.length > CAP) {
    const more = el('button', 'mc-more', view.groupAll ? `Show top ${CAP}` : `Show all ${names.length}`);
    more.type = 'button';
    more.addEventListener('click', () => { view.groupAll = !view.groupAll; render(); });
    wrap.appendChild(more);
  }
  return wrap;
}

/** Ready-to-reviewed distribution and reopened-by-model-label (flow.reviewWait, flow.reopenedByLabel). */
function renderReviewFirstLook(f) {
  const wrap = el('div', 'mc-grid2');
  const rr = f.reviewWait?.readyToReviewed;
  const sub = 'Time from moving to Review until the card moves again or you write a review note on it. When high: open the oldest Ready-for-review card first.';
  if (rr && (rr.n || rr.waiting)) {
    const rows = rr.buckets.map((b) => [b.label, String(b.n)]);
    wrap.appendChild(card('Ready to first look', sub,
      el('p', 'mc-counts', `${rr.n} cards · median ${rr.median != null ? fmtHours(rr.median) : '–'} · ${fmtPercentileLabel('p90', 'leave')} ${rr.p90 != null ? fmtHours(rr.p90) : '–'} · ${rr.waiting} still waiting`),
      table('Time from ready to first look', [{ label: 'Waited' }, { label: 'Cards', num: true }], rows)));
  } else {
    wrap.appendChild(card('Ready to first look', sub, empty('No cards moved to Review in this range.')));
  }
  const rl = f.reopenedByLabel || [];
  const rrows = rl.map((g) => [g.label, String(g.moves + g.fixes), String(g.moves), String(g.fixes)]);
  wrap.appendChild(card('Reopened by model label', 'Moved back from Review/Done, or a fix ticket opened from a shipped ticket within 14 days. When a label is high: check that label\'s tickets get clearer checks or a stronger model.',
    rl.length ? table('Reopened by model label', [{ label: 'Model label' }, { label: 'Reopened', num: true }, { label: 'Moved back', num: true }, { label: 'Fix tickets', num: true }], rrows) : empty('Nothing reopened in this range.')));
  return wrap;
}

function renderFlow(d) {
  const f = d.flow;
  const s = section('flow', 'Ticket flow', 'How long tickets sit in each column, and how many move through per week.');
  if (!f) { s.appendChild(empty('No ticket history in this range.')); return s; }

  const c = f.counts || {};
  const counts = el('p', 'mc-counts');
  counts.textContent = `${c.started ?? 0} started · ${c.shipped ?? 0} shipped · ${c.reopened ?? 0} reopened${c.reopenedFixes ? ` (${c.reopenedFixes} as a fix ticket within 14 days)` : ''} · ${c.closedWithoutWork ?? 0} closed without work` +
    (f.backlog ? ` · ${f.backlog.openTodo} open in to do (${f.backlog.growthPerWeek >= 0 ? '+' : '−'}${Math.abs(f.backlog.growthPerWeek)} per week)` : '');
  s.appendChild(counts);
  const legend = el('p', 'mc-stage-legend', 'Median: the typical wait. 3 in 4 leave within: a quarter wait longer. A visit is one stay in a column; added up counts tickets still waiting too.');
  s.appendChild(card('Time in each column', 'Segment width roughly follows total time spent; to do is a queue, so it is never the bottleneck.', renderStageBar(f), legend));

  s.appendChild(renderReviewFirstLook(f));
  s.appendChild(renderTimeSplit(f, { el, append, table, ticketLink, empty, card }));

  const grid = el('div', 'mc-grid2');
  const tw = f.throughputByWeek || [];
  grid.appendChild(card('Weekly throughput', 'Tickets created, shipped and closed (first move into review, done or archive) per week; the line shows how many were started.',
    tw.length ? barChart({
      title: 'Weekly throughput: created, shipped and closed bars, started line',
      categories: tw.map(w => fmtDay(ms(w.week))),
      series: [{ name: 'Created', color: PALETTE[0], values: tw.map(w => w.created) }, { name: 'Shipped', color: PALETTE[1], values: tw.map(w => w.shipped) },
        ...(tw.some(w => w.closed != null) ? [{ name: 'Closed', color: PALETTE[3], values: tw.map(w => w.closed ?? 0) }] : [])],
      line: { name: 'Started', color: PALETTE[2], values: tw.map(w => w.started) },
      mode: 'grouped',
    }) : empty('No weekly counts yet.')));
  const wip = f.wip || [];
  grid.appendChild(card('Work in progress over time', 'Tickets and epics in progress at the end of each day.',
    wip.length ? lineChart({
      title: 'Work in progress per day: tickets and epics',
      series: [
        { name: 'Tickets', color: PALETTE[0], points: wip.map(p => ({ x: ms(p.date), y: p.tickets })) },
        { name: 'Epics', color: PALETTE[3], dashed: true, points: wip.map(p => ({ x: ms(p.date), y: p.epics })) },
      ],
      yFormat: (n) => fmtNum(n, 0),
    }) : empty('No daily snapshots yet.')));
  const cw = f.cycleByWeek || [];
  grid.appendChild(card('Cycle time by week', 'Median hours from start to review, by the week tickets finished.',
    cw.length ? lineChart({
      title: 'Median cycle time by week',
      series: [{ name: 'Median cycle', color: PALETTE[4], points: cw.map(p => ({ x: ms(p.week), y: p.median })) }],
      yFormat: fmtHours, area: true, tickSteps: HOUR_STEPS,
    }) : empty('No finished tickets in the range, so no cycle time yet.')));

  const idleList = (items, emptyText) => {
    if (!items.length) return empty(emptyText);
    const ul = el('ul', 'mc-forgot');
    for (const e of items) {
      const li = el('li', 'mc-forgot-item');
      append(li, ticketLink(e.id), el('span', 'mc-forgot-title', e.title), el('span', 'mc-pill mc-pill-warn', `idle ${e.idleDays} d`),
        el('span', 'mc-forgot-meta', [e.project, e.lane].filter(Boolean).join(' · ')));
      ul.appendChild(li);
    }
    return ul;
  };
  grid.appendChild(card('Forgotten epics', 'In progress, but nothing has moved in the epic or its children for a while.',
    idleList(f.forgottenEpics || [], 'No forgotten epics. Every epic in progress had activity recently.')));
  grid.appendChild(card('Stale tickets', 'Tickets in progress with no activity on the ticket itself for a few days.',
    idleList(f.staleTickets || [], 'No stale tickets. Every ticket in progress had activity recently.')));
  s.appendChild(grid);
  s.appendChild(card('Flow by group', 'Where each project, lane or area spends its time.', renderGroupTable(f)));
  return s;
}

// ---------- sessions ----------

function sortedRecent(rows) {
  const { key, dir } = view.sort;
  const val = (r) => (key === 'ticket' || key === 'title' || key === 'start') ? String(r[key] ?? '') : (r[key] ?? 0);
  const out = [...rows].sort((a, b) => {
    const x = val(a); const y = val(b);
    return typeof x === 'string' ? x.localeCompare(y, undefined, { numeric: true }) : x - y;
  });
  return dir === 'desc' ? out.reverse() : out;
}

function recentTable(rows) {
  const cols = [
    { label: 'Start', key: 'start' }, { label: 'Ticket', key: 'ticket' }, { label: 'Title', key: 'title' },
    { label: 'Wall', key: 'wallMin', num: true }, { label: 'Active', key: 'activeMin', num: true },
    { label: 'Waiting on you', key: 'waitUserMin', num: true }, { label: 'Questions', key: 'questions', num: true },
    { label: 'Missed wakes', key: 'missedWakes', num: true }, { label: 'Stalls', key: 'stalls', num: true },
    { label: 'Tool waits', key: 'toolWaits', num: true }, { label: 'Question waits', key: 'questionWaits', num: true },
    { label: 'Helpers', key: 'helpers', num: true },
    { label: 'Cost', key: 'costUSD', num: true },
  ];
  const RECENT_CAP = 15;
  const all = sortedRecent(rows);
  const body = (view.recentAll ? all : all.slice(0, RECENT_CAP)).map(r => [
    startStamp(r.start),
    r.ticket ? ticketLink(r.ticket) : '–',
    r.title ? cellText(r.title) : '–',
    fmtMinutes(r.wallMin), fmtMinutes(r.activeMin), fmtMinutes(r.waitUserMin),
    r.questionsMidRun ? `${r.questions} (${r.questionsMidRun} mid-run)` : String(r.questions ?? 0),
    r.missedWakes ? el('span', 'mc-pill mc-pill-bad', String(r.missedWakes)) : '0',
    r.stalls ? el('span', 'mc-pill mc-pill-warn', String(r.stalls)) : '0',
    String(r.toolWaits ?? 0), String(r.questionWaits ?? 0),
    String(r.helpers ?? 0),
    r.costUSD != null ? `$${r.costUSD.toFixed(2)}` : '–',
  ]);
  const t = table('Recent sessions', cols, body, {
    sort: view.sort,
    onSort(key) {
      view.sort = { key, dir: view.sort.key === key ? (view.sort.dir === 'asc' ? 'desc' : 'asc') : (key === 'ticket' || key === 'title' ? 'asc' : 'desc') };
      const host = document.getElementById('mcRecentHost');
      paintRecent(host, rows);
      const th = [...host.querySelectorAll('th')].find(h => h.getAttribute('aria-sort') !== 'none');
      th?.querySelector('button')?.focus();
    },
  });
  const box = el('div');
  box.appendChild(t);
  if (all.length > RECENT_CAP) {
    const more = el('button', 'mc-more', view.recentAll ? `Show latest ${RECENT_CAP}` : `Show all ${all.length}`);
    more.type = 'button';
    more.addEventListener('click', () => {
      view.recentAll = !view.recentAll;
      const host = document.getElementById('mcRecentHost');
      paintRecent(host, rows);
      host.querySelector('.mc-more')?.focus();
    });
    box.appendChild(more);
  }
  return box;
}

function paintRecent(host, rows) {
  host.textContent = '';
  host.appendChild(recentTable(rows));
}

function renderSessions(d) {
  const s = section('sessions', 'Sessions', 'Claude Code sessions: how long they run, how much they wait on you, and how often they stall.');
  const x = d.sessions;
  if (!x || !x.summary || !x.summary.n) {
    s.appendChild(empty('No sessions collected in this range. Press Refresh data to read your Claude Code transcripts.'));
    return s;
  }
  const m = x.summary;
  const p = el('p', 'mc-counts');
  p.textContent = `${m.n} sessions (${m.withTicket} on a ticket) · median ${fmtMinutes(m.medianWallMin)} wall, ${fmtMinutes(m.medianActiveMin)} active · ` +
    (m.medianReplyMin != null ? `median reply ${fmtMinutes(m.medianReplyMin)} · ` : '') +
    `${m.questions} questions (${m.questionsMidRun} mid-run) · stuck and silent counts are in Session health` +
    (m.sessionsWaitedOver1h != null ? ` · ${m.sessionsWaitedOver1h} sessions waited over 1 h` : '') + ' · ' +
    `${m.sessionsPerTicket?.median ?? '–'} per ticket (max ${m.sessionsPerTicket?.max ?? '–'}) · $${fmtNum(m.costUSD, 2)} over ${m.costSessions ?? m.n} sessions (same as the Cost section)`;
  s.appendChild(p);

  const bw = x.byWeek || [];
  const grid = el('div', 'mc-grid2');
  grid.appendChild(card('Clean sessions by week', 'Share of sessions with no question, silence or stop (see Session health).',
    bw.length ? lineChart({
      title: 'Autonomous session share by week',
      series: [{ name: 'Autonomy', color: PALETTE[1], points: bw.map(w => ({ x: ms(w.week), y: w.autonomousShare })) }],
      yFormat: (n) => fmtPct(n), yMax: 1, area: true,
    }) : empty('No weekly session data yet.')));
  s.appendChild(grid);

  const host = el('div');
  host.id = 'mcRecentHost';
  host.appendChild((x.recent || []).length ? recentTable(x.recent) : empty('No recent sessions.'));
  s.appendChild(card('Recent sessions', 'Click a column to sort. Waiting on you is time between a turn ending and your next prompt.', host));

  const top = x.topTickets || [];
  let body;
  if (!top.length) body = empty('No tickets with sessions in this range.');
  else {
    const max = Math.max(...top.map(t => t.wallHours), 0.1);
    body = el('ul', 'mc-bars');
    for (const t of top) {
      const li = el('li', 'mc-bar-row');
      const track = el('div', 'mc-bar-track');
      const wall = el('span', 'mc-bar-fill mc-bar-wall'); wall.style.width = `${(t.wallHours / max) * 100}%`;
      const act = el('span', 'mc-bar-fill mc-bar-active'); act.style.width = `${(t.activeHours / max) * 100}%`;
      append(track, wall, act);
      append(li, ticketLink(t.ticket), track, el('span', 'mc-bar-val', `${fmtHours(t.activeHours)} active · ${t.sessions} ${t.sessions === 1 ? 'session' : 'sessions'}`));
      body.appendChild(li);
    }
  }
  s.appendChild(card('Top tickets by active time', 'Dark bar is active hours, light bar is wall-clock hours.', body));
  return s;
}

// ---------- build & CI ----------

function renderBuild(d) {
  const s = section('build', 'Build & CI', 'Local gates, builds and GitHub Actions: how long they take and where they fail.');
  const t = d.timings || {};
  const series = t.series || [];
  if (!series.length && !(t.ci?.byRepo || []).length) {
    s.appendChild(empty('No timings yet. Run ch metrics collect --ci --gates, or time a command with ch metrics time.'));
    return s;
  }
  const byKey = new Map();
  for (const x of series) {
    const k = `${x.repo}|${x.kind}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(x);
  }
  const grid = el('div', 'mc-grid2');
  for (const [k, list] of byKey) {
    const [repo, kind] = k.split('|');
    grid.appendChild(card(`${shortRepo(repo)} · ${kind}`, 'Seconds per run (busy series show the daily median). Hollow red points are failed runs; a red badge counts failures on a busy day.',
      lineChart({
        title: `${shortRepo(repo)} ${kind} run time over time`,
        series: list.map((x, i) => ({
          name: x.name + (x.host ? ` (${x.host})` : ''), color: PALETTE[i % PALETTE.length],
          points: x.points.map(p => ({ x: ms(p.at), y: p.seconds, hollow: !p.ok })),
        })),
        yFormat: fmtSeconds, tickSteps: SECOND_STEPS, legend: true,
      })));
  }
  if (byKey.size) s.appendChild(grid);
  else s.appendChild(empty('No local gate or build timings yet.'));

  // trends
  const trends = t.trends || [];
  let tb;
  if (!trends.length) tb = empty('Not enough runs in both weeks to compare yet.');
  else {
    tb = el('ul', 'mc-trends');
    for (const r of trends) {
      const flat = !Number.isFinite(r.changePct) || Math.abs(r.changePct) < 5;
      const pct = Number.isFinite(r.changePct) ? r.changePct : 0;
      const li = el('li', `mc-trend ${flat ? 'flat' : pct > 0 ? 'bad' : 'good'}`);
      const arrow = el('span', 'mc-trend-arrow', flat ? '≈' : pct > 0 ? '▲' : '▼');
      arrow.setAttribute('aria-hidden', 'true');
      append(li, arrow,
        el('span', 'mc-trend-pct', (Number.isFinite(r.changePct) ? `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(0)}%` : 'n/a')),
        el('span', 'mc-trend-name', `${shortRepo(r.repo)} ${r.name}`),
        el('span', 'mc-trend-meta', `${fmtSeconds(r.recentMedian)} now vs ${fmtSeconds(r.priorMedian)} before · ${r.recentCount}/${r.priorCount} runs`));
      li.setAttribute('aria-label', `${shortRepo(r.repo)} ${r.name} is ${flat ? 'about the same' : pct > 0 ? 'slower' : 'faster'}: ${pct.toFixed(0)} percent`);
      tb.appendChild(li);
    }
  }
  const row = el('div', 'mc-grid2');
  row.appendChild(card('Trends', 'Median of the last 7 days against the 7 before. Up is slower.', tb));

  // red time
  const rt = t.redTime;
  let rb;
  if (!rt || !rt.summary || !rt.summary.branches) rb = empty('No red branches in this range. Failing runs that later turn green show up here.');
  else {
    rb = el('div');
    const chips = el('div', 'mc-chips');
    for (const [l, v] of [['branches', fmtNum(rt.summary.branches)], ['median', fmtMinutes(rt.summary.medianMinutes)], [fmtPercentileLabel('p90', 'finish'), fmtMinutes(rt.summary.p90Minutes)], ['red right now', fmtNum(rt.summary.openNow)]]) {
      const c = el('div', `mc-chip${l === 'red right now' && rt.summary.openNow ? ' bad' : ''}`);
      append(c, el('b', null, v), el('span', null, l));
      chips.appendChild(c);
    }
    rb.appendChild(chips);
    const items = [...(rt.items || [])].sort((a, b) => b.redMinutes - a.redMinutes).slice(0, 6);
    if (items.length) {
      rb.appendChild(table('Longest red stretches', [
        { label: 'Repo' }, { label: 'Branch' }, { label: 'Red for', num: true }, { label: 'State' },
      ], items.map(i => [i.repo, el('code', null, i.branch), fmtMinutes(i.redMinutes), i.open ? el('span', 'mc-pill mc-pill-bad', 'still red') : 'fixed'])));
    }
  }
  row.appendChild(card('Red time', 'How long a PR branch stays red, from the first failed run to the next green one.', rb));
  s.appendChild(row);

  // CI table
  const ci = t.ci?.byRepo || [];
  s.appendChild(card('GitHub Actions', 'Run time is start to finish; queue is time waiting for a runner.',
    ci.length ? table('CI by repo and workflow', [
      { label: 'Repo' }, { label: 'Workflow' }, { label: 'Runs', num: true }, { label: 'Median', num: true },
      { label: fmtPercentileLabel('p90', 'finish'), title: percentileTip('p90'), num: true }, { label: 'Fail rate', num: true }, { label: 'Queue', num: true },
    ], ci.map(r => [r.repo, r.workflow, fmtNum(r.runs), fmtSeconds(r.medianSeconds), fmtSeconds(r.p90Seconds),
      r.failRate > 0.1 ? el('span', 'mc-pill mc-pill-bad', fmtPct(r.failRate)) : fmtPct(r.failRate), fmtSeconds(r.medianQueueSeconds)]))
      : empty('No CI runs collected. Add repos under metrics.repos in config.json, then refresh.')));
  return s;
}

// ---------- next up ----------

function renderNext(d) {
  const s = section('next', 'Next up', 'Ready tickets, best first: epic already in progress, lane order, priority, due date, age.');
  const list = d.next || [];
  if (!list.length) { s.appendChild(empty('Nothing is ready. Every to do ticket is blocked, a gate, or under a finished epic.')); return s; }
  const ol = el('ol', 'mc-next');
  list.forEach((n, i) => {
    const li = el('li', 'mc-next-item');
    const rank = el('span', 'mc-rank', String(i + 1));
    const main = el('div', 'mc-next-main');
    const line = el('div', 'mc-next-line');
    append(line, ticketLink(n.id), el('span', 'mc-next-title', n.title));
    main.appendChild(line);
    const meta = el('div', 'mc-next-meta');
    if (n.epicId) { append(meta, el('span', null, 'in '), ticketLink(n.epicId), el('span', null, n.epicTitle ? ` ${n.epicTitle}` : '')); }
    const where = [n.project, n.lane, n.priority].filter(Boolean).join(' · ');
    if (where) meta.appendChild(el('span', 'mc-next-where', where));
    main.appendChild(meta);
    const reasons = el('div', 'mc-reasons');
    for (const r of n.reasons || []) reasons.appendChild(el('span', 'mc-reason', r));
    append(li, rank, main, reasons);
    ol.appendChild(li);
  });
  s.appendChild(ol);
  return s;
}

function renderSources(d) {
  const src = d.sources || {};
  const p = el('p', 'mc-sources');
  p.id = 'mcH-sources'; // the contents row jumps here
  const parts = Object.entries(src).map(([k, v]) => `${k}: ${fmtNum(v.records)} records${v.newest ? `, newest ${ago(v.newest)}` : ''}`);
  p.textContent = parts.length ? `Data sources — ${parts.join(' · ')}` : '';
  return p;
}

// ---------- skeleton and render ----------

function skeleton() {
  const w = el('div', 'mc-skel-wrap');
  w.setAttribute('role', 'status');
  w.setAttribute('aria-label', 'Loading metrics');
  w.appendChild(el('div', 'mc-skel mc-skel-insights'));
  w.appendChild(el('div', 'mc-skel mc-skel-tiles'));
  w.appendChild(el('div', 'mc-skel mc-skel-block'));
  return w;
}

function sectionError(label) {
  const s = el('section', 'mc-section mc-section-error');
  s.setAttribute('role', 'status');
  s.appendChild(el('p', 'mc-empty', `${label} could not be drawn. The other sections are fine; reload if it stays.`));
  return s;
}

/** Builds the whole body off-screen; one throwing section shows a short message in its place. */
function buildBody() {
  const frag = document.createDocumentFragment();
  const note = view.collectNote;
  if (note) {
    const n = el('div', `mc-note ${note.ok ? 'ok' : 'bad'}`);
    n.setAttribute('role', 'status');
    const lines = el('div', 'mc-note-lines');
    append(lines, el('b', null, note.ok ? 'Data refreshed' : 'Refresh failed'));
    for (const l of note.lines || []) lines.appendChild(el('div', null, l));
    const close = el('button', 'mc-note-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', () => { view.collectNote = null; render(); });
    append(n, lines, close);
    frag.appendChild(n);
  }
  if (view.error && !view.data) {
    const e = el('div', 'mc-error');
    e.setAttribute('role', 'alert');
    append(e, el('b', null, 'Could not load metrics'), el('p', null, view.error));
    const retry = el('button', 'mc-refresh', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', load);
    e.appendChild(retry);
    frag.appendChild(e);
    return frag;
  }
  if (!view.data) { frag.appendChild(skeleton()); return frag; }
  if (view.error) {
    const e = el('div', 'mc-note bad');
    e.textContent = `Showing the last good data. ${view.error}`;
    frag.appendChild(e);
  }
  const d = view.data;
  append(frag, staleBanner(d, el));
  const costHelpers = { el, append, section, tile, table, ticketLink, empty, card };
  const parts = [
    ['Insights', () => renderInsights(d)],
    ['Headline numbers', () => renderHeadline(d)],
    ['Ticket flow', () => renderFlow(d)],
    ['Sessions', () => renderSessions(d)],
    ['Session health', () => renderHealth(d, costHelpers)],
    ['Backlog', () => renderBacklog(d, costHelpers)],
    ['Quality', () => renderQuality(d, costHelpers)],
    ['Cost', () => renderCost(d, costHelpers)],
    ['Build and CI', () => renderBuild(d)],
    ['Next up', () => renderNext(d)],
    ['Data sources', () => renderSources(d)],
  ];
  append(frag, buildNav(parts.map(([label]) => label), el));
  for (const [label, fn] of parts) append(frag, safe(label, fn, sectionError));
  return frag;
}

function render() {
  const root = document.getElementById('metricsMain');
  const body = root?.querySelector('#mcBody');
  if (!body) return;
  safe('Controls', paintState);
  // Build first, swap last: if building itself fails the old content stays on screen.
  const next = safe('Metrics page', buildBody);
  if (next) body.replaceChildren(next);
}

// ---------- entry points ----------

function build(root) {
  root.textContent = '';
  root.setAttribute('aria-live', 'off');
  root.appendChild(buildHeader());
  const body = el('div', 'mc-body');
  body.id = 'mcBody';
  root.appendChild(body);
  view.built = true;
}

/** Called each time the Metrics tab becomes active. */
export function onMetricsTabShow() {
  const root = document.getElementById('metricsMain');
  if (!root) return;
  if (!view.built) build(root);
  readUrl();
  view.loading = true;
  render();
  load();
  clearInterval(view.ticker);
  view.ticker = setInterval(() => {
    if (!document.getElementById('metricsPanel')?.classList.contains('active')) { clearInterval(view.ticker); return; }
    paintState();
  }, 30000);
}

/** Exposed for tests. */
export const _view = view;
