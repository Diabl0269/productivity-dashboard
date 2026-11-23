/**
 * cli/lib/automation-status.js (PRO122, PRO123): every reader against temp files, fake `launchctl` and `gh`
 * binaries on PATH, and a loopback web server. Never reads the real machine's jobs, logs or GitHub.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  readStatus, readEntryStatus, joinStatus, lastLine, calendarTimes, nextCalendarRun, expandPath, clearGhCache, toMs, waitingFrom,
} from '../lib/automation-status.js';
import { httpUrlProblem, healthState, summarizeHealth, relTime } from '../../shared/home-config-runs.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ch-autostatus-'));
const MIN = 60e3;

/** A fake binary `name` in a fresh dir that prints `out` (and exits `code`), first on PATH while fn runs. */
async function withFakeBin(bins, fn) {
  const dir = tmp();
  for (const [name, script] of Object.entries(bins)) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, `#!/bin/sh\n${script}\n`);
    fs.chmodSync(f, 0o755);
  }
  const old = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${old}`;
  try { return await fn(dir); } finally { process.env.PATH = old; }
}

test('expandPath: ~ is the home folder, relative paths are against the config folder', () => {
  assert.equal(expandPath('~/x.log'), path.join(os.homedir(), 'x.log'));
  assert.equal(expandPath('logs/a.log', '/srv/cfg'), '/srv/cfg/logs/a.log');
  assert.equal(expandPath('/abs/a.log', '/srv/cfg'), '/abs/a.log');
  assert.equal(toMs(1700000000), 1700000000000);
});

test('mtime: newest file in a folder, late against maxAgeMin, missing path is unknown', async () => {
  const dir = tmp();
  const now = Date.now();
  fs.writeFileSync(path.join(dir, 'old'), 'x');
  fs.utimesSync(path.join(dir, 'old'), new Date(now - 300 * MIN), new Date(now - 300 * MIN));
  fs.writeFileSync(path.join(dir, 'new'), 'x');
  fs.utimesSync(path.join(dir, 'new'), new Date(now - 30 * MIN), new Date(now - 30 * MIN));
  fs.utimesSync(dir, new Date(now - 600 * MIN), new Date(now - 600 * MIN));
  const fresh = await readStatus({ type: 'mtime', path: dir, maxAgeMin: 60 }, { now });
  assert.equal(Math.round((now - Date.parse(fresh.lastRun)) / MIN), 30);
  assert.equal(fresh.late, false);
  assert.equal((await readStatus({ type: 'mtime', path: dir, maxAgeMin: 10 }, { now })).late, true);
  const gone = await readStatus({ type: 'mtime', path: path.join(dir, 'nope') });
  assert.equal(gone.ok, null);
  assert.match(gone.detail, /does not exist/);
  // match: only the named entries count, so the newer 'new' file is ignored when it is not the job's trace.
  const only = await readStatus({ type: 'mtime', path: dir, match: '^old$' }, { now });
  assert.equal(Math.round((now - Date.parse(only.lastRun)) / MIN), 300);
  assert.match((await readStatus({ type: 'mtime', path: dir, match: '^none$' })).detail, /matches/);
});

test('json-file: a timestamp field, an ok field, epoch seconds, bad JSON', async () => {
  const dir = tmp();
  const now = Date.parse('2026-06-15T12:00:00Z');
  fs.writeFileSync(path.join(dir, 'tick.json'), JSON.stringify({ at: '2026-06-15T11:55:00Z', intervalMin: 10, run: { result: 'failed' } }));
  const r = await readStatus({ type: 'json-file', path: 'tick.json', okField: 'run.result', maxAgeMin: 30 }, { baseDir: dir, now });
  assert.equal(r.lastRun, '2026-06-15T11:55:00.000Z');
  assert.equal(r.ok, false);
  assert.equal(r.intervalMin, 10);
  fs.writeFileSync(path.join(dir, 'sec.json'), JSON.stringify({ when: 1781524800 }));
  assert.equal((await readStatus({ type: 'json-file', path: 'sec.json', field: 'when' }, { baseDir: dir })).lastRun, new Date(1781524800e3).toISOString());
  fs.writeFileSync(path.join(dir, 'bad.json'), '{');
  const bad = await readStatus({ type: 'json-file', path: 'bad.json' }, { baseDir: dir });
  assert.equal(bad.ok, null);
  assert.match(bad.detail, /could not be read/);
  assert.match((await readStatus({ type: 'json-file', path: 'sec.json' }, { baseDir: dir })).detail, /no time in "at"/);
});

test('log-tail: the last non-empty line, its timestamp, ok and fail patterns', async () => {
  const dir = tmp();
  const f = path.join(dir, 'job.log');
  fs.writeFileSync(f, '2026-06-15T10:00:00Z START one\n2026-06-15T11:00:00.500Z ERROR disk full\n\n  \n');
  const r = await readStatus({ type: 'log-tail', path: f, okPattern: 'START|SKIP', failPattern: 'ERROR' });
  assert.equal(r.lastRun, '2026-06-15T11:00:00.500Z');
  assert.equal(r.ok, false);
  assert.match(r.detail, /ERROR disk full/);
  fs.appendFileSync(f, '[2026-06-15 11:10:00] SKIP gate=busy\n');
  assert.equal((await readStatus({ type: 'log-tail', path: f, okPattern: 'START|SKIP', failPattern: 'ERROR' })).ok, true);
  fs.writeFileSync(f, 'no time here\n');
  const plain = await readStatus({ type: 'log-tail', path: f });
  assert.equal(plain.ok, null);
  assert.equal(Date.parse(plain.lastRun), Math.floor(fs.statSync(f).mtimeMs));
  assert.deepEqual(lastLine(''), { line: '', at: null });
});

const PRINT = `gui/501/com.example.tick = {
\tactive count = 0
\tstate = not running
\tprogram = /bin/sh
\truns = 12
\tlast exit code = 0
\tevent triggers = {
\t\tcom.example.tick.1 => {
\t\t\tdescriptor = {
\t\t\t\t"Minute" => 30
\t\t\t\t"Hour" => 6
\t\t\t}
\t\t}
\t}
\trun interval = 600 seconds
}`;

test('launchctl: loaded with exit 0, a failed exit, not loaded, and not allowed', async () => {
  await withFakeBin({
    launchctl: `case "$2" in
  */com.example.tick) cat <<'EOF'
${PRINT}
EOF
  ;;
  */com.example.bad) printf '\\tstate = not running\\n\\tlast exit code = 78: EX_CONFIG\\n' ;;
  */com.example.never) printf '\\tstate = running\\n\\tlast exit code = (never exited)\\n' ;;
  */com.example.denied) echo 'Could not print domain: 1: Operation not permitted' >&2; exit 1 ;;
  *) echo "Could not find service \\"x\\" in domain for user gui: 501" >&2; exit 113 ;;
esac`,
  }, async () => {
    const now = new Date(2026, 5, 15, 5, 0, 0).getTime();
    const ok = await readStatus({ type: 'launchctl', label: 'com.example.tick' }, { now, uid: 501 });
    assert.equal(ok.ok, true);
    assert.equal(ok.intervalMin, 10);
    assert.equal(ok.nextRun, new Date(2026, 5, 15, 6, 30).toISOString());
    assert.match(ok.detail, /last exit code 0; 12 runs/);
    assert.equal((await readStatus({ type: 'launchctl', label: 'com.example.bad' })).ok, false);
    const never = await readStatus({ type: 'launchctl', label: 'com.example.never' });
    assert.equal(never.ok, null);
    assert.match(never.detail, /running now/);
    const off = await readStatus({ type: 'launchctl', label: 'com.example.gone' });
    assert.equal(off.off, true);
    assert.equal(healthState(off), 'off');
    const denied = await readStatus({ type: 'launchctl', label: 'com.example.denied' });
    assert.equal(denied.ok, null);
    assert.match(denied.detail, /sandbox/);
  });
});

test('calendar times: the next local run, today or tomorrow', () => {
  const times = calendarTimes(PRINT);
  assert.deepEqual(times, [{ Minute: 30, Hour: 6 }]);
  assert.equal(nextCalendarRun(times, new Date(2026, 5, 15, 7, 0).getTime()), new Date(2026, 5, 16, 6, 30).getTime());
  assert.equal(nextCalendarRun([{ Minute: 15 }], new Date(2026, 5, 15, 7, 20).getTime()), new Date(2026, 5, 15, 8, 15).getTime());
  assert.equal(nextCalendarRun([], Date.now()), null);
});

test('gh-workflow: success, failure, running, gh failing; one call per workflow per minute', async () => {
  clearGhCache();
  await withFakeBin({
    gh: `echo "$@" >> "$(dirname "$0")/calls"
case "$*" in
  *--workflow\\ CI*) echo '[{"status":"completed","conclusion":"success","createdAt":"2026-06-15T10:00:00Z","url":"https://github.com/o/r/actions/runs/1","displayTitle":"Fix the oven"}]' ;;
  *--workflow\\ Deploy*) echo '[{"status":"completed","conclusion":"failure","createdAt":"2026-06-15T09:00:00Z","url":"u","displayTitle":"Ship"}]' ;;
  *--workflow\\ Nightly*) echo '[{"status":"in_progress","conclusion":"","createdAt":"2026-06-15T11:00:00Z","url":"u","displayTitle":"Nightly"}]' ;;
  *--workflow\\ Empty*) echo '[]' ;;
  *) echo 'HTTP 404: workflow not found' >&2; exit 1 ;;
esac`,
  }, async (dir) => {
    const ci = await readStatus({ type: 'gh-workflow', repo: 'o/r', workflow: 'CI' });
    assert.equal(ci.ok, true);
    assert.equal(ci.lastRun, '2026-06-15T10:00:00Z');
    assert.equal(ci.url, 'https://github.com/o/r/actions/runs/1');
    assert.match(ci.detail, /success: Fix the oven/);
    await readStatus({ type: 'gh-workflow', repo: 'o/r', workflow: 'CI' });
    assert.equal(fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').length, 1, 'cached');
    assert.equal((await readStatus({ type: 'gh-workflow', repo: 'o/r', workflow: 'Deploy' })).ok, false);
    assert.equal((await readStatus({ type: 'gh-workflow', repo: 'o/r', workflow: 'Nightly' })).ok, null);
    assert.match((await readStatus({ type: 'gh-workflow', repo: 'o/r', workflow: 'Empty' })).detail, /no runs/);
    const missing = await readStatus({ type: 'gh-workflow', repo: 'o/r', workflow: 'Nope' });
    assert.equal(missing.ok, null);
    assert.match(missing.detail, /workflow not found/);
  });
  clearGhCache();
});

test('http: a loopback server up and down; addresses with secrets or plain http elsewhere are refused', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(req.url === '/down' ? 503 : 200);
    res.end('ok');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const up = await readStatus({ type: 'http', url: `${base}/` });
    assert.equal(up.ok, true);
    assert.match(up.detail, /answered 200/);
    assert.equal((await readStatus({ type: 'http', url: `${base}/down` })).ok, false);
  } finally { server.close(); }
  for (const bad of ['http://example.com/', 'https://user:pw@example.com/', 'https://example.com/?token=1', 'https://example.com/?api_key=1', 'ftp://example.com/']) {
    assert.ok(httpUrlProblem(bad), bad);
    const r = await readStatus({ type: 'http', url: bad });
    assert.equal(r.ok, null, bad);
  }
  assert.equal(httpUrlProblem('https://bakery.example/'), null);
  assert.equal(httpUrlProblem('http://localhost:3000/health'), null);
});

test('a reader that hangs answers "no answer" at its timeout; an unknown type never throws', async () => {
  await withFakeBin({ launchctl: 'sleep 5' }, async () => {
    const t = Date.now();
    const r = await readStatus({ type: 'launchctl', label: 'com.example.slow' }, { timeout: 300 });
    assert.ok(Date.now() - t < 2000);
    assert.equal(r.ok, null);
    assert.match(r.detail, /no answer|did not answer/);
  });
  assert.match((await readStatus({ type: 'teleport' })).detail, /unknown status type/);
  assert.match((await readStatus({ type: 'none' })).detail, /no live status/);
});

test('a gated dispatcher tick reads as waiting with its reason and time, not late and not a problem (AGE207)', async () => {
  const dir = tmp();
  const now = new Date(2026, 5, 15, 12, 0).getTime(); // local times: the text is in this computer's zone
  const until = new Date(2026, 5, 15, 14, 0).toISOString(); // 14:00 local today
  fs.writeFileSync(path.join(dir, 'tick.json'), JSON.stringify({ at: new Date(now - 5 * MIN).toISOString(), intervalMin: 10, gate: { name: 'limit', label: 'usage limit', detail: 'account usage limit until ...', until, waiting: true } }));
  // The log repeats an unchanged SKIP line only once an hour, so its tail is 70 min old while the tick itself is on time.
  fs.writeFileSync(path.join(dir, 'autorun.log'), `${new Date(now - 70 * MIN).toISOString()} SKIP gate=limit account usage limit until ...\n`);
  const entry = { status: [
    { type: 'log-tail', path: 'autorun.log', okPattern: 'START|SKIP', maxAgeMin: 25 },
    { type: 'json-file', path: 'tick.json', field: 'at', reasonField: 'gate', maxAgeMin: 25 },
  ] };
  const e = await readEntryStatus(entry, { baseDir: dir, now });
  assert.equal(healthState(e), 'waiting');
  assert.equal(e.late, false);
  assert.equal(e.waiting.text, 'usage limit until 14:00');
  assert.equal(e.waiting.until, until);
  assert.match(e.detail, /waiting: usage limit until 14:00/);
  const sum = summarizeHealth([{ id: 'autorun', name: 'Autorun tick', result: e }]);
  assert.equal(sum.counts.waiting, 1);
  assert.deepEqual(sum.problems, [], 'waiting is not a problem');
  // A heartbeat that is itself late is not trusted to say why: late again.
  const old = await readEntryStatus(entry, { baseDir: dir, now: now + 60 * MIN });
  assert.equal(healthState(old), 'late');
  // A gate that is not a hold (busy: runs are live) is ok, and a hold whose time passed says nothing.
  assert.equal(waitingFrom({ name: 'busy', label: 'busy', waiting: false }, now), null);
  assert.equal(waitingFrom({ name: 'limit', label: 'usage limit', until: new Date(now - MIN).toISOString(), waiting: true }, now), null);
  assert.equal(waitingFrom({ name: 'off', label: 'switched off', until: null, waiting: true }, now).text, 'switched off');
  assert.match(waitingFrom({ name: 'spend', label: 'weekly spend cap', until: new Date(2026, 5, 16, 13, 0).toISOString(), waiting: true }, now).text, /^weekly spend cap until Tue 13:00$/);
  // A failure still wins over waiting.
  assert.equal(healthState(joinStatus([{ ok: false, late: false }, { ok: null, late: false, waiting: { text: 'x' } }], now)), 'failed');
});

test('joining sources: newest run, a failure wins, late, off, next run from the interval', async () => {
  const now = Date.parse('2026-06-15T12:00:00Z');
  const j = joinStatus([
    { type: 'launchctl', lastRun: null, ok: true, late: false, detail: 'loaded', intervalMin: 10 },
    { type: 'log-tail', lastRun: '2026-06-15T11:55:00Z', ok: null, late: false, detail: 'last line' },
  ], now);
  assert.equal(j.ok, true);
  assert.equal(j.nextRun, '2026-06-15T12:05:00.000Z');
  assert.equal(j.detail, 'loaded · last line');
  assert.equal(healthState(joinStatus([{ lastRun: '2026-06-15T09:00:00Z', ok: null, late: true, detail: '' }], now)), 'late');
  assert.equal(healthState(joinStatus([{ ok: true, late: false }, { ok: false, late: false }], now)), 'failed');
  assert.equal(healthState(joinStatus([], now)), 'unknown');
  assert.equal(healthState({ checking: true }), 'checking');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ at: new Date().toISOString() }));
  const e = await readEntryStatus({ status: [{ type: 'json-file', path: 'a.json', maxAgeMin: 5 }, { type: 'none' }] }, { baseDir: dir });
  assert.equal(healthState(e), 'ok');
  assert.equal(e.sources.length, 2);
  const sum = summarizeHealth([{ id: 'a', name: 'A', result: e }, { id: 'b', name: 'B', result: { ok: false } }, { id: 'c', name: 'C', result: { off: true } }]);
  assert.deepEqual(sum.problems.map(p => `${p.id}:${p.state}`), ['b:failed', 'c:off']);
  assert.equal(sum.counts.ok, 1);
  assert.equal(relTime('2026-06-15T11:56:00Z', now), '4 min ago');
  assert.equal(relTime('2026-06-15T15:00:00Z', now), 'in 3 h');
  assert.equal(relTime(null, now), '');
});
