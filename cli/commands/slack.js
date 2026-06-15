/**
 * cli/commands/slack.js
 *
 * ch slack <subcommand> [args...]
 *
 * Subcommands:
 *   recent    --days <N> --user <SLACK_USER_ID> [--count 100] [--max-pages 5] [--query "<raw>"]
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

  // Compute after:YYYY-MM-DD for the search query
  const afterMs   = Date.now() - days * 86400 * 1000;
  const afterDate = new Date(afterMs);
  const pad       = n => String(n).padStart(2, '0');
  const afterStr  = `${afterDate.getFullYear()}-${pad(afterDate.getMonth() + 1)}-${pad(afterDate.getDate())}`;

  let results;

  if (values.query) {
    // Raw override — single search bucket tagged 'custom'
    const matches = await searchAll(values.query, { count, maxPages, token });
    results = matches.map(m => normalizeMatch(m, 'custom'));
  } else {
    // Three buckets
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
          // Merge bucket tag if not already present
          const existing = seen.get(key);
          if (!existing.match_types.includes(tag)) {
            existing.match_types.push(tag);
          }
        } else {
          seen.set(key, normalizeMatch(m, tag));
        }
      }
    }

    results = Array.from(seen.values());
  }

  // Sort descending by timestamp (numeric)
  results.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

  jsonOut(results);
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
  channels  --ids <C1,C2,...> --days <N> [--limit 200] [--max-pages 5]
  thread    --channel <C> --ts <timestamp>
  reactions --channel <C> --ts <timestamp> [--user <U>]

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
