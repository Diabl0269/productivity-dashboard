/**
 * cli/lib/slack.js
 * Zero-dependency Slack Web API client for the ch CLI.
 *
 * Key design:
 *   - API base URL reads from process.env.SLACK_API_BASE (for test mocking) || 'https://slack.com/api/'
 *   - Token from config.json slack_token (or a token command) via getToken()
 *   - All API calls via slackCall() with automatic rate-limit retry
 *   - Pagination helpers: searchAll, historyAll, repliesAll
 *   - Validation helpers: isUserId, isChannelId, isTs
 *   - Link builder: buildPermalink
 *   - User/workspace memoization to avoid repeated API calls
 */

import { readConfig } from './io.js';
import { execFileSync } from 'node:child_process';

/** Normalize a URL string to always end with '/'. */
function normalizeBase(url) {
  return url.endsWith('/') ? url : url + '/';
}

/** Compute the API base URL (testable via env var). */
function getApiBase() {
  return normalizeBase(process.env.SLACK_API_BASE || 'https://slack.com/api/');
}

/** Sleep for `ms` milliseconds. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Module-level memos (per process lifetime)
const _userNameCache = new Map();
let _workspaceUrl = null;

/**
 * Reset module-level memoization caches for test isolation.
 */
export function resetMemo() {
  _userNameCache.clear();
  _workspaceUrl = null;
}

// slack_token_cmd is operator-controlled local config (a credential-helper
// pattern, like git's credential.helper) — run with execFileSync (no shell).
function resolveTokenCmd(cmd) {
  let parts;
  if (Array.isArray(cmd)) parts = cmd.filter(s => typeof s === 'string' && s.length);
  else if (typeof cmd === 'string' && cmd.trim()) parts = cmd.trim().split(/\s+/);
  else { const e = new Error('slack_token_cmd is empty or invalid (expected a command string or array)'); e.code='NO_TOKEN'; throw e; }
  try {
    const out = execFileSync(parts[0], parts.slice(1), { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
    const token = (out || '').trim();
    if (!token) { const e = new Error('slack_token_cmd produced no output'); e.code='NO_TOKEN'; throw e; }
    return token;
  } catch (e) {
    if (e.code === 'NO_TOKEN') throw e;
    if (e.code === 'ENOENT') { const er = new Error(`slack_token_cmd: command not found on PATH: ${parts[0]}`); er.code='NO_TOKEN'; throw er; }
    const stderr = (e.stderr && e.stderr.toString().trim()) || e.message;
    const er = new Error(`slack_token_cmd failed: ${stderr}`); er.code='NO_TOKEN'; throw er;
  }
}

/**
 * Get the Slack token via 3-tier priority:
 *   1. SLACK_TOKEN env var (trimmed, non-empty)
 *   2. Token command from SLACK_TOKEN_CMD env or config.json slack_token_cmd (string or array)
 *   3. Literal token from config.json slack_token
 * Throws an Error with .code='NO_TOKEN' if no token is found.
 */
export function getToken() {
  // Tier 1: SLACK_TOKEN env var (trimmed, non-empty)
  const envToken = (process.env.SLACK_TOKEN || '').trim();
  if (envToken) return envToken;

  // Tier 2: token command from env or config
  const cfg = readConfig();
  const cmdEnv = (process.env.SLACK_TOKEN_CMD || '').trim();
  const cmdCfg = cfg.slack_token_cmd;
  const cmd = cmdEnv || cmdCfg;
  if (cmd) return resolveTokenCmd(cmd);

  // Tier 3: literal token from config
  const token = cfg.slack_token;
  if (token && typeof token === 'string' && token.trim() !== '') {
    return token.trim();
  }

  const err = new Error(
    'No Slack token configured. Provide one of: ' +
    '(a) SLACK_TOKEN env var, ' +
    '(b) slack_token_cmd in config.json — a command (string or array) that prints the token to stdout, resolved at runtime so nothing is stored on disk, ' +
    'or (c) slack_token literal in config.json. ' +
    'Note: `ch slack recent` uses search.messages, which requires a Slack xoxp- USER token with scope search:read ' +
    '(a bot xoxb- token is rejected); the other subcommands also accept a bot token with ' +
    'channels:history/groups:history/im:history/mpim:history/reactions:read/users:read.'
  );
  err.code = 'NO_TOKEN';
  throw err;
}

/**
 * Call a Slack Web API method via GET.
 *
 * @param {string} method - Slack API method name (e.g. 'search.messages')
 * @param {Record<string,string|number|boolean>} params - query parameters (undefined values skipped)
 * @param {{token?: string}} opts - optional overrides
 * @returns {Promise<object>} - parsed Slack API response (always ok:true on return)
 */
export async function slackCall(method, params = {}, opts = {}) {
  const API_BASE = getApiBase();
  const token = opts.token || getToken();

  const url = new URL(method, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
      },
    });

    // Rate-limit: retry with Retry-After
    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
        await sleep((retryAfter + 0.5) * 1000);
        continue;
      }
    }

    const data = await res.json();

    // Slack returns ok:false and error:'ratelimited' in JSON too
    if (data.error === 'ratelimited') {
      if (attempt < MAX_RETRIES) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
        await sleep((retryAfter + 0.5) * 1000);
        continue;
      }
    }

    if (!data.ok) {
      const err = new Error(
        `Slack API ${method} failed: ${data.error || ('HTTP ' + res.status)}`
      );
      err.slackError = data.error;
      throw err;
    }

    return data;
  }
}

/**
 * Build a Slack message permalink.
 *
 * @param {string} baseUrl - workspace base URL (e.g. 'https://myteam.slack.com/')
 * @param {string} channelId - channel ID
 * @param {string} ts - message timestamp
 * @param {string|undefined} threadTs - parent thread timestamp (if in thread)
 * @returns {string}
 */
export function buildPermalink(baseUrl, channelId, ts, threadTs) {
  const base = normalizeBase(baseUrl);
  const tsNoDot = ts.replace('.', '');
  let link = `${base}archives/${channelId}/p${tsNoDot}`;
  if (threadTs && threadTs !== ts) {
    link += `?thread_ts=${threadTs}&cid=${channelId}`;
  }
  return link;
}

/**
 * Resolve a Slack user ID to a username string.
 * Memoized per process to avoid repeated API calls.
 *
 * @param {string} userId
 * @param {string} [token]
 * @returns {Promise<string>}
 */
export async function resolveUsername(userId, token) {
  if (_userNameCache.has(userId)) return _userNameCache.get(userId);
  const data = await slackCall('users.info', { user: userId }, token ? { token } : {});
  const name = data.user.name;
  _userNameCache.set(userId, name);
  return name;
}

/**
 * Get the workspace base URL from auth.test.
 * Memoized per process.
 *
 * @param {string} [token]
 * @returns {Promise<string>}
 */
export async function workspaceBaseUrl(token) {
  if (_workspaceUrl) return _workspaceUrl;
  const data = await slackCall('auth.test', {}, token ? { token } : {});
  _workspaceUrl = data.url;
  return _workspaceUrl;
}

// --- Validation helpers ---

/** Returns true if s looks like a Slack user/workspace ID (U... or W...). */
export function isUserId(s) {
  return /^[UW][A-Z0-9]{2,}$/i.test(s);
}

/** Returns true if s looks like a Slack channel/group/DM ID (C..., G..., D...). */
export function isChannelId(s) {
  return /^[CGD][A-Z0-9]{2,}$/i.test(s);
}

/** Returns true if s looks like a Slack message timestamp. */
export function isTs(s) {
  return /^\d{6,}\.\d{1,}$/.test(s);
}

// --- Pagination helpers ---

/**
 * Search Slack messages across all pages up to maxPages.
 *
 * @param {string} query
 * @param {{count?: number, maxPages?: number, token?: string}} opts
 * @returns {Promise<object[]>} flat array of match objects
 */
export async function searchAll(query, { count = 100, maxPages = 5, token } = {}) {
  const matches = [];
  let page = 1;
  const callOpts = token ? { token } : {};

  while (page <= maxPages) {
    const data = await slackCall(
      'search.messages',
      { query, count, page, sort: 'timestamp', sort_dir: 'desc' },
      callOpts
    );
    const msgs = data.messages;
    const pageMatches = msgs?.matches || [];
    matches.push(...pageMatches);

    const paging = msgs?.paging || {};
    const totalPages = paging.pages || 1;
    if (page >= totalPages || page >= maxPages) break;
    page++;
  }

  return matches;
}

/**
 * Fetch all messages from a channel history up to maxPages.
 *
 * @param {string} channel
 * @param {{oldest?: string, limit?: number, maxPages?: number, token?: string}} opts
 * @returns {Promise<object[]>} flat array of message objects
 */
export async function historyAll(channel, { oldest, limit = 200, maxPages = 5, token } = {}) {
  const messages = [];
  let cursor;
  let pagesRead = 0;
  const callOpts = token ? { token } : {};

  while (pagesRead < maxPages) {
    const params = { channel, limit };
    if (oldest) params.oldest = oldest;
    if (cursor) params.cursor = cursor;

    const data = await slackCall('conversations.history', params, callOpts);
    const msgs = data.messages || [];
    messages.push(...msgs);
    pagesRead++;

    cursor = data.response_metadata?.next_cursor;
    if (!cursor || !data.has_more) break;
  }

  return messages;
}

/**
 * Fetch all replies in a thread up to maxPages.
 *
 * @param {string} channel
 * @param {string} ts - parent message timestamp
 * @param {{limit?: number, maxPages?: number, token?: string}} opts
 * @returns {Promise<object[]>} flat array of message objects (parent first)
 */
export async function repliesAll(channel, ts, { limit = 200, maxPages = 5, token } = {}) {
  const messages = [];
  let cursor;
  let pagesRead = 0;
  const callOpts = token ? { token } : {};

  while (pagesRead < maxPages) {
    const params = { channel, ts, limit };
    if (cursor) params.cursor = cursor;

    const data = await slackCall('conversations.replies', params, callOpts);
    const msgs = data.messages || [];
    messages.push(...msgs);
    pagesRead++;

    cursor = data.response_metadata?.next_cursor;
    if (!cursor || !data.has_more) break;
  }

  return messages;
}
