/**
 * shared/session-metrics.js: pure (no fs) session summary from parsed Claude Code transcript lines.
 * Spec: docs/metrics.md "Sessions". Prompt text is read only to classify and to find a
 * `/ship-task <id>`; it is never stored in the record.
 */

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
  let stopBlocked = 0;
  let compactions = 0;
  let costUSD = null;
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
      if (typeof line.totalCostUSD === 'number') costUSD = line.totalCostUSD;
      continue;
    }
    if (type !== 'user' && type !== 'assistant' && type !== 'system') continue;
    if (line.isSidechain) continue;
    const ms = Date.parse(line.timestamp);
    if (Number.isNaN(ms)) continue;
    if (line.gitBranch && line.gitBranch !== 'HEAD') branch = line.gitBranch;

    // A silence of stallMinutes between two lines of an open turn is a stall.
    if (turnStart !== null && prevMs !== null && ms - prevMs >= stallMs) {
      stalls += 1;
      stallTotal += ms - prevMs;
    }
    if (firstMs === null || ms < firstMs) firstMs = ms;
    if (lastMs === null || ms > lastMs) lastMs = ms;

    if (type === 'user') {
      const cls = classifyUser(line);
      if (cls) {
        if (cls === 'human') {
          userPrompts += 1;
          if (firstPrompt === null) firstPrompt = userText(line.message.content) || '';
        }
        if (turnStart === null) {
          // The wait on the user ends only when the prompt came from the user.
          if (cls === 'human' && waitFrom !== null) waitMs += Math.max(0, ms - waitFrom);
          waitFrom = null;
          turnStart = ms;
          turns += 1;
        }
      }
    } else if (type === 'assistant') {
      const blocks = line.message && line.message.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b && b.type === 'tool_use' && b.name === 'AskUserQuestion') {
            questions += 1;
            const activeSoFar = activeMs + (turnStart !== null ? ms - turnStart : 0);
            if (activeSoFar > midMs) questionsMidRun += 1;
          }
        }
      }
    } else if (type === 'system') {
      if (line.subtype === 'stop_hook_summary') {
        if (line.preventedContinuation === true) stopBlocked += 1;
        else endTurn(ms);
      } else if (line.subtype === 'compact_boundary') {
        compactions += 1;
      }
    }
    prevMs = ms;
  }
  if (turnStart !== null && lastMs !== null) endTurn(lastMs);

  if (firstMs === null) return null;
  return {
    key: sessionId,
    sessionId,
    project: project ?? null,
    title: title ?? null,
    ticket: ticketFrom({ title, branch, firstPrompt }),
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
    stopBlocked,
    compactions,
    helpers: 0,
    prs,
    branch: branch ?? null,
    costUSD: costUSD === null ? null : Math.round(costUSD * 100) / 100,
  };
}
