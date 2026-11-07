import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ch');

function home(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-metrics-'));
  if (config) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}
function ch(dir, args) {
  return spawnSync('node', [CH, 'metrics', ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
}
function timings(dir) {
  const f = path.join(dir, 'metrics', 'timings.jsonl');
  return fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
}

test('time records the run and passes the exit code through', () => {
  const dir = home();
  const r = ch(dir, ['time', 'mytest', '--repo', 'demo', '--', 'node', '-e', 'process.exit(3)']);
  assert.equal(r.status, 3);
  const [rec] = timings(dir);
  assert.equal(rec.name, 'mytest');
  assert.equal(rec.repo, 'demo');
  assert.equal(rec.kind, 'other');
  assert.equal(rec.ok, false);
  assert.equal(rec.source, 'manual');
  assert.equal(rec.host, 'local');
  assert.ok(rec.seconds >= 0);
  const ok = ch(dir, ['time', 'fine', '--', 'node', '-e', '0']);
  assert.equal(ok.status, 0);
  assert.equal(timings(dir)[1].ok, true);
});

test('record writes a manual timing', () => {
  const dir = home();
  const r = ch(dir, ['record', '--name', 'lint', '--seconds', '12.5', '--failed', '--kind', 'test', '--at', '2026-01-02T03:04:05Z']);
  assert.equal(r.status, 0, r.stderr);
  const [rec] = timings(dir);
  assert.equal(rec.name, 'lint');
  assert.equal(rec.seconds, 12.5);
  assert.equal(rec.ok, false);
  assert.equal(rec.kind, 'test');
  assert.equal(rec.at, '2026-01-02T03:04:05.000Z');
  assert.equal(ch(dir, ['record', '--name', 'x']).status, 1);
});

test('collect --gates maps gate JSONL and build TSV, and is idempotent', () => {
  const dir = home();
  const gate = path.join(dir, 'gate.jsonl');
  const tsv = path.join(dir, 'build.log');
  fs.writeFileSync(gate,
    JSON.stringify({ at: '2026-01-01T10:00:00Z', name: 'ci-local', worktree: 'wt1', branch: 'b', sha: 's', ok: true, seconds: 412, steps: { build: 300, tests: 100 } }) + '\n' +
    'not json\n' +
    JSON.stringify({ at: '2026-01-01T11:00:00Z', name: 'ci-local', worktree: 'wt2', ok: false, seconds: 50, steps: { build: 40 } }) + '\n' +
    JSON.stringify({ at: '2026-01-01T13:00:00Z', name: 'ci-local', worktree: 'wt3', ok: false, seconds: 1, steps: {} }) + '\n'); // --help run: skipped
  fs.writeFileSync(tsv, '2026-01-01T10:00:00Z\twt1\t5\t7\t300\t2\n2026-01-01T12:00:00Z\twt1\t5\t0\t0\t0\n');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    metrics: { gateLogs: [{ repo: 'demo', path: gate }], buildTimeLogs: [{ repo: 'demo', path: tsv }] },
  }));

  const r = ch(dir, ['collect', '--gates']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /gates: 3 runs/);
  const recs = timings(dir);
  assert.equal(recs.length, 3); // wt3 (empty steps) is skipped
  const g = recs.find(x => x.key === 'gate:demo:2026-01-01T10:00:00Z:wt1');
  assert.equal(g.kind, 'gate');
  assert.equal(g.seconds, 412);
  assert.equal(g.source, 'gate-log');
  assert.deepEqual(g.steps, { build: 300, tests: 100 });
  const b = recs.find(x => x.kind === 'build');
  assert.equal(b.seconds, 300);
  assert.deepEqual(b.steps, { wait: 7, build: 300 });
  assert.equal(b.key, 'build:demo:2026-01-01T10:00:00Z:wt1');

  ch(dir, ['collect', '--gates']);
  assert.equal(timings(dir).length, 3);
});

test('collect --sessions and --ci skip cleanly without config', () => {
  const dir = home();
  const r = ch(dir, ['collect', '--ci', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const s = ch(dir, ['collect', '--sessions']);
  assert.equal(s.status, 0, s.stderr);
});

test('unknown subcommand fails', () => {
  const dir = home();
  assert.equal(ch(dir, ['bogus']).status, 1);
});

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('collect --sessions reads transcripts (prefix entries too); flow and report work on the result', () => {
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-cproj-'));
  for (const n of ['-Users-x-work', '-Users-x-work-app']) fs.mkdirSync(path.join(projects, n));
  fs.copyFileSync(path.join(FX, 'transcript-basic.jsonl'), path.join(projects, '-Users-x-work', 'a.jsonl'));
  fs.copyFileSync(path.join(FX, 'transcript-basic.jsonl'), path.join(projects, '-Users-x-work-app', 'b.jsonl'));
  const dir = home({ metrics: { claudeProjects: [path.join(projects, '-Users-x-work*')] } });
  fs.copyFileSync(path.join(FX, 'tasks.sample.json'), path.join(dir, 'tasks.json'));
  const c = ch(dir, ['collect', '--sessions', '--json', '--since', '3650d']);
  assert.equal(c.status, 0, c.stderr);
  assert.equal(JSON.parse(c.stdout).sessions.changed, 2);
  const recs = fs.readFileSync(path.join(dir, 'metrics', 'sessions.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(recs.length >= 1);

  const flow = ch(dir, ['flow', '--json']);
  assert.equal(flow.status, 0, flow.stderr);
  assert.ok(JSON.parse(flow.stdout).throughputByWeek);
  const human = ch(dir, ['flow']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Bottleneck:/);
  assert.match(human.stdout, /Stage\s+stays/);

  const rep = ch(dir, ['report', '--json', '--since', '3650d']);
  assert.equal(rep.status, 0, rep.stderr);
  const p = JSON.parse(rep.stdout);
  assert.ok(p.sessions.summary.n >= 1);
  assert.ok(p.insights.some(i => i.kind === 'missing'));
  const text = ch(dir, ['report']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Insights/);
  assert.match(text.stdout, /Headline numbers/);
  assert.equal(ch(dir, ['report', '--since', 'soon']).status, 1);
});
