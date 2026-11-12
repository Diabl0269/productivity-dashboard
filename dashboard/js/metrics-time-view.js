// metrics-time-view.js — "Where in-progress time went": a stacked bar of the four categories and a
// table of the tickets with the most idle time. Data: payload.flow.inProgressSplit (shared/time-split.js).
// Definitions: docs/metrics.md "Where in-progress time goes". DOM helpers come from metrics-view.js.
import { fmtHours, fmtPct } from './metrics-charts.js';

const PARTS = [
  { key: 'working', hours: 'workingH', label: 'Working', spoken: 'working', cls: 'is-working', note: 'a session is running for the ticket' },
  { key: 'ci', hours: 'ciH', label: 'Waiting on CI', spoken: 'waiting on CI', cls: 'is-ci', note: 'a CI run for its branch is running' },
  { key: 'you', hours: 'youH', label: 'Waiting on you', spoken: 'waiting on you', cls: 'is-you', note: 'a session waits on your reply or a question' },
  { key: 'idle', hours: 'idleH', label: 'Nobody working on it', spoken: 'nobody working on it', cls: 'is-idle', note: 'no Claude session on the ticket, no CI run, nothing waiting on you; can read high when a session does not name the ticket' },
];

/** @param {object} f the payload's flow; @param {object} h DOM helpers {el, append, table, ticketLink, empty, card} */
export function renderTimeSplit(f, h) {
  const { el, append, table, ticketLink, empty, card } = h;
  const sp = f && f.inProgressSplit;
  const total = sp && sp.total;
  if (!total || !(total.hours > 0)) {
    return card('Where in-progress time went', 'Time tickets spent in progress, by what was running.', empty('No time in progress in this range.'));
  }
  // A bar for one set of shares; `hoursOf(part)` gives the hours text for the hover/label (or null).
  const makeBar = (name, shares, hoursOf) => {
    const bar = el('div', 'mc-splitbar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${name}: ${PARTS.map((p) => `${p.spoken} ${hoursOf ? `${hoursOf(p)}, ` : ''}${fmtPct(shares[p.key] || 0)}`).join('; ')}`);
    for (const p of PARTS) {
      const share = shares[p.key] || 0;
      if (!(share > 0)) continue;
      const seg = el('div', `mc-split ${p.cls}`);
      seg.style.flexGrow = String(share);
      seg.title = `${p.label}: ${hoursOf ? `${hoursOf(p)} · ` : ''}${fmtPct(share)}`;
      if (share >= 0.08) seg.textContent = fmtPct(share);
      bar.appendChild(seg);
    }
    return bar;
  };
  const ty = sp.typical;
  const hasTypical = ty && ty.n > 0;
  const legend = el('ul', 'mc-splitlegend');
  for (const p of PARTS) {
    const li = el('li', 'mc-splitkey');
    const lead = hasTypical ? fmtPct(ty.shares[p.key] || 0) : `${fmtHours(total[p.hours])} · ${fmtPct(total.shares[p.key] || 0)}`;
    append(li, el('span', `mc-splitdot ${p.cls}`), el('span', 'mc-splitname', p.label), el('span', 'mc-splitval', lead), el('span', 'mc-splitnote', p.note));
    legend.appendChild(li);
  }
  const totalBar = makeBar(`All in-progress time ${fmtHours(total.hours)}`, total.shares, (p) => fmtHours(total[p.hours]));
  const kids = [];
  if (hasTypical) {
    kids.push(el('p', 'mc-card-sub', `A typical ticket (average share over ${ty.n} tickets that left in progress, median ${fmtHours(ty.medianHours)} there)`),
      makeBar('A typical ticket', ty.shares, null), legend,
      el('p', 'mc-card-sub', `All in-progress time together: ${fmtHours(total.hours)}, working ${fmtPct(total.shares.working)}, CI ${fmtPct(total.shares.ci)}, waiting on you ${fmtPct(total.shares.you)}, nobody working on it ${fmtPct(total.shares.idle)}. Tickets forgotten in progress inflate this; they also show as stale tickets.`),
      totalBar);
  } else {
    kids.push(totalBar, legend);
  }
  const rows = (sp.byTicket || []).map((r) => [
    ticketLink(r.ticket), r.title || '', fmtHours(r.hours), fmtHours(r.workingH), fmtHours(r.ciH), fmtHours(r.youH), fmtHours(r.idleH),
  ]);
  const tbl = table('Where in-progress time went', [
    { label: 'Ticket' }, { label: 'Title' }, { label: 'In progress', num: true }, { label: 'Working', spoken: 'working', num: true },
    { label: 'CI', num: true }, { label: 'You', num: true }, { label: 'Nobody', num: true },
  ], rows);
  const note = sp.sessionsWithIntervals ? null : empty('No session timing yet, so everything reads as nobody working on it. Press Refresh data to read your Claude Code transcripts.');
  return card('Where in-progress time went',
    `${sp.tickets} tickets, ${fmtHours(total.hours)} in all. A moment counts once: working first, then CI, then waiting on you, the rest is nobody working on it. Top ${rows.length} by time with nobody working on it.`,
    ...kids, note, tbl);
}
