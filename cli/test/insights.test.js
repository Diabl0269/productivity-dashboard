/**
 * cli/test/insights.test.js: shared/insights.js rules and shared/metrics-payload.js on small inputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights, fmtHours } from '../../shared/insights.js';
import { buildMetricsPayload } from '../../shared/metrics-payload.js';
import { healthBlock } from '../../shared/health-metrics.js';

const stage = (median, open = { n: 0, oldestHours: 0 }, n = 3) => ({ n, median, p75: median, totalHours: 10, open });
const flow = (over = {}) => ({
  bottleneck: null,
  stages: { todo: stage(null, undefined, 0), 'in-progress': stage(null, undefined, 0), review: stage(null, undefined, 0) },
  groups: { project: {} },
  backlog: { openTodo: 4, growthPerWeek: 0 },
  forgottenEpics: [],
  ...over,
});
const full = { sources: { sessions: { records: 1 }, ci: { records: 1 }, gates: { records: 1 }, builds: { records: 1 } } };
const find = (list, kind) => list.filter(i => i.kind === kind);

test('fmtHours picks minutes, hours or days', () => {
  assert.equal(fmtHours(0.5), '30 min');
  assert.equal(fmtHours(3.44), '3.4 h');
  assert.equal(fmtHours(72), '3.0 days');
});

test('bottleneck stage, share and projects that differ', () => {
  const f = flow({
    bottleneck: { stage: 'review', medianHours: 27.5, totalHours: 84, share: 0.62 },
    stages: { todo: stage(null, undefined, 0), 'in-progress': stage(3.4), review: stage(27.5) },
    groups: { project: { a: { bottleneck: { stage: 'in-progress' } }, b: { bottleneck: { stage: 'review' } } } },
  });
  const [i] = buildInsights({ ...full, flow: f });
  assert.equal(i.kind, 'bottleneck');
  assert.equal(i.title, 'Review is the slowest step: typically 27.5 h vs 3.4 h building');
  assert.match(i.detail, /a typical ticket waits 27\.5 h there vs 3\.4 h building/);
  assert.match(i.detail, /holds 62% of the work time/);
  assert.match(i.detail, /Different in: a: Building\./);
});

test('wait before work starts vs build time', () => {
  const f = flow({ stages: { todo: stage(72), 'in-progress': stage(3.4), review: stage(null, undefined, 0) } });
  const list = buildInsights({ ...full, flow: f });
  const w = list.find(i => i.title.startsWith('Tickets wait'));
  assert.equal(w.title, 'Tickets wait 3.0 days before work starts; building takes 3.4 h');
  assert.equal(w.kind, 'warn');
});

test('backlog growth and shrink; small growth is silent', () => {
  const weeks = [{ created: 10, closed: 5 }, { created: 6, closed: 5 }];
  const grow = buildInsights({ ...full, flow: flow({ backlog: { openTodo: 30, growthPerWeek: 5 }, throughputByWeek: weeks }) });
  assert.equal(grow[0].title, 'The backlog grows by 5 tickets a week (created 8, closed 5)');
  assert.equal(grow[0].kind, 'warn');
  const shrink = buildInsights({ ...full, flow: flow({ backlog: { openTodo: 3, growthPerWeek: -2.5 } }) });
  assert.equal(shrink[0].kind, 'good');
  assert.deepEqual(buildInsights({ ...full, flow: flow({ backlog: { openTodo: 3, growthPerWeek: 0.4 } }) }), []);
});

test('review: one finding about the first look, not a second copy of the review-stage median', () => {
  const stages = { todo: stage(null, undefined, 0), 'in-progress': stage(null, undefined, 0), review: stage(6, { n: 2, oldestHours: 96 }) };
  const rr = { n: 4, median: 30, p90: 80, waiting: 2, buckets: [] };
  const list = buildInsights({ ...full, flow: flow({ stages, reviewWait: { readyToReviewed: rr } }) });
  const [i] = list;
  assert.equal(i.kind, 'warn');
  assert.equal(i.title, 'First look at finished work: median 30.0 h, p90 3.3 days');
  assert.match(i.detail, /2 cards still waiting/);
  assert.match(i.detail, /When this is high/);
  assert.equal(list.filter(x => /Review waits a median/.test(x.title)).length, 0);
});

test('forgotten epics', () => {
  const f = flow({ forgottenEpics: [{ id: 'E1', idleDays: 5.5 }, { id: 'E2', idleDays: 4 }] });
  const [i] = buildInsights({ ...full, flow: f });
  assert.equal(i.title, '2 epics in progress with no activity');
  assert.equal(i.detail, 'E1 idle 5.5 days, E2 idle 4 days.');
});

test('stale tickets in progress', () => {
  const f = flow({ staleTickets: ['A', 'B', 'C', 'D', 'E'].map((id, n) => ({ id, idleDays: 9 - n })) });
  const [i] = buildInsights({ ...full, flow: f });
  assert.equal(i.title, '5 tickets in progress with no activity for 3+ days');
  assert.equal(i.detail, 'A idle 9 days, B idle 8 days, C idle 7 days, D idle 6 days and 1 more.');
});

// Session health: ONE insight (stuck, silent, asked, clean) from payload.health, built here from small session lists.
const hs = (list, since = '2026-11-02', until = '2026-11-08') => healthBlock(list.map((s, i) => ({ start: '2026-11-03T10:00:00Z', ...s, key: `s${i}` })), Date.parse(since), Date.parse(until));
const healthInsights = (p) => buildInsights({ ...full, ...p }).filter(i => /sessions? ran clean/.test(i.title));
const sums = { summary: { n: 10, waitUserHours: 0, medianActiveMin: 30 }, byWeek: [] };

test('session health is one insight: the stuck, silent and autonomy cards are gone', () => {
  const list = [{ missedWakes: 2, missedWakeOrigins: { 'tool-result': 1, 'task-notification': 1 } }, { stalls: 1 }, {}, {}];
  const all = buildInsights({ ...full, sessions: sums, health: hs(list) });
  assert.equal(healthInsights({ sessions: sums, health: hs(list) }).length, 1);
  assert.equal(all.filter(i => /got stuck|went silent|without asking/.test(i.title)).length, 0);
  assert.equal(all[0].title, '2 of 4 sessions ran clean; 1 stuck, 1 silent');
  assert.equal(all[0].kind, 'warn');
  assert.match(all[0].detail, /Stuck: 1 session with a 20\+ min silence nothing answered \(1 stopped right after a tool finished, 1 notifications, peer messages or prompts unanswered\)/);
  assert.match(all[0].detail, /docs\/agent-notes\/stuck-sessions\.md/);
});

test('session health: helper waits are counted on their own, not as stuck', () => {
  const [i] = healthInsights({ sessions: sums, health: hs(Array.from({ length: 10 }, (_, k) => (k ? {} : { helperWaits: 4 }))) });
  assert.equal(i.kind, 'good');
  assert.match(i.detail, /4 waits on a running helper, not counted\./);
});

test('session health: clean share change from the week before, silent sessions name the tool', () => {
  const list = [
    ...Array.from({ length: 4 }, () => ({ start: '2026-10-27T10:00:00Z' })),
    ...Array.from({ length: 3 }, () => ({ start: '2026-11-03T10:00:00Z' })),
    { start: '2026-11-03T10:00:00Z', toolWaits: 5, toolWaitTools: { Bash: 4, Read: 1 } },
    ...Array.from({ length: 3 }, () => ({ start: '2026-11-03T10:00:00Z', stalls: 1 })),
  ];
  const [i] = healthInsights({ sessions: sums, health: hs(list, '2026-10-26') });
  assert.equal(i.title, '7 of 11 sessions ran clean; 0 stuck, 4 silent');
  assert.match(i.detail, /Silent: 4 sessions with 3 model silences or 5 long tool or permission waits, mostly Bash/);
  assert.match(i.detail, /Clean share down 57 points from the week before/);
  assert.equal(i.kind, 'warn');
});

test('your replies: median reply and sessions that waited over an hour', () => {
  const sessions = { summary: { n: 4, autonomousShare: null, waitUserHours: 8, medianActiveMin: 30, medianReplyMin: 12, sessionsWaitedOver1h: 3 }, byWeek: [] };
  const [i] = buildInsights({ ...full, sessions });
  assert.equal(i.title, 'Your replies took a median of 12 min; 3 sessions waited over 1 h');
  assert.equal(i.kind, 'warn');
  assert.match(i.detail, /Total waiting on you: 8\.0 h/);
});

test('timing trends: threshold, run counts on both sides, slower and faster wording', () => {
  const t = (over) => ({ repo: 'my-app', kind: 'gate', name: 'ci-local', recentMedian: 510, priorMedian: 420, changePct: 21.4, recentCount: 5, priorCount: 4, ...over });
  const timings = { trends: [t(), t({ name: 'few', recentCount: 2 }), t({ name: 'flat', changePct: 14 }), t({ name: 'fast', recentMedian: 300, priorMedian: 420, changePct: -28.6 })] };
  const list = buildInsights({ ...full, timings });
  assert.equal(list.length, 2);
  assert.equal(find(list, 'slower')[0].title, 'my-app ci-local 21% slower: 7.0 → 8.5 min');
  assert.equal(find(list, 'faster')[0].title, 'my-app fast 29% faster: 7.0 → 5.0 min');
});

test('CI fail rate at 20% and above', () => {
  const timings = { ci: { byRepo: [
    { repo: 'r', workflow: 'CI', runs: 10, failed: 3, failRate: 0.3, cancelled: 5, flakyReruns: 2, topFailedJobs: [{ name: 'lint', count: 2 }, { name: 'unit', count: 1 }] },
    { repo: 'q', workflow: 'CI', runs: 10, failRate: 0.1 },
  ] } };
  const list = buildInsights({ ...full, timings });
  assert.deepEqual(list.map(i => i.title), ['r CI fails 30% of finished runs']);
  assert.equal(list[0].detail, '3 of 10 finished CI runs failed (5 cancelled by newer pushes not counted); 2 passed on a rerun. Most failing jobs: lint (2), unit (1).');
});

test('red time, open now or not', () => {
  const open = buildInsights({ ...full, timings: { redTime: { summary: { branches: 3, medianMinutes: 25, p90Minutes: 120, openNow: 1 } } } });
  assert.equal(open[0].kind, 'warn');
  assert.match(open[0].title, /^1 branch red right now/);
  const calm = buildInsights({ ...full, timings: { redTime: { summary: { branches: 3, medianMinutes: 25, p90Minutes: 120, openNow: 0 } } } });
  assert.equal(calm[0].title, 'Branches stay red a median of 25 min');
});

test('missing sources get one entry each; capped at 10, titles at 70 chars', () => {
  const none = { sources: { sessions: { records: 0 }, ci: { records: 0 }, gates: { records: 0 }, builds: { records: 0 } } };
  const list = buildInsights(none);
  assert.equal(list.length, 4);
  assert.ok(list.every(i => i.kind === 'missing'));
  assert.equal(list.find(i => i.title.includes('gate')).title, 'No local gate runs yet: they are recorded from the next gate run');
  const many = { ...none, timings: { trends: Array.from({ length: 20 }, (_, k) => ({ repo: 'r', name: `n${k}`, recentMedian: 200, priorMedian: 100, changePct: 100, recentCount: 3, priorCount: 3 })) } };
  const capped = buildInsights(many);
  assert.equal(capped.length, 10);
  assert.ok(capped.every(i => i.title.length <= 70));
});

test('buildMetricsPayload: shape, window, project filter on sessions, sources', () => {
  const NOW = '2026-11-07T12:00:00.000Z';
  const mv = (at, from, to) => ({ at, event: 'moved', from, to });
  const tk = (id, project, over = {}) => ({ id, title: id, type: 'task', project, lane: 'l', created: '2026-11-01T00:00:00.000Z', history: [], ...over });
  const doc = { sections: [
    { id: 'done', tasks: [tk('A1', 'pa', { history: [mv('2026-11-02T00:00:00.000Z', 'todo', 'in-progress'), mv('2026-11-03T00:00:00.000Z', 'in-progress', 'done')] })] },
    { id: 'todo', tasks: [tk('B1', 'pb')] },
  ], meta: {} };
  const ses = (id, ticket, start, over = {}) => ({ key: id, sessionId: id, ticket, title: `${ticket} x`, start, end: start, wallMin: 60, activeMin: 30, waitUserMin: 30, questions: 1, questionsMidRun: 0, stalls: 0, helpers: 1, costUSD: 2, ...over });
  const sessions = [
    ses('s1', 'A1', '2026-11-03T10:00:00.000Z'),
    ses('s2', 'A1', '2026-11-04T10:00:00.000Z', { stalls: 1 }),
    ses('s3', 'B1', '2026-11-05T10:00:00.000Z'),
    ses('old', 'A1', '2026-08-01T10:00:00.000Z'),
  ];
  const timings = [
    { at: '2026-11-06T00:00:00.000Z', kind: 'ci', host: 'ci', name: 'CI', workflow: 'CI', repo: 'r', branch: 'x', seconds: 100, queuedSeconds: 10, ok: false },
    { at: '2026-11-06T01:00:00.000Z', kind: 'ci', host: 'ci', name: 'CI', workflow: 'CI', repo: 'r', branch: 'x', seconds: 120, queuedSeconds: 20, ok: true },
  ];
  const p = buildMetricsPayload({ doc, sessions, timings, cfg: {}, now: NOW });
  assert.deepEqual(Object.keys(p), ['generatedAt', 'window', 'filters', 'flow', 'sessions', 'health', 'quality', 'costs', 'estimates', 'timings', 'next', 'insights', 'sources']);
  assert.deepEqual(p.filters.projects, ['pa', 'pb']);
  assert.equal(p.sessions.summary.n, 3); // 'old' is outside the window
  assert.equal(p.sessions.summary.autonomousShare, 0.667);
  assert.deepEqual(p.sessions.summary.sessionsPerTicket, { median: 1.5, max: 2 });
  assert.equal(p.sessions.summary.waitUserHours, 1.5);
  assert.equal(p.sessions.summary.toolWaits, 0);
  assert.equal(p.sessions.summary.silentSessions, 1);
  assert.equal(p.sessions.summary.sessionsWaitedOver1h, 0);
  assert.equal(p.sessions.summary.costUSD, 6);
  assert.equal(p.sessions.recent[0].sessionId, 's3');
  assert.equal(p.sessions.topTickets[0].ticket, 'A1');
  const pa = buildMetricsPayload({ doc, sessions, timings, cfg: {}, now: NOW, project: 'pa' });
  assert.equal(pa.sessions.summary.n, 2);
  assert.equal(pa.filters.project, 'pa');
  assert.equal(p.timings.series[0].points.length, 2);
  assert.equal(p.timings.redTime.summary.branches, 1);
  assert.equal(p.timings.redTime.summary.medianMinutes, 60);
  assert.deepEqual(p.timings.ci.byRepo[0], { repo: 'r', workflow: 'CI', runs: 2, failed: 1, cancelled: 0, flakyReruns: 0, medianSeconds: 110, p90Seconds: 118, failRate: 0.5, medianQueueSeconds: 15, topFailedJobs: [] });
  assert.deepEqual(p.sources.sessions, { records: 4, newest: '2026-11-05T10:00:00.000Z' });
  assert.equal(p.sources.gates.records, 0);
  assert.ok(p.insights.some(i => i.kind === 'missing' && /gate/.test(i.title)));
  assert.ok(Array.isArray(p.next));
});

test('payload CI block: cancelled runs excluded, flaky reruns and top failed jobs counted', () => {
  const ci = (n, over) => ({ key: `k${n}`, kind: 'ci', repo: 'r', workflow: 'CI', branch: 'b', at: `2026-11-05T0${n}:00:00.000Z`, seconds: 100, queuedSeconds: 10, ok: true, conclusion: 'success', attempt: 1, ...over });
  const timings = [
    ci(1, {}), ci(2, { attempt: 2 }),
    ci(3, { ok: false, conclusion: 'failure', failedJobs: ['lint', 'unit'] }), ci(4, { ok: false, conclusion: 'failure', failedJobs: ['lint'] }),
    ci(5, { ok: null, conclusion: 'cancelled', seconds: 5 }), ci(6, { ok: null, conclusion: 'cancelled', seconds: 5 }),
  ];
  const p = buildMetricsPayload({ doc: { sections: [], meta: {} }, timings, now: '2026-11-06T00:00:00.000Z', since: '2026-11-01T00:00:00.000Z' });
  const r = p.timings.ci.byRepo[0];
  assert.deepEqual([r.runs, r.failed, r.cancelled, r.flakyReruns, r.failRate, r.medianSeconds], [4, 2, 2, 1, 0.5, 100]);
  assert.deepEqual(r.topFailedJobs, [{ name: 'lint', count: 2 }, { name: 'unit', count: 1 }]);
  assert.equal(p.timings.series[0].points.length, 4);
});
