/**
 * cli/lib/slack.js
 * Zero-dependency Slack Web API client for the ch CLI.
 *
 * Key design:
 *   - API base URL reads from process.env.SLACK_API_BASE (for test mocking) || 'https://slack.com/api/'
 *   - Token from config.json slack_token via getToken()
 *   - All API calls via slackCall() with automatic rate-limit retry
 *   - Pagination helpers: searchAll, historyAll, repliesAll
 *   - Validation helpers: isUserId, isChannelId, isTs
 *   - Link builder: buildPermalink
 *   - User/workspace memoization to avoid repeated API calls
 */

import { readConfig } from './io.js';

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

/**
 * Get the Slack token from config.json.
 * Throws an Error with .code='NO_TOKEN' if missing, empty, or not a string.
 */
export function getToken() {
  const cfg = readConfig();
  const token = cfg.slack_token;
  if (!token || typeof token !== 'string' || token.trim() === '') {
    const err = new Error(
      'slack_token is missing from config.json. ' +
      'Add a Slack xoxp- user token with the following scopes: ' +
      'search:read, channels:history, groups:history, im:history, mpim:history, ' +
      'channels:read, groups:read, reactions:read, users:read.'
    );
    err.code = 'NO_TOKEN';
    throw err;
  }
  return token.trim();
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
