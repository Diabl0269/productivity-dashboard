// metrics-time-view.js — "Where in-progress time went": a stacked bar of the five categories and a
// table of the tickets with the most idle time. Data: payload.flow.inProgressSplit (shared/time-split.js).
// Definitions: docs/metrics.md "Where in-progress time goes". DOM helpers come from metrics-view.js.
// "Nobody working on it" is two things (PRO87): waiting its turn behind a ticket of the same epic, and left in progress.
import { fmtDaysHours, fmtPct } from './metrics-charts.js';

const PARTS = [
  { key: 'working', hours: 'workingH', label: 'Working', spoken: 'working', cls: 'is-working', note: 'a session is running for the ticket' },
  { key: 'ci', hours: 'ciH', label: 'Waiting on CI', spoken: 'waiting on CI', cls: 'is-ci', note: 'a CI run for its branch is running' },
  { key: 'you', hours: 'youH', label: 'Waiting on you', spoken: 'waiting on you', cls: 'is-you', note: 'a session waits on your reply or a question' },
  { key: 'waiting', hours: 'waitingH', label: 'Waiting its turn', spoken: 'waiting its turn', cls: 'is-waiting', note: 'no session on this ticket, but a session was running on another ticket of the same epic: it queued behind its sibling' },
  { key: 'left', hours: 'leftH', label: 'Left in progress', spoken: 'left in progress', cls: 'is-left', note: 'no session on the ticket or its epic, no CI, nothing waiting on you: it sat in In progress with nobody having it open' },
];

/** Older servers send one `idle` number: read it as "left" so the bar still adds up. */
function norm(x) {
  if (!x) return x;
  const sh = x.shares || {};
  const hasSplit = sh.waiting !== undefined || x.waitingH !== undefined;
  return { ...x, waitingH: x.waitingH ?? 0, leftH: x.leftH ?? (hasSplit ? 0 : x.idleH), shares: { ...sh, waiting: sh.waiting ?? 0, left: sh.left ?? (hasSplit ? 0 : sh.idle) } };
}

/**
 * One plain sentence from the numbers: how much of the in-progress time was spent waiting its turn
 * and how much was left. Exported for tests. `total` is payload.flow.inProgressSplit.total.
 */
export function timeVerdict(total) {
  const t = norm(total);
  if (!t || !(t.hours > 0)) return '';
  const w = t.shares.waiting || 0;
  const l = t.shares.left || 0;
  const head = `Tickets sat in progress for ${fmtDaysHours(t.hours)} in all`;
  if (!(w > 0) && !(l > 0)) return `${head}, and every hour had a session, CI or a question on it.`;
  const bits = [];
  if (w > 0) bits.push(`${fmtPct(w)} of it they waited their turn behind another ticket of the same run`);
  if (l > 0) bits.push(`${fmtPct(l)} of it nobody had them open`);
  return `${head}: ${bits.join(', and ')}.`;
}

/** @param {object} f the payload's flow; @param {object} h DOM helpers {el, append, table, ticketLink, empty, card} */
export function renderTimeSplit(f, h) {
  const { el, append, table, ticketLink, empty, card } = h;
  const sp = f && f.inProgressSplit;
  const total = norm(sp && sp.total);
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
  const hasTypical = sp.typical && sp.typical.n > 0;
  const tyShares = hasTypical ? norm({ shares: sp.typical.shares, idleH: 0 }).shares : null;
  const top = sp.idleTop || {};
  // One line of the tickets behind a bucket, each a link that opens the ticket.
  const topLine = (list) => {
    if (!list || !list.length) return null;
    const line = el('span', 'mc-splittop');
    line.appendChild(el('span', null, 'Most: '));
    list.forEach((g, i) => {
      if (i) line.appendChild(el('span', null, ', '));
      line.appendChild(ticketLink(g.ticket));
      line.appendChild(el('span', null, ` ${fmtDaysHours(g.hours)}`));
    });
    return line;
  };
  const legend = el('ul', 'mc-splitlegend');
  for (const p of PARTS) {
    const li = el('li', 'mc-splitkey');
    const lead = hasTypical ? fmtPct(tyShares[p.key] || 0) : `${fmtDaysHours(total[p.hours])} · ${fmtPct(total.shares[p.key] || 0)}`;
    append(li, el('span', `mc-splitdot ${p.cls}`), el('span', 'mc-splitname', p.label), el('span', 'mc-splitval', lead), el('span', 'mc-splitnote', p.note), topLine(top[p.key]));
    legend.appendChild(li);
  }
  const totalBar = makeBar(`All in-progress hours ${fmtDaysHours(total.hours)}`, total.shares, (p) => fmtDaysHours(total[p.hours]));
  const kids = [];
  if (hasTypical) {
    kids.push(el('p', 'mc-card-sub', `Average ticket (average share over ${sp.typical.n} tickets that left in progress, median ${fmtDaysHours(sp.typical.medianHours)} there)`),
      makeBar('Average ticket', tyShares, null), legend,
      el('p', 'mc-card-sub', `All in-progress hours: ${fmtDaysHours(total.hours)}, working ${fmtPct(total.shares.working)}, CI ${fmtPct(total.shares.ci)}, waiting on you ${fmtPct(total.shares.you)}, waiting its turn ${fmtPct(total.shares.waiting)}, left in progress ${fmtPct(total.shares.left)}. Forgotten stays are left out (below).`),
      totalBar);
  } else {
    kids.push(totalBar, legend);
  }
  const rows = (sp.byTicket || []).map((r0) => {
    const r = norm(r0);
    return [ticketLink(r.ticket), r.title || '', fmtDaysHours(r.hours), fmtDaysHours(r.workingH), fmtDaysHours(r.ciH), fmtDaysHours(r.youH), fmtDaysHours(r.waitingH), fmtDaysHours(r.leftH)];
  });
  const tbl = table('Where in-progress time went', [
    { label: 'Ticket' }, { label: 'Title' }, { label: 'In progress', num: true }, { label: 'Working', spoken: 'working', num: true },
    { label: 'CI', num: true }, { label: 'You', num: true }, { label: 'Its turn', num: true, title: 'Waiting its turn: another ticket of the same epic had a session running' },
    { label: 'Left', num: true, title: 'Left in progress: no session at all' },
  ], rows);
  const fg = sp.forgotten;
  const forgotten = fg && fg.n > 0
    ? el('p', 'mc-card-sub', `Forgotten (${fg.n} ${fg.n === 1 ? 'stay' : 'stays'}, ${fmtDaysHours(fg.hours)}): in progress over 72 h with no session work, left out of the numbers above. ${fg.tickets.slice(0, 12).map((g) => `${g.ticket} ${fmtDaysHours(g.hours)}`).join(', ')}${fg.n > 12 ? ` and ${fg.n - 12} more` : ''}.`)
    : null;
  const note = sp.sessionsWithIntervals ? null : empty('No session timing yet, so everything reads as left in progress. Press Refresh data to read your Claude Code transcripts.');
  const verdict = el('p', 'mc-verdict', timeVerdict(total));
  const tells = el('p', 'mc-action', `What this tells you: waiting its turn is normal when an epic runs its tickets one after another; "left in progress" is the part to look at, because nobody was working on those tickets at all.`);
  return card('Where in-progress time went',
    `${sp.tickets} tickets, ${fmtDaysHours(total.hours)} in all. A moment counts once: working first, then CI, then waiting on you, then waiting its turn, and the rest is left in progress. Top ${rows.length} by time nobody had them.`,
    verdict, ...kids, tells, forgotten, note, tbl);
}
