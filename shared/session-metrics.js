/**
 * shared/session-metrics.js: pure (no fs) session summary from parsed Claude Code transcript lines.
 * Spec: docs/metrics.md "Sessions". Prompt text is read only to classify and to find a
 * `/ship-task <id>`; it is never stored in the record.
 */

import { priceUsage, normalizeModel } from './model-prices.js';

const TICKET_RE = /^[\s"'`]*([A-Z]{2,5}\d+)\b/;
const BRANCH_RE = /(?:^|[^a-z])([a-z]{2,5}\d+)(?![a-z0-9])/i;
const SHIP_RE = /\/ship-task\b[\s\S]{0,80}?\b([A-Za-z]{2,5}\d+)\b/;
const ARGS_RE = /<command-args>\s*([A-Za-z]{2,5}\d+)\b/;

/** Ticket id from the session title, else the branch, else the first `/ship-task <id>` prompt. */
export function ticketFrom({ title, branch, firstPrompt } = {}) {
  if (title) {
    const m = TICKET_RE.exec(String(title));
    if (m) return m[1];
  }
  if (branch) {
    const m = BRANCH_RE.exec(String(branch));
    if (m) return m[1].toUpperCase();
  }
  if (firstPrompt) {
    const s = String(firstPrompt).slice(0, 4000);
    if (s.includes('/ship-task')) {
      const a = ARGS_RE.exec(s);
      if (a) return a[1].toUpperCase();
      const m = SHIP_RE.exec(s);
      if (m) return m[1].toUpperCase();
    }
  }
  return null;
}

const NON_PROMPT_PREFIX = ['<task-notification', '<system-reminder', '<local-command-caveat', '<local-command-stdout'];

/** Text of a user line's content (string or text blocks), or null when it only carries tool results. */
function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string');
  if (texts.length === 0) return null;
  return texts.map((b) => b.text).join('\n');
}

/**
 * Classify a user line: 'human' (a prompt from the person), 'other' (task notification, scheduled
 * wake-up, peer/agent message, meta text) or null (tool_result carrier).
 * Real field: `origin.kind === 'human'` (newer transcripts, `turnOrigin: 'human'`). Older lines
 * without origin count as human when they are non-meta text that is not a notification/reminder.
 */
export function classifyUser(line) {
  if (line.isSidechain) return null;
  const text = userText(line.message && line.message.content);
  if (text === null) return null;
  if (line.isMeta) return 'other';
  const kind = line.origin && line.origin.kind;
  if (kind) return kind === 'human' ? 'human' : 'other';
  if (line.turnOrigin) return line.turnOrigin === 'human' ? 'human' : 'other';
  const t = text.trimStart();
  if (NON_PROMPT_PREFIX.some((p) => t.startsWith(p))) return 'other';
  return 'human';
}

const HELPER_ORIGINS = new Set(['task-notification', 'peer']);

// `ch tasks move <ID> in-progress` (also `CH_HOME=... ch`, `./ch`) starts work on a child ticket.
const MOVE_RE = /\bch\s+tasks\s+move\s+([A-Za-z]{2,5}\d+)\s+in-progress\b/i;
const SESSION = '\u0000session'; // stands for the session's own ticket, known only at the end
const rUSD = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const RAW = 6; // decimals kept on per-model / per-ticket dollars (a small ticket costs fractions of a cent)

/** Token counts of one `message.usage` object; cache writes fall back to the 5-minute bucket. */
function usageOf(u) {
  if (!u || typeof u !== 'object') return null;
  const cc = u.cache_creation;
  const has = cc && typeof cc === 'object' && (cc.ephemeral_5m_input_tokens !== undefined || cc.ephemeral_1h_input_tokens !== undefined);
  const n = (v) => (typeof v === 'number' && v > 0 ? v : 0);
  return {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite5m: has ? n(cc.ephemeral_5m_input_tokens) : n(u.cache_creation_input_tokens),
    cacheWrite1h: has ? n(cc.ephemeral_1h_input_tokens) : 0,
  };
}

/**
 * Collects token usage and tool calls from assistant lines. One API message is written as several
 * lines with the same `message.id` and the same usage, so each id counts once (field-wise max, in
 * case an early line carries a partial count). Tool calls dedupe by tool_use id.
 */
class UsageTracker {
  constructor() {
    this.msgs = new Map(); // message id -> {model, usage, ticket}
    this.toolIds = new Set();
    this.toolCalls = {};
    this.toolCallsTotal = 0;
    this.agentCalls = 0;
    this.agentModels = {};
    this.ticketTools = {}; // ticket -> tool call count
  }

  /** Register an assistant line; `ticket` is the ticket current at that moment (may be null). */
  addAssistant(line, ticket) {
    const msg = line.message;
    if (!msg || typeof msg !== 'object') return;
    const u = usageOf(msg.usage);
    if (u) {
      const id = msg.id || line.uuid;
      const prev = id ? this.msgs.get(id) : null;
      if (prev) {
        for (const k of Object.keys(u)) prev.usage[k] = Math.max(prev.usage[k], u[k]);
      } else {
        this.msgs.set(id || `anon${this.msgs.size}`, { model: msg.model || null, usage: u, ticket });
      }
    }
    if (!Array.isArray(msg.content)) return;
    for (const b of msg.content) {
      if (!b || b.type !== 'tool_use') continue;
      if (b.id) {
        if (this.toolIds.has(b.id)) continue;
        this.toolIds.add(b.id);
      }
      const name = b.name || 'tool';
      this.toolCalls[name] = (this.toolCalls[name] || 0) + 1;
      this.toolCallsTotal += 1;
      if (ticket) this.ticketTools[ticket] = (this.ticketTools[ticket] || 0) + 1;
      if (name === 'Agent') {
        this.agentCalls += 1;
        const m = (b.input && typeof b.input.model === 'string' && b.input.model) || 'inherit';
        this.agentModels[m] = (this.agentModels[m] || 0) + 1;
      }
    }
  }

  /** {tokens, byModel, costUSD, byTicket: {ticket: {costUSD, tokens}}}; costUSD null when nothing priced. */
  totals() {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const byModel = {};
    const byTicket = {};
    let cost = 0;
    let priced = false;
    for (const { model, usage, ticket } of this.msgs.values()) {
      const write = usage.cacheWrite5m + usage.cacheWrite1h;
      tokens.input += usage.input;
      tokens.output += usage.output;
      tokens.cacheRead += usage.cacheRead;
      tokens.cacheWrite += write;
      const name = normalizeModel(model) || 'unknown';
      const m = byModel[name] || (byModel[name] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0 });
      m.input += usage.input;
      m.output += usage.output;
      m.cacheRead += usage.cacheRead;
      m.cacheWrite += write;
      const c = priceUsage(model, usage);
      if (c !== null) { m.costUSD += c; cost += c; priced = true; }
      if (ticket) {
        const t = byTicket[ticket] || (byTicket[ticket] = { costUSD: 0, tokens: 0 });
        t.tokens += usage.input + usage.output + usage.cacheRead + write;
        if (c !== null) t.costUSD += c;
      }
    }
    for (const m of Object.values(byModel)) m.costUSD = rUSD(m.costUSD, RAW);
    return { tokens, byModel, costUSD: priced ? cost : null, byTicket };
  }
}

/**
 * Pure summary of one helper (subagent) transcript: usage and cost per model, tool calls and the
 * first timestamp (ms), used to attribute the helper's cost to the ticket current at that time.
 * Helper lines are all sidechain lines, so no sidechain filter applies here.
 */
export function summarizeHelperUsage(lines) {
  const tr = new UsageTracker();
  let firstMs = null;
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const ms = Date.parse(line.timestamp);
    if (!Number.isNaN(ms) && (firstMs === null || ms < firstMs)) firstMs = ms;
    if (line.type === 'assistant') tr.addAssistant(line, null);
  }
  const t = tr.totals();
  return { firstMs, tokens: t.tokens, byModel: t.byModel, costUSD: t.costUSD, toolCallsTotal: tr.toolCallsTotal };
}

/** The ticket current at `ms`: the last switch in `rec.ticketTimeline` ([[iso, id], ...]) at or before it, else the session's. */
export function ticketAt(rec, ms) {
  let cur = rec.ticket ?? null;
  for (const [t, id] of rec.ticketTimeline || []) {
    if (Date.parse(t) <= ms) cur = id;
    else break;
  }
  return cur;
}

/**
 * Fold helper summaries (from summarizeHelperUsage) into a session record: helper totals, the
 * combined costUSD (main + helpers, cents) and each helper's cost into `byTicket` for the ticket
 * current at the helper's first timestamp. Returns the record.
 */
export function applyHelpers(rec, helpers) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byModel = {};
  let cost = 0;
  let priced = false;
  let calls = 0;
  const byTicket = rec.byTicket || (rec.byTicket = {});
  for (const h of helpers || []) {
    for (const k of Object.keys(tokens)) tokens[k] += h.tokens[k];
    calls += h.toolCallsTotal || 0;
    for (const [name, m] of Object.entries(h.byModel || {})) {
      const x = byModel[name] || (byModel[name] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0 });
      x.input += m.input; x.output += m.output; x.cacheRead += m.cacheRead; x.cacheWrite += m.cacheWrite; x.costUSD += m.costUSD;
    }
    if (h.costUSD !== null && h.costUSD !== undefined) { cost += h.costUSD; priced = true; }
    const ticket = h.firstMs === null || h.firstMs === undefined ? rec.ticket ?? null : ticketAt(rec, h.firstMs);
    if (ticket) {
      const t = byTicket[ticket] || (byTicket[ticket] = { costUSD: 0, tokens: 0, toolCalls: 0 });
      t.costUSD = rUSD(t.costUSD + (h.costUSD || 0), RAW);
      t.tokens += h.tokens.input + h.tokens.output + h.tokens.cacheRead + h.tokens.cacheWrite;
      t.toolCalls += h.toolCallsTotal || 0;
    }
  }
  for (const m of Object.values(byModel)) m.costUSD = rUSD(m.costUSD, RAW);
  rec.helperCostUSD = priced ? rUSD(cost) : null;
  rec.helperTokens = tokens;
  rec.helperByModel = byModel;
  rec.helperToolCalls = calls;
  const main = rec.mainCostUSD;
  rec.costUSD = (main === null || main === undefined) && !priced ? null : rUSD((main || 0) + cost);
  return rec;
}

const r1 = (n) => Math.round(n * 10) / 10;

export function summarizeSession(lines, { stallMinutes = 20, midRunMinutes = 15, project } = {}) {
  const stallMs = stallMinutes * 60000;
  const midMs = midRunMinutes * 60000;
  let sessionId = null;
  let title = null;
  let branch = null;
  let firstPrompt = null;
  let firstMs = null;
  let lastMs = null;
  let prevMs = null;
  let turnStart = null; // ms when the open turn began
  let waitFrom = null; // ms when the current wait began (last turn end)
  let activeMs = 0;
  let waitMs = 0;
  let turns = 0;
  let userPrompts = 0;
  let questions = 0;
  let questionsMidRun = 0;
  let stalls = 0;
  let stallTotal = 0;
  let missedWakes = 0;
  let missedWakeMs = 0;
  const missedWakeOrigins = {};
  let helperWaits = 0;
  let helperWaitMs = 0;
  let lastWasUser = false; // the last conversation line was a user line (prompt or tool result)
  let assistantStarted = false; // an assistant line was written since the open turn's prompt
  let openOrigin = 'human'; // origin of the prompt that opened the turn
  let questionWaits = 0;
  let questionWaitMs = 0;
  let toolWaits = 0;
  let toolWaitMs = 0;
  const toolWaitTools = {};
  const replyWaits = [];
  const pending = new Map(); // tool_use id -> tool name, until its tool_result arrives
  let stopBlocked = 0;
  let compactions = 0;
  let costStateUSD = null;
  const usage = new UsageTracker();
  let curTicket = SESSION;
  const switches = []; // [ms, ticket]
  const prs = [];

  const endTurn = (ms) => {
    if (turnStart === null) return;
    activeMs += Math.max(0, ms - turnStart);
    turnStart = null;
    waitFrom = ms;
  };

  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const type = line.type;
    if (!sessionId && line.sessionId) sessionId = line.sessionId;
    if (type === 'custom-title') {
      if (line.customTitle) title = line.customTitle;
      continue;
    }
    if (type === 'pr-link') {
      if (line.prRepository && line.prNumber) {
        const ref = `${line.prRepository}#${line.prNumber}`;
        if (!prs.includes(ref)) prs.push(ref);
      }
      continue;
    }
    if (type === 'cost-state') {
      if (typeof line.totalCostUSD === 'number') costStateUSD = line.totalCostUSD;
      continue;
    }
    if (type !== 'user' && type !== 'assistant' && type !== 'system') continue;
    if (line.isSidechain) continue;
    const ms = Date.parse(line.timestamp);
    if (Number.isNaN(ms)) continue;
    if (line.gitBranch && line.gitBranch !== 'HEAD') branch = line.gitBranch;

    // A silence of stallMinutes between two lines of an open turn, by what was pending when it began:
    // an AskUserQuestion (waiting on you), another tool call (long command or permission prompt),
    // or nothing (the model or API went silent: a stall).
    if (turnStart !== null && prevMs !== null && ms - prevMs >= stallMs) {
      const gap = ms - prevMs;
      const names = [...pending.values()];
      if (names.includes('AskUserQuestion')) {
        questionWaits += 1;
        questionWaitMs += gap;
      } else if (names.length) {
        toolWaits += 1;
        toolWaitMs += gap;
        for (const n of new Set(names)) toolWaitTools[n] = (toolWaitTools[n] || 0) + 1;
      } else if (!assistantStarted && HELPER_ORIGINS.has(openOrigin) && type === 'user'
        && classifyUser(line) === 'other' && HELPER_ORIGINS.has(line.origin && line.origin.kind)) {
        // The turn was opened by a notification or peer message and the next line is another one: the
        // session was waiting on a still-running subagent or background task, not stuck.
        helperWaits += 1;
        helperWaitMs += gap;
      } else if (!assistantStarted || (lastWasUser && type !== 'assistant')) {
        // The prompt that opened the turn, or the last tool result, was never answered (idle-stopped,
        // queued or blocked). When the model does answer after the gap, it is a stall instead.
        const origin = assistantStarted ? 'tool-result' : openOrigin;
        missedWakes += 1;
        missedWakeMs += gap;
        missedWakeOrigins[origin] = (missedWakeOrigins[origin] || 0) + 1;
      } else {
        stalls += 1;
        stallTotal += gap;
      }
    }
    if (firstMs === null || ms < firstMs) firstMs = ms;
    if (lastMs === null || ms > lastMs) lastMs = ms;

    if (type === 'user') {
      const content = line.message && line.message.content;
      if (Array.isArray(content)) {
        for (const b of content) if (b && b.type === 'tool_result' && b.tool_use_id) pending.delete(b.tool_use_id);
      }
      const cls = classifyUser(line);
      if (cls) {
        if (cls === 'human') {
          userPrompts += 1;
          if (firstPrompt === null) firstPrompt = userText(line.message.content) || '';
        }
        if (turnStart === null) {
          // The wait on the user ends only when the prompt came from the user.
          if (cls === 'human' && waitFrom !== null) {
            waitMs += Math.max(0, ms - waitFrom);
            replyWaits.push(r1(Math.max(0, ms - waitFrom) / 60000));
          }
          waitFrom = null;
          turnStart = ms;
          turns += 1;
          assistantStarted = false;
          openOrigin = cls === 'human' ? 'human' : (line.origin && line.origin.kind) || (line.isMeta ? 'meta' : 'other');
        }
      }
    } else if (type === 'assistant') {
      assistantStarted = true;
      const blocks = line.message && line.message.content;
      usage.addAssistant(line, curTicket);
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b && b.type === 'tool_use' && b.name === 'Bash' && b.input && typeof b.input.command === 'string') {
            const mv = MOVE_RE.exec(b.input.command);
            if (mv) { curTicket = mv[1].toUpperCase(); switches.push([ms, curTicket]); }
          }
          if (b && b.type === 'tool_use' && b.id) pending.set(b.id, b.name || 'tool');
          if (b && b.type === 'tool_use' && b.name === 'AskUserQuestion') {
            questions += 1;
            const activeSoFar = activeMs + (turnStart !== null ? ms - turnStart : 0);
            if (activeSoFar > midMs) questionsMidRun += 1;
          }
        }
        // A final message (no tool call) closes the turn even when no stop_hook_summary follows.
        const sr = line.message && line.message.stop_reason;
        if ((sr === 'end_turn' || sr === 'stop_sequence') && !blocks.some(b => b && b.type === 'tool_use')) endTurn(ms);
      }
    } else if (type === 'system') {
      if (line.subtype === 'stop_hook_summary') {
        if (line.preventedContinuation === true) stopBlocked += 1;
        else endTurn(ms);
      } else if (line.subtype === 'compact_boundary') {
        compactions += 1;
      }
    }
    if (type === 'user') lastWasUser = true;
    else if (type === 'assistant') lastWasUser = false;
    prevMs = ms;
  }
  if (turnStart !== null && lastMs !== null) endTurn(lastMs);

  if (firstMs === null) return null;
  const ticket = ticketFrom({ title, branch, firstPrompt });
  const ut = usage.totals();
  const byTicket = {};
  for (const [k, v] of Object.entries(ut.byTicket)) {
    const id = k === SESSION ? ticket : k;
    if (!id) continue;
    const e = byTicket[id] || (byTicket[id] = { costUSD: 0, tokens: 0, toolCalls: 0 });
    e.costUSD += v.costUSD;
    e.tokens += v.tokens;
  }
  for (const [k, n] of Object.entries(usage.ticketTools)) {
    const id = k === SESSION ? ticket : k;
    if (!id) continue;
    const e = byTicket[id] || (byTicket[id] = { costUSD: 0, tokens: 0, toolCalls: 0 });
    e.toolCalls += n;
  }
  for (const e of Object.values(byTicket)) e.costUSD = rUSD(e.costUSD, RAW);
  if (ticket && !byTicket[ticket]) byTicket[ticket] = { costUSD: 0, tokens: 0, toolCalls: 0 };
  return {
    key: sessionId,
    sessionId,
    project: project ?? null,
    title: title ?? null,
    ticket,
    start: new Date(firstMs).toISOString(),
    end: new Date(lastMs).toISOString(),
    wallMin: r1((lastMs - firstMs) / 60000),
    activeMin: r1(activeMs / 60000),
    waitUserMin: r1(waitMs / 60000),
    turns,
    userPrompts,
    questions,
    questionsMidRun,
    stalls,
    stallMin: r1(stallTotal / 60000),
    missedWakes,
    missedWakeMin: r1(missedWakeMs / 60000),
    missedWakeOrigins,
    helperWaits,
    helperWaitMin: r1(helperWaitMs / 60000),
    toolWaits,
    toolWaitMin: r1(toolWaitMs / 60000),
    toolWaitTools,
    questionWaits,
    questionWaitMin: r1(questionWaitMs / 60000),
    replyWaits,
    stopBlocked,
    compactions,
    helpers: 0,
    prs,
    branch: branch ?? null,
    // Claude Code's own `cost-state` total (rare); costUSD below is computed from usage.
    costStateUSD: costStateUSD === null ? null : rUSD(costStateUSD),
    tokens: ut.tokens,
    byModel: ut.byModel,
    mainCostUSD: ut.costUSD === null ? null : rUSD(ut.costUSD, RAW),
    costUSD: ut.costUSD === null ? null : rUSD(ut.costUSD),
    toolCalls: usage.toolCalls,
    toolCallsTotal: usage.toolCallsTotal,
    agentCalls: usage.agentCalls,
    agentModels: usage.agentModels,
    byTicket,
    // Ticket switches (`ch tasks move <id> in-progress`): [[iso, id], ...] in order.
    ticketTimeline: switches.map(([t, id]) => [new Date(t).toISOString(), id]),
  };
}
