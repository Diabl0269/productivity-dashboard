/**
 * shared/limit-hits.js (pure): recognise usage-limit and API-error lines in a Claude Code transcript.
 * Spec: docs/metrics.md "Cost" > Limit hits. Intl only, no dependencies.
 * Real texts: "You've hit your session limit · resets 12:40pm (Asia/Jerusalem)",
 * "You've hit your weekly limit · resets Sep 22 at 2pm (Asia/Jerusalem)", "Credit balance is too low".
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const HIT_RE = /hit your ([a-z0-9 -]*?)\blimit\b/i;
const RESET_RE = /resets\s+(?:([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i;

function zoneParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const p = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = Number(value);
  return p;
}

const offsetMs = (ms, tz) => {
  const p = zoneParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

/** UTC ms of a wall-clock time in an IANA zone (day may overflow: d = 32 is the 1st of next month). */
function zonedToMs(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

/**
 * Text of an assistant error line -> {kind: 'session'|'weekly', resetText} for a subscription limit,
 * else null (credit balance and other API errors are not limits).
 */
export function parseLimitText(text) {
  const t = String(text || '');
  const hit = HIT_RE.exec(t);
  if (!hit) return null;
  const word = hit[1].toLowerCase();
  const kind = /week/.test(word) ? 'weekly' : /session|5-hour|five-hour/.test(word) ? 'session' : null;
  return kind ? { kind, resetText: t } : null;
}

/**
 * Best-effort ISO time of the reset named in a limit text, relative to the hit time `atMs`.
 * Date-less ("resets 12:40pm (Zone)") = the next occurrence after `atMs`; with a month and day, the next
 * such date. null when the text, the zone or the date does not parse.
 */
export function parseResetsAt(text, atMs) {
  const m = RESET_RE.exec(String(text || ''));
  if (!m || !Number.isFinite(atMs)) return null;
  const [, mon, day, hh, mm, ap, tz] = m;
  try {
    let h = Number(hh) % 12;
    if (/pm/i.test(ap)) h += 12;
    const mi = mm ? Number(mm) : 0;
    if (Number(hh) < 1 || Number(hh) > 12 || mi > 59) return null;
    const now = zoneParts(atMs, tz);
    let ms;
    if (mon) {
      const month = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
      if (!month || Number(day) < 1 || Number(day) > 31) return null;
      ms = zonedToMs(now.year, month, Number(day), h, mi, tz);
      if (ms < atMs - 86400000) ms = zonedToMs(now.year + 1, month, Number(day), h, mi, tz);
    } else {
      ms = zonedToMs(now.year, now.month, now.day, h, mi, tz);
      if (ms <= atMs) ms = zonedToMs(now.year, now.month, now.day + 1, h, mi, tz);
    }
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  } catch {
    return null; // unknown time zone
  }
}

/** Text of an assistant line's content blocks. */
function lineText(line) {
  const c = line.message && line.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && typeof b.text === 'string').map((b) => b.text).join('\n');
}

/**
 * Classify a transcript line: {type: 'limit', kind, resetText} for a usage-limit line, {type: 'api-error'}
 * for any other API failure (API Error text, credit balance, a system `api_error`), else null.
 */
export function classifyErrorLine(line) {
  if (!line || typeof line !== 'object') return null;
  if (line.type === 'system' && line.subtype === 'api_error') return { type: 'api-error' };
  if (line.type === 'assistant' && line.isApiErrorMessage === true) {
    const lim = parseLimitText(lineText(line));
    return lim ? { type: 'limit', ...lim } : { type: 'api-error' };
  }
  return null;
}

/** True for the "[Request interrupted by user ...]" text the transcript writes when you press Escape. */
export function isInterruptLine(line) {
  if (!line || line.type !== 'user') return false;
  const c = line.message && line.message.content;
  const texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b && typeof b.text === 'string').map((b) => b.text) : [];
  return texts.some((t) => t.trimStart().startsWith('[Request interrupted by user'));
}

/** The assistant text "No response requested.": written when a session of a closed or crashed app is resumed. */
export function isNoResponseLine(line) {
  return !!line && line.type === 'assistant' && lineText(line).trim().startsWith('No response requested');
}

/** A user line that only carries tool results: another (parallel or background) tool finishing. */
export function isToolResultLine(line) {
  const c = line && line.type === 'user' && line.message && line.message.content;
  return Array.isArray(c) && c.some((b) => b && b.type === 'tool_result');
}

const NEAR_MS = 2 * 60000;

/**
 * Cause of a missed wake that sat from `prevMs` to `ms`: usage-limit (a limit line within the gap or 2 min
 * either side), api-error, app-closed ("No response requested."), interrupt, else unknown. `events` =
 * [{ms, cause}] of the session's error, resume and interrupt lines.
 */
export function stopCause(prevMs, ms, events) {
  const near = events.filter((e) => e.ms >= prevMs - NEAR_MS && e.ms <= ms + NEAR_MS);
  for (const c of STOP_CAUSE_ORDER) if (near.some((e) => e.cause === c)) return c;
  return 'unknown';
}

/**
 * Causes a suite script records in $CH_HOME/stop-causes.jsonl (one JSON object per line:
 * sessionId, at, cause, evidence, recordedAt). They sit right after usage-limit in the priority.
 */
export const RECORDED_STOP_CAUSES = ['idle-sweep', 'app-quit', 'app-update', 'rate-limit', 'network', 'keypress', 'mac-sleep', 'auth', 'archived'];
const STOP_CAUSE_ORDER = ['usage-limit', ...RECORDED_STOP_CAUSES, 'api-error', 'app-closed', 'interrupt'];

/**
 * Stop-cause events ({ms, cause}) for one session from the recorded entries: matching sessionId, a
 * known cause that is not 'unknown', and a readable `at`. Anything else is ignored.
 */
export function recordedStopEvents(entries, sessionId) {
  const out = [];
  for (const e of entries || []) {
    if (!e || !sessionId || e.sessionId !== sessionId || !RECORDED_STOP_CAUSES.includes(e.cause)) continue;
    const ms = Date.parse(e.at);
    if (Number.isFinite(ms)) out.push({ ms, cause: e.cause });
  }
  return out;
}
