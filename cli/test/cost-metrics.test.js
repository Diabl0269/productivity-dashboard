/**
 * cli/test/cost-metrics.test.js: cost at API prices (model prices, usage in transcripts, helpers,
 * per-ticket attribution, payload `costs`, the insight and `ch metrics cost`). Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeModel, priceUsage } from '../../shared/model-prices.js';
import { summarizeSession, summarizeHelperUsage, applyHelpers } from '../../shared/session-metrics.js';
import { collectSessions } from '../lib/session-files.js';
import { buildMetricsPayload } from '../../shared/metrics-payload.js';
import { buildInsights } from '../../shared/insights.js';

const CH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ch');
const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();

const u = (over = {}) => ({
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, ...over,
});
const asst = (min, id, model, usage, blocks = [{ type: 'text', text: 'a' }], extra = {}) => ({
  type: 'assistant', sessionId: 's1', timestamp: at(min), gitBranch: 'main', ...extra,
  message: { id, model, usage, content: blocks },
});
const bash = (min, id, command, msgId) => asst(min, msgId, 'claude-opus-5', u(), [{ type: 'tool_use', id, name: 'Bash', input: { command } }]);
const human = (min) => ({ type: 'user', sessionId: 's1', timestamp: at(min), origin: { kind: 'human' }, message: { content: 'x' } });
const title = (t) => ({ type: 'custom-title', sessionId: 's1', customTitle: t });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('model prices: normalize ids, unknown model is null, cache write multipliers', () => {
  assert.equal(normalizeModel('claude-opus-5-5[1m]'), 'claude-opus-5-5');
  assert.equal(normalizeModel('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.equal(normalizeModel(undefined), null);
  assert.equal(priceUsage('<synthetic>', { input: 1000 }), null);
  // opus-5: $5 in, $25 out, $0.50 read per million; 5m write 1.25x, 1h write 2x input
  close(priceUsage('claude-opus-5', { input: 1e6, output: 1e6, cacheRead: 1e6 }), 5 + 25 + 0.5);
  close(priceUsage('claude-opus-5', { cacheWrite5m: 1e6 }), 6.25);
  close(priceUsage('claude-opus-5', { cacheWrite1h: 1e6 }), 10);
  // Matched to Claude Code's own totals: Sonnet 5.5 cache reads $0.10, Haiku 5.5 long prompts 5x.
  close(priceUsage('claude-sonnet-5-5', { cacheRead: 1e6 }), 0.1);
  close(priceUsage('claude-haiku-5-5', { input: 50000, output: 1e6 }), (50000 * 0.1 + 1e6 * 0.5) / 1e6);
  close(priceUsage('claude-haiku-5-5', { input: 1000, cacheRead: 200000, output: 1e6 }), 5 * (1000 * 0.1 + 200000 * 0.01 + 1e6 * 0.5) / 1e6);
  close(priceUsage('claude-sonnet-5-5[1m]', { input: 1e6 }), 2);
});

test('usage: one API message written as several lines counts once; per model; cache write fallback', () => {
  const r = summarizeSession([
    human(0),
    asst(1, 'm1', 'claude-opus-5', u({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 } }), [{ type: 'text', text: 'a' }]),
    asst(1, 'm1', 'claude-opus-5', u({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 } }), [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
    asst(2, 'm2', 'claude-haiku-4-5', { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 40 }),
    asst(3, 'm3', '<synthetic>', u({ input_tokens: 7 })),
    asst(4, 'side', 'claude-opus-5', u({ input_tokens: 999 }), undefined, { isSidechain: true }),
  ]);
  assert.deepEqual(r.tokens, { input: 117, output: 55, cacheRead: 1000, cacheWrite: 540 });
  const opus = 100 * 5 + 50 * 25 + 1000 * 0.5 + 200 * 5 * 1.25 + 300 * 5 * 2;
  const haiku = 10 * 1 + 5 * 5 + 40 * 1 * 1.25;
  close(r.byModel['claude-opus-5'].costUSD, opus / 1e6);
  close(r.byModel['claude-haiku-4-5'].costUSD, haiku / 1e6);
  assert.equal(r.byModel['claude-haiku-4-5'].cacheWrite, 40);
  assert.equal(r.byModel['<synthetic>'].costUSD, 0);
  assert.equal(r.costUSD, Math.round(((opus + haiku) / 1e6) * 100) / 100);
  assert.equal(r.byModel['claude-opus-5'].input, 100);
});

test('tool calls and Agent calls are counted by name, once per tool_use id', () => {
  const agent = (min, id, model) => asst(min, `m${id}`, 'claude-opus-5', u(), [{ type: 'tool_use', id, name: 'Agent', input: model ? { model } : {} }]);
  const r = summarizeSession([
    human(0), agent(1, 'a1', 'haiku'), agent(2, 'a2'), agent(3, 'a3', 'haiku'),
    asst(4, 'mr', 'claude-opus-5', u(), [{ type: 'tool_use', id: 'r1', name: 'Read', input: {} }]),
    asst(4, 'mr', 'claude-opus-5', u(), [{ type: 'tool_use', id: 'r1', name: 'Read', input: {} }]),
  ]);
  assert.deepEqual(r.toolCalls, { Agent: 3, Read: 1 });
  assert.equal(r.toolCallsTotal, 4);
  assert.equal(r.agentCalls, 3);
  assert.deepEqual(r.agentModels, { haiku: 2, inherit: 1 });
});

test('byTicket: `ch tasks move <ID> in-progress` switches the current ticket', () => {
  const big = u({ output_tokens: 1e6 }); // $25 on opus-5
  const r = summarizeSession([
    title('EPC1 - epic'), human(0),
    asst(1, 'a', 'claude-opus-5', big),
    bash(2, 'b1', 'CH_HOME=/x ./ch tasks move kid1 in-progress', 'b'),
    asst(3, 'c', 'claude-opus-5', big, [{ type: 'tool_use', id: 'r', name: 'Read', input: {} }]),
    bash(4, 'b2', 'echo hi && ch tasks move KID2 in-progress', 'd'),
    asst(5, 'e', 'claude-opus-5', big),
    bash(6, 'b3', 'ch tasks move KID3 review', 'f'), // not a start of work
  ]);
  assert.equal(r.ticket, 'EPC1');
  assert.deepEqual(r.ticketTimeline.map(x => x[1]), ['KID1', 'KID2']);
  assert.equal(r.byTicket.EPC1.costUSD, 25);
  assert.equal(r.byTicket.KID1.costUSD, 25);
  assert.equal(r.byTicket.KID2.costUSD, 25);
  assert.equal(r.byTicket.KID1.toolCalls, 2); // the Read and the next move command
  assert.equal(r.byTicket.KID1.tokens, 1e6);
  // no switch: just the session's ticket; no ticket at all: nothing to attribute to
  assert.deepEqual(Object.keys(summarizeSession([title('EPC1 - e'), human(0), asst(1, 'a', 'claude-opus-5', big)]).byTicket), ['EPC1']);
  assert.deepEqual(summarizeSession([human(0), asst(1, 'a', 'claude-opus-5', big)]).byTicket, {});
});

test('helpers: summarized by usage and attributed to the ticket current at their first line', () => {
  const big = u({ output_tokens: 1e6 });
  const main = summarizeSession([
    title('EPC1 - epic'), human(0),
    asst(1, 'a', 'claude-opus-5', u({ input_tokens: 1e6 })), // $5
    bash(10, 'b1', 'ch tasks move KID1 in-progress', 'b'),
  ]);
  const helperLines = (startMin, model) => [
    { type: 'user', isSidechain: true, timestamp: at(startMin), message: { content: 'go' } },
    asst(startMin + 1, 'h1', model, big, [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }], { isSidechain: true }),
    asst(startMin + 1, 'h1', model, big, undefined, { isSidechain: true }),
  ];
  const h1 = summarizeHelperUsage(helperLines(5, 'claude-sonnet-5-5')); // before the switch: $10
  const h2 = summarizeHelperUsage(helperLines(20, 'claude-haiku-4-5')); // after: $5
  assert.equal(h1.costUSD, 10);
  assert.equal(h1.toolCallsTotal, 1);
  assert.equal(h1.firstMs, T0 + 5 * 60000);
  applyHelpers(main, [h1, h2]);
  assert.equal(main.helperCostUSD, 15);
  assert.equal(main.costUSD, 20);
  assert.equal(main.helperToolCalls, 2); // one tool call in each helper
  assert.equal(main.helperTokens.output, 2e6);
  assert.equal(main.helperByModel['claude-haiku-4-5'].costUSD, 5);
  assert.equal(main.byTicket.EPC1.costUSD, 15);
  assert.equal(main.byTicket.KID1.costUSD, 5);
  assert.equal(summarizeHelperUsage([{ type: 'user' }]).costUSD, null);
});

test('session-files: helper transcripts add cost, and a new helper invalidates the cache', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-cost-'));
  try {
    const lines = [title('PRO9 - x'), human(0), asst(1, 'a', 'claude-opus-5', u({ input_tokens: 1e6 }))];
    fs.writeFileSync(path.join(dir, 's1.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    const first = await collectSessions({ dirs: [dir] });
    assert.equal(first.records[0].costUSD, 5);
    assert.equal(first.records[0].helperCostUSD, null);
    const sub = path.join(dir, 's1', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const hl = [asst(2, 'h', 'claude-opus-5', u({ output_tokens: 1e6 }), undefined, { isSidechain: true })];
    fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), hl.map(l => JSON.stringify(l)).join('\n') + '\n');
    fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), '{}');
    const second = await collectSessions({ dirs: [dir], cache: first.cache });
    assert.equal(second.records[0].helperCostUSD, 25);
    assert.equal(second.records[0].costUSD, 30);
    assert.equal(second.records[0].byTicket.PRO9.costUSD, 30);
    // unchanged helper dir: served from cache
    second.cache[path.join(dir, 's1.jsonl')].record.title = 'cached';
    const third = await collectSessions({ dirs: [dir], cache: second.cache });
    assert.equal(third.records[0].title, 'cached');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const NOW = '2026-11-07T12:00:00.000Z';
const tk = (id, over = {}) => ({ id, title: `${id} title`, type: 'task', project: 'pa', lane: 'l', created: '2026-11-01T00:00:00.000Z', history: [], ...over });
const doc = () => ({
  sections: [
    { id: 'in-progress', tasks: [tk('EP1', { type: 'epic' }), tk('K1', { parentId: 'EP1', labels: ['model:opus'] })] },
    { id: 'review', tasks: [tk('K2', { parentId: 'EP1', labels: ['model:opus'] }), tk('K3', { parentId: 'EP1', labels: ['model:haiku'] })] },
    { id: 'done', tasks: [tk('S1'), tk('S2', { labels: ['model:opus'] }), tk('K4', { parentId: 'EP1' })] },
  ],
  meta: {},
});
const ses = (id, ticket, cost, byTicket, over = {}) => ({
  key: id, sessionId: id, ticket, title: `${ticket} x`, start: '2026-11-03T10:00:00.000Z', end: '2026-11-03T11:00:00.000Z',
  wallMin: 60, activeMin: 30, costUSD: cost, helperCostUSD: 0, byTicket,
  byModel: { 'claude-opus-5': { costUSD: cost } }, tokens: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }, helperTokens: {}, ...over,
});

test('payload costs: byTicket attribution and share, byEpic rollup through parentId, perShipped median/p75', () => {
  const sessions = [
    ses('s1', 'EP1', 10, { EP1: { costUSD: 2, tokens: 100, toolCalls: 3 }, K1: { costUSD: 6, tokens: 500, toolCalls: 9 }, K2: { costUSD: 2, tokens: 50, toolCalls: 1 } }, { helperCostUSD: 4 }),
    ses('s2', 'K3', 4, { K3: { costUSD: 4, tokens: 10, toolCalls: 2 } }),
    ses('s3', 'S1', 2, { S1: { costUSD: 2, tokens: 5, toolCalls: 0 } }),
    ses('s4', 'S2', 6, { S2: { costUSD: 6, tokens: 5, toolCalls: 0 } }),
    ses('s5', 'K4', 8, { K4: { costUSD: 8, tokens: 5, toolCalls: 0 } }),
    ses('old', 'S1', 99, { S1: { costUSD: 99 } }, { start: '2026-08-01T10:00:00.000Z' }),
    // an older record with only costUSD goes whole to its ticket
    { key: 'legacy', ticket: 'K4', start: '2026-11-04T10:00:00.000Z', costUSD: 2, activeMin: 10 },
  ];
  const c = buildMetricsPayload({ doc: doc(), sessions, cfg: {}, now: NOW }).costs;
  assert.equal(c.total.costUSD, 32);
  assert.equal(c.total.helperCostUSD, 4);
  assert.equal(c.total.sessions, 6);
  assert.equal(c.total.byModel[0].model, 'claude-opus-5');
  const k1 = c.byTicket.find(t => t.ticket === 'K1');
  assert.deepEqual([k1.costUSD, k1.tokens, k1.toolCalls, k1.sessions, k1.state, k1.title, k1.labels], [6, 500, 9, 1, 'in-progress', 'K1 title', ['model:opus']]);
  assert.equal(k1.share, 0.188);
  assert.equal(c.byTicket[0].ticket, 'K4'); // 8 + 2 legacy = 10, ties with nothing bigger
  assert.equal(c.byTicket.find(t => t.ticket === 'K4').costUSD, 10);
  assert.equal(c.byTicket.find(t => t.ticket === 'EP1').activeMin, 30);
  assert.ok(!c.byTicket.some(t => t.ticket === 'S1' && t.costUSD > 2)); // the old session is outside the window
  const ep = c.byEpic[0];
  assert.equal(ep.epic, 'EP1');
  assert.equal(ep.costUSD, 2 + 6 + 2 + 4 + 10); // own + K1 + K2 + K3 + K4
  assert.deepEqual(ep.children.map(k => [k.ticket, k.costUSD]), [['K4', 10], ['K1', 6], ['K3', 4], ['EP1', 2], ['K2', 2]]);
  assert.equal(ep.children.find(k => k.ticket === 'EP1').own, true);
  // shipped = now in review or done, grouped by model label
  const opus = c.perShipped.find(g => g.label === 'model:opus');
  assert.deepEqual([opus.n, opus.medianUSD, opus.totalUSD], [2, 4, 8]); // K2 (2) and S2 (6)
  assert.equal(opus.p75USD, 5);
  const none = c.perShipped.find(g => g.label === 'none');
  assert.deepEqual([none.n, none.medianUSD, none.totalUSD], [2, 6, 12]); // S1 (2) and K4 (10)
  assert.equal(c.plan, undefined);
  const pa = buildMetricsPayload({ doc: doc(), sessions, cfg: {}, now: NOW, project: 'pa' }).costs;
  assert.equal(pa.total.sessions, 6);
  assert.equal(buildMetricsPayload({ doc: doc(), sessions, cfg: {}, now: NOW, project: 'nope' }).costs.total.sessions, 0);
});

test('payload costs: plan multiple scales the window to 30 days', () => {
  const sessions = [ses('s1', 'S1', 10, { S1: { costUSD: 10 } })];
  const p = buildMetricsPayload({ doc: doc(), sessions, cfg: { planUSDPerMonth: 50 }, now: NOW, since: '2026-10-28T12:00:00.000Z' });
  assert.deepEqual(p.costs.plan, { usdPerMonth: 50, apiEquivalentPer30d: 30, multiple: 0.6 }); // 10 days: $10 -> $30
  const none = buildMetricsPayload({ doc: doc(), sessions: [], cfg: {}, now: NOW });
  assert.equal(none.costs.total.costUSD, 0);
  assert.deepEqual(none.costs.byTicket, []);
});

test('insight: the epic that cost most, and the plan multiple when configured', () => {
  const sessions = [
    ses('s1', 'EP1', 10, { EP1: { costUSD: 2 }, K1: { costUSD: 8 } }),
    ses('s2', 'S1', 10, { S1: { costUSD: 10 } }),
  ];
  const payload = buildMetricsPayload({ doc: doc(), sessions, cfg: { planUSDPerMonth: 5 }, now: NOW });
  const i = payload.insights.find(x => x.title.includes('cost the most'));
  assert.ok(i, JSON.stringify(payload.insights));
  assert.match(i.title, /^EP1 cost the most: \$10\.00, 50% of the window's \$20\.00$/);
  assert.match(i.detail, /\$20\.00 at API prices|API list prices/);
  assert.match(i.detail, /your \$5\.00 plan/);
  const noPlan = buildInsights({ costs: { ...payload.costs, plan: undefined } });
  assert.ok(!noPlan.find(x => x.title.includes('cost the most')).detail.includes('plan'));
  assert.ok(!buildInsights({ costs: { total: { costUSD: 0 } } }).some(x => x.title.includes('cost')));
});

test('ch metrics cost: table, one ticket, an epic per child, json, report block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-cost-cli-'));
  try {
    fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc()));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ metrics: { planUSDPerMonth: 100 } }));
    fs.mkdirSync(path.join(dir, 'metrics'));
    const recent = new Date(Date.now() - 86400000).toISOString();
    const s = { ...ses('s1', 'EP1', 10, { EP1: { costUSD: 4, tokens: 1200000, toolCalls: 3 }, K1: { costUSD: 6, tokens: 500, toolCalls: 9 } }), start: recent, end: recent };
    fs.writeFileSync(path.join(dir, 'metrics', 'sessions.jsonl'), JSON.stringify(s) + '\n');
    const run = (...a) => spawnSync('node', [CH, 'metrics', ...a], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
    const table = run('cost', '--since', '30d');
    assert.equal(table.status, 0, table.stderr);
    assert.match(table.stdout, /\$10\.00 at API prices/);
    assert.match(table.stdout, /K1\s+\$6\.00\s+60%\s+500\s+9\s+1\s+K1 title/);
    assert.match(table.stdout, /EP1\s+\$4\.00\s+40%\s+1\.2M/);
    const epic = run('cost', 'ep1');
    assert.match(epic.stdout, /Epic EP1\s+\$10\.00 in all/);
    assert.match(epic.stdout, /K1\s+\$6\.00/);
    assert.match(epic.stdout, /\(its own sessions\)/);
    const one = run('cost', 'K1', '--json');
    assert.equal(JSON.parse(one.stdout).ticket.costUSD, 6);
    assert.equal(JSON.parse(run('cost', '--json').stdout).total.costUSD, 10);
    assert.equal(run('cost', 'ZZ9').status, 1);
    const rep = run('report');
    assert.match(rep.stdout, /Cost \$10\.00 at API prices/);
    assert.match(rep.stdout, /epic EP1\s+\$10\.00/);
    assert.ok(JSON.parse(run('report', '--json').stdout).costs.byTicket.length >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
