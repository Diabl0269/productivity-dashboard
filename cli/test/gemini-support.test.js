import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateEdit, effectiveRun, HARNESSES, HARNESS_DEFAULTS } from '../../shared/automation-run.js';
import { buildPlist } from '../../scripts/launchagents/lib.mjs';
import { detectTool, buildModel, automationId } from '../../server/automations/model.js';
import { automationCapabilities, clearCapabilitiesCache } from '../../server/automations/capabilities.js';
import { handleAutomationsRoute } from '../../server/automations-routes.js';
import { readLiveSessions } from '../lib/running-inputs.js';
import { collectSessions } from '../lib/session-files.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUN_JOB = path.join(REPO_ROOT, 'scripts', 'launchagents', 'run-job.sh');
const hasPlutil = spawnSync('plutil', ['-help']).status === 0;

function tmpDir(prefix = 'gemini-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('shared/automation-run supports gemini harness defaults and validation', () => {
  assert.ok(HARNESSES.includes('gemini'));
  assert.equal(HARNESS_DEFAULTS.gemini.cli, 'agy');
  const valid = validateEdit({ harness: 'gemini', effort: 'high', model: 'gemini-4-carbon-medium' });
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.patch.harness, 'gemini');
  const run = effectiveRun({ id: 'daily-summary', run: { harness: 'gemini' } });
  assert.equal(run.cli, 'agy');
  assert.equal(run.harness, 'gemini');
});

test('buildPlist includes ~/.local/bin in PATH for agy, claude, and copilot binaries', () => {
  const xml = buildPlist(
    { id: 'daily-summary', schedule: { hour: 8, minute: 58 }, harness: 'gemini', cli: 'agy', model: 'gemini-4-carbon-medium', effort: 'high' },
    { repoRoot: '/Users/you/repo', dirs: { home: '/Users/you', supportDir: '/support', launchDir: '/launch', logDir: '/logs' } },
  );
  assert.match(xml, /AUTOMATION_HARNESS<\/key><string>gemini/);
  assert.match(xml, /AUTOMATION_CLI<\/key><string>agy/);
  assert.match(xml, /\/Users\/you\/\.local\/bin:\/opt\/homebrew\/bin/);
});

test('run-job.sh: gemini and copilot pass -p with prompt last, extract conversation_id cleanly, and write runs.jsonl', () => {
  const dir = tmpDir('run-job-');
  try {
    const logDir = path.join(dir, 'logs');
    const agyCalls = path.join(dir, 'agy.args');
    const mockAgy = path.join(dir, 'agy');
    fs.writeFileSync(mockAgy, `#!/bin/bash
printf '%s\\n' "$@" > "${agyCalls}"
# Output a 40-char git SHA and dashes first to verify they never hijack conversation_id
echo "commit 91005ee2ed995c7ed12361b00aaac73a72a80286"
echo "------------------------------------"
echo '{"conversation_id":"00000000-0000-4000-8000-000000000042","status":"SUCCESS","response":"done"}'
`, { mode: 0o755 });

    const r1 = spawnSync('/bin/bash', [RUN_JOB, 'daily-summary', 'Run the daily summary'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTOMATION_HARNESS: 'gemini',
        AUTOMATION_CLI: mockAgy,
        AUTOMATION_MODEL: 'gemini-4-carbon-medium',
        AUTOMATION_EFFORT: 'high',
        AUTOMATION_ARGUMENTS: '--add-dir\n/tmp',
        AUTOMATION_LOG_DIR: logDir,
      },
    });
    assert.equal(r1.status, 0, r1.stderr);
    const args = fs.readFileSync(agyCalls, 'utf8').trim().split('\n');
    assert.deepEqual(args, [
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--model', 'gemini-4-carbon-medium',
      '--effort', 'high',
      '--add-dir', '/tmp',
      '-p', 'Run the daily summary',
    ]);
    const last = JSON.parse(fs.readFileSync(path.join(logDir, 'daily-summary.last.json'), 'utf8'));
    assert.equal(last.sessionID, '00000000-0000-4000-8000-000000000042');
    assert.equal(last.harness, 'gemini');
    assert.equal(last.exitCode, 0);
    assert.equal(fs.existsSync(path.join(logDir, 'daily-summary.running.json')), false, 'running sidecar cleaned up on exit');
    const runs = fs.readFileSync(path.join(logDir, 'daily-summary.runs.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].sessionID, '00000000-0000-4000-8000-000000000042');

    // Validate copilot harness flag ordering (-p <prompt> at the end, never swallowing --allow-all)
    const copilotCalls = path.join(dir, 'copilot.args');
    const mockCopilot = path.join(dir, 'copilot');
    fs.writeFileSync(mockCopilot, `#!/bin/bash
printf '%s\\n' "$@" > "${copilotCalls}"
echo '{"session_id":"00000000-0000-4000-8000-000000000099"}'
`, { mode: 0o755 });
    const r2 = spawnSync('/bin/bash', [RUN_JOB, 'copilot-job', 'Check repo status'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTOMATION_HARNESS: 'copilot',
        AUTOMATION_CLI: mockCopilot,
        AUTOMATION_MODEL: 'gpt-4.1',
        AUTOMATION_EFFORT: 'medium',
        AUTOMATION_LOG_DIR: logDir,
      },
    });
    assert.equal(r2.status, 0, r2.stderr);
    assert.deepEqual(fs.readFileSync(copilotCalls, 'utf8').trim().split('\n'), [
      '--allow-all', '--output-format', 'json',
      '--model', 'gpt-4.1',
      '--reasoning-effort', 'medium',
      '-p', 'Check repo status',
    ]);
    // Validate generic protocol: a brand-new harness not hardcoded in run-job.sh works purely via AUTOMATION_* env vars
    const futureCalls = path.join(dir, 'future.args');
    const mockFuture = path.join(dir, 'future-agent');
    fs.writeFileSync(mockFuture, `#!/bin/bash
printf '%s\\n' "$@" > "${futureCalls}"
echo '{"session_id":"00000000-0000-4000-8000-000000000777","model":"future-v1"}'
`, { mode: 0o755 });
    const r3 = spawnSync('/bin/bash', [RUN_JOB, 'future-job', 'Ship it'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTOMATION_HARNESS: 'future-agent',
        AUTOMATION_CLI: mockFuture,
        AUTOMATION_BASE_ARGS: 'headless\n--json',
        AUTOMATION_EFFORT_FLAG: '--thinking',
        AUTOMATION_EFFORT: 'high',
        AUTOMATION_PROMPT_FLAG: '--prompt',
        AUTOMATION_LOG_DIR: logDir,
      },
    });
    assert.equal(r3.status, 0, r3.stderr);
    assert.deepEqual(fs.readFileSync(futureCalls, 'utf8').trim().split('\n'), [
      'headless', '--json', '--thinking', 'high', '--prompt', 'Ship it',
    ]);
    const futLast = JSON.parse(fs.readFileSync(path.join(logDir, 'future-job.last.json'), 'utf8'));
    assert.equal(futLast.sessionID, '00000000-0000-4000-8000-000000000777');
    assert.equal(futLast.model, 'future-v1');
    assert.equal(futLast.harness, 'future-agent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectTool honors AUTOMATION_HARNESS even when run-job.sh mentions other CLIs, and strips both label prefixes', () => {
  const genericRunner = fs.readFileSync(RUN_JOB, 'utf8');
  assert.equal(detectTool(['/bin/bash', RUN_JOB], genericRunner, 'local.agent-automation.daily-summary', { AUTOMATION_HARNESS: 'gemini' }), 'gemini');
  assert.equal(detectTool(['/bin/bash', RUN_JOB], genericRunner, 'local.agent-automation.daily-summary', { AUTOMATION_HARNESS: 'claude' }), 'claude');
  assert.equal(detectTool(['/usr/local/bin/agy', '-p', 'hi']), 'gemini');
  assert.equal(automationId('local.agent-automation.daily-summary'), 'daily-summary');
  assert.equal(automationId('local.opencode.daily-summary'), 'daily-summary');

  const dir = tmpDir('model-sidecar-');
  try {
    fs.writeFileSync(path.join(dir, 'daily-summary.last.json'), JSON.stringify({ sessionID: 'conv-1', startedAt: '2026-11-23T08:00:00Z', exitCode: 0 }));
    const m = buildModel({
      Label: 'local.agent-automation.daily-summary',
      ProgramArguments: ['/bin/bash', RUN_JOB, 'daily-summary', 'hi'],
      EnvironmentVariables: { AUTOMATION_HARNESS: 'gemini', AUTOMATION_LOG_DIR: dir },
    }, '/tmp/local.agent-automation.daily-summary.plist');
    assert.equal(m.tool, 'gemini');
    assert.equal(m.lastSession?.sessionID, 'conv-1');
    assert.equal(m.recentRuns.length, 1);

    // Live running.json with current process PID marks automation as running and exposes runningSession
    fs.writeFileSync(path.join(dir, 'daily-summary.running.json'), JSON.stringify({ startedAt: '2026-11-23T08:01:00Z', pid: process.pid, harness: 'gemini', model: 'gemini-4-hydrogen-low' }));
    const mRun = buildModel({
      Label: 'local.agent-automation.daily-summary',
      ProgramArguments: ['/bin/bash', RUN_JOB, 'daily-summary', 'hi'],
      EnvironmentVariables: { AUTOMATION_HARNESS: 'gemini', AUTOMATION_LOG_DIR: dir },
    }, '/tmp/local.agent-automation.daily-summary.plist');
    assert.equal(mRun.state, 'running');
    assert.equal(mRun.runningSession?.harness, 'gemini');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('capabilities, open-session (gemini + opencode terminal), and interactive launch work end-to-end', { skip: !hasPlutil && 'plutil is only available on macOS' }, async () => {
  const tmp = tmpDir('gemini-routes-');
  const prevEnv = { ...process.env };
  let srv;
  try {
    const agentsDir = path.join(tmp, 'agents');
    const logsDir = path.join(tmp, 'logs');
    const workDir = path.join(tmp, "Project's Home");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    const callsLog = path.join(tmp, 'calls.log');
    const mockLaunchctl = path.join(tmp, 'launchctl');
    fs.writeFileSync(mockLaunchctl, '#!/bin/sh\nprintf "PID\\tStatus\\tLabel\\n-\\t0\\tlocal.agent-automation.daily-summary\\n"\n', { mode: 0o755 });
    const mockOsascript = path.join(tmp, 'osascript');
    fs.writeFileSync(mockOsascript, `#!/bin/sh\nprintf 'OSASCRIPT:%s\\n' "$2" >> "${callsLog}"\n`, { mode: 0o755 });
    const mockAgy = path.join(tmp, 'agy');
    fs.writeFileSync(mockAgy, `#!/bin/sh
if [ "$3" = "models" ]; then
  echo '{"command":{"name":"models","data":{"models":[{"id":"gemini-4-carbon-medium","label":"Gemini 4 Carbon"}]}}}'
elif [ "$3" = "agents" ]; then
  echo '{"command":{"name":"agents","data":{"agents":[{"name":"researcher"}]}}}'
fi
`, { mode: 0o755 });

    // Write a Gemini LaunchAgent plist and a recorded run
    const geminiLabel = 'local.agent-automation.daily-summary';
    const plistJson = path.join(tmp, 'gemini.json');
    fs.writeFileSync(plistJson, JSON.stringify({
      Label: geminiLabel,
      ProgramArguments: ['/bin/bash', RUN_JOB, 'daily-summary', 'run'],
      WorkingDirectory: workDir,
      EnvironmentVariables: { AUTOMATION_HARNESS: 'gemini', AUTOMATION_CLI: mockAgy, AUTOMATION_LOG_DIR: logsDir },
      StartCalendarInterval: { Hour: 8, Minute: 58 },
    }));
    assert.equal(spawnSync('plutil', ['-convert', 'xml1', '-o', path.join(agentsDir, `${geminiLabel}.plist`), plistJson]).status, 0);
    fs.writeFileSync(path.join(logsDir, 'daily-summary.runs.jsonl'), `${JSON.stringify({ sessionID: '00000000-0000-4000-8000-000000000111', startedAt: '2026-11-23T08:58:00Z', exitCode: 0, harness: 'gemini' })}\n`);

    // Write an OpenCode LaunchAgent plist to verify terminal session resume too
    const ocLabel = 'local.agent-automation.oc-job';
    const ocJson = path.join(tmp, 'oc.json');
    fs.writeFileSync(ocJson, JSON.stringify({
      Label: ocLabel,
      ProgramArguments: ['/bin/bash', RUN_JOB, 'oc-job', 'run'],
      WorkingDirectory: workDir,
      EnvironmentVariables: { AUTOMATION_HARNESS: 'opencode', AUTOMATION_CLI: '/opt/opencode-cli', AUTOMATION_LOG_DIR: logsDir },
    }));
    assert.equal(spawnSync('plutil', ['-convert', 'xml1', '-o', path.join(agentsDir, `${ocLabel}.plist`), ocJson]).status, 0);
    fs.writeFileSync(path.join(logsDir, 'oc-job.last.json'), JSON.stringify({ sessionID: 'ses_test123', startedAt: '2026-11-23T09:00:00Z', exitCode: 0 }));

    Object.assign(process.env, {
      LAUNCH_AGENTS_DIR: agentsDir,
      AUTOMATION_LOG_DIR: logsDir,
      LAUNCHCTL_BIN: mockLaunchctl,
      OSASCRIPT_BIN: mockOsascript,
      GEMINI_CLI: mockAgy,
    });
    clearCapabilitiesCache();

    const readBody = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s)); });
    srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (!handleAutomationsRoute(req, res, url, { readBody })) { res.writeHead(404); res.end(); }
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const api = async (method, p, body) => {
      const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json() };
    };

    // 1. Capabilities include Gemini models & agents
    const caps = await api('GET', '/api/automations/capabilities?refresh=1');
    assert.equal(caps.status, 200);
    const geminiCap = caps.body.harnesses.find(h => h.id === 'gemini');
    assert.ok(geminiCap);
    assert.deepEqual(geminiCap.models, ['gemini-4-carbon-medium']);
    assert.deepEqual(geminiCap.agents, ['researcher']);

    // 2. Runs endpoint lists recorded Gemini runs
    const runs = await api('GET', `/api/automations/${geminiLabel}/runs`);
    assert.equal(runs.status, 200);
    assert.equal(runs.body.runs.length, 1);
    assert.equal(runs.body.runs[0].sessionID, '00000000-0000-4000-8000-000000000111');

    // 3. Open session on Gemini opens Terminal in WorkingDirectory (handling apostrophe!) with --conversation=<id>
    const opened = await api('POST', `/api/automations/${geminiLabel}/open-session`, {});
    assert.equal(opened.status, 200);
    assert.equal(opened.body.done, 'terminal');
    assert.equal(opened.body.sessionID, '00000000-0000-4000-8000-000000000111');
    assert.match(opened.body.command, /Project'\\''s Home/);
    assert.match(opened.body.command, /--conversation=00000000-0000-4000-8000-000000000111/);

    // 4. Open session on OpenCode with mode: 'terminal' attaches directly with -s ses_test123
    const ocOpened = await api('POST', `/api/automations/${ocLabel}/open-session`, { mode: 'terminal' });
    assert.equal(ocOpened.status, 200);
    assert.equal(ocOpened.body.done, 'terminal');
    assert.match(ocOpened.body.command, /\/opt\/opencode-cli -s ses_test123/);

    // 5. Interactive ticket launch endpoint launches agy -i safely via temp prompt file
    const launched = await api('POST', '/api/automations/launch', {
      provider: 'gemini',
      prompt: 'Work on Task BKR12: Bake bread\nWith "quotes" & \'apostrophes\' and $vars',
      folder: workDir,
      model: 'gemini-4-carbon-medium',
    });
    assert.equal(launched.status, 200);
    assert.equal(launched.body.done, 'terminal');
    const scriptLog = fs.readFileSync(callsLog, 'utf8');
    assert.match(scriptLog, /--model gemini-4-carbon-medium -i/);

    // 6. Terminal settings default to 'default', persist 'cmux' in config.json, and open runs via cmux
    const cfgRoot = path.join(tmp, 'data-root');
    fs.mkdirSync(cfgRoot, { recursive: true });
    process.env.CH_HOME = cfgRoot;
    const getTerm0 = await api('GET', '/api/automations/settings');
    assert.equal(getTerm0.body.terminalApp, 'default');
    const setTerm = await api('PUT', '/api/automations/settings', { terminalApp: 'cmux' });
    assert.equal(setTerm.body.terminalApp, 'cmux');
    assert.equal(JSON.parse(fs.readFileSync(path.join(cfgRoot, 'config.json'), 'utf8')).terminalApp, 'cmux');

    const cmuxLog = path.join(tmp, 'cmux.log');
    const mockCmux = path.join(tmp, 'cmux');
    fs.writeFileSync(mockCmux, `#!/bin/sh
if [ "$1" = "current-workspace" ]; then echo "workspace:1"; exit 0; fi
printf 'CMUX:%s\\n' "$*" >> "${cmuxLog}"
echo "surface:9"
`, { mode: 0o755 });
    process.env.CMUX_BIN = mockCmux;
    delete process.env.OSASCRIPT_BIN;

    const cmuxOpened = await api('POST', `/api/automations/${geminiLabel}/open-session`, {});
    assert.equal(cmuxOpened.status, 200);
    assert.equal(cmuxOpened.body.terminal, 'cmux');
    assert.match(fs.readFileSync(cmuxLog, 'utf8'), /new-surface --type terminal --workspace workspace:1/);
    process.env.OPEN_BIN = path.join(tmp, 'noop-open');
    fs.writeFileSync(process.env.OPEN_BIN, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    // 7. Saving an automation that still had the legacy OpenCode-only run-job.sh upgrades the runner and adds ~/.local/bin to PATH
    const legacyRunner = path.join(tmp, 'run-job.sh');
    fs.writeFileSync(legacyRunner, '#!/bin/bash\n# Runs one OpenCode automation and records its session in <log dir>/<id>.last.json.\nopencode-cli run "$2"\n', { mode: 0o755 });
    const legacyLabel = 'local.opencode.legacy-upgrade';
    const legacyPlist = path.join(tmp, 'legacy.json');
    fs.writeFileSync(legacyPlist, JSON.stringify({
      Label: legacyLabel,
      ProgramArguments: ['/bin/bash', legacyRunner, 'legacy-upgrade', 'prompt'],
      EnvironmentVariables: { PATH: '/usr/bin:/bin' },
    }));
    assert.equal(spawnSync('plutil', ['-convert', 'xml1', '-o', path.join(agentsDir, `${legacyLabel}.plist`), legacyPlist]).status, 0);
    const upgraded = await api('PUT', `/api/automations/${legacyLabel}`, {
      environment: { AUTOMATION_HARNESS: 'gemini', GEMINI_MODEL: 'gemini-4-hydrogen-low', PATH: '/usr/bin:/bin' },
      scriptContent: fs.readFileSync(legacyRunner, 'utf8'),
    });
    assert.equal(upgraded.status, 200);
    assert.match(upgraded.body.automation.environment.PATH, /\.local\/bin/);
    assert.match(fs.readFileSync(legacyRunner, 'utf8'), /AUTOMATION_BASE_ARGS/);

    // 8. Switching harness to gemini keeps past opencode runs with their harness & model, and dispatches open-session per run
    fs.writeFileSync(path.join(logsDir, 'daily-summary.runs.jsonl'), [
      JSON.stringify({ sessionID: 'ses_old_oc', startedAt: '2026-11-22T08:58:00Z', exitCode: 0, model: 'github-copilot/mai-code-2' }),
      JSON.stringify({ sessionID: '00000000-0000-4000-8000-000000000222', startedAt: '2026-11-23T08:58:00Z', exitCode: 0, harness: 'gemini', model: 'gemini-4-hydrogen-low' }),
    ].join('\n') + '\n');
    const mixedRuns = await api('GET', `/api/automations/${geminiLabel}/runs`);
    assert.equal(mixedRuns.body.runs.length, 2);
    assert.equal(mixedRuns.body.runs[0].harness, 'gemini');
    assert.equal(mixedRuns.body.runs[0].model, 'gemini-4-hydrogen-low');
    assert.equal(mixedRuns.body.runs[1].harness, 'opencode');
    assert.equal(mixedRuns.body.runs[1].model, 'github-copilot/mai-code-2');

    // Opening the older opencode run on a gemini-configured automation dispatches to opencode, NOT agy!
    const openOldOc = await api('POST', `/api/automations/${geminiLabel}/open-session`, { sessionID: 'ses_old_oc', mode: 'terminal' });
    assert.equal(openOldOc.body.harness, 'opencode');
    assert.match(openOldOc.body.command, /-s ses_old_oc/);
  } finally {
    srv?.close();
    for (const k of Object.keys(process.env)) if (!(k in prevEnv)) delete process.env[k];
    Object.assign(process.env, prevEnv);
    clearCapabilitiesCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readLiveSessions and collectSessions read Antigravity brain transcripts', async () => {
  const dir = tmpDir('gemini-brain-');
  try {
    const convId = '00000000-0000-4000-8000-000000000777';
    const logDir = path.join(dir, convId, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const transcriptFile = path.join(logDir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-23T10:00:00Z', content: '/ship-task BKR12 and inspect BKR99' }),
      JSON.stringify({
        step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-23T10:01:00Z',
        model: 'gemini-4-carbon-medium', input_tokens: 1500, cache_read_tokens: 500, output_tokens: 250,
        tool_calls: [
          { name: 'run_command', args: { CommandLine: 'ch tasks move BKR13 in-progress' } },
          { name: 'invoke_subagent', args: { Model: 'flash', TypeName: 'research' } },
        ],
      }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'GENERIC', created_at: '2026-11-23T10:01:30Z', content: 'huge tool output' }),
      JSON.stringify({
        step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-23T10:03:00Z',
        model: 'gemini-4-carbon-medium', input_tokens: 2000, cache_read_tokens: 1500, output_tokens: 100,
        tool_calls: [],
      }),
    ];
    fs.writeFileSync(transcriptFile, `${lines.join('\n')}\n`);

    const live = readLiveSessions({ projectsDir: path.join(dir, 'no-claude'), geminiBrainDir: dir, now: Date.now(), liveMinutes: 20, sessionMeta: null });
    assert.equal(live.length, 1);
    assert.equal(live[0].id, convId);
    assert.equal(live[0].harness, 'gemini');
    assert.deepEqual(live[0].ticketIds, ['BKR12']);
    assert.deepEqual(live[0].mentionedIds, ['BKR99']);

    const { records } = await collectSessions({ dirs: [dir] });
    assert.equal(records.length, 1);
    const rec = records[0];
    assert.equal(rec.sessionId, convId);
    assert.equal(rec.ticket, 'BKR12');
    assert.equal(rec.userPrompts, 1);
    assert.equal(rec.agentCalls, 1);
    assert.deepEqual(rec.tokens, { input: 3500, output: 350, cacheRead: 2000, cacheWrite: 0 });
    assert.ok(rec.byTicket.BKR12);
    assert.ok(rec.byTicket.BKR13);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
