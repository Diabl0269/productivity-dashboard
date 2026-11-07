/**
 * shared/ci-metrics.js (pure)
 *   redTime(runs, prs?) -> [{repo, branch, redMinutes, start, end, open, endedBy?}]
 *   trend(records, {now, days}) -> [{repo, kind, name, recentMedian, priorMedian, changePct, ...}]
 */

/** A cancelled or skipped run is neither a pass nor a failure: it never counts toward fail rate, red time or duration. */
export function isUncounted(r) {
  return r?.conclusion === 'cancelled' || r?.conclusion === 'skipped';
}

/** A run that passed on a later attempt (attempt > 1, success): the first attempt failed for a flaky reason. */
export function isFlakyRerun(r) {
  return r?.conclusion === 'success' && Number(r.attempt) > 1;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function span(r, start, end, open, endedBy) {
  return {
    repo: r.repo, branch: r.branch,
    redMinutes: Math.max(0, Math.round(((Date.parse(end) - Date.parse(start)) / 60000) * 10) / 10),
    start, end, open,
    ...(endedBy ? { endedBy } : {}),
  };
}

/** The latest PR for repo+branch that merged or closed after `start` (ISO), or null. `prs` are kind 'pr' timing records. */
function closingPr(prs, repo, branch, start) {
  let best = null;
  for (const p of prs) {
    if (p.repo !== repo || p.branch !== branch) continue;
    const end = p.mergedAt || p.closedAt;
    if (!end || !(Date.parse(end) > Date.parse(start))) continue;
    if (!best || Date.parse(end) > Date.parse(best.end)) best = { end, endedBy: p.mergedAt ? 'merged' : 'closed' };
  }
  return best;
}

/**
 * Per repo+branch: from the first failed run to the next success on that branch.
 * A still-failing branch gives an open span ending at its last run, unless the branch's PR merged or
 * closed after the span started: then the span ends there (`open: false`, `endedBy: 'merged'|'closed'`).
 * `runs` are timing records ({repo, branch, at, ok}); `at` is when the run started. `prs` are optional
 * kind 'pr' records ({repo, branch, mergedAt, closedAt}).
 */
export function redTime(runs, prs = []) {
  const groups = new Map();
  for (const r of runs || []) {
    if (r.ok == null || isUncounted(r) || !r.at || !r.branch) continue;
    const k = `${r.repo}\u0000${r.branch}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let redStart = null;
    for (const r of list) {
      if (!r.ok) {
        if (!redStart) redStart = r.at;
      } else if (redStart) {
        out.push(span(r, redStart, r.at, false));
        redStart = null;
      }
    }
    if (redStart) {
      const pr = closingPr(prs || [], list[0].repo, list[0].branch, redStart);
      out.push(pr ? span(list[0], redStart, pr.end, false, pr.endedBy) : span(list[0], redStart, list[list.length - 1].at, true));
    }
  }
  return out;
}

/** Median of the last `days` days vs the `days` before, per (repo, kind, name). */
export function trend(records, { now = Date.now(), days = 7 } = {}) {
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  const win = days * 86400000;
  const groups = new Map();
  for (const r of records || []) {
    if (!Number.isFinite(r.seconds) || !r.at || isUncounted(r)) continue;
    const age = nowMs - Date.parse(r.at);
    if (!(age >= 0) || age >= 2 * win) continue;
    const k = JSON.stringify([r.repo ?? null, r.kind ?? null, r.name ?? null]);
    if (!groups.has(k)) groups.set(k, { recent: [], prior: [] });
    groups.get(k)[age < win ? 'recent' : 'prior'].push(r.seconds);
  }
  const out = [];
  for (const [k, g] of groups) {
    const [repo, kind, name] = JSON.parse(k);
    const recentMedian = median(g.recent), priorMedian = median(g.prior);
    const changePct = recentMedian != null && priorMedian
      ? Math.round(((recentMedian - priorMedian) / priorMedian) * 1000) / 10 : null;
    out.push({ repo, kind, name, recentMedian, priorMedian, changePct, recentCount: g.recent.length, priorCount: g.prior.length });
  }
  return out;
}
