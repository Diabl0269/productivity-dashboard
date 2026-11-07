import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redTime, trend } from '../../shared/ci-metrics.js';
import { ciRecordsFromRuns, collectCi } from '../commands/metrics.js';

const run = (branch, at, ok, repo = 'o/r') => ({ repo, branch, at, ok });

test('redTime: first failure to next success, per branch', () => {
  const out = redTime([
    run('a', '2026-01-01T10:00:00Z', false),
    run('a', '2026-01-01T10:30:00Z', false),
    run('a', '2026-01-01T11:00:00Z', true),
    run('b', '2026-01-01T10:00:00Z', true),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].branch, 'a');
  assert.equal(out[0].redMinutes, 60);
  assert.equal(out[0].open, false);
});

test('redTime: still-red branch is open; green branches give nothing', () => {
  const out = redTime([
    run('a', '2026-01-01T10:00:00Z', false),
    run('a', '2026-01-01T10:20:00Z', false),
    run('b', '2026-01-01T10:00:00Z', true),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].open, true);
  assert.equal(out[0].redMinutes, 20);
});

test('trend: median of last 7 days vs the 7 before', () => {
  const now = Date.parse('2026-01-20T00:00:00Z');
  const d = n => new Date(now - n * 86400000).toISOString();
  const rec = (n, seconds) => ({ repo: 'r', kind: 'gate', name: 'g', at: d(n), seconds });
  const out = trend([rec(1, 100), rec(2, 140), rec(3, 120), rec(9, 100), rec(10, 100), rec(30, 999)], { now });
  assert.equal(out.length, 1);
  assert.equal(out[0].recentMedian, 120);
  assert.equal(out[0].priorMedian, 100);
  assert.equal(out[0].changePct, 20);
});

test('trend: no prior data gives null change', () => {
  const now = Date.parse('2026-01-20T00:00:00Z');
  const out = trend([{ repo: 'r', kind: 'ci', name: 'x', at: '2026-01-19T00:00:00Z', seconds: 5 }], { now });
  assert.equal(out[0].changePct, null);
});

const GH = [
  { databaseId: 11, workflowName: 'CI', headBranch: 'main', headSha: 'abc', event: 'push', status: 'completed', conclusion: 'success',
    createdAt: '2026-01-01T10:00:00Z', startedAt: '2026-01-01T10:00:30Z', updatedAt: '2026-01-01T10:05:30Z' },
  { databaseId: 12, workflowName: 'CI', headBranch: 'x', headSha: 'def', event: 'pull_request', status: 'completed', conclusion: 'failure',
    createdAt: '2026-01-01T11:00:00Z', startedAt: '2026-01-01T11:00:10Z', updatedAt: '2026-01-01T11:01:10Z' },
  { databaseId: 13, workflowName: 'CI', headBranch: 'x', headSha: 'ghi', event: 'push', status: 'in_progress', conclusion: '',
    createdAt: '2026-01-01T12:00:00Z', startedAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:00:00Z' },
];

test('ciRecordsFromRuns maps completed runs only', () => {
  const recs = ciRecordsFromRuns('o/r', GH);
  assert.equal(recs.length, 2);
  assert.deepEqual(
    { key: recs[0].key, kind: recs[0].kind, host: recs[0].host, name: recs[0].name, seconds: recs[0].seconds, queuedSeconds: recs[0].queuedSeconds, ok: recs[0].ok, source: recs[0].source },
    { key: 'gh:o/r:11', kind: 'ci', host: 'ci', name: 'CI', seconds: 300, queuedSeconds: 30, ok: true, source: 'gh' },
  );
  assert.equal(recs[1].ok, false);
  assert.equal(recs[1].conclusion, 'failure');
  assert.equal(recs[1].event, 'pull_request');
});

test('collectCi uses the injected runner and survives a failing repo', () => {
  const cfg = { repos: [{ repo: 'o/r', workflows: ['CI'] }, { repo: 'o/bad' }] };
  const calls = [];
  const runner = (repo, wf) => {
    calls.push([repo, wf]);
    if (repo === 'o/bad') throw new Error('gh: not found');
    return GH;
  };
  const { records, repos } = collectCi({ cfg, runner });
  assert.equal(records.length, 2);
  assert.equal(repos, 1);
  assert.deepEqual(calls, [['o/r', 'CI'], ['o/bad', null]]);
});
