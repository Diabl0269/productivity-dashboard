// /api/automations against a temp LAUNCH_AGENTS_DIR and a mock launchctl (LAUNCHCTL_BIN) that logs its calls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { handleAutomationsRoute } from '../../server/automations-routes.js';

let tmp, srv, base;
const label = 'local.opencode.demo';

function readBody(req) {
  return new Promise(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s)); });
}
const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const calls = () => fs.existsSync(path.join(tmp, 'calls.log')) ? fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8').trim().split('\n') : [];

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-'));
  fs.mkdirSync(path.join(tmp, 'agents'));
  fs.mkdirSync(path.join(tmp, 'logs'));
  const mock = path.join(tmp, 'launchctl');
  fs.writeFileSync(mock, `#!/bin/sh\necho "$@" >> "${tmp}/calls.log"\ncase "$1" in list) printf 'PID\\tStatus\\tLabel\\n-\\t0\\t${label}\\n';; esac\nexit 0\n`, { mode: 0o755 });
  const script = path.join(tmp, 'run.sh');
  fs.writeFileSync(script, '#!/bin/bash\nopencode-cli run "hello"\n');
  const src = path.join(tmp, 'src.json');
  fs.writeFileSync(src, JSON.stringify({
    Label: label, ProgramArguments: ['/bin/bash', script, 'demo'], StartCalendarInterval: { Weekday: 0, Hour: 9, Minute: 3 },
    StandardOutPath: path.join(tmp, 'logs', 'demo.log'),
  }));
  assert.equal(spawnSync('plutil', ['-convert', 'xml1', '-o', path.join(tmp, 'agents', `${label}.plist`), src]).status, 0);
  fs.writeFileSync(path.join(tmp, 'logs', 'demo.log'), 'line1\nline2\n');
  fs.writeFileSync(path.join(tmp, 'logs', 'demo.last.json'), JSON.stringify({ sessionID: 'ses_abc', exitCode: 0 }));
  Object.assign(process.env, { LAUNCH_AGENTS_DIR: path.join(tmp, 'agents'), AUTOMATION_LOG_DIR: path.join(tmp, 'logs'), LAUNCHCTL_BIN: mock });
  srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!handleAutomationsRoute(req, res, url, { readBody })) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('GET lists the plist with schedule, state, script, tool and last session', async () => {
  const { status, body } = await api('GET', '/api/automations');
  assert.equal(status, 200);
  const a = body.automations.find(x => x.label === label);
  assert.equal(a.scheduleText, 'Sun 09:03');
  assert.equal(a.state, 'loaded');
  assert.equal(a.tool, 'opencode');
  assert.match(a.script.content, /opencode-cli run/);
  assert.equal(a.lastSession.sessionID, 'ses_abc');
});

test('PUT rewrites schedule + script, lints, and reloads', async () => {
  const { status, body } = await api('PUT', `/api/automations/${label}`, {
    schedule: { calendar: [{ Weekday: 1, Hour: 7, Minute: 30 }, { Weekday: 2, Hour: 7, Minute: 30 }] },
    scriptContent: '#!/bin/bash\nopencode-cli run "changed"\n',
  });
  assert.equal(status, 200);
  assert.equal(body.automation.scheduleText, 'Mon–Tue 07:30');
  assert.match(body.automation.script.content, /changed/);
  assert.equal(body.reloaded, true);
  assert.ok(calls().some(c => c.startsWith('bootout')));
  assert.ok(calls().some(c => c.startsWith('bootstrap')));
});

test('PUT refuses invalid schedules and unknown labels', async () => {
  assert.equal((await api('PUT', `/api/automations/${label}`, { schedule: { calendar: [{ Hour: 99 }] } })).status, 400);
  assert.equal((await api('PUT', '/api/automations/nope', {})).status, 404);
  assert.equal((await api('GET', '/api/automations/..%2Fetc')).status, 400);
});

test('run, toggle, log tail', async () => {
  assert.equal((await api('POST', `/api/automations/${label}/run`)).status, 200);
  assert.ok(calls().some(c => c.startsWith('kickstart -k')));
  assert.equal((await api('POST', `/api/automations/${label}/toggle`, { enabled: false })).status, 200);
  assert.ok(calls().some(c => c.startsWith('disable')));
  const log = await api('GET', `/api/automations/${label}/log`);
  assert.equal(log.body.text, 'line1\nline2\n');
});

test('create then delete', async () => {
  const c = await api('POST', '/api/automations', { label: 'com.example.new', arguments: ['/bin/echo', 'x'], schedule: { calendar: [{ Hour: 1, Minute: 2 }] }, load: false });
  assert.equal(c.status, 200);
  assert.equal(c.body.automation.scheduleText, 'Daily 01:02');
  assert.equal((await api('POST', '/api/automations', { label: 'com.example.new', arguments: ['/bin/echo'] })).status, 409);
  assert.equal((await api('DELETE', '/api/automations/com.example.new')).status, 200);
  assert.ok(!fs.existsSync(path.join(tmp, 'agents', 'com.example.new.plist')));
});

test('open-session for an opencode automation opens the app', async () => {
  const open = path.join(tmp, 'open');
  fs.writeFileSync(open, `#!/bin/sh\necho "open $@" >> "${tmp}/calls.log"\n`, { mode: 0o755 });
  process.env.OPEN_BIN = open;
  const r = await api('POST', `/api/automations/${label}/open-session`);
  assert.equal(r.body.done, 'open-app');
  assert.equal(r.body.sessionID, 'ses_abc');
  assert.ok(calls().some(c => c.startsWith('open -a /Applications/OpenCode.app')));
});

test('cross-origin requests are refused', async () => {
  const r = await fetch(base + '/api/automations', { headers: { Origin: 'http://evil.example' } });
  assert.equal(r.status, 403);
});
