/**
 * shared/asks.js — "Asks for you": questions a session left for Tal (PRO73).
 *
 * New asks live on the ticket as `asks` and show as `Ask:` lines next to its result:
 *   asks: [{ n, at, text, by?, mergePr?, state, answer?, resolvedAt? }]
 *   state: 'open' | 'answered' | 'done' | 'dismissed'
 * An ask stays open until Tal answers, marks it done or dismisses it, even after the ticket
 * is done. A merge ask (`mergePr`) also closes itself once that PR merges.
 *
 * Older tickets carry their questions in the result instead, and are read as asks with no
 * migration:
 *   - a Left line ending in "?" or saying "Merge it" -> one ask per line
 *   - Unverified lines starting "needs-tal:" (the proof-gate prefix) -> one ask per ticket
 *     ("3 things to judge")
 * Resolving one of those leaves the result as it is and records it in `resolvedAsks`:
 *   resolvedAsks: [{ kind: 'left' | 'needs-tal', text, state, at }]
 * An epic's rolled-up copy of a child's line ("FRO12: ...") is shown once, on the child.
 *
 * Each open ask has a key, unique on its ticket: the ask's n ("1"), "L<i>" for the i-th Left
 * line, "T" for the needs-tal group. Answering and done write a decision on the ticket.
 *
 * Pure (no fs, no DOM); used by the CLI and the dashboard.
 */

import { isNeedsTalLine } from './proof-gate.js';

export const ASK_STATES = ['open', 'answered', 'done', 'dismissed'];
const RESOLVED_STATES = ['answered', 'done', 'dismissed'];
const RESOLVED_KINDS = ['left', 'needs-tal'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PR_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\/?$/i;
// "FRO12: " at the start of a line an epic rolled up from its child.
const ROLLED_PREFIX = /^([A-Za-z]{1,8}\d+):\s*/;

/** Is this Left line a question for Tal (ends with "?" or says "Merge it")? */
export function isLegacyQuestion(line) {
  const s = String(line ?? '').trim();
  return s.endsWith('?') || /\bMerge it\b/.test(s);
}

/** Error text for an ask question, or ''. */
export function askTextError(text) {
  if (typeof text !== 'string' || !text.trim()) return 'the question must be a non-empty string';
  if (text.trim().length > 1000) return 'the question must be at most 1000 characters';
  return '';
}

/** Error text for a --ask-by date, or ''. */
export function askByError(by) {
  return typeof by === 'string' && DATE_RE.test(by.trim()) ? '' : '--ask-by must be a date YYYY-MM-DD';
}

/** Error text for a --merge-pr URL, or ''. */
export function mergePrError(url) {
  return typeof url === 'string' && PR_URL_RE.test(url.trim()) ? '' : '--merge-pr must be a GitHub pull request URL (https://github.com/<owner>/<repo>/pull/<n>)';
}

/** Add an open ask to `task`. Returns the new ask; throws on a bad question, date or PR URL. */
export function addAsk(task, { text, by, mergePr, now = new Date().toISOString() } = {}) {
  const err = askTextError(text) || (by != null && by !== '' ? askByError(by) : '') || (mergePr != null && mergePr !== '' ? mergePrError(mergePr) : '');
  if (err) throw new Error(err);
  if (!Array.isArray(task.asks)) task.asks = [];
  const n = task.asks.reduce((m, a) => Math.max(m, Number(a?.n) || 0), 0) + 1;
  const ask = { n, at: now, text: text.trim(), state: 'open' };
  if (by) ask.by = by.trim();
  if (mergePr) ask.mergePr = mergePr.trim();
  task.asks.push(ask);
  return ask;
}

const resolvedSet = (task, kind) => new Set((task?.resolvedAsks || []).filter(r => r && r.kind === kind).map(r => r.text));

/**
 * The open asks of one ticket, in order: its own asks, then legacy Left questions, then the
 * needs-tal group. `skipLine(kind, line)` drops legacy lines (used to show an epic's
 * rolled-up copies once, on the child).
 * @returns {Array<{ key, kind: 'ask'|'merge'|'question'|'taste', text, line?, lines?, by?, mergePr?, at, legacy }>}
 * (`line` is a Left question's stored text, `text` its trimmed form)
 */
export function taskAsks(task, { skipLine = () => false } = {}) {
  const out = [];
  for (const a of task?.asks || []) {
    if (!a || a.state !== 'open') continue;
    const row = { key: String(a.n), kind: a.mergePr ? 'merge' : 'ask', text: a.text, at: a.at || '', legacy: false };
    if (a.by) row.by = a.by;
    if (a.mergePr) row.mergePr = a.mergePr;
    out.push(row);
  }
  const at = task?.result?.at || task?.updated || '';
  const doneLeft = resolvedSet(task, 'left');
  (task?.result?.left || []).forEach((line, i) => {
    if (!isLegacyQuestion(line) || doneLeft.has(line) || skipLine('left', line)) return;
    out.push({ key: `L${i + 1}`, kind: /\bMerge it\b/.test(line) ? 'merge' : 'question', text: line.trim(), line, at, legacy: true });
  });
  const doneTal = resolvedSet(task, 'needs-tal');
  const taste = (task?.result?.unverified || []).filter(l => isNeedsTalLine(l) && !doneTal.has(l) && !skipLine('unverified', l));
  if (taste.length) {
    out.push({ key: 'T', kind: 'taste', text: `${taste.length} thing${taste.length === 1 ? '' : 's'} to judge`, lines: taste, at, legacy: true });
  }
  return out;
}

/** Every ticket in the doc: [{ task, section }]. */
function flat(doc) {
  const rows = [];
  for (const section of doc?.sections || []) for (const task of section.tasks || []) rows.push({ task, section: section.id });
  return rows;
}

/**
 * A skipLine for `task`: true for an epic's copy "<child>: <line>" of a line the child
 * ticket still carries in the same list (the child shows it).
 */
function rolledCopySkipper(task, byId) {
  return (kind, line) => {
    const m = ROLLED_PREFIX.exec(line);
    if (!m || m[1] === task.id) return false;
    const child = byId.get(m[1]);
    if (!child) return false;
    const rest = line.slice(m[0].length);
    return (child.result?.[kind] || []).includes(rest);
  };
}

/**
 * Every open ask in the doc, one row per ask (one per ticket for needs-tal lines), oldest
 * first; asks with an answer-by date come first, soonest first.
 * @returns {Array<{ id, title, section, key, kind, text, lines?, by?, mergePr?, at, legacy }>}
 */
export function openAsks(doc) {
  const rows = flat(doc);
  const byId = new Map(rows.map(r => [r.task.id, r.task]));
  const out = [];
  for (const { task, section } of rows) {
    if (!task?.id) continue;
    for (const ask of taskAsks(task, { skipLine: rolledCopySkipper(task, byId) })) {
      out.push({ id: task.id, title: task.title || '', section, ...ask });
    }
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return out.sort((a, b) => {
    if (a.by || b.by) {
      if (!a.by) return 1;
      if (!b.by) return -1;
      if (a.by !== b.by) return cmp(a.by, b.by);
    }
    return cmp(a.at, b.at) || cmp(a.id, b.id);
  });
}

/** How many asks wait for Tal. */
export function countAsks(doc) {
  return openAsks(doc).length;
}

/** "N asks for Tal are on the Plan page", or '' when there are none. */
export function asksNotice(n) {
  if (!n) return '';
  return `${n} ask${n === 1 ? '' : 's'} for Tal ${n === 1 ? 'is' : 'are'} on the Plan page`;
}

/** The question an ask row stands for, as one line (the needs-tal group lists its lines). */
export function askQuestion(ask) {
  return ask.kind === 'taste' ? `Judge: ${ask.lines.join('; ')}` : ask.text;
}

const ACTIONS = { answer: 'answered', done: 'done', dismiss: 'dismissed' };

/**
 * Resolve the open ask `key` on `task`: `action` is 'answer' (needs `reply`), 'done' (reply
 * optional) or 'dismiss'. Answer and done add a decision to the ticket. Mutates `task`.
 * Returns { question, state, decision } (decision null for a dismiss); throws on a bad key,
 * action or missing reply.
 */
export function resolveAsk(task, key, { action, reply = '', now = new Date().toISOString(), by = 'Tal' } = {}) {
  const state = ACTIONS[action];
  if (!state) throw new Error(`unknown action "${action}" (answer, done or dismiss)`);
  const text = String(reply ?? '').trim();
  if (action === 'answer' && !text) throw new Error('an answer needs a reply');
  const open = taskAsks(task);
  const ask = open.find(a => a.key === String(key).trim().toUpperCase() || a.key === String(key).trim());
  if (!ask) {
    const keys = open.map(a => a.key).join(', ');
    throw new Error(`${task?.id || 'ticket'} has no open ask "${key}"${keys ? ` (open: ${keys})` : ' (none open)'}`);
  }
  const question = askQuestion(ask);
  if (ask.legacy) {
    if (!Array.isArray(task.resolvedAsks)) task.resolvedAsks = [];
    const lines = ask.kind === 'taste' ? ask.lines : [ask.line];
    for (const line of lines) task.resolvedAsks.push({ kind: ask.kind === 'taste' ? 'needs-tal' : 'left', text: line, state, at: now });
  } else {
    const own = task.asks.find(a => String(a.n) === ask.key);
    own.state = state;
    own.resolvedAt = now;
    if (text) own.answer = text;
  }
  let decision = null;
  if (action !== 'dismiss') {
    const said = text || 'done';
    decision = { at: now, text: `${by} ${now.slice(0, 10)}: asked "${question}": ${said}` };
    if (!Array.isArray(task.decisions)) task.decisions = [];
    task.decisions.push(decision);
  }
  return { question, state, decision };
}

/**
 * Close every open merge ask on `task` whose PR has merged. `prState(url)` returns
 * { state } (e.g. 'MERGED') or { error }; errors leave the ask open. Returns the asks closed.
 */
export function closeMergedAsks(task, prState, { now = new Date().toISOString() } = {}) {
  const closed = [];
  for (const a of task?.asks || []) {
    if (!a || a.state !== 'open' || !a.mergePr) continue;
    const s = prState(a.mergePr) || {};
    if (String(s.state || '').toUpperCase() !== 'MERGED') continue;
    resolveAsk(task, String(a.n), { action: 'done', reply: `PR merged (${a.mergePr})`, now, by: 'Auto' });
    closed.push(a);
  }
  return closed;
}

/** Plain lines for a ticket's own asks, shown with its result: "Ask: <q>" (+ how it ended). */
export function askLines(task) {
  return (task?.asks || []).filter(Boolean).map((a) => {
    const by = a.by ? ` (by ${a.by})` : '';
    const pr = a.mergePr ? ` [${a.mergePr}]` : '';
    if (a.state === 'open') return `Ask: ${a.text}${by}${pr}`;
    const how = a.state === 'dismissed' ? 'dismissed' : a.answer ? `${a.state}: ${a.answer}` : a.state;
    return `Ask: ${a.text}${pr} (${how})`;
  });
}

/** Schema errors for a ticket's `asks` and `resolvedAsks` (empty when valid). */
export function askErrors(task, ref) {
  const errors = [];
  if (task.asks !== undefined && task.asks !== null) {
    if (!Array.isArray(task.asks)) errors.push(`${ref}.asks must be an array`);
    else {
      const seen = new Set();
      task.asks.forEach((a, i) => {
        const r = `${ref}.asks[${i}]`;
        if (!a || typeof a !== 'object') { errors.push(`${r} must be an object`); return; }
        if (!Number.isInteger(a.n) || a.n < 1) errors.push(`${r}.n must be a positive integer`);
        else if (seen.has(a.n)) errors.push(`${r}.n ${a.n} is used twice`);
        seen.add(a.n);
        if (askTextError(a.text)) errors.push(`${r}.text: ${askTextError(a.text)}`);
        if (typeof a.at !== 'string') errors.push(`${r}.at must be an ISO string`);
        if (!ASK_STATES.includes(a.state)) errors.push(`${r}.state must be one of ${ASK_STATES.join(', ')}`);
        if (a.by !== undefined && askByError(a.by)) errors.push(`${r}.by must be a date YYYY-MM-DD`);
        if (a.mergePr !== undefined && mergePrError(a.mergePr)) errors.push(`${r}.mergePr must be a GitHub pull request URL`);
      });
    }
  }
  if (task.resolvedAsks !== undefined && task.resolvedAsks !== null) {
    if (!Array.isArray(task.resolvedAsks)) errors.push(`${ref}.resolvedAsks must be an array`);
    else task.resolvedAsks.forEach((x, i) => {
      const r = `${ref}.resolvedAsks[${i}]`;
      if (!x || typeof x !== 'object') { errors.push(`${r} must be an object`); return; }
      if (!RESOLVED_KINDS.includes(x.kind)) errors.push(`${r}.kind must be left or needs-tal`);
      if (typeof x.text !== 'string' || !x.text) errors.push(`${r}.text must be a non-empty string`);
      if (!RESOLVED_STATES.includes(x.state)) errors.push(`${r}.state must be answered, done or dismissed`);
    });
  }
  return errors;
}

/** Keep well-formed asks / resolvedAsks only (the dashboard loader); returns { asks, resolvedAsks }. */
export function cleanAsks(task) {
  const asks = Array.isArray(task?.asks)
    ? task.asks.filter(a => a && typeof a === 'object' && Number.isInteger(a.n) && a.n > 0 && !askTextError(a.text)
      && typeof a.at === 'string' && ASK_STATES.includes(a.state)).map((a) => {
      const e = { n: a.n, at: a.at, text: a.text, state: a.state };
      for (const k of ['by', 'mergePr', 'answer', 'resolvedAt']) if (typeof a[k] === 'string' && a[k]) e[k] = a[k];
      return e;
    })
    : [];
  const resolvedAsks = Array.isArray(task?.resolvedAsks)
    ? task.resolvedAsks.filter(x => x && RESOLVED_KINDS.includes(x.kind) && typeof x.text === 'string' && x.text
      && RESOLVED_STATES.includes(x.state)).map(x => ({ kind: x.kind, text: x.text, state: x.state, at: String(x.at || '') }))
    : [];
  return { asks, resolvedAsks };
}
