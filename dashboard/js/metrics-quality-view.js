// metrics-quality-view.js — the "Quality" section of the Metrics tab: review notes by taste principle,
// rework and red CI by model label. Data: payload.quality (shared/quality-metrics.js).
// Definitions: docs/metrics.md "Quality". DOM helpers come from metrics-view.js (passed in, no import cycle).
import { fmtPct } from './metrics-charts.js';

const pct = (x) => (x == null ? '–' : fmtPct(x));
const LABEL = (l) => String(l).replace(/^model:/, '');

/** @param {object} d the metrics payload; @param {object} h DOM helpers {el, append, section, table, ticketLink, empty, card} */
export function renderQuality(d, h) {
  const { el, section, table, ticketLink, empty, card } = h;
  const s = section('quality', 'Quality', 'Where shipped work needed a second look: review notes by taste principle, and rework and red CI runs by model label.');
  const q = d.quality;
  if (!q) { s.appendChild(empty('No quality data in this payload.')); return s; }
  const n = q.notes;
  // A card's "do this when high" line; the live flag makes it stand out when its threshold is crossed.
  const hint = (text, high) => el('p', `mc-action${high ? ' is-high' : ''}`, `${high ? 'High now. ' : 'When high: '}${text}`);

  // --- review notes ---
  const noteBody = [];
  if (!n.total) noteBody.push(empty('No review notes written in this range.'));
  else {
    noteBody.push(el('p', 'mc-counts', `${n.total} notes on ${n.shipped} shipped tickets (${n.perShipped ?? '–'} per ticket) · ${n.kinds.fix || 0} fix, ${n.kinds.idea || 0} idea, ${n.kinds.design || 0} design · ${n.states.filed || 0} filed, ${n.states.dismissed || 0} dismissed${n.states.new ? `, ${n.states.new} unsent` : ''}`));
    noteBody.push(table('Review notes by taste principle', [
      { label: 'Principle' }, { label: 'Fix', num: true }, { label: 'Idea', num: true }, { label: 'Design', num: true },
      { label: 'Filed', num: true }, { label: 'Dismissed', num: true },
    ], n.byPrinciple.map((r) => [r.high ? `${r.principle} (high)` : r.principle, r.fix, r.idea, r.design, r.filed, r.dismissed])));
    if (n.topTickets.length) {
      const list = el('p', 'mc-card-sub');
      list.appendChild(document.createTextNode('Most fix notes: '));
      n.topTickets.forEach((t, i) => { if (i) list.appendChild(document.createTextNode(', ')); list.appendChild(ticketLink(t.ticket)); list.appendChild(document.createTextNode(` (${t.fix})`)); });
      noteBody.push(list);
    }
  }
  noteBody.push(hint(n.hint, n.high));
  const grid = el('div', 'mc-grid2');
  grid.appendChild(card('Review notes by taste principle', 'Principle comes from the filed ticket\'s Taste line, else the check the note was written against. Sorted by fix notes.', ...noteBody));

  // --- rework by label ---
  const labelRows = q.byLabel.filter((r) => r.shipped || r.reopened);
  const reworkBody = labelRows.length
    ? [table('Rework by model label', [{ label: 'Label' }, { label: 'Shipped', num: true }, { label: 'Reopened', num: true }, { label: 'Rework', num: true }],
      labelRows.map((r) => [LABEL(r.label), r.shipped, r.reopened, r.reworkHigh ? `${pct(r.reworkShare)} (high)` : pct(r.reworkShare)]))]
    : [empty('No shipped tickets in this range.')];
  reworkBody.push(hint(q.rework.hint, q.rework.high));
  grid.appendChild(card('Rework by model label', `Reopened = moved back from review or done, plus a fix ticket opened within 14 days. ${q.rework.reopened} of ${q.rework.shipped} shipped (${pct(q.rework.share)}).`, ...reworkBody));
  s.appendChild(grid);

  // --- red CI per PR ---
  const ci = q.ci;
  const ciBody = [];
  if (!ci.prs) ciBody.push(empty('No CI runs on PR branches in this range. Press Refresh data to collect CI runs.'));
  else {
    const top = ci.topFailedJob;
    ciBody.push(el('p', 'mc-counts', `${ci.failedRuns} failed of ${ci.runs} runs on ${ci.prs} PRs (${ci.failedPerPr} failed per PR) · ${ci.failedHours} h in failed runs, ${ci.rerunHours} h in reruns${top ? ` · top failing job: ${top.name} (${top.count})` : ''}`));
    ciBody.push(table('Red CI runs by model label', [{ label: 'Label' }, { label: 'PRs', num: true }, { label: 'Runs', num: true }, { label: 'Failed', num: true }, { label: 'Failed per PR', num: true }, { label: 'Rerun h', num: true }],
      q.byLabel.filter((r) => r.prs).map((r) => [LABEL(r.label), r.prs, r.runs, r.failedRuns, r.redHigh ? `${r.failedPerPr} (high)` : r.failedPerPr, r.rerunHours])));
  }
  ciBody.push(hint(ci.hint, ci.high));
  s.appendChild(card('Red CI per PR', 'A PR is a branch with finished runs, joined to its ticket through the session branch. Cancelled runs are not counted.', ...ciBody));
  return s;
}
