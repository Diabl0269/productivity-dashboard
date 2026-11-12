// metrics-cost-view.js — the "Cost" section of the Metrics tab: dollars at API list prices per
// ticket and epic, and what a shipped ticket costs by model label. Data: payload.costs
// (shared/cost-metrics.js). Definitions: docs/metrics.md "Cost".
// The DOM helpers come from metrics-view.js (passed in, so there is no import cycle).

/** $12.30, or $0.04 for small amounts. */
export function fmtUSD(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 1.2M, 340k, 812. */
export function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}

import { limitsLine } from '../../shared/plan-share.js';

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const tokenSum = (t) => (t ? (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) : 0);

/**
 * @param {object} d the metrics payload
 * @param {{el:Function, append:Function, section:Function, tile:Function, table:Function, ticketLink:Function, empty:Function, card:Function}} h
 */
export function renderCost(d, h) {
  const { el, append, section, tile, table, ticketLink, empty, card } = h;
  const s = section('cost', 'Cost', 'What the Claude work cost, in dollars at API list prices computed from token usage (a plan is billed differently; this is the comparable size of the work). Helpers are included.');
  const c = d.costs;
  if (!c || !(c.total?.costUSD > 0)) {
    s.appendChild(empty('No cost recorded in this range. Press Refresh data to read your Claude Code transcripts.'));
    return s;
  }
  const t = c.total;
  const top = t.byModel[0];
  const grid = el('div', 'mc-tiles');
  append(
    grid,
    tile('Total at API prices', fmtUSD(t.costUSD), `${t.sessions} sessions · ${fmtTokens(tokenSum(t.tokens))} tokens`, null, 'List-price dollars from token usage, main sessions plus helpers'),
    tile('Helpers', t.costUSD > 0 ? pct(t.helperCostUSD / t.costUSD) : '–', `${fmtUSD(t.helperCostUSD)} spent by subagents`, null, 'Share of the total spent by helper (subagent) transcripts'),
    tile('Top model', top ? top.model.replace(/^claude-/, '') : '–', t.byModel.length ? t.byModel.slice(0, 4).map(m => `${m.model.replace(/^claude-/, '')} ${pct(m.share)}`).join(' · ') : ' ', null, 'Spend by model in this range, largest first'),
  );
  if (t.byPart?.some(x => x.costUSD > 0)) {
    const nm = { cacheRead: 'reads', cacheWrite: 'writes', output: 'output', input: 'input' };
    grid.appendChild(tile('Cost by part', t.byPart.slice(0, 2).map(x => `cache ${nm[x.part]} ${pct(x.share)}`).join(' · '), t.byPart.slice(2).map(x => `${nm[x.part]} ${pct(x.share)}`).join(' · '), null, 'Share of the total by cache reads, cache writes, output and input tokens (main thread plus helpers; the split is in ch metrics cost)'));
  }
  if (t.context && t.context.calls > 0) {
    grid.appendChild(tile('Context per call', fmtTokens(t.context.median), `p90 ${fmtTokens(t.context.p90)} · ${t.context.calls.toLocaleString('en-US')} main-thread calls`, null, 'Median input + cache read + cache write tokens of one main-thread API call'));
  }
  if (c.plan) {
    grid.appendChild(tile('Month at API prices', fmtUSD(c.plan.apiEquivalentPer30d), `${c.plan.multiple}x your ${fmtUSD(c.plan.usdPerMonth)} plan`, null, 'This range scaled to 30 days, against planUSDPerMonth in config.json'));
  }
  s.appendChild(grid);
  if (c.limits) {
    const note = el('div', 'mc-note', limitsLine(c.limits));
    note.title = 'Usage-limit hits in this range. A week\'s limit is estimated from the API-price cost of the 7 days before each weekly-limit hit (median); the reset window is not known exactly, so treat it as a rough size.';
    s.appendChild(note);
  }

  const cal = !!(c.limits && c.limits.weekUSD > 0);
  const wk = (r) => (r.weekShare === undefined ? '' : `${(r.weekShare * 100).toFixed(1)}%`);
  const tickets = c.byTicket.map((r) => [
    ticketLink(r.ticket), r.title || '', fmtUSD(r.costUSD), ...(cal ? [wk(r)] : []), pct(r.share), fmtTokens(r.tokens), String(r.toolCalls), String(r.sessions),
  ]);
  s.appendChild(card('Cost per ticket', 'Usage while the ticket was current in a session (a session on an epic switches ticket when it moves a child to in-progress), plus its helpers. Top 30. "% wk" is the share of an estimated week\'s plan limit, shown once a weekly-limit hit calibrates it.',
    table('Cost per ticket', [
      { label: 'Ticket' }, { label: 'Title' }, { label: 'Cost', num: true }, ...(cal ? [{ label: '% wk', num: true }] : []), { label: 'Share', num: true },
      { label: 'Tokens', num: true }, { label: 'Tool calls', num: true }, { label: 'Sessions', num: true },
    ], tickets)));

  if (c.byEpic.length) {
    const epics = c.byEpic.map((e) => {
      const kids = el('span', 'mc-cost-kids');
      for (const k of e.children.slice(0, 8)) {
        append(kids, k.own ? el('span', 'mc-cost-own', `own ${fmtUSD(k.costUSD)}`) : ticketLink(k.ticket), k.own ? null : el('span', 'mc-cost-amt', ` ${fmtUSD(k.costUSD)} `));
      }
      if (e.children.length > 8) kids.appendChild(el('span', 'mc-cost-amt', `+${e.children.length - 8} more`));
      return [ticketLink(e.epic), e.title || '', fmtUSD(e.costUSD), ...(cal ? [wk(e)] : []), pct(e.share), kids];
    });
    s.appendChild(card('Epics', 'An epic\'s cost is its own sessions plus every ticket under it.',
      table('Cost per epic', [
        { label: 'Epic' }, { label: 'Title' }, { label: 'Cost', num: true }, ...(cal ? [{ label: '% wk', num: true }] : []), { label: 'Share', num: true }, { label: 'Children' },
      ], epics)));
  }

  if (c.perShipped.length) {
    const shipped = c.perShipped.map((g) => [g.label, String(g.n), fmtUSD(g.medianUSD), fmtUSD(g.p75USD), fmtUSD(g.totalUSD)]);
    s.appendChild(card('Per shipped ticket by model label', 'Tickets now in review or done that cost something, grouped by their model label.',
      table('Cost per shipped ticket by model label', [
        { label: 'Model label' }, { label: 'Tickets', num: true }, { label: 'Median', num: true }, { label: 'p75', num: true }, { label: 'Total', num: true },
      ], shipped)));
  }
  const est = d.estimates;
  if (est && est.byLabel?.length) {
    const rows = est.byLabel.map((g) => [g.label, String(g.n), fmtUSD(g.medianUSD), fmtUSD(g.p75USD)]);
    s.appendChild(card('Estimates', `What a ticket is expected to cost, from tickets now in review or done with cost in the last ${est.sampleWindowDays} days (${est.samples} samples). A ticket's range comes from the narrowest group of at least 5 similar tickets (model label, type, project, lane); the run plan, the ticket panel and ch tasks next show it.`,
      table('Cost estimate samples by model label', [
        { label: 'Model label' }, { label: 'Samples', num: true }, { label: 'Typical (median)', num: true }, { label: 'Up to (p75)', num: true },
      ], rows)));
  }
  return s;
}
