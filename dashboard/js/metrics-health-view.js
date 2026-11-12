// metrics-health-view.js — the "Session health" and "Backlog" sections of the Metrics tab.
// Data: payload.health (shared/health-metrics.js) and payload.flow.backlog. One definition per status:
// stuck, silent, asked, clean (docs/metrics.md "Session health"). DOM helpers come from metrics-view.js.
import { barChart, fmtDay, fmtPct } from './metrics-charts.js';
import { causeLabel } from '../../shared/health-metrics.js';

const ms = (s) => new Date(s).getTime();
const WAKE = { human: 'your prompt', 'task-notification': 'a task notification', peer: 'a peer message', assistant: 'the model itself', system: 'a system line', other: 'another line', 'not recorded': 'not recorded (older records)' };

/** @param {object} d the metrics payload; @param {object} h DOM helpers {el, section, tile, table, empty, card} */
export function renderHealth(d, h) {
  const { el, section, tile, table, empty, card } = h;
  const s = section('health', 'Session health', 'Every session is exactly one of: stuck (a 20+ min silence nothing answered), silent (a model stall or a long tool or permission wait), asked you mid-run, or clean.');
  const x = d.health;
  if (!x || !x.n) { s.appendChild(empty('No sessions collected in this range. Press Refresh data to read your Claude Code transcripts.')); return s; }
  const action = (text) => el('p', 'mc-action', `Do this: ${text}`);
  const st = x.status;
  const e = x.events;

  const tiles = el('div', 'mc-tiles');
  tiles.appendChild(tile('Clean', fmtPct(x.cleanShare ?? 0), `${st.clean} of ${x.n} sessions`, null, 'No mid-run question, stall, long tool wait or missed wake-up'));
  tiles.appendChild(tile('Stuck', String(st.stuck), `${e.midTurnStops} stopped mid-turn · ${e.unansweredTotal} unanswered`, null, 'At least one missed wake-up', `mc-tile-wide${st.stuck ? ' is-alert' : ''}`));
  tiles.appendChild(tile('Silent', String(st.silent), `${e.stalls} model silences · ${e.toolWaits} tool waits`, null, 'Not stuck, but a model stall or a tool or permission prompt left open 20+ minutes'));
  tiles.appendChild(tile('Asked you', String(st.asked), `${e.questionsMidRun} mid-run questions`, null, 'Only mid-run questions, nothing stuck or silent'));
  s.appendChild(tiles);

  const grid = el('div', 'mc-grid2');
  const bw = x.byWeek || [];
  grid.appendChild(card('Sessions by status, by week', 'Stacked: clean, asked you, silent, stuck.',
    bw.length ? barChart({
      title: 'Sessions by status by week',
      categories: bw.map((w) => fmtDay(ms(w.week))),
      series: [
        { name: 'Clean', color: 'var(--mc-s2)', values: bw.map((w) => w.clean) },
        { name: 'Asked you', color: 'var(--mc-s1)', values: bw.map((w) => w.asked) },
        { name: 'Silent', color: 'var(--mc-s3)', values: bw.map((w) => w.silent) },
        { name: 'Stuck', color: 'var(--mc-bad)', values: bw.map((w) => w.stuck) },
      ],
      mode: 'stacked',
    }) : empty('No weekly session data yet.'),
    action(x.actions.clean)));

  const causes = Object.entries(x.causes || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const stuckBody = [];
  if (!e.midTurnStops && !e.unansweredTotal) stuckBody.push(empty('Nothing stuck in this range.'));
  else {
    stuckBody.push(table('Stuck by origin and cause', [{ label: 'Kind' }, { label: 'Count', num: true }], [
      ['Stopped right after a tool finished', e.midTurnStops],
      ...causes.map(([k, n]) => [`↳ cause: ${causeLabel(k)}`, n]),
      ...Object.entries(e.unanswered).map(([k, n]) => [`Unanswered ${WAKE[k] || k}`, n]),
    ]));
  }
  stuckBody.push(action(x.actions.stuck));
  grid.appendChild(card('Stuck', 'Where sessions stopped and waited. The stuck kinds and their guards are written in docs/agent-notes/stuck-sessions.md (suite repo).', ...stuckBody));
  s.appendChild(grid);

  // Stops with no cause found, by what ended the silence and by week.
  const u = x.unknown;
  const unkBody = [];
  if (!u.total) unkBody.push(empty('Every mid-turn stop has a cause.'));
  else {
    unkBody.push(el('p', 'mc-counts', `${u.total} of ${u.ofStops} mid-turn stops have no cause found (${fmtPct(u.share ?? 0)})`));
    unkBody.push(table('Stops with no cause by what ended the silence', [{ label: 'Ended by' }, { label: 'Stops', num: true }],
      Object.entries(u.byWake).sort((a, b) => b[1] - a[1]).map(([k, n]) => [WAKE[k] || k, n])));
    const weeks = u.byWeek || [];
    unkBody.push(barChart({
      title: 'Stops with no cause found, by week',
      categories: weeks.map((w) => fmtDay(ms(w.week))),
      series: [{ name: 'No cause found', color: 'var(--mc-bad)', values: weeks.map((w) => w.n) }],
    }));
  }
  unkBody.push(action(x.actions.unknown));
  const grid2 = el('div', 'mc-grid2');
  grid2.appendChild(card('Stops with no cause', 'Mid-turn stops where no usage limit, API error, app quit or other known cause was recorded.', ...unkBody));
  grid2.appendChild(card('Silent', 'Model silences (nothing pending) and tool or permission waits left open for 20+ minutes.',
    el('p', 'mc-counts', `${st.silent} sessions · ${e.stalls} model silences · ${e.toolWaits} tool waits${Object.keys(e.toolWaitTools).length ? ` (${Object.entries(e.toolWaitTools).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}${e.helperWaits ? ` · ${e.helperWaits} waits on a running helper, not counted` : ''}`),
    action(x.actions.silent)));
  s.appendChild(grid2);
  return s;
}

/** The Backlog card: created vs shipped per week, closed without work and the growing-backlog hint. */
export function renderBacklog(d, h) {
  const { el, section, tile, empty, card } = h;
  const s = section('backlog', 'Backlog', 'Tickets opened against tickets shipped, so you can tell when to stop opening small ones.');
  const b = d.flow && d.flow.backlog;
  if (!b || !Array.isArray(b.byWeek) || !b.byWeek.length) { s.appendChild(empty('No backlog data in this range.')); return s; }
  const tiles = el('div', 'mc-tiles');
  tiles.appendChild(tile('Waiting in to do', String(b.openTodo), `${b.growthPerWeek > 0 ? '+' : ''}${b.growthPerWeek} a week (created minus closed)`, null, 'Tickets in the to do column now'));
  tiles.appendChild(tile('Created vs shipped', `${b.created} / ${b.shipped}`, 'in this range', null, 'Tickets created against tickets that reached review or done after real work'));
  tiles.appendChild(tile('Closed without work', String(b.closedWithoutWork), 'moved to done without ever starting', null, 'Closed as duplicates, obsolete or already done: not counted as shipped'));
  s.appendChild(tiles);
  s.appendChild(card('Created vs shipped per week', 'The current week is still running and does not count towards the streak.',
    barChart({
      title: 'Tickets created and shipped by week',
      categories: b.byWeek.map((w) => fmtDay(ms(w.week))),
      series: [
        { name: 'Created', color: 'var(--mc-s1)', values: b.byWeek.map((w) => w.created) },
        { name: 'Shipped', color: 'var(--mc-s2)', values: b.byWeek.map((w) => w.shipped) },
      ],
    }),
    el('p', `mc-action${b.over ? ' is-high' : ''}`, `${b.over ? 'High now. ' : 'When created > shipped for 3 weeks: '}${b.action}`)));
  return s;
}
