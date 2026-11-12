/**
 * shared/insights.js (pure): plain-English findings from a metrics payload (without `insights`).
 * Each rule yields {kind, title, detail, value?}; the list is sorted by importance and capped.
 * Kinds: bottleneck | slower | faster | warn | good | info | missing.
 */

const MAX_INSIGHTS = 10;
const STAGE_LABEL = { 'in-progress': 'Building', review: 'Review', todo: 'Waiting to start' };

import { causeLabel } from './health-metrics.js';

const round1 = n => Math.round(n * 10) / 10;
const pct = x => Math.round(x * 100);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Hours as "40 min", "3.4 h" or "3.0 days". */
export function fmtHours(h) {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${round1(h).toFixed(1)} h`;
  return `${round1(h / 24).toFixed(1)} days`;
}

/** Two second values in one shared unit: "7.0 → 8.5 min". */
function fmtSecondsPair(a, b) {
  const big = Math.max(a, b);
  const [div, unit] = big < 90 ? [1, 's'] : big < 5400 ? [60, 'min'] : [3600, 'h'];
  return `${round1(a / div).toFixed(1)} → ${round1(b / div).toFixed(1)} ${unit}`;
}
const fmtMinutes = m => (m < 90 ? `${Math.round(m)} min` : fmtHours(m / 60));

/** Where in-progress time went: skipped without session or CI data (everything would read as "nobody working on it"). */
function splitRule(sp, out) {
  const t = sp?.total;
  if (!t || !(t.hours >= 1) || !(t.workingH + t.ciH + t.youH > 0)) return;
  const ty = sp.typical;
  if (ty && ty.n > 0) {
    const s = ty.shares;
    const bits = [['working', s.working], ['CI', s.ci], ['waiting on you', s.you], ['waiting its turn', s.waiting], ['left in progress', s.left]].filter(([, v]) => v != null)
      .map(([k, v]) => `${k} ${pct(v || 0)}%`).join(', ');
    const top = sp.byTicket?.[0];
    out.push({
      weight: 75, kind: (s.idle || 0) >= 0.5 ? 'warn' : 'info', value: s.idle,
      title: `Average ticket: idle ${pct(s.idle || 0)}% of its time in progress`,
      detail: `Average ticket (average share over ${plural(ty.n, 'ticket')} that left in progress in the window): ${bits}. `
        + `All in-progress hours: working ${fmtHours(t.workingH)}, CI ${fmtHours(t.ciH)}, waiting on you ${fmtHours(t.youH)}, waiting its turn ${fmtHours(t.waitingH || 0)}, left in progress ${fmtHours(t.leftH || 0)} (idle ${pct(t.shares?.idle || 0)}% in all); `
        + `forgotten stays (in progress over 72 h, no session work) are left out.`
        + (top && top.idleH > 0 ? ` Most idle: ${top.ticket} (${fmtHours(top.idleH)}).` : ''),
    });
    return;
  }
  const sh = t.shares || {};
  const idle = pct(sh.idle || 0);
  const parts = [
    ['working', t.workingH, sh.working], ['waiting on CI', t.ciH, sh.ci], ['waiting on you', t.youH, sh.you],
  ];
  const big = parts.slice().sort((a, b) => b[1] - a[1])[0];
  const notes = [];
  if (big[1] > 0) notes.push(`The biggest part besides that is ${big[0]}: ${fmtHours(big[1])} (${pct(big[2] || 0)}%).`);
  if (t.workingH < t.ciH) notes.push('Waiting on CI is longer than the sessions spent working.');
  const top = sp.byTicket?.[0];
  out.push({
    weight: 75, kind: sh.idle >= 0.5 ? 'warn' : 'info', value: sh.idle,
    title: `Idle ${idle}% of in-progress time`,
    detail: `Of ${fmtHours(t.hours)} tickets spent in progress: working ${fmtHours(t.workingH)}, waiting on CI ${fmtHours(t.ciH)}, waiting on you ${fmtHours(t.youH)}, waiting its turn ${fmtHours(t.waitingH || 0)}, left in progress ${fmtHours(t.leftH || 0)} (idle ${idle}%). ${notes.join(' ')}`
      + (top && top.idleH > 0 ? ` Most idle: ${top.ticket} (${fmtHours(top.idleH)}).` : ''),
  });
}

function flowRules(flow, out) {
  if (!flow) return;
  const b = flow.bottleneck;
  if (b) {
    const label = STAGE_LABEL[b.stage] || b.stage;
    const others = Object.entries(flow.groups?.project || {})
      .filter(([, g]) => g.bottleneck && g.bottleneck.stage !== b.stage)
      .map(([slug, g]) => `${slug}: ${STAGE_LABEL[g.bottleneck.stage] || g.bottleneck.stage}`);
    const otherStage = b.stage === 'review' ? 'in-progress' : 'review';
    const otherMed = flow.stages?.[otherStage]?.median;
    const phrase = st => (st === 'review' ? 'in review' : 'building');
    const typical = b.medianHours;
    const diff = others.length ? ` Different in: ${others.join(', ')}.` : '';
    if (typical != null && otherMed != null) {
      out.push({
        weight: 100, kind: 'bottleneck', value: b.share,
        title: `${label} is the slowest step: typically ${fmtHours(typical)} vs ${fmtHours(otherMed)} ${phrase(otherStage)}`,
        detail: `${label} is the slowest step: a typical ticket ${b.stage === 'review' ? 'waits' : 'spends'} ${fmtHours(typical)} ${b.stage === 'review' ? 'there' : 'building'} vs ${fmtHours(otherMed)} ${phrase(otherStage)} (median closed stay). In total ${label.toLowerCase()} holds ${pct(b.share)}% of the work time (${fmtHours(b.totalHours)}).${diff}`,
      });
    } else {
      out.push({
        weight: 100, kind: 'bottleneck', value: b.share,
        title: `${label} is the slowest step${typical != null ? `: typically ${fmtHours(typical)}` : ''}`,
        detail: `${fmtHours(b.totalHours)} of the time tickets spend building or in review is ${label.toLowerCase()} (${pct(b.share)}%).${diff}`,
      });
    }
  }
  const wait = flow.stages?.todo?.median;
  const build = flow.stages?.['in-progress']?.median;
  if (wait != null && build != null) {
    out.push({
      weight: 80, kind: wait >= 24 && wait > build * 2 ? 'warn' : 'info', value: wait,
      title: `Tickets wait ${fmtHours(wait)} before work starts; building takes ${fmtHours(build)}`,
      detail: 'Median time in To do versus in progress, for tickets that finished in the window.',
    });
  }
  splitRule(flow.inProgressSplit, out);
  const growth = flow.backlog?.growthPerWeek;
  if (typeof growth === 'number' && Math.abs(growth) >= 1) {
    const grows = growth > 0;
    const weeks = flow.throughputByWeek || [];
    const avg = k => (weeks.length ? round1(weeks.reduce((a, w) => a + (w[k] || 0), 0) / weeks.length) : null);
    const cz = weeks.length ? ` (created ${avg('created')}, closed ${avg('closed')})` : '';
    out.push({
      weight: 60, kind: grows ? 'warn' : 'good', value: growth,
      title: `The backlog ${grows ? 'grows' : 'shrinks'} by ${plural(round1(Math.abs(growth)), 'ticket')} a week${cz}`,
      detail: `${flow.backlog.openTodo} open in To do; tickets created minus tickets closed (shipped, closed without work or archived), averaged per week.`,
    });
  }
  // Review wait is shown once on the Metrics tab (the "Review wait" tile: epic cards, median, p90, waiting now).
  // The finding here is the other question: how long until finished work is first looked at.
  const rr = flow.reviewWait?.readyToReviewed;
  if (rr && rr.n > 0) {
    const waiting = rr.waiting > 0 ? ` ${plural(rr.waiting, 'card')} still waiting for a first look.` : '';
    out.push({
      weight: 90, kind: (rr.median ?? 0) >= 24 || (rr.p90 ?? 0) >= 72 ? 'warn' : 'info', value: rr.median,
      title: `First look at finished work: median ${fmtHours(rr.median)}, p90 ${fmtHours(rr.p90)}`,
      detail: `From moving to Review until the card moves again or a review note is written, over ${plural(rr.n, 'card')}.${waiting} When this is high, review the oldest cards first or batch the checks.`,
    });
  }
  const fe = flow.forgottenEpics || [];
  if (fe.length) {
    out.push({
      weight: 70, kind: 'warn', value: fe.length,
      title: `${plural(fe.length, 'epic')} in progress with no activity`,
      detail: fe.slice(0, 3).map(e => `${e.id} idle ${round1(e.idleDays)} days`).join(', ') + (fe.length > 3 ? ` and ${fe.length - 3} more` : '') + '.',
    });
  }
  const st = flow.staleTickets || [];
  if (st.length) {
    const days = flow.staleDays ?? 3;
    out.push({
      weight: 68, kind: 'warn', value: st.length,
      title: `${plural(st.length, 'ticket')} in progress with no activity for ${days}+ days`,
      detail: st.slice(0, 4).map(t => `${t.id} idle ${round1(t.idleDays)} days`).join(', ') + (st.length > 4 ? ` and ${st.length - 4} more` : '') + '.',
    });
  }
}

/** The one session-health finding (stuck, silent, asked, clean: shared/health-metrics.js) with its action line. */
function healthRule(h, out) {
  if (!h || !h.n) return;
  const st = h.status;
  const weeks = (h.byWeek || []).filter(w => w.n > 0 && w.cleanShare != null);
  let change = '';
  let dropped = false;
  if (weeks.length >= 2) {
    const [prev, last] = weeks.slice(-2);
    const d = pct(last.cleanShare) - pct(prev.cleanShare);
    if (d !== 0) change = ` Clean share ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} points from the week before.`;
    dropped = d <= -10;
  }
  const share = pct(h.cleanShare ?? 0);
  const e = h.events;
  const cz = Object.entries(h.causes || {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${causeLabel(k)}`);
  const stops = e.midTurnStops ? ` The ${plural(e.midTurnStops, 'mid-turn stop')}: ${cz.join(', ')}.` : '';
  const tools = Object.entries(e.toolWaitTools || {}).sort((a, b) => b[1] - a[1]);
  out.push({
    weight: st.stuck ? 95 : 75, kind: st.stuck || dropped || share < 50 ? 'warn' : share >= 70 ? 'good' : 'info', value: h.cleanShare,
    title: `${st.clean} of ${plural(h.n, 'session')} ran clean; ${st.stuck} stuck, ${st.silent} silent`,
    detail: `Stuck: ${plural(st.stuck, 'session')} with a 20+ min silence nothing answered (${e.midTurnStops} stopped right after a tool finished, ${e.unansweredTotal} notifications, peer messages or prompts unanswered). `
      + `Silent: ${plural(st.silent, 'session')} with ${plural(e.stalls, 'model silence')} or ${plural(e.toolWaits, 'long tool or permission wait')}${tools.length ? `, mostly ${tools[0][0]}` : ''}. `
      + `Asked you mid-run: ${st.asked}.${stops}${change}${e.helperWaits ? ` ${plural(e.helperWaits, 'wait')} on a running helper, not counted.` : ''} ${st.stuck ? h.actions.stuck : h.actions.clean}`,
  });
}

/** Backlog growing: more tickets created than shipped for 3 weeks in a row. */
function backlogRule(b, out) {
  if (!b || !b.over) return;
  out.push({
    weight: 70, kind: 'warn', value: b.weeksOver,
    title: `More tickets opened than shipped for ${b.weeksOver} weeks`,
    detail: `${b.created} created against ${b.shipped} shipped in the window; ${b.openTodo} waiting in to do. ${b.action}`,
  });
}

function sessionRules(sessions, health, out) {
  const s = sessions?.summary;
  if (!s || !s.n) return;
  healthRule(health, out);
  if (s.medianReplyMin != null) {
    const over = s.sessionsWaitedOver1h || 0;
    out.push({
      weight: 65, kind: s.medianReplyMin > 30 || over > 0 ? 'warn' : 'info', value: s.medianReplyMin,
      title: `Your replies took a median of ${fmtMinutes(s.medianReplyMin)}; ${plural(over, 'session')} waited over 1 h`,
      detail: `Time from a finished turn to your next prompt. Total waiting on you: ${fmtHours(s.waitUserHours || 0)}, a median of ${fmtMinutes(s.medianActiveMin ?? 0)} of active work per session.`,
    });
  }
}

const usd = n => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;

/** Calibrated "a week's limit" sentence, or why there is none; shared by the insight, the CLI and the tab. */
export function weekLimitText(l) {
  return l && l.weekUSD > 0
    ? `A week's limit is about ${usd(l.weekUSD)} at API prices (from ${plural(l.nWeekly, 'weekly-limit hit')}).`
    : 'Not calibrated yet: no weekly-limit hit in the data.';
}

/** Usage-limit hits in the window: how many, the time lost and the calibrated week. */
function limitRules(l, out) {
  const hits = (l?.sessionHits || 0) + (l?.weeklyHits || 0);
  if (!(hits > 0)) return;
  out.push({
    weight: 85, kind: 'warn', value: hits,
    title: `Hit a usage limit ${plural(hits, 'time')}, losing ${fmtHours(l.lostHours || 0)}`,
    detail: `${plural(l.sessionHits, 'session-limit hit')} and ${plural(l.weeklyHits, 'weekly-limit hit')} in the window; the lost time runs from a hit to when work resumed or the limit reset. ${weekLimitText(l)}`,
  });
}

/** One cost finding: what cost most in the window (an epic when there is one, else a ticket). */
function costRules(costs, out) {
  limitRules(costs?.limits, out);
  const total = costs?.total;
  if (!total || !(total.costUSD > 0)) return;
  const epic = costs.byEpic?.[0];
  const top = costs.byTicket?.[0];
  const lead = epic
    ? `${epic.epic} cost the most: ${usd(epic.costUSD)}, ${pct(epic.share)}% of the window's ${usd(total.costUSD)}`
    : top ? `${top.ticket} cost the most: ${usd(top.costUSD)}, ${pct(top.share)}% of the window's ${usd(total.costUSD)}` : `Claude work cost ${usd(total.costUSD)} at API prices`;
  const plan = costs.plan
    ? ` At this pace a month is about ${usd(costs.plan.apiEquivalentPer30d)} at API prices, ${costs.plan.multiple}x your ${usd(costs.plan.usdPerMonth)} plan.`
    : '';
  out.push({
    weight: 78, kind: 'info', value: total.costUSD,
    title: lead,
    detail: `Dollars at API list prices, from token usage across ${plural(total.sessions, 'session')}; helpers made up ${usd(total.helperCostUSD)} of it.${plan}`,
  });
}

function timingRules(timings, out) {
  for (const t of timings?.trends || []) {
    if (t.changePct == null || Math.abs(t.changePct) < 15 || t.recentCount < 3 || t.priorCount < 3) continue;
    const slower = t.changePct > 0;
    const who = [t.repo, t.name].filter(Boolean).join(' ') || 'timing';
    out.push({
      weight: (slower ? 60 : 50) + Math.min(Math.abs(t.changePct), 40) / 10, kind: slower ? 'slower' : 'faster', value: t.changePct,
      title: `${who} ${Math.round(Math.abs(t.changePct))}% ${slower ? 'slower' : 'faster'}: ${fmtSecondsPair(t.priorMedian, t.recentMedian)}`,
      detail: `Median of the last 7 days (${plural(t.recentCount, 'run')}) against the 7 before (${plural(t.priorCount, 'run')}).`,
    });
  }
  for (const r of timings?.ci?.byRepo || []) {
    if (r.runs >= 3 && r.failRate >= 0.2) {
      const failed = r.failed ?? Math.round(r.failRate * r.runs);
      const jobs = (r.topFailedJobs || []).slice(0, 3).map(j => `${j.name} (${j.count})`).join(', ');
      out.push({
        weight: 65, kind: 'warn', value: r.failRate,
        title: `${[r.repo, r.workflow].filter(Boolean).join(' ')} fails ${pct(r.failRate)}% of finished runs`,
        detail: `${failed} of ${r.runs} finished CI runs failed`
          + (r.cancelled ? ` (${r.cancelled} cancelled by newer pushes not counted)` : '')
          + (r.flakyReruns ? `; ${r.flakyReruns} passed on a rerun` : '')
          + `.${jobs ? ` Most failing jobs: ${jobs}.` : ''}`,
      });
    }
  }
  const red = timings?.redTime?.summary;
  if (red && red.branches > 0) {
    out.push({
      weight: red.openNow > 0 ? 66 : 55, kind: red.openNow > 0 ? 'warn' : 'info', value: red.medianMinutes,
      title: red.openNow > 0
        ? `${plural(red.openNow, 'branch', 'branches')} red right now; typical red time ${fmtMinutes(red.medianMinutes)}`
        : `Branches stay red a median of ${fmtMinutes(red.medianMinutes)}`,
      detail: `${plural(red.branches, 'red stretch', 'red stretches')} in the window, slowest tenth ${fmtMinutes(red.p90Minutes)} or more.`,
    });
  }
}

const MISSING = [
  ['sessions', 'No Claude sessions collected yet', 'Run `ch metrics collect --sessions` (set metrics.claudeProjects in config.json).'],
  ['ci', 'No CI runs collected yet', 'Add repos under metrics.repos in config.json, then run `ch metrics collect --ci`.'],
  ['gates', 'No local gate runs yet: they are recorded from the next gate run', 'Point metrics.gateLogs at the gate log, or record runs with `ch metrics time`.'],
  ['builds', 'No local build times yet', 'Point metrics.buildTimeLogs at a build-time log, then run `ch metrics collect --gates`.'],
];

/**
 * @param {object} p the payload without `insights`
 * @returns {{kind:string,title:string,detail:string,value?:number}[]}
 */
export function buildInsights(p) {
  const out = [];
  flowRules(p?.flow, out);
  sessionRules(p?.sessions, p?.health, out);
  backlogRule(p?.flow?.backlog, out);
  costRules(p?.costs, out);
  timingRules(p?.timings, out);
  for (const [src, title, detail] of MISSING) {
    if (p?.sources?.[src] && !p.sources[src].records) out.push({ weight: 20, kind: 'missing', title, detail });
  }
  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_INSIGHTS)
    .map(({ weight, title, ...rest }) => ({ kind: rest.kind, title: title.length > 70 ? `${title.slice(0, 69)}…` : title, detail: rest.detail, ...(rest.value !== undefined ? { value: rest.value } : {}) }));
}
