// metrics-charts.js — tiny dependency-free SVG charts for the Metrics tab.
// lineChart (time axis, multiple series, hollow points) and barChart (grouped or stacked,
// optional overlay line). Colours are CSS custom properties (theme aware); every chart has an
// accessible label, a hover tooltip and a visually hidden data table. Charts redraw at the
// real container width so text keeps its size (no viewBox scaling of type).
// Pure helpers (fmt*, niceTicks) are exported for tests and touch no DOM.

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- formatting helpers (no DOM) ----------

/** Hours -> "45 min", "6.5 h", "3.2 d". */
export function fmtHours(h) {
  if (h == null || !Number.isFinite(h)) return '–';
  const abs = Math.abs(h);
  if (h === 0) return '0';
  if (abs < 1 / 60) return '<1\u00a0min';
  if (abs < 1) return `${Math.round(h * 60)}\u00a0min`;
  if (abs < 48) return `${trim(h, abs < 10 ? 1 : 0)}\u00a0h`;
  return `${trim(h / 24, 1)}\u00a0d`;
}

/** Hours for sums that can get huge: like fmtHours, but 3 weeks and more read as "766 wk" (a sum of many stays). */
export function fmtTotalHours(h) {
  if (h == null || !Number.isFinite(h)) return '–';
  const weeks = Math.abs(h) / (24 * 7);
  if (weeks < 3) return fmtHours(h);
  return `${trim(h / (24 * 7), weeks < 10 ? 1 : 0)}\u00a0wk`;
}

/** Minutes -> "45 min", "1.8 h", "2.3 d". */
export function fmtMinutes(m) {
  if (m == null || !Number.isFinite(m)) return '–';
  return fmtHours(m / 60);
}

/** Seconds -> "42 s", "7 min 48 s" style compact ("7m 48s"), "1h 12m". */
export function fmtSeconds(sec) {
  if (sec == null || !Number.isFinite(sec)) return '–';
  const s = Math.round(sec);
  if (s < 60) return `${s}\u00a0s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem && m < 10 ? `${m}m\u00a0${rem}s` : `${m}\u00a0min`;
  }
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h\u00a0${mm}m` : `${h}\u00a0h`;
}

export function fmtPct(frac, digits = 0) {
  if (frac == null || !Number.isFinite(frac)) return '–';
  return `${(frac * 100).toFixed(digits)}%`;
}

export function fmtNum(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return '–';
  return Number(n.toFixed(digits)).toLocaleString('en-US');
}

/**
 * Plain-words header for a percentile, so no table or tile says a bare "p75" or "p90" (PRO87).
 * `key` is 'median' | 'p75' | 'p90'; `kind` picks the verb: 'cost' (cost this or less), 'leave'
 * (leave within), 'take' (take this long or less), 'finish' (finish within), 'use' (use this or fewer).
 * The statistical term stays available through percentileTip() for a hover tooltip.
 */
const PERCENTILE_TAIL = { cost: 'cost this or less', leave: 'leave within', take: 'take this long or less', finish: 'finish within', use: 'use this or fewer' };
export function fmtPercentileLabel(key, kind = 'cost') {
  if (key === 'median') return 'Typical (median)';
  const lead = key === 'p75' ? '3 in 4' : key === 'p90' ? '9 in 10' : null;
  if (!lead) return String(key);
  return `${lead} ${PERCENTILE_TAIL[kind] || PERCENTILE_TAIL.cost}`;
}

/** Tooltip text that keeps the technical term for those who want it. */
export function percentileTip(key) {
  if (key === 'median') return 'Median: half are below this, half above.';
  if (key === 'p75') return 'p75 (75th percentile): 3 in 4 are at or below this; a quarter are above it.';
  if (key === 'p90') return 'p90 (90th percentile): 9 in 10 are at or below this; one in ten is above it.';
  return '';
}

function trim(n, digits) {
  return String(Number(n.toFixed(digits)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ms or ISO string -> "Nov 3" (UTC-agnostic: uses local time of the instant). */
export function fmtDay(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** ms -> "Nov 7 14:30" (used when the whole axis spans under two days). */
export function fmtDayTime(v) {
  const d = new Date(v);
  return `${fmtDay(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Round-number ticks covering [min, max]; about `count` of them. */
export const SECOND_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 43200, 86400];
export const HOUR_STEPS = [0.25, 0.5, 1, 2, 3, 6, 12, 24, 48, 96, 168, 336, 720];

/** @param {number[]} [steps] allowed step sizes (e.g. SECOND_STEPS keeps ticks on whole minutes) */
export function niceTicks(min, max, count = 4, steps) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max === min) { max = min + 1; }
  const raw = (max - min) / Math.max(1, count);
  let step;
  if (steps) {
    step = steps.find(s => s >= raw) ?? steps[steps.length - 1];
  } else {
    const pow = 10 ** Math.floor(Math.log10(raw));
    const f = raw / pow;
    step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  }
  const out = [];
  const start = Math.floor(min / step) * step;
  for (let v = start; v <= max + step * 0.999; v += step) {
    out.push(Number(v.toPrecision(12)));
    if (out.length > 12) break;
    if (v >= max) break;
  }
  return out;
}

// ---------- DOM helpers ----------

function svgEl(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  if (text != null) n.textContent = text;
  return n;
}

function htmlEl(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

const M = { l: 46, r: 12, t: 10, b: 26 };

function legend(items) {
  const wrap = htmlEl('div', 'mc-legend');
  for (const it of items) {
    const li = htmlEl('span', 'mc-legend-item');
    const sw = htmlEl('span', `mc-swatch${it.kind === 'line' ? ' mc-swatch-line' : ''}`);
    sw.style.background = it.color;
    li.append(sw, document.createTextNode(it.name));
    wrap.appendChild(li);
  }
  return wrap;
}

function hiddenTable(title, head, rows) {
  const table = document.createElement('table');
  table.appendChild(htmlEl('caption', null, title));
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of head) { const th = htmlEl('th', null, h); th.scope = 'col'; hr.appendChild(th); }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const c of r) tr.appendChild(htmlEl('td', null, c));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  const box = htmlEl('div', 'mc-sr');
  box.appendChild(table);
  return box;
}

/**
 * Shared chart shell: wrapper, legend, svg host, tooltip, resize redraw.
 * `draw(width, ctx)` fills the svg and returns { hit(x,y) -> {x,y,lines:[...],title} | null }.
 */
function chartShell({ title, legendItems, height, table, draw, alwaysLegend }) {
  const wrap = htmlEl('figure', 'mc-chart');
  wrap.setAttribute('aria-label', title);
  if (legendItems?.length > 1 || (legendItems?.length === 1 && alwaysLegend)) {
    wrap.appendChild(legend(legendItems));
  }
  const host = htmlEl('div', 'mc-host');
  const tip = htmlEl('div', 'mc-tip');
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  wrap.append(host, tip, table);

  let lastW = 0;
  let hit = null;
  let guide = null;

  const render = () => {
    const w = Math.max(240, Math.round(host.clientWidth || 640));
    if (Math.abs(w - lastW) < 6 && lastW) return;
    lastW = w;
    host.textContent = '';
    const svg = svgEl('svg', {
      class: 'mc-svg', viewBox: `0 0 ${w} ${height}`, width: '100%', height,
      role: 'img', 'aria-label': title, preserveAspectRatio: 'xMinYMid meet',
    });
    svg.appendChild(svgEl('title', {}, title));
    const res = draw(w, svg);
    hit = res?.hit || null;
    guide = svgEl('g', { class: 'mc-guide' });
    svg.appendChild(guide);
    host.appendChild(svg);
    svg.addEventListener('pointermove', (e) => {
      if (!hit) return;
      const rect = svg.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (w / rect.width);
      const py = (e.clientY - rect.top) * (height / rect.height);
      const h = hit(px, py);
      guide.textContent = '';
      if (!h) { tip.hidden = true; return; }
      if (h.guide) guide.appendChild(h.guide);
      tip.textContent = '';
      tip.appendChild(htmlEl('div', 'mc-tip-title', h.title));
      for (const l of h.lines) {
        const row = htmlEl('div', 'mc-tip-row');
        if (l.color) {
          const sw = htmlEl('span', 'mc-swatch');
          sw.style.background = l.color;
          row.appendChild(sw);
        }
        row.appendChild(htmlEl('span', 'mc-tip-name', l.name));
        row.appendChild(htmlEl('b', null, l.value));
        tip.appendChild(row);
      }
      tip.hidden = false;
      const sx = h.x * (rect.width / w);
      const tw = tip.offsetWidth;
      const left = sx + 14 + tw > host.clientWidth ? Math.max(0, sx - tw - 14) : sx + 14;
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, (h.y * (rect.height / height)) - 8)}px`;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; guide.textContent = ''; });
  };

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => render()).observe(host);
  }
  // First paint is synchronous when attached later; the observer covers detached builds.
  wrap.redraw = () => { lastW = 0; render(); };
  queueMicrotask(() => { if (wrap.isConnected) render(); });
  requestAnimationFrame(() => { if (!lastW) render(); });
  return wrap;
}

function axes(svg, w, h, yTicks, yFmt, yScale) {
  const g = svgEl('g', { class: 'mc-axis' });
  for (const t of yTicks) {
    const y = yScale(t);
    g.appendChild(svgEl('line', { x1: M.l, x2: w - M.r, y1: y, y2: y, class: 'mc-grid' }));
    g.appendChild(svgEl('text', { x: M.l - 8, y: y + 4, 'text-anchor': 'end', class: 'mc-tick' }, yFmt(t)));
  }
  g.appendChild(svgEl('line', { x1: M.l, x2: w - M.r, y1: h - M.b, y2: h - M.b, class: 'mc-baseline' }));
  svg.appendChild(g);
}

// ---------- line chart ----------

/**
 * @param {{title:string, series:{name:string,color:string,dashed?:boolean,points:{x:number,y:number,hollow?:boolean,note?:string}[]}[],
 *   yFormat?:(n:number)=>string, xFormat?:(n:number)=>string, yMax?:number, height?:number, area?:boolean}} o
 */
export function lineChart(o) {
  const { title, height = 200 } = o;
  const yFormat = o.yFormat || ((n) => fmtNum(n, 1));
  const xFormat = o.xFormat || fmtDay;
  const series = o.series.map(dailyize);
  const all = series.flatMap(s => s.points);
  const xs = all.map(p => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yTop = o.yMax ?? Math.max(...all.flatMap(p => [p.y, ...(p.failedPts || []).map(f => f.y)]), 1);
  const ticks = niceTicks(0, yTop, 4, o.tickSteps);
  const yHi = ticks[ticks.length - 1];

  const table = hiddenTable(title, ['Series', 'When', 'Value'],
    series.flatMap(s => s.points.map(p => [s.name, xFormat(p.x),
      yFormat(p.y) + (p.n ? ` (median of ${p.n} runs, ${p.fails} failed)` : '') + (p.hollow ? ' (failed)' : '')])));

  return chartShell({
    title, height, table, alwaysLegend: o.legend,
    legendItems: series.map(s => ({ name: s.name, color: s.color, kind: 'line' })),
    draw(w, svg) {
      const pw = w - M.l - M.r;
      const ph = height - M.t - M.b;
      const sx = (x) => M.l + (xMax === xMin ? pw / 2 : ((x - xMin) / (xMax - xMin)) * pw);
      const sy = (y) => M.t + ph - (y / yHi) * ph;
      axes(svg, w, height, ticks, yFormat, sy);
      // x ticks: chosen by width (>= ~70px apart, 96px when labels carry a time), no repeated labels;
      // times only when the whole window is at most two days.
      const shortSpan = xMax - xMin <= 2 * 864e5 && xFormat === fmtDay;
      const pitch = shortSpan ? 96 : 70;
      const n = Math.max(2, Math.min(8, Math.floor(pw / pitch)));
      const tickFmt = (x) => (shortSpan ? fmtDayTime(x) : xFormat(x));
      const seen = new Set();
      for (let i = 0; i < n; i++) {
        const x = xMin + ((xMax - xMin) * i) / (n - 1);
        const label = tickFmt(x);
        if (seen.has(label)) continue;
        seen.add(label);
        const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        svg.appendChild(svgEl('text', { x: sx(x), y: height - 8, 'text-anchor': anchor, class: 'mc-tick' }, label));
      }
      const pts = [];
      series.forEach((s) => {
        const sorted = [...s.points].sort((a, b) => a.x - b.x);
        if (sorted.length > 1) {
          const d = sorted.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
          if (o.area && series[0] === s) {
            svg.appendChild(svgEl('path', {
              d: `${d} L${sx(sorted[sorted.length - 1].x)} ${sy(0)} L${sx(sorted[0].x)} ${sy(0)} Z`,
              fill: s.color, opacity: 0.1,
            }));
          }
          svg.appendChild(svgEl('path', {
            d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round',
            'stroke-linecap': 'round', 'stroke-dasharray': s.dashed ? '5 4' : null, class: 'mc-line',
          }));
        }
        const small = sorted.length <= 14;
        for (const p of sorted) {
          pts.push({ s, p, cx: sx(p.x), cy: sy(p.y) });
          if (p.hollow) {
            svg.appendChild(svgEl('circle', { cx: sx(p.x), cy: sy(p.y), r: 4, class: 'mc-hollow' }));
          } else if (small || sorted.length < 40) {
            svg.appendChild(svgEl('circle', { cx: sx(p.x), cy: sy(p.y), r: small ? 3 : 2, fill: s.color }));
          }
          if (p.fails > 0) {
            if (p.fails <= 3) {
              for (const f of p.failedPts) svg.appendChild(svgEl('circle', { cx: sx(p.x), cy: sy(f.y), r: 3, class: 'mc-hollow' }));
            } else {
              const by = Math.max(M.t + 8, sy(p.y) - 12);
              svg.appendChild(svgEl('circle', { cx: sx(p.x), cy: by, r: 7, class: 'mc-badge' }));
              svg.appendChild(svgEl('text', { x: sx(p.x), y: by + 3.5, 'text-anchor': 'middle', class: 'mc-badge-text' }, String(p.fails)));
            }
          }
        }
      });
      return {
        hit(px, py) {
          let best = null; let bd = Infinity;
          for (const q of pts) {
            const d = (q.cx - px) ** 2 + ((q.cy - py) * 0.5) ** 2;
            if (d < bd) { bd = d; best = q; }
          }
          if (!best || bd > 50 * 50) return null;
          const dot = svgEl('circle', { cx: best.cx, cy: best.cy, r: 5, fill: 'none', stroke: best.s.color, 'stroke-width': 2 });
          if (best.p.n) {
            return {
              x: best.cx, y: best.cy, guide: dot, title: xFormat(best.p.x),
              lines: [
                { name: `${best.s.name} median`, color: best.s.color, value: yFormat(best.p.y) },
                { name: 'Runs that day', value: String(best.p.n) },
                { name: 'Failed', value: String(best.p.fails) },
              ],
            };
          }
          const same = pts.filter(q => q.p.x === best.p.x && !q.p.n);
          return {
            x: best.cx, y: best.cy, guide: dot, title: xFormat(best.p.x),
            lines: same.map(q => ({ name: q.s.name + (q.p.hollow ? ' (failed)' : ''), color: q.s.color, value: yFormat(q.p.y) })),
          };
        },
      };
    },
  });
}

const DENSE_POINTS = 60;

/** More than ~60 points: one point per local day (median of passing runs, else of all runs). */
function dailyize(s) {
  if (s.points.length <= DENSE_POINTS) return s;
  const days = new Map();
  for (const p of s.points) {
    const d = new Date(p.x);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(p);
  }
  const med = (a) => { const v = a.map(p => p.y).sort((x, y) => x - y); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const points = [...days.entries()].sort((a, b) => a[0] - b[0]).map(([x, list]) => {
    const failed = list.filter(p => p.hollow);
    const passing = list.filter(p => !p.hollow);
    return { x, y: med(passing.length ? passing : list), n: list.length, fails: failed.length, failedPts: failed };
  });
  return { ...s, points };
}

// ---------- bar chart ----------

/**
 * @param {{title:string, categories:string[], series:{name:string,color:string,values:number[]}[],
 *   mode?:'grouped'|'stacked', line?:{name:string,color:string,values:number[]}, yFormat?:(n:number)=>string,
 *   height?:number}} o
 */
export function barChart(o) {
  const { title, categories, series, mode = 'grouped', yFormat = (n) => fmtNum(n, 0), height = 200 } = o;
  const line = o.line || null;
  const stackTotals = categories.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const maxVal = mode === 'stacked'
    ? Math.max(...stackTotals, 1)
    : Math.max(...series.flatMap(s => s.values), ...(line ? line.values : []), 1);
  const yTop = Math.max(maxVal, ...(line ? line.values : [0]));
  const ticks = niceTicks(0, o.yMax ?? yTop, 4, o.tickSteps);
  const yHi = ticks[ticks.length - 1];

  const all = line ? [...series, line] : series;
  const table = hiddenTable(title, ['Category', ...all.map(s => s.name)],
    categories.map((c, i) => [c, ...all.map(s => yFormat(s.values[i] ?? 0))]));

  return chartShell({
    title, height, table,
    legendItems: all.map(s => ({ name: s.name, color: s.color, kind: s === line ? 'line' : 'bar' })),
    draw(w, svg) {
      const pw = w - M.l - M.r;
      const ph = height - M.t - M.b;
      const band = pw / categories.length;
      const sy = (y) => M.t + ph - (y / yHi) * ph;
      axes(svg, w, height, ticks, yFormat, sy);
      const groupW = Math.min(band * 0.72, 64);
      const barW = mode === 'stacked' ? groupW : groupW / series.length;
      const step = Math.max(1, Math.ceil(categories.length / Math.max(2, Math.floor(pw / 56))));
      categories.forEach((c, i) => {
        const cx = M.l + band * i + band / 2;
        const x0 = cx - groupW / 2;
        let acc = 0;
        series.forEach((s, si) => {
          const v = s.values[i] || 0;
          const h = (v / yHi) * ph;
          if (mode === 'stacked') {
            svg.appendChild(svgEl('rect', { x: x0, y: sy(acc + v), width: barW, height: h, fill: s.color, rx: 2 }));
            acc += v;
          } else {
            svg.appendChild(svgEl('rect', { x: x0 + si * barW + 1, y: sy(v), width: Math.max(1, barW - 2), height: h, fill: s.color, rx: 2 }));
          }
        });
        if (i % step === 0) {
          svg.appendChild(svgEl('text', { x: cx, y: height - 8, 'text-anchor': 'middle', class: 'mc-tick' }, c));
        }
      });
      if (line) {
        const d = line.values.map((v, i) => `${i ? 'L' : 'M'}${(M.l + band * i + band / 2).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
        svg.appendChild(svgEl('path', { d, fill: 'none', stroke: line.color, 'stroke-width': 2, 'stroke-linejoin': 'round', class: 'mc-line' }));
        line.values.forEach((v, i) => svg.appendChild(svgEl('circle', { cx: M.l + band * i + band / 2, cy: sy(v), r: 3, fill: line.color })));
      }
      return {
        hit(px) {
          const i = Math.floor((px - M.l) / band);
          if (i < 0 || i >= categories.length) return null;
          const cx = M.l + band * i + band / 2;
          const guide = svgEl('rect', { x: M.l + band * i, y: M.t, width: band, height: ph, class: 'mc-hover-band' });
          return {
            x: cx, y: M.t + 10, guide, title: categories[i],
            lines: all.map(s => ({ name: s.name, color: s.color, value: yFormat(s.values[i] ?? 0) })),
          };
        },
      };
    },
  });
}
