/**
 * shared/health-metrics.js (pure): the Session health block and the backlog trend of the Metrics tab.
 * One definition each, no overlap: every session lands in exactly one status.
 *   stuck  = at least one missed wake-up (a 20+ min silence that nothing answered)
 *   silent = not stuck, but a model stall or a long tool/permission wait
 *   asked  = only mid-run questions to you
 *   clean  = none of the above
 * Spec: docs/metrics.md "Session health" and "Backlog".
 */
const DAY = 24 * 3600 * 1000;
const iso = ms => new Date(ms).toISOString();
const mondayMs = ms => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY;
};
const add = (acc, obj) => { for (const [k, v] of Object.entries(obj || {})) acc[k] = (acc[k] || 0) + v; };

/** Where the stuck-session kinds and their guards are written (a different repo: plain text, not a link). */
export const STUCK_DOCS = 'docs/agent-notes/stuck-sessions.md';

export const isStuck = s => s.missedWakes > 0;
export const isSilent = s => !isStuck(s) && (s.stalls > 0 || s.toolWaits > 0);
export const isAsked = s => !isStuck(s) && !isSilent(s) && s.questionsMidRun > 0;
/** The one status of a session: stuck, silent, asked or clean. */
export function statusOf(s) {
  return isStuck(s) ? 'stuck' : isSilent(s) ? 'silent' : isAsked(s) ? 'asked' : 'clean';
}

const CAUSE_LABELS = {
  'usage-limit': 'usage limit', 'idle-sweep': 'idle sweep', 'app-quit': 'app quit', 'app-update': 'app update',
  'rate-limit': 'rate limit', network: 'network', keypress: 'Escape keypress', 'mac-sleep': 'Mac slept',
  auth: 'not logged in', archived: 'archived on purpose', 'api-error': 'API error', 'app-closed': 'app closed',
  interrupt: 'interrupted by you', unknown: 'no cause found',
};
export const causeLabel = k => CAUSE_LABELS[k] || k;

function counts(list) {
  const c = { stuck: 0, silent: 0, asked: 0, clean: 0 };
  for (const s of list) c[statusOf(s)]++;
  return c;
}
const share = (c, n) => (n ? Math.round((c.clean / n) * 1000) / 1000 : null);
const sumOf = (list, f) => list.reduce((a, s) => a + (Number(f(s)) || 0), 0);

/**
 * @param {object[]} list sessions in the window
 * @param {number} sinceMs @param {number} untilMs
 */
export function healthBlock(list, sinceMs, untilMs) {
  const n = list.length;
  const status = counts(list);
  const origins = {};
  const causes = {};
  const toolWaitTools = {};
  const unknownByWake = {};
  for (const s of list) {
    add(origins, s.missedWakeOrigins);
    add(causes, s.missedWakeCauses);
    add(toolWaitTools, s.toolWaitTools);
    add(unknownByWake, s.missedWakeUnknownBy);
  }
  const midTurnStops = origins['tool-result'] || 0;
  const unanswered = { ...origins };
  delete unanswered['tool-result'];
  const unansweredTotal = Object.values(unanswered).reduce((a, b) => a + b, 0);
  const unknownTotal = causes.unknown || 0;
  const recorded = Object.values(unknownByWake).reduce((a, b) => a + b, 0);
  if (unknownTotal > recorded) unknownByWake['not recorded'] = unknownTotal - recorded;

  const weeks = new Map();
  for (let w = mondayMs(sinceMs); w <= untilMs; w += 7 * DAY) weeks.set(w, []);
  for (const s of list) weeks.get(mondayMs(Date.parse(s.start)))?.push(s);
  const byWeek = [...weeks].map(([w, l]) => {
    const c = counts(l);
    return {
      week: iso(w).slice(0, 10), n: l.length, ...c, cleanShare: share(c, l.length),
      midTurnStops: sumOf(l, s => (s.missedWakeOrigins || {})['tool-result']),
      unknown: sumOf(l, s => (s.missedWakeCauses || {}).unknown),
    };
  });

  const topCause = Object.entries(causes).filter(([k]) => k !== 'unknown').sort((a, b) => b[1] - a[1])[0];
  const topTool = Object.entries(toolWaitTools).sort((a, b) => b[1] - a[1])[0];
  const stalls = sumOf(list, s => s.stalls);
  const toolWaits = sumOf(list, s => s.toolWaits);
  const unknownShare = midTurnStops ? Math.round((unknownTotal / midTurnStops) * 1000) / 1000 : null;

  const actions = {
    stuck: status.stuck
      ? (topCause
        ? `Fix the biggest known cause first: ${causeLabel(topCause[0])} (${topCause[1]}). Stuck kinds and their guards: ${STUCK_DOCS} in the suite repo.`
        : `No known cause yet: ${STUCK_DOCS} in the suite repo lists the stuck kinds and their guards.`)
      : 'No stuck sessions in this range.',
    unknown: unknownTotal
      ? (unknownShare >= 0.5
        ? `Most mid-turn stops have no cause (${unknownTotal} of ${midTurnStops}): record the cause when it is known (the stop-causes log) before fixing anything else.`
        : `${unknownTotal} of ${midTurnStops} mid-turn stops have no cause: look at the ones woken by the same origin first.`)
      : 'Every mid-turn stop has a cause.',
    silent: status.silent
      ? (topTool
        ? `Mostly ${topTool[0]} waits: give those calls a timeout or run them in the background so a session never sits on one.`
        : 'Model silences: check for API errors around the time and restart the session instead of waiting.')
      : 'No silent sessions in this range.',
    clean: n === 0 ? 'No sessions in this range.'
      : status.clean < n * 0.5
        ? 'Fewer than half the sessions ran clean: start with the stuck ones, then the silent ones.'
        : 'Most sessions ran clean: only the stuck ones need a fix.',
  };

  return {
    n, status, cleanShare: share(status, n),
    events: { midTurnStops, unanswered, unansweredTotal, stalls, toolWaits, toolWaitTools, questionsMidRun: sumOf(list, s => s.questionsMidRun), helperWaits: sumOf(list, s => s.helperWaits) },
    causes,
    unknown: { total: unknownTotal, ofStops: midTurnStops, share: unknownShare, byWake: unknownByWake, byWeek: byWeek.map(w => ({ week: w.week, n: w.unknown })) },
    byWeek, actions, docs: STUCK_DOCS,
  };
}

/**
 * Backlog trend: created vs shipped per week (the last, still running week is left out of the streak),
 * closed without work, and a hint when created > shipped for 3 weeks in a row.
 * @param {{week:string,created:number,shipped:number}[]} weeks flow.throughputByWeek
 */
export function backlogBlock(weeks, base, { closedWithoutWork = 0, untilMs } = {}) {
  const rows = (weeks || []).map(w => ({ week: w.week, created: w.created || 0, shipped: w.shipped || 0 }));
  const done = rows.filter(r => untilMs === undefined || Date.parse(r.week) + 7 * DAY <= untilMs);
  let streak = 0;
  for (let i = done.length - 1; i >= 0 && done[i].created > done[i].shipped; i--) streak++;
  const created = rows.reduce((a, r) => a + r.created, 0);
  const shipped = rows.reduce((a, r) => a + r.shipped, 0);
  const over = streak >= 3;
  return {
    ...base, byWeek: rows, created, shipped, closedWithoutWork, weeksOver: streak, over,
    action: over
      ? `More tickets were opened than shipped for ${streak} weeks in a row: stop opening small tickets and close the cheap ones first.`
      : 'Created and shipped are in step: no action.',
  };
}
