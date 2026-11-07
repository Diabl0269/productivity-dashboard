/**
 * cli/test/insights.test.js: shared/insights.js rules and shared/metrics-payload.js on small inputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights, fmtHours } from '../../shared/insights.js';
import { buildMetricsPayload } from '../../shared/metrics-payload.js';

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
    bottleneck: { stage: 'review', totalHours: 84, share: 0.62 },
    groups: { project: { a: { bottleneck: { stage: 'in-progress' } }, b: { bottleneck: { stage: 'review' } } } },
  });
  const [i] = buildInsights({ ...full, flow: f });
  assert.equal(i.kind, 'bottleneck');
  assert.equal(i.title, 'Review holds 62% of the work time');
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

test('review wait median and oldest open card', () => {
  const f = flow({ stages: { todo: stage(null, undefined, 0), 'in-progress': stage(null, undefined, 0), review: stage(6, { n: 2, oldestHours: 96 }) } });
  const [i] = buildInsights({ ...full, flow: f });
  assert.equal(i.kind, 'warn');
  assert.equal(i.title, 'Review waits a median of 6.0 h; 2 cards open now, oldest 4.0 days');
});

test('forgotten epics', () => {
  const f = flow({ forgottenEpics: [{ id: 'E1', idleDays: 5.5 }, { id: 'E2', idleDays: 4 }] });
  const [i] = buildInsights({ ...full, flow: f });
  assert.equal(i.title, '2 epics in progress with no activity');
  assert.equal(i.detail, 'E1 idle 5.5 days, E2 idle 4 days.');
});

test('autonomy share with week-over-week change, mid-run questions and stalls per session', () => {
  const sessions = {
    summary: { n: 10, autonomousShare: 0.6, questionsMidRun: 5, stalls: 3, waitUserHours: 0, medianActiveMin: 30 },
    byWeek: [{ n: 4, autonomousShare: 0.8 }, { n: 6, autonomousShare: 0.5 }],
  };
  const [i] = buildInsights({ ...full, sessions });
  assert.equal(i.title, '60% of sessions ran without asking or going silent');
  assert.match(i.detail, /5 mid-run questions \(0\.5 per session\) and 3 silences \(0\.3 per session\) across 10 sessions\. Down 30 points/);
  assert.equal(i.kind, 'warn'); // dropped by 10+ points
  const good = buildInsights({ ...full, sessions: { summary: { ...sessions.summary, autonomousShare: 0.9 }, byWeek: [] } });
  assert.equal(good[0].kind, 'good');
});

test('silent sessions: model silences vs long tool or permission waits', () => {
  const sessions = { summary: { n: 10, autonomousShare: null, stalls: 2, toolWaits: 5, silentSessions: 4, toolWaitTools: { Bash: 4, Read: 1 } }, byWeek: [] };
  const i = buildInsights({ ...full, sessions }).find(x => x.title.includes('went silent'));
  assert.equal(i.title, '4 sessions went silent mid-turn (2 model, 5 tool waits, mostly Bash)');
  assert.match(i.detail, /2 model silences and 5 long tool or permission waits, mostly Bash\./);
  assert.equal(i.kind, 'warn');
});

test('missed wake-ups rank first and are counted by origin', () => {
  const sessions = { summary: { n: 10, autonomousShare: 0.5, missedWakeSessions: 3, missedWakeOrigins: { 'task-notification': 12, peer: 2, human: 1, 'tool-result': 4 }, silentSessions: 2, stalls: 1, toolWaits: 1 }, byWeek: [] };
  const [i] = buildInsights({ ...full, sessions });
  assert.equal(i.title, '3 sessions got stuck 20+ min (4 stopped mid-turn, 15 unanswered)');
  assert.match(i.detail, /4 times a session stopped right after a tool finished/);
  assert.match(i.detail, /12 notifications, 2 peer messages and 1 prompt of yours went unanswered/);
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
  const timings = { ci: { byRepo: [{ repo: 'r', workflow: 'CI', runs: 10, failRate: 0.3 }, { repo: 'q', workflow: 'CI', runs: 10, failRate: 0.1 }] } };
  const list = buildInsights({ ...full, timings });
  assert.deepEqual(list.map(i => i.title), ['r CI fails 30% of runs']);
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
  assert.deepEqual(Object.keys(p), ['generatedAt', 'window', 'filters', 'flow', 'sessions', 'timings', 'next', 'insights', 'sources']);
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
  assert.deepEqual(p.timings.ci.byRepo[0], { repo: 'r', workflow: 'CI', runs: 2, medianSeconds: 110, p90Seconds: 118, failRate: 0.5, medianQueueSeconds: 15 });
  assert.deepEqual(p.sources.sessions, { records: 4, newest: '2026-11-05T10:00:00.000Z' });
  assert.equal(p.sources.gates.records, 0);
  assert.ok(p.insights.some(i => i.kind === 'missing' && /gate/.test(i.title)));
  assert.ok(Array.isArray(p.next));
});
