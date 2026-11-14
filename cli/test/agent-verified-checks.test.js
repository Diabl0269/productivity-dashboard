/**
 * cli/test/agent-verified-checks.test.js
 * `agentVerified` on a check: schema, `ch tasks update --verify-check`, `ch tasks checks`, normalizeChecks.
 * Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const CH_SCRIPT = path.resolve(__dirname, '../../ch');
const NOTE = 'ran the script against the fixture';

function run(args, home) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}
const read = (home) => JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
function taskOf(home, id) {
  for (const s of read(home).sections) { const t = s.tasks.find(x => x.id === id); if (t) return t; }
  return null;
}
function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-agentver-'));
  const doc = JSON.parse(fs.readFileSync(FIXTURE_SAMPLE, 'utf8'));
  const sec = (id) => doc.sections.find(s => s.id === id);
  const mk = (id, extra) => ({ id, title: `Synthetic ${id}`, priority: 'medium', checked: false, subtasks: [], created: '2026-01-01', updated: '2026-01-01', ...extra });
  const ck = (text, extra = {}) => ({ text, checked: false, ...extra });
  const verified = { at: '2026-01-02T03:04:05.000Z', by: 'agent', result: 'pass', note: NOTE };
  sec('todo').tasks.push(mk('T91', { type: 'epic', checks: [ck('epic open'), ck('epic verified', { agentVerified: verified })] }));
  sec('in-progress').tasks.push(mk('T92', { checks: [ck('wip plain'), ck('wip handed', { handedTo: 'T99' }), ck('wip ticked', { checked: true })] }));
  sec('done').tasks.push(mk('T93', { type: 'epic', checks: [ck('done epic check')] }));
  sec('done').tasks.push(mk('T94', { checks: [ck('done plain')] }));
  sec('todo').tasks.push(mk('T95', { checks: [ck('plain todo ticket check')] }));
  fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc, null, 2));
  return h;
}

test('verify-check pass records the marker and never ticks', () => {
  const h = home();
  const r = run(['tasks', 'update', 'T92', '--verify-check', '1', '--verify-note', NOTE], h);
  assert.equal(r.status, 0, r.stderr);
  const c = taskOf(h, 'T92').checks[0];
  assert.equal(c.checked, false);
  assert.equal(c.agentVerified.result, 'pass');
  assert.equal(c.agentVerified.by, 'agent');
  assert.equal(c.agentVerified.note, NOTE);
  assert.ok(!isNaN(Date.parse(c.agentVerified.at)));
  assert.equal(run(['tasks', 'lint'], h).status, 0);
});

test('verify-check fail with custom by', () => {
  const h = home();
  const r = run(['tasks', 'update', 'T92', '--verify-check', '1', '--verify-note', NOTE, '--verify-result', 'fail', '--verify-by', 'bot'], h);
  assert.equal(r.status, 0, r.stderr);
  const c = taskOf(h, 'T92').checks[0];
  assert.deepEqual([c.agentVerified.result, c.agentVerified.by, c.checked], ['fail', 'bot', false]);
});

test('verify-check needs a note, a valid result and an in-range N', () => {
  const h = home();
  assert.notEqual(run(['tasks', 'update', 'T92', '--verify-check', '1'], h).status, 0);
  assert.notEqual(run(['tasks', 'update', 'T92', '--verify-check', '1', '--verify-note', 'short'], h).status, 0);
  assert.notEqual(run(['tasks', 'update', 'T92', '--verify-check', '1', '--verify-note', NOTE, '--verify-result', 'maybe'], h).status, 0);
  const r = run(['tasks', 'update', 'T92', '--verify-check', '9', '--verify-note', NOTE], h);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--verify-check N must be between 1 and 3/);
  assert.equal(taskOf(h, 'T92').checks[0].agentVerified, undefined);
});

test('unverify-check deletes the marker', () => {
  const h = home();
  run(['tasks', 'update', 'T92', '--verify-check', '1', '--verify-note', NOTE], h);
  const r = run(['tasks', 'update', 'T92', '--unverify-check', '1'], h);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskOf(h, 'T92').checks[0].agentVerified, undefined);
  assert.notEqual(run(['tasks', 'update', 'T92', '--unverify-check', '7'], h).status, 0);
});

test('schema rejects a malformed agentVerified', () => {
  for (const bad of [
    { at: 'x', by: 'a', result: 'pass', note: NOTE },
    { at: '2026-01-02T00:00:00Z', by: 'a', result: 'ok', note: NOTE },
    { at: '2026-01-02T00:00:00Z', by: 'a', result: 'pass', note: '  ' },
    'nope',
  ]) {
    const h = home();
    const doc = read(h);
    doc.sections.find(s => s.id === 'in-progress').tasks.find(t => t.id === 'T92').checks[0].agentVerified = bad;
    fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc));
    const r = run(['tasks', 'lint'], h);
    assert.notEqual(r.status, 0, JSON.stringify(bad));
    assert.match(r.stdout + r.stderr, /agentVerified/);
  }
});

test('ch tasks checks lists only unverified, unticked, not handed-off checks on open epics and wip/review tickets', () => {
  const h = home();
  const out = run(['tasks', 'checks'], h).stdout;
  assert.match(out, /T91#1 epic open/);
  assert.match(out, /T92#1 wip plain/);
  for (const no of ['epic verified', 'wip handed', 'wip ticked', 'done epic check', 'done plain', 'plain todo ticket check']) {
    assert.ok(!out.includes(no), `${no} must not be listed`);
  }
  const json = JSON.parse(run(['tasks', 'checks', '--json'], h).stdout);
  assert.deepEqual(json.map(r => r.id).sort(), ['T91', 'T92']);
});

test('ch tasks checks says so when empty', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-agentver-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(h, 'tasks.json'));
  const r = run(['tasks', 'checks'], h);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No unverified checks\./);
});

test('normalizeChecks keeps agentVerified and drops a malformed one', async () => {
  const { normalizeChecks } = await import(pathToFileURL(path.resolve(__dirname, '../../dashboard/js/tasks-json.js')).href);
  const av = { at: '2026-01-02T03:04:05.000Z', by: 'agent', result: 'fail', note: NOTE };
  const out = normalizeChecks([{ text: 'a', checked: false, agentVerified: av }, { text: 'b', checked: false, agentVerified: { result: 'pass' } }]);
  assert.deepEqual(out[0].agentVerified, av);
  assert.equal(out[1].agentVerified, undefined);
});

test('reviewing a child keeps the agent-verified marker on the epic copy of its check', () => {
  const h = home();
  const doc = read(h);
  const sec = (id) => doc.sections.find(s => s.id === id);
  const verified = { at: '2026-01-02T03:04:05.000Z', by: 'agent', result: 'pass', note: NOTE };
  const base = { priority: 'medium', checked: false, subtasks: [], created: '2026-01-01', updated: '2026-01-01' };
  sec('in-progress').tasks.push({ ...base, id: 'T96', title: 'Synthetic epic', type: 'epic', lane: 'x' });
  sec('in-progress').tasks.push({ ...base, id: 'T97', title: 'Synthetic child', parentId: 'T96', checks: [{ text: 'see the thing', checked: false, agentVerified: verified }] });
  fs.writeFileSync(path.join(h, 'tasks.json'), JSON.stringify(doc, null, 2));
  const r = run(['tasks', 'review', 'T97', '--shipped', 'did it', '--tests', 't', '--ci', 'ok', '--check', 'see the thing'], h);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const epicCheck = taskOf(h, 'T96').checks.find(c => c.text === 'T97: see the thing');
  assert.ok(epicCheck, 'epic got the check');
  assert.deepEqual(epicCheck.agentVerified, verified);
  assert.equal(epicCheck.checked, false);
});
