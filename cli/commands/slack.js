/**
 * cli/commands/slack.js
 *
 * ch slack <subcommand> [args...]
 *
 * Subcommands:
 *   recent    --days <N> --user <SLACK_USER_ID> [--count 100] [--max-pages 5] [--query "<raw>"]
 *   awaiting  --user <SLACK_USER_ID> --days <N> [--count 100] [--max-pages 5] [--cap 10]
 *   channels  --ids <C1,C2,...> --days <N> [--limit 200] [--max-pages 5]
 *   thread    --channel <C> --ts <timestamp>
 *   reactions --channel <C> --ts <timestamp> [--user <U>]
 *
 * All subcommands output JSON arrays or objects to stdout.
 * Token is read from config.json slack_token.
 */

import { parse } from '../lib/args.js';
import { jsonOut, die } from '../lib/output.js';
import {
  getToken,
  resolveUsername,
  workspaceBaseUrl,
  slackCall,
  buildPermalink,
  searchAll,
  historyAll,
  repliesAll,
  isUserId,
  isChannelId,
  isTs,
} from '../lib/slack.js';

// ─── recent ──────────────────────────────────────────────────────────────────

async function cmdRecent(argv) {
  const { values } = parse(argv, {
    days:       { type: 'string' },
    user:       { type: 'string' },
    count:      { type: 'string' },
    'max-pages':{ type: 'string' },
    query:      { type: 'string' },
    json:       { type: 'boolean', short: 'j' },
  });

  const user = values.user;
  if (!user || !isUserId(user)) {
    die('--user <SLACK_USER_ID> is required and must be a valid Slack user ID (e.g. U01ABCDEFG)', 1);
  }

  const days = parseInt(values.days || '7', 10);
  if (isNaN(days) || days < 1) {
    die('--days must be a positive integer', 1);
  }

  const count    = parseInt(values.count || '100', 10);
  const maxPages = parseInt(values['max-pages'] || '5', 10);

  const token    = getToken();
  const username = await resolveUsername(user, token);

  const { afterStr } = computeAfterStr(days);

  let results;

  if (values.query) {
    // Raw override — single search bucket tagged 'custom'
    const matches = await searchAll(values.query, { count, maxPages, token });
    results = matches.map(m => normalizeMatch(m, 'custom'));
  } else {
    results = await fetchRecentBuckets(username, { count, maxPages, token, afterStr });
  }

  // Sort descending by timestamp (numeric)
  results.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

  jsonOut(results);
}

/** Compute the search `after:YYYY-MM-DD` string and its epoch-ms for a day window. */
function computeAfterStr(days) {
  const afterMs   = Date.now() - days * 86400 * 1000;
  const afterDate = new Date(afterMs);
  const pad       = n => String(n).padStart(2, '0');
  const afterStr  = `${afterDate.getFullYear()}-${pad(afterDate.getMonth() + 1)}-${pad(afterDate.getDate())}`;
  return { afterStr, afterMs };
}

/**
 * Run the three search buckets (from_user / to_user / mention) for `username`,
 * dedupe by channel:ts (merging match_types), and return the normalized matches.
 * Shared by `recent` and `awaiting`.
 */
async function fetchRecentBuckets(username, { count, maxPages, token, afterStr }) {
  const buckets = [
    { tag: 'from_user', q: `from:@${username} after:${afterStr}` },
    { tag: 'to_user',   q: `to:@${username} after:${afterStr}` },
    { tag: 'mention',   q: `@${username} after:${afterStr}` },
  ];

  // Dedupe map: key = "channelId:ts"
  const seen = new Map();

  for (const { tag, q } of buckets) {
    const matches = await searchAll(q, { count, maxPages, token });
    for (const m of matches) {
      const key = `${m.channel?.id}:${m.ts}`;
      if (seen.has(key)) {
        const existing = seen.get(key);
        if (!existing.match_types.includes(tag)) {
          existing.match_types.push(tag);
        }
      } else {
        seen.set(key, normalizeMatch(m, tag));
      }
    }
  }

  return Array.from(seen.values());
}

function normalizeMatch(m, bucketTag) {
  return {
    text:         m.text,
    permalink:    m.permalink,
    timestamp:    m.ts,
    channel:      m.channel?.id   ?? null,
    channel_name: m.channel?.name ?? null,
    author_id:    m.user          ?? null,
    author_name:  m.username      ?? null,
    is_private:   m.channel?.is_private ?? null,
    match_types:  [bucketTag],
  };
}

// ─── awaiting ──────────────────────────────────────────────────────────────────

/**
 * DM-like conversations, where replies are top-level rather than threaded:
 * 1:1 DMs (`D...`), legacy group DMs (`G...`), and modern multi-person DMs
 * (which come back as `C...` ids but with an `mpdm-...` channel name).
 */
function isDmLike(channelId, channelName) {
  return /^[DG]/.test(channelId || '') || /^mpdm-/.test(channelName || '');
}

/** Heuristic: does this text read like a question/request expecting a reply? (advisory only) */
function looksLikeQuestion(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('?')) return true;
  return /\b(can|could|would|should|wdyt|pls|please|let me know|lmk|any update|following up|follow up|thoughts|approve|review|wanna|do you|did you)\b/.test(t);
}

/** Automated authors whose messages are never "awaiting a reply" (install/reminder notices, etc.). */
const BOT_AUTHORS = new Set(['USLACKBOT']);

/** True if `user` reacted to the message object (reactions inline on history/replies payloads). */
function userReacted(msg, user) {
  return (msg?.reactions || []).some(r => (r.users || []).includes(user));
}

/** Extract the `thread_ts` query param from a Slack permalink, or null if top-level. */
function threadTsFromPermalink(permalink) {
  const m = /[?&]thread_ts=([0-9]+\.[0-9]+)/.exec(permalink || '');
  return m ? m[1] : null;
}

/**
 * `ch slack awaiting --user <U> --days <N>`
 *
 * Find inbound messages directed at <U> (DMs, @mentions, to:user) over the window, then
 * VERIFY each one server-side and return ONLY the UNRESOLVED ("awaiting") ones — fully
 * verified, so the caller needs no JSON post-processing, no thread/reaction follow-up calls,
 * and no ad-hoc scripts.
 *
 * Resolution (a candidate is "resolved" = NOT awaiting if any holds):
 *   - DM-like (D.../G.../mpdm): <U> sent any later message in that conversation. We read this
 *     straight from the `from:@<U>` search bucket already fetched — it captures every message
 *     <U> authored in the window, INCLUDING thread replies. (This is why we do NOT use
 *     conversations.history/`thread` for DMs: history omits thread replies and `thread` on a
 *     DM question reports message_count 1, both of which falsely flag answered DMs.)
 *   - Channel mention: <U> replied in that message's thread, or reacted to it. Verified with a
 *     single conversations.replies call per candidate (thread root from the permalink).
 *   - Reaction-only acknowledgement on a DM: confirmed with a bounded reactions.get fallback.
 *
 * A failed lookup (channel_not_found for a defunct/left DM, a deactivated user, an inaccessible
 * channel) is non-fatal: the candidate is counted unverifiable and skipped, never flagged, and
 * never aborts the run (mirrors the daily-summary per-item skip rule).
 */
async function cmdAwaiting(argv) {
  const { values } = parse(argv, {
    days:        { type: 'string' },
    user:        { type: 'string' },
    count:       { type: 'string' },
    'max-pages': { type: 'string' },
    cap:         { type: 'string' },
    json:        { type: 'boolean', short: 'j' },
  });

  const user = values.user;
  if (!user || !isUserId(user)) {
    die('--user <SLACK_USER_ID> is required and must be a valid Slack user ID (e.g. U01ABCDEFG)', 1);
  }

  const days = parseInt(values.days || '7', 10);
  if (isNaN(days) || days < 1) {
    die('--days must be a positive integer', 1);
  }

  const count    = parseInt(values.count || '100', 10);
  const maxPages = parseInt(values['max-pages'] || '5', 10);
  const cap      = parseInt(values.cap || '10', 10);

  const token    = getToken();
  const username = await resolveUsername(user, token);
  const { afterStr } = computeAfterStr(days);

  const recent = await fetchRecentBuckets(username, { count, maxPages, token, afterStr });

  // Index every recent message by channel — used for the in-memory DM reply check below.
  const byChannel = new Map();
  for (const m of recent) {
    if (!byChannel.has(m.channel)) byChannel.set(m.channel, []);
    byChannel.get(m.channel).push(m);
  }

  // Candidates: inbound (not from <user>, not a bot/automation), directed at <user>, with real text.
  const candidates = recent.filter(m =>
    m.author_id && m.author_id !== user && !BOT_AUTHORS.has(m.author_id) &&
    (m.text || '').trim().length > 0 &&
    (isDmLike(m.channel, m.channel_name) || m.match_types.includes('mention') || m.match_types.includes('to_user'))
  );

  const MAX_API_CALLS = 40; // bound per-candidate thread/reaction verification calls
  let apiCalls = 0;
  let resolvedCount = 0;
  let unverifiableCount = 0;
  const awaiting = [];

  for (const c of candidates) {
    const candTs = Number(c.timestamp);
    const dmLike = isDmLike(c.channel, c.channel_name);
    let resolved = false;
    let unverifiable = false;

    // Reply check.
    if (dmLike) {
      // In-memory: did <user> author any later message in this conversation? (zero API calls;
      // the from:@<user> bucket includes <user>'s top-level AND thread messages.)
      const msgs = byChannel.get(c.channel) || [];
      resolved = msgs.some(m => m.author_id === user && Number(m.timestamp) > candTs);

      // Reaction-only acknowledgement fallback (bounded).
      if (!resolved && apiCalls < MAX_API_CALLS) {
        apiCalls++;
        try {
          const data = await slackCall('reactions.get', { channel: c.channel, timestamp: c.timestamp, full: true }, { token });
          if ((data.message?.reactions || []).some(r => (r.users || []).includes(user))) resolved = true;
        } catch { /* reaction lookup failed — reply check already authoritative; treat as no-ack */ }
      }
    } else if (apiCalls < MAX_API_CALLS) {
      // Channel mention: check the message's thread for a reply by <user> (or a reaction).
      apiCalls++;
      const root = threadTsFromPermalink(c.permalink) || c.timestamp;
      try {
        const thread = await repliesAll(c.channel, root, { token });
        resolved =
          thread.some(m => m.user === user && Number(m.ts) > candTs) ||
          thread.some(m => m.ts === c.timestamp && userReacted(m, user));
      } catch {
        unverifiable = true; // lookup failed -> skip, don't flag
      }
    } else {
      unverifiable = true; // verification budget exhausted -> skip (don't flag unverified)
    }

    if (unverifiable) { unverifiableCount++; continue; }
    if (resolved)     { resolvedCount++; continue; }
    awaiting.push({
      author_id:           c.author_id,
      author_name:         c.author_name,
      text:                c.text,
      channel:             c.channel,
      channel_name:        c.channel_name,
      is_private:          c.is_private,
      timestamp:           c.timestamp,
      permalink:           c.permalink,
      match_types:         c.match_types,
      looks_like_question: looksLikeQuestion(c.text),
    });
  }

  awaiting.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

  jsonOut({
    user,
    username,
    days,
    after:               afterStr,
    candidates_examined: candidates.length,
    resolved_count:      resolvedCount,
    unverifiable_count:  unverifiableCount,
    awaiting_count:      awaiting.length,
    awaiting:            awaiting.slice(0, cap),
  });
}

// ─── channels ────────────────────────────────────────────────────────────────

async function cmdChannels(argv) {
  const { values } = parse(argv, {
    ids:         { type: 'string' },
    days:        { type: 'string' },
    limit:       { type: 'string' },
    'max-pages': { type: 'string' },
    json:        { type: 'boolean', short: 'j' },
  });

  if (!values.ids) {
    die('--ids <C1,C2,...> is required', 1);
  }

  const ids = values.ids.split(',').map(s => s.trim()).filter(Boolean);
  for (const id of ids) {
    if (!isChannelId(id)) {
      die(`invalid channel ID: "${id}" (expected Slack channel ID starting with C, G, or D)`, 1);
    }
  }

  const days = parseInt(values.days || '7', 10);
  if (isNaN(days) || days < 1) {
    die('--days must be a positive integer', 1);
  }

  const limit    = parseInt(values.limit || '200', 10);
  const maxPages = parseInt(values['max-pages'] || '5', 10);

  const token  = getToken();
  const base   = await workspaceBaseUrl(token);
  const oldest = String(Math.floor((Date.now() / 1000) - days * 86400));

  const allMessages = [];

  for (const id of ids) {
    // Best-effort channel name resolution
    let channelName = null;
    try {
      const info = await slackCall('conversations.info', { channel: id }, { token });
      channelName = info.channel?.name ?? null;
    } catch {
      // Non-fatal: leave null and continue
    }

    const msgs = await historyAll(id, { oldest, limit, maxPages, token });

    for (const msg of msgs) {
      // Skip join/leave system subtypes
      if (msg.subtype === 'channel_join' || msg.subtype === 'channel_leave') continue;

      allMessages.push({
        text:         msg.text || '',
        permalink:    buildPermalink(base, id, msg.ts, msg.thread_ts),
        timestamp:    msg.ts,
        channel:      id,
        channel_name: channelName,
        author_id:    msg.user || msg.bot_id || null,
        thread_ts:    msg.thread_ts || null,
        reply_count:  msg.reply_count || 0,
      });
    }
  }

  // Sort descending by timestamp
  allMessages.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

  jsonOut(allMessages);
}

// ─── thread ──────────────────────────────────────────────────────────────────

async function cmdThread(argv) {
  const { values } = parse(argv, {
    channel: { type: 'string' },
    ts:      { type: 'string' },
    json:    { type: 'boolean', short: 'j' },
  });

  if (!values.channel || !isChannelId(values.channel)) {
    die('--channel <C> is required and must be a valid Slack channel ID', 1);
  }
  if (!values.ts || !isTs(values.ts)) {
    die('--ts <timestamp> is required and must be a valid Slack timestamp (e.g. 1700000000.000100)', 1);
  }

  const channel = values.channel;
  const ts      = values.ts;
  const token   = getToken();
  const base    = await workspaceBaseUrl(token);

  const msgs = await repliesAll(channel, ts, { token });

  const messages = msgs.map(m => ({
    text:      m.text,
    permalink: buildPermalink(base, channel, m.ts, ts),
    timestamp: m.ts,
    channel,
    author_id: m.user || m.bot_id || null,
    is_parent: m.ts === ts,
  }));

  jsonOut({
    channel,
    thread_ts:     ts,
    message_count: messages.length,
    messages,
  });
}

// ─── reactions ───────────────────────────────────────────────────────────────

async function cmdReactions(argv) {
  const { values } = parse(argv, {
    channel: { type: 'string' },
    ts:      { type: 'string' },
    user:    { type: 'string' },
    json:    { type: 'boolean', short: 'j' },
  });

  if (!values.channel || !isChannelId(values.channel)) {
    die('--channel <C> is required and must be a valid Slack channel ID', 1);
  }
  if (!values.ts || !isTs(values.ts)) {
    die('--ts <timestamp> is required and must be a valid Slack timestamp', 1);
  }

  const channel = values.channel;
  const ts      = values.ts;
  const token   = getToken();

  // NOTE: reactions.get uses 'timestamp' param, NOT 'ts'
  const data      = await slackCall('reactions.get', { channel, timestamp: ts, full: true }, { token });
  const reactions = (data.message?.reactions || []).map(r => ({
    name:  r.name,
    count: r.count,
    users: r.users || [],
  }));

  const result = { channel, ts, reactions };

  if (values.user) {
    if (!isUserId(values.user)) {
      die('--user must be a valid Slack user ID', 1);
    }
    result.user   = values.user;
    result.reacted = reactions.some(r => (r.users || []).includes(values.user));
  }

  jsonOut(result);
}

// ─── dispatcher ──────────────────────────────────────────────────────────────

const USAGE = `ch slack <subcommand> [args...]

Subcommands:
  recent    --days <N> --user <UID> [--count 100] [--max-pages 5] [--query "<raw>"]
  awaiting  --user <UID> --days <N> [--count 100] [--max-pages 5] [--cap 10]
  channels  --ids <C1,C2,...> --days <N> [--limit 200] [--max-pages 5]
  thread    --channel <C> --ts <timestamp>
  reactions --channel <C> --ts <timestamp> [--user <U>]

awaiting: returns only messages directed at <UID> with NO reply/reaction from <UID> —
fully verified server-side (no follow-up thread/reaction calls or JSON post-processing needed).

All commands output JSON. Token: config.json slack_token (xoxp- user token).`;

export default async function slack(argv) {
  const sub = argv[0];

  if (!sub || sub === '--help' || sub === 'help') {
    process.stdout.write(USAGE + '\n');
    return;
  }

  const rest = argv.slice(1);

  try {
    switch (sub) {
      case 'recent':    return await cmdRecent(rest);
      case 'awaiting':  return await cmdAwaiting(rest);
      case 'channels':  return await cmdChannels(rest);
      case 'thread':    return await cmdThread(rest);
      case 'reactions': return await cmdReactions(rest);
      default:
        die(`unknown slack subcommand: "${sub}"\n${USAGE}`, 1);
    }
  } catch (e) {
    if (e.code === 'NO_TOKEN') {
      die(e.message, 2);
    }
    die(`slack ${sub} failed: ${e.message}`, 2);
  }
}
