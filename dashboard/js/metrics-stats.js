// metrics-stats.js — small pure helpers the Metrics headline tiles share (moved out of metrics-view.js, PRO87).
// No DOM here; metrics-view.js imports them.

export const ms = (s) => new Date(s).getTime();
export const median = (arr) => {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};


export function pctChange(now, prev) {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  return ((now - prev) / prev) * 100;
}

/** delta: { text, good: true|false|null } */
export function pctDelta(now, prev, lowerIsBetter, label = 'vs last week') {
  const p = pctChange(now, prev);
  if (p == null) return null;
  const r = Math.round(p);
  if (r === 0) return { text: `≈ flat ${label}`, good: null };
  return { text: `${r > 0 ? '▲' : '▼'} ${Math.abs(r)}% ${label}`, good: (r < 0) === lowerIsBetter };
}

/** Median of passing (ok) runs; last 7 days against the 7 before for the delta. */
export function passingStats(points) {
  const ok = points.filter(p => p.ok);
  const t = Date.now();
  const recent = ok.filter(p => ms(p.at) >= t - 7 * 864e5).map(p => p.seconds);
  const prior = ok.filter(p => ms(p.at) < t - 7 * 864e5 && ms(p.at) >= t - 14 * 864e5).map(p => p.seconds);
  const value = median(ok.map(p => p.seconds));
  const r = median(recent); const pr = median(prior);
  return { value, n: ok.length, delta: recent.length >= 3 && prior.length >= 3 && r != null && pr != null ? pctDelta(r, pr, true, 'vs prior week') : null };
}

/** Local gate time: passing gate runs; builds when there are no gate runs. */
export function gateStats(d) {
  const series = d.timings?.series || [];
  for (const kind of ['gate', 'build']) {
    const pts = series.filter(s => s.kind === kind && s.host !== 'ci').flatMap(s => s.points);
    const st = passingStats(pts);
    if (st.n) return { ...st, kind };
  }
  return { value: null, n: 0, delta: null, kind: 'gate' };
}

