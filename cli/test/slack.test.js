/**
 * cli/test/slack.test.js
 * Tests for ch slack subcommands and cli/lib/slack.js pure functions.
 *
 * Architecture:
 *   - Pure unit tests (buildPermalink, isUserId, isChannelId, isTs): direct import, no network.
 *   - Integration tests for CLI dispatch: two strategies:
 *       a. spawnSync for arg-validation / token-missing paths (no network needed).
 *       b. Direct module invocation with globalThis.fetch mocked for paths that require API calls.
 *         We capture stdout/stderr/process.exit via stubs.
 *
 * Note: SLACK_API_BASE must be set to a value whose pathname produces the right method name.
 *       We use 'http://mock/' so URLs become 'http://mock/users.info' -> pathname '/users.info'.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPermalink,
  isUserId,
  isChannelId,
  isTs,
  resetMemo,
  proxyAuthHeader,
} from '../lib/slack.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CH_SCRIPT  = path.resolve(__dirname, '../..', 'ch');

// ─── Temp dir helpers ─────────────────────────────────────────────────────────

let tmpWithToken;    // has slack_token
let tmpNoToken;      // no slack_token

before(() => {
  tmpWithToken = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-slack-tok-'));
  fs.writeFileSync(path.join(tmpWithToken, 'config.json'), JSON.stringify({ slack_token: 'xoxp-test' }));

  tmpNoToken = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-slack-notok-'));
  fs.writeFileSync(path.join(tmpNoToken, 'config.json'), JSON.stringify({ other: 'value' }));
});

after(() => {
  fs.rmSync(tmpWithToken, { recursive: true, force: true });
  fs.rmSync(tmpNoToken, { recursive: true, force: true });
});

// ─── spawnSync helper ─────────────────────────────────────────────────────────

/**
 * Run the ch script synchronously.
 * Only used for tests that exit before any network call (arg errors, token missing).
 */
function runSlack(args, { chHome = tmpWithToken, extraEnv = {} } = {}) {
  const env = {
    ...process.env,
    CH_HOME: chHome,
    SLACK_API_BASE: 'http://mock/',
    ...extraEnv,
  };
  return spawnSync(process.execPath, [CH_SCRIPT, 'slack', ...args], {
    encoding: 'utf8',
    env,
    timeout: 8000,
  });
}

// ─── Mock-fetch integration helper ───────────────────────────────────────────

/**
 * Channel/user IDs used in tests. Must satisfy isChannelId / isUserId validators.
 * C + 2+ alphanumeric chars.
 */
const CH1 = 'C01TESTCH1';
const CH2 = 'C02TESTCH2';
const CH3 = 'C03DEFUNCT';            // channel whose thread lookup fails -> unverifiable, skipped
const DM1 = 'D01TESTDM1';            // answered DM: <user> replied later (resolved in-memory)
const DM3 = 'D03TESTDM3';            // unanswered DM: no reply, no reaction -> awaiting
const TS_FROM     = '1700000300.000100';
const TS_DM       = '1700000200.000100';
const TS_DM1_REPLY= '1700000260.000100'; // <user>'s reply in DM1 (later than the inbound)
const TS_DM3      = '1700000220.000100';
const TS_CH3      = '1700000110.000100';
const TS_MENTION= '1700000100.000100';
const TS_HIST   = '1700000500.000200';
const TS_JOIN   = '1700000400.000000';
const TS_PARENT = '1700000000.000100';
const TS_REPLY  = '1700000600.000300';
const USER_ME   = 'U01SPLUN3MZ';
const USER_NOBODY = 'U0000000000';

/**
 * Install a globalThis.fetch mock and set SLACK_API_BASE to 'http://mock/' so
 * URL pathnames match method names (e.g. /users.info -> 'users.info').
 * Returns a restore function.
 */
function installMockFetch() {
  const originalFetch = globalThis.fetch;
  const originalApiBase = process.env.SLACK_API_BASE;

  // Set SLACK_API_BASE so slackCall builds URLs like http://mock/users.info
  process.env.SLACK_API_BASE = 'http://mock/';

  globalThis.fetch = async (urlStr) => {
    const url = new URL(urlStr);
    const method = url.pathname.replace(/^\//, '');
    const query = Object.fromEntries(url.searchParams);

    let body;

    switch (method) {
      case 'auth.test':
        body = { ok: true, url: 'https://test.slack.com/', user_id: 'UBOT', team: 'T1' };
        break;

      case 'users.info':
        body = { ok: true, user: { id: query.user, name: 'tal.efronny' } };
        break;

      case 'conversations.info':
        body = { ok: true, channel: { id: query.channel, name: 'chan-' + query.channel } };
        break;

      case 'search.messages': {
        const q = query.query || '';
        let matches = [];
        if (q.includes('from:')) {
          // from:@me -> the user's OWN messages (author == USER_ME), as Slack returns them.
          // Includes <user>'s reply in DM1 -> exercises the in-memory DM reply resolution.
          matches = [
            {
              type: 'message', user: USER_ME, username: 'tal.efronny',
              ts: TS_FROM, text: 'from msg',
              permalink: `https://test.slack.com/archives/${CH1}/p1700000300000100`,
              channel: { id: CH1, name: 'general', is_private: false },
            },
            {
              type: 'message', user: USER_ME, username: 'tal.efronny',
              ts: TS_DM1_REPLY, text: 'sure, sounds good',
              permalink: `https://test.slack.com/archives/${DM1}/p1700000260000100`,
              channel: { id: DM1, name: 'directmessage', is_private: true },
            },
          ];
        } else if (q.includes('to:')) {
          matches = [
            // Answered DM (DM1): <user> replied later -> resolved in-memory, NOT awaiting.
            {
              type: 'message', user: 'U3', username: 'other',
              ts: TS_DM, text: 'dm msg',
              permalink: `https://test.slack.com/archives/${DM1}/p1700000200000100`,
              channel: { id: DM1, name: 'directmessage', is_private: true },
            },
            // Unanswered DM (DM3): no reply, no reaction -> AWAITING.
            {
              type: 'message', user: 'U8', username: 'pinger',
              ts: TS_DM3, text: 'unanswered dm question?',
              permalink: `https://test.slack.com/archives/${DM3}/p1700000220000100`,
              channel: { id: DM3, name: 'directmessage', is_private: true },
            },
            // Slackbot notice -> bot author, must be excluded entirely (never awaiting).
            {
              type: 'message', user: 'USLACKBOT', username: 'slackbot',
              ts: '1700000230.000100', text: 'Your request to install can now be used?',
              permalink: `https://test.slack.com/archives/D04BOTDM/p1700000230000100`,
              channel: { id: 'D04BOTDM', name: 'directmessage', is_private: true },
            },
          ];
        } else if (q === 'test query') {
          // custom query path
          matches = [{
            type: 'message', user: 'U5', username: 'tester',
            ts: '1700000150.000100', text: 'test query result',
            permalink: `https://test.slack.com/archives/${CH1}/p1700000150000100`,
            channel: { id: CH1, name: 'general', is_private: false },
          }];
        } else {
          // mention bucket — includes duplicate of from_user match (same channel:ts)
          matches = [
            {
              type: 'message', user: 'U4', username: 'mentioner',
              ts: TS_MENTION, text: 'mention msg',
              permalink: `https://test.slack.com/archives/${CH2}/p1700000100000100`,
              channel: { id: CH2, name: 'random', is_private: false },
            },
            // Channel mention whose thread lookup fails -> unverifiable, skipped (not awaiting).
            {
              type: 'message', user: 'U6', username: 'ghost',
              ts: TS_CH3, text: 'defunct channel mention?',
              permalink: `https://test.slack.com/archives/${CH3}/p1700000110000100`,
              channel: { id: CH3, name: 'gone-channel', is_private: false },
            },
            // Duplicate: same channel+ts as from_user match -> tests dedupe + merged match_types
            {
              type: 'message', user: 'U2', username: 'someone',
              ts: TS_FROM, text: 'from msg',
              permalink: `https://test.slack.com/archives/${CH1}/p1700000300000100`,
              channel: { id: CH1, name: 'general', is_private: false },
            },
          ];
        }
        body = { ok: true, messages: { matches, paging: { count: 100, total: matches.length, page: 1, pages: 1 } } };
        break;
      }

      case 'conversations.history':
        body = {
          ok: true,
          messages: [
            { type: 'message', user: 'U3', text: 'history msg', ts: TS_HIST, reply_count: 0 },
            { subtype: 'channel_join', user: 'U4', text: 'joined', ts: TS_JOIN },
          ],
          has_more: false,
        };
        break;

      case 'conversations.replies':
        if (query.channel === CH3) {
          body = { ok: false, error: 'channel_not_found' };
        } else {
          body = {
            ok: true,
            messages: [
              { user: 'U2', text: 'parent', ts: TS_PARENT, thread_ts: TS_PARENT },
              { user: USER_ME, text: 'reply', ts: TS_REPLY, thread_ts: TS_PARENT },
            ],
            has_more: false,
          };
        }
        break;

      case 'reactions.get':
        // Only the TS_PARENT message carries a reaction by USER_ME; others are bare.
        body = (query.timestamp === TS_PARENT)
          ? { ok: true, message: { reactions: [{ name: 'thumbsup', users: [USER_ME, 'U9'], count: 2 }] } }
          : { ok: true, message: { reactions: [] } };
        break;

      default:
        body = { ok: false, error: 'method_not_found' };
    }

    const bodyStr = JSON.stringify(body);
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => JSON.parse(bodyStr),
    };
  };

  return () => {
    globalThis.fetch = originalFetch;
    if (originalApiBase === undefined) delete process.env.SLACK_API_BASE;
    else process.env.SLACK_API_BASE = originalApiBase;
    resetMemo();
  };
}

/**
 * Capture stdout/stderr writes and process.exit calls within an async fn.
 * Returns { stdout, stderr, exitCode } after fn completes or calls process.exit.
 *
 * process.exit is stubbed — throws an internal sentinel instead of actually exiting.
 */
async function capture(fn) {
  let stdout = '';
  let stderr = '';
  let exitCode = null;

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origExit = process.exit.bind(process);
  const origConsoleLog = console.log;

  class ExitSignal extends Error {
    constructor(code) { super('exit'); this.code = code; }
  }

  process.stdout.write = (s) => { stdout += s; return true; };
  process.stderr.write = (s) => { stderr += s; return true; };
  console.log = (...args) => { stdout += args.join(' ') + '\n'; };
  process.exit = (code = 0) => { throw new ExitSignal(code); };

  try {
    await fn();
  } catch (e) {
    if (e instanceof ExitSignal) {
      exitCode = e.code;
    } else {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
      console.log = origConsoleLog;
      process.exit = origExit;
      throw e;
    }
  } finally {
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    console.log = origConsoleLog;
    process.exit = origExit;
  }

  return { stdout, stderr, exitCode: exitCode ?? 0 };
}

/**
 * Set CH_HOME and run a function, restoring CH_HOME afterward.
 */
function withChHome(chHome, fn) {
  const orig = process.env.CH_HOME;
  process.env.CH_HOME = chHome;
  return fn().finally(() => {
    if (orig === undefined) delete process.env.CH_HOME;
    else process.env.CH_HOME = orig;
  });
}

// ─── Integration tests using mock fetch ──────────────────────────────────────

test('slack recent: JSON array, required fields, dedupe, sort descending', async () => {
  const restore = installMockFetch();
  try {
    const { default: slackCmd } = await import('../commands/slack.js');
    const result = await withChHome(tmpWithToken, () =>
      capture(() => slackCmd(['recent', '--days', '7', '--user', USER_ME]))
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const arr = JSON.parse(result.stdout);
    assert.ok(Array.isArray(arr), 'output should be an array');
    assert.ok(arr.length > 0, 'should have items');

    // Required fields on every item
    for (const item of arr) {
      assert.ok('text'       in item, 'missing text');
      assert.ok('permalink'  in item, 'missing permalink');
      assert.ok('timestamp'  in item, 'missing timestamp');
      assert.ok('channel'    in item, 'missing channel');
      assert.ok('author_id'  in item, 'missing author_id');
      assert.ok(Array.isArray(item.match_types), 'match_types should be array');
    }

    // Dedupe: no duplicate channel:ts keys
    const keys = arr.map(i => `${i.channel}:${i.timestamp}`);
    const uniqueKeys = new Set(keys);
    assert.equal(keys.length, uniqueKeys.size, 'duplicates found in output');

    // Merged item (from_user + mention share same channel:ts) -> >=2 match_types
    const merged = arr.find(i => i.channel === CH1 && i.timestamp === TS_FROM);
    assert.ok(merged, `expected deduplicated ${CH1} item with ts ${TS_FROM}`);
    assert.ok(merged.match_types.length >= 2, 'merged item should have >=2 match_types');

    // Descending sort by timestamp
    for (let i = 1; i < arr.length; i++) {
      assert.ok(
        Number(arr[i - 1].timestamp) >= Number(arr[i].timestamp),
        'should be sorted descending by timestamp'
      );
    }
  } finally {
    restore();
  }
});

test('slack awaiting: only unresolved inbound (DM reply in-memory, thread reply, defunct skip, own msg ignored)', async () => {
  const restore = installMockFetch();
  try {
    const { default: slackCmd } = await import('../commands/slack.js');
    const result = await withChHome(tmpWithToken, () =>
      capture(() => slackCmd(['awaiting', '--user', USER_ME, '--days', '5']))
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const obj = JSON.parse(result.stdout);
    assert.equal(obj.user, USER_ME);
    assert.ok(Array.isArray(obj.awaiting), 'awaiting should be an array');

    // DM3 (author U8): no reply, no reaction -> AWAITING.
    const dmItem = obj.awaiting.find(a => a.channel === DM3);
    assert.ok(dmItem, 'unanswered DM3 should be awaiting');
    assert.equal(dmItem.author_id, 'U8');
    assert.equal(dmItem.looks_like_question, true, "'...question?' should be flagged a question");
    assert.ok('permalink' in dmItem, 'item should keep permalink');

    // DM1 (author U3): <user> replied later (captured by from: bucket) -> RESOLVED in-memory.
    // This is the key fix: a DM reply (incl. thread replies) must NOT be flagged awaiting.
    assert.equal(obj.awaiting.some(a => a.channel === DM1), false, 'answered DM must resolve in-memory');

    // CH2 (mention): <user> replied in-thread -> RESOLVED.
    assert.equal(obj.awaiting.some(a => a.channel === CH2), false, 'in-thread reply should resolve CH2');

    // CH3 (mention): thread lookup fails (channel_not_found) -> unverifiable, skipped, not flagged, no crash.
    assert.equal(obj.awaiting.some(a => a.channel === CH3), false, 'defunct channel must be skipped, not flagged');
    assert.ok(obj.unverifiable_count >= 1, 'defunct channel should count as unverifiable');

    // CH1 (from:@me) authored by USER_ME -> never a candidate.
    assert.equal(obj.awaiting.some(a => a.channel === CH1), false, 'own message must not be a candidate');

    // Slackbot (USLACKBOT) -> bot author, excluded entirely.
    assert.equal(obj.awaiting.some(a => a.author_id === 'USLACKBOT'), false, 'bot messages must be excluded');

    assert.equal(obj.awaiting_count, obj.awaiting.length, 'awaiting_count matches array length');
    assert.ok(obj.resolved_count >= 2, 'DM1 + CH2 should both count as resolved');
  } finally {
    restore();
  }
});

test('slack awaiting: bad args (no --user) -> exit 1', () => {
  const res = runSlack(['awaiting', '--days', '5']);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}. stderr: ${res.stderr}`);
});

test('slack channels: JSON array, channel_join filtered, permalink correct, channel_name present', async () => {
  const restore = installMockFetch();
  try {
    const { default: slackCmd } = await import('../commands/slack.js');
    const result = await withChHome(tmpWithToken, () =>
      capture(() => slackCmd(['channels', '--ids', `${CH1},${CH2}`, '--days', '1']))
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const arr = JSON.parse(result.stdout);
    assert.ok(Array.isArray(arr));

    // channel_join must be filtered
    assert.equal(arr.some(m => m.text === 'joined'), false, 'channel_join should be filtered out');

    // history msg present
    const histMsg = arr.find(m => m.text === 'history msg');
    assert.ok(histMsg, 'history msg should be present');

    // Permalink for CH1 ts TS_HIST -> no thread_ts, so buildPermalink(base, CH1, TS_HIST, undefined)
    // base = 'https://test.slack.com/', tsNoDot = '1700000500000200'
    const expectedPermalink = `https://test.slack.com/archives/${CH1}/p1700000500000200`;
    const ch1msg = arr.find(m => m.channel === CH1 && m.timestamp === TS_HIST);
    assert.ok(ch1msg, 'CH1 history message should be present');
    assert.equal(ch1msg.permalink, expectedPermalink);
    assert.ok(ch1msg.channel_name, 'channel_name should be set');
  } finally {
    restore();
  }
});

test('slack thread: object with messages, exactly one is_parent', async () => {
  const restore = installMockFetch();
  try {
    const { default: slackCmd } = await import('../commands/slack.js');
    const result = await withChHome(tmpWithToken, () =>
      capture(() => slackCmd(['thread', '--channel', CH1, '--ts', TS_PARENT]))
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const obj = JSON.parse(result.stdout);
    assert.ok(Array.isArray(obj.messages));
    assert.equal(obj.channel, CH1);
    assert.equal(obj.thread_ts, TS_PARENT);

    const parents = obj.messages.filter(m => m.is_parent);
    assert.equal(parents.length, 1, 'exactly one is_parent message');
  } finally {
    restore();
  }
});

test('slack reactions: reacted true for USER_ME', async () => {
  const restore = installMockFetch();
  try {
    const { default: slackCmd } = await import('../commands/slack.js');
    const result = await withChHome(tmpWithToken, () =>
      capture(() => slackCmd(['reactions', '--channel', CH1, '--ts', TS_PARENT, '--user', USER_ME]))
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const obj = JSON.parse(result.stdout);
    assert.equal(obj.reacted, true, `${USER_ME} should have reacted`);
    assert.ok(Array.isArray(obj.reactions));
  } finally {
    restore();
  }
});

test('slack reactions: reacted false for USER_NOBODY', async () => {
  const restore = installMockFetch();
  try {
    const { default: slackCmd } = await import('../commands/slack.js');
    const result = await withChHome(tmpWithToken, () =>
      capture(() => slackCmd(['reactions', '--channel', CH1, '--ts', TS_PARENT, '--user', USER_NOBODY]))
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const obj = JSON.parse(result.stdout);
    assert.equal(obj.reacted, false, `${USER_NOBODY} should not have reacted`);
  } finally {
    restore();
  }
});

test('slack recent: --query override path returns matches with custom match_types', async () => {
  const restore = installMockFetch();
  try {
    const { default: slackCmd } = await import('../commands/slack.js');
    const result = await withChHome(tmpWithToken, () =>
      capture(() => slackCmd(['recent', '--days', '7', '--user', USER_ME, '--query', 'test query']))
    );

    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}`);
    const arr = JSON.parse(result.stdout);
    assert.ok(Array.isArray(arr), 'output should be an array');
    assert.ok(arr.length > 0, 'should have items from custom query');

    // Every item should have match_types containing 'custom'
    for (const item of arr) {
      assert.ok(Array.isArray(item.match_types), `item should have match_types array`);
      assert.ok(item.match_types.includes('custom'), `match_types should include 'custom'`);
    }

    // No duplicate channel:ts entries
    const keys = arr.map(i => `${i.channel}:${i.timestamp}`);
    const uniqueKeys = new Set(keys);
    assert.equal(keys.length, uniqueKeys.size, 'duplicates found in output');
  } finally {
    restore();
  }
});

// ─── Token/arg error tests (via spawnSync — no network needed) ────────────────

test('missing token: exit 2, stderr includes "No Slack token"', () => {
  const res = runSlack(['recent', '--days', '7', '--user', USER_ME], {
    chHome: tmpNoToken,
    extraEnv: { SLACK_TOKEN: '', SLACK_TOKEN_CMD: '' },
  });
  assert.equal(res.status, 2, `expected exit 2, got ${res.status}. stderr: ${res.stderr}`);
  assert.ok(res.stderr.includes('No Slack token'), `stderr should mention 'No Slack token', got: ${res.stderr}`);
});

test('token from SLACK_TOKEN env: token resolves, API call fails (not a token error)', () => {
  // Create a temp dir with a config that has NO token fields
  const tmpEnvTok = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-slack-envtok-'));
  fs.writeFileSync(path.join(tmpEnvTok, 'config.json'), JSON.stringify({ other: 'value' }));
  try {
    const res = runSlack(['reactions', '--channel', 'C12345678', '--ts', '1700000000.000001'], {
      chHome: tmpEnvTok,
      extraEnv: { SLACK_TOKEN: 'xoxp-fromenv', SLACK_API_BASE: 'http://127.0.0.1:1/' },
    });
    assert.equal(res.status, 2, `expected exit 2, got ${res.status}. stderr: ${res.stderr}`);
    // Token resolved fine; error must be from the refused API call, NOT a token config error
    assert.ok(!res.stderr.includes('No Slack token'), `stderr should not mention token error, got: ${res.stderr}`);
    assert.ok(!res.stderr.includes('slack_token'), `stderr should not mention 'slack_token', got: ${res.stderr}`);
  } finally {
    fs.rmSync(tmpEnvTok, { recursive: true, force: true });
  }
});

test('slack_token_cmd resolves token from a command: token resolves, API call fails (not a token error)', () => {
  // Create a fake executable: a shell script that prints the token
  const tmpCmd = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-slack-cmd-'));
  const fakeCmdScript = path.join(tmpCmd, 'get-token');
  fs.writeFileSync(fakeCmdScript, '#!/bin/sh\nprintf \'xoxp-from-cmd\'\n');
  fs.chmodSync(fakeCmdScript, 0o755);

  // Config with slack_token_cmd (string form)
  const tmpCmdHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-slack-cmdhome-'));
  fs.writeFileSync(path.join(tmpCmdHome, 'config.json'), JSON.stringify({ slack_token_cmd: fakeCmdScript }));

  try {
    const res = runSlack(['reactions', '--channel', 'C12345678', '--ts', '1700000000.000001'], {
      chHome: tmpCmdHome,
      extraEnv: { SLACK_API_BASE: 'http://127.0.0.1:1/', SLACK_TOKEN: '', SLACK_TOKEN_CMD: '' },
    });
    assert.equal(res.status, 2, `expected exit 2, got ${res.status}. stderr: ${res.stderr}`);
    // Token resolved fine via command; error must be from the refused API call, NOT a token config error
    assert.ok(!res.stderr.includes('No Slack token'), `stderr should not mention token error, got: ${res.stderr}`);
    assert.ok(!res.stderr.includes('slack_token_cmd'), `stderr should not mention 'slack_token_cmd', got: ${res.stderr}`);
  } finally {
    fs.rmSync(tmpCmd, { recursive: true, force: true });
    fs.rmSync(tmpCmdHome, { recursive: true, force: true });
  }
});

test('bad args: recent without --user -> exit 1', () => {
  const res = runSlack(['recent', '--days', '7']);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}. stderr: ${res.stderr}`);
});

test('bad args: reactions with invalid channel and ts -> exit 1', () => {
  const res = runSlack(['reactions', '--channel', 'bad', '--ts', 'x']);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}. stderr: ${res.stderr}`);
});

// ─── Pure unit tests for lib/slack.js ────────────────────────────────────────

test('buildPermalink: basic (no thread)', () => {
  const link = buildPermalink('https://myteam.slack.com/', 'C1', '1700000000.000100', undefined);
  assert.equal(link, 'https://myteam.slack.com/archives/C1/p1700000000000100');
});

test('buildPermalink: thread variant', () => {
  const link = buildPermalink('https://myteam.slack.com', 'C1', '1700000600.000300', '1700000000.000100');
  assert.equal(link, 'https://myteam.slack.com/archives/C1/p1700000600000300?thread_ts=1700000000.000100&cid=C1');
});

test('buildPermalink: thread_ts === ts treated as non-thread', () => {
  const link = buildPermalink('https://myteam.slack.com/', 'C1', '1700000000.000100', '1700000000.000100');
  assert.equal(link, 'https://myteam.slack.com/archives/C1/p1700000000000100');
});

test('isUserId: accepts U... and W...', () => {
  assert.ok(isUserId('U01SPLUN3MZ'));
  assert.ok(isUserId('UABC123'));
  assert.ok(isUserId('W01ABCDEF'));
  assert.equal(isUserId('C01ABC'), false, 'C prefix should fail');
  assert.equal(isUserId('bad'), false, 'random string should fail');
  assert.equal(isUserId(''), false, 'empty should fail');
  assert.equal(isUserId('U1'), false, 'too short after U');
});

test('isChannelId: accepts C..., G..., D...', () => {
  assert.ok(isChannelId('C01ABC123'));
  assert.ok(isChannelId('G01ABCDEF'));
  assert.ok(isChannelId('D01ABCDEF'));
  assert.equal(isChannelId('U01ABC'), false, 'U prefix should fail');
  assert.equal(isChannelId('bad'), false, 'random string should fail');
  assert.equal(isChannelId(''), false, 'empty should fail');
  assert.equal(isChannelId('C1'), false, 'too short after C (need 2+ chars after prefix)');
});

test('isTs: accepts valid slack timestamps', () => {
  assert.ok(isTs('1700000000.000100'));
  assert.ok(isTs('123456.1'));
  assert.ok(isTs('1234567890.123456'));
  assert.equal(isTs('12345.1'), false, '5 digits before dot should fail (need 6+)');
  assert.equal(isTs('not-a-ts'), false, 'string should fail');
  assert.equal(isTs('1700000000'), false, 'no dot should fail');
  assert.equal(isTs(''), false, 'empty should fail');
});

test('proxyAuthHeader: builds Basic header from embedded credentials', () => {
  const h = proxyAuthHeader('http://srt:s3cr3t@localhost:62721');
  assert.equal(h, 'Basic ' + Buffer.from('srt:s3cr3t').toString('base64'));
});

test('proxyAuthHeader: null when proxy URL has no credentials', () => {
  assert.equal(proxyAuthHeader('http://localhost:62721'), null);
});

test('proxyAuthHeader: percent-decodes credentials', () => {
  const h = proxyAuthHeader('http://user:p%40ss%3Aword@host:8080');
  assert.equal(h, 'Basic ' + Buffer.from('user:p@ss:word').toString('base64'));
});

test('proxyAuthHeader: accepts a URL object', () => {
  const h = proxyAuthHeader(new URL('http://a:b@h:1'));
  assert.equal(h, 'Basic ' + Buffer.from('a:b').toString('base64'));
});

test('proxyAuthHeader: falls back to raw value on unencoded % in credentials', () => {
  // A literal, unencoded '%' would make decodeURIComponent throw; we must
  // fall back to the raw credential rather than crash the whole request.
  const h = proxyAuthHeader(new URL('http://user:50%off@host:8080'));
  assert.equal(h, 'Basic ' + Buffer.from('user:50%off').toString('base64'));
});
