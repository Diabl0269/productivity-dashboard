/**
 * shared/asks.js — "Asks for you": decisions a session left for Tal (PRO73, PRO86).
 *
 * An ask is a choice between options, never a thing to look at (those are checks on the epic's
 * review card). It lives on the ticket as `asks`:
 *   asks: [{ n, at, text, by?, mergePr?, options?: [{ key, text }], recommend?, details?,
 *            media?: { video?, audio?, image?, project? }, sameAs?, state, answer?, resolvedAt? }]
 *   state: 'open' | 'answered' | 'done' | 'dismissed' | 'parked'
 * A new ask's text is at most 140 characters (the rest goes in `details`); media paths are
 * relative to $CH_HOME/evidence, like review evidence. A taste question ("taste: ...") is never
 * an ask: it is a check on the epic (`ch tasks review`, cli/lib/taste-checks.js). Adding an ask
 * sets the ticket's `waitingOn` to Tal; resolving it clears that.
 *
 * Decisions the Plan page's "For you" list shows (openAsks), only while the work is open (inbox / todo / in-progress / review):
 *   - the ticket's own open asks, while the ticket or its epic is open
 *   - older tickets' Left lines ending in "?" or saying "Merge it" (key L<i>), while the ticket is open;
 *     a legacy merge ask takes the PR link from the ticket's links and closes once that PR merges
 *   - an open ticket whose `waitingOn` names Tal (key W)
 * needs-tal Unverified lines are not asks: they roll up as checks on the epic's review card.
 * Rows with the same question (normalized text) or joined by `sameAs` show as one card
 * (groupAsks); answering one answers them all.
 *
 * Answering records a decision and clears waitingOn. On a done / archived ticket it adds a review
 * note instead, which is filed as a follow-up ticket (shared/review-filing.js). Park records the
 * reason and moves the ticket to backlog.
 *
 * Pure (no fs, no DOM); used by the CLI and the dashboard.
 */

import {
  evidencePathError, videoPathError, audioPathError, projectPathError, tidyEvidencePath,
} from './review.js';
import { addReviewNote } from './review-notes.js';
import { planFiling, applyFiling } from './review-filing.js';

export const ASK_STATES = ['open', 'answered', 'done', 'dismissed', 'parked'];
const RESOLVED_STATES = ['answered', 'done', 'dismissed', 'parked'];
const RESOLVED_KINDS = ['left', 'needs-tal'];
/** Sections where work is still open: an ask outside them is stale. */
export const ASK_OPEN_SECTIONS = ['inbox', 'todo', 'in-progress', 'review'];
const CLOSED_SECTIONS = ['done', 'archive'];
/** A new question's length cap; longer context goes in --details. */
export const ASK_TEXT_MAX = 140;
const STORED_TEXT_MAX = 1000; // older asks were longer; the schema still accepts them
const OPTION_MAX = 200;
const DETAILS_MAX = 4000;
export const MEDIA_KINDS = ['video', 'audio', 'image', 'project'];
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z]{1,8}\d+$/;
const PR_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\/?$/i;
const TAL_RE = /\bTal\b/i;
// "FRO12: " at the start of a line an epic rolled up from its child.
const ROLLED_PREFIX = /^([A-Za-z]{1,8}\d+):\s*/;

/** Is this Left line a question for Tal (ends with "?" or says "Merge it")? */
export function isLegacyQuestion(line) {
  const s = String(line ?? '').trim();
  return s.endsWith('?') || /\bMerge it\b/.test(s);
}

/** Does the ticket wait on Tal (its `waitingOn` names Tal)? */
export function waitsOnTal(task) {
  return typeof task?.waitingOn === 'string' && TAL_RE.test(task.waitingOn);
}

/** A question that asks Tal to judge taste ("taste: ..."): a check, never an ask. */
export function isTasteText(text) {
  return /^\s*taste\s*:/i.test(String(text ?? ''));
}

/** Error text for an ask question, or ''. `max` is 140 for new asks, 1000 for stored ones. */
export function askTextError(text, { max = STORED_TEXT_MAX } = {}) {
  if (typeof text !== 'string' || !text.trim()) return 'the question must be a non-empty string';
  const n = text.trim().length;
  if (n > max) {
    return max === ASK_TEXT_MAX
      ? `the question is ${n} characters; keep it to ${ASK_TEXT_MAX} (one plain question) and put the rest in --details`
      : `the question must be at most ${max} characters`;
  }
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

/** Image evidence: any of IMAGE_EXTS, otherwise the same rules as the other evidence paths. */
export function imagePathError(v, label = 'image') {
  const ext = IMAGE_EXTS.find(e => String(v ?? '').trim().toLowerCase().endsWith(e));
  if (ext) return evidencePathError(v, ext, label);
  const base = evidencePathError(v, '.png', label);
  return base && !base.includes('must end with') ? base : `${label} must end with one of ${IMAGE_EXTS.join(', ')}: ${String(v ?? '').trim()}`;
}

const MEDIA_CHECK = { video: videoPathError, audio: audioPathError, image: imagePathError, project: projectPathError };

/** Error for one media path of `kind`, or null. */
export function mediaPathError(kind, value) {
  const check = MEDIA_CHECK[kind];
  return check ? check(value, kind) : `unknown media kind "${kind}"`;
}

/** "A: Keep it" -> { key: 'A', text: 'Keep it' }; without a key the i-th letter is used. */
export function parseOption(input, i = 0) {
  if (input && typeof input === 'object') return { key: String(input.key || '').trim().toUpperCase(), text: String(input.text || '').trim() };
  const s = String(input ?? '').trim();
  const m = /^([A-Za-z])\s*[:).]\s*([\s\S]+)$/.exec(s);
  return m ? { key: m[1].toUpperCase(), text: m[2].trim() } : { key: String.fromCharCode(65 + i), text: s };
}

/**
 * Add an open ask to `task` and set its waitingOn to Tal. Returns the new ask; throws on a long or
 * empty question, a bad date, PR URL, option, recommendation or media path, or a taste question.
 */
export function addAsk(task, {
  text, by, mergePr, options, recommend, details, media, sameAs, now = new Date().toISOString(),
} = {}) {
  if (isTasteText(text)) {
    throw new Error('a taste question is a check, not an ask: put it on the review as --check "<what to judge>" with --check-video / --check-audio / --check-project, or as an Unverified "needs-tal: taste: <text> | video=<path>" line');
  }
  const err = askTextError(text, { max: ASK_TEXT_MAX }) || (by != null && by !== '' ? askByError(by) : '')
    || (mergePr != null && mergePr !== '' ? mergePrError(mergePr) : '');
  if (err) throw new Error(err);
  const opts = (options || []).filter(o => o != null && o !== '').map(parseOption);
  const keys = new Set();
  for (const o of opts) {
    if (!/^[A-Z]$/.test(o.key) || o.key === 'P') throw new Error(`option "${o.key}: ${o.text}" needs a one-letter key other than P (Park is always offered)`);
    if (keys.has(o.key)) throw new Error(`option ${o.key} is given twice`);
    if (!o.text || o.text.length > OPTION_MAX) throw new Error(`option ${o.key} must be 1-${OPTION_MAX} characters`);
    keys.add(o.key);
  }
  const rec = recommend != null && recommend !== '' ? String(recommend).trim().toUpperCase() : '';
  if (rec && !keys.has(rec)) throw new Error(`--recommend ${rec} is not one of the options (${[...keys].join(', ') || 'none given'})`);
  const det = details != null ? String(details).trim() : '';
  if (det.length > DETAILS_MAX) throw new Error(`--details must be at most ${DETAILS_MAX} characters`);
  const m = {};
  for (const kind of MEDIA_KINDS) {
    const v = media?.[kind];
    if (v == null || v === '') continue;
    const e = mediaPathError(kind, v);
    if (e) throw new Error(e);
    m[kind] = tidyEvidencePath(v);
  }
  if (sameAs != null && sameAs !== '' && !ID_RE.test(String(sameAs).trim())) throw new Error(`--same-as must be a ticket id: ${sameAs}`);
  if (!Array.isArray(task.asks)) task.asks = [];
  const n = task.asks.reduce((mx, a) => Math.max(mx, Number(a?.n) || 0), 0) + 1;
  const ask = { n, at: now, text: text.trim(), state: 'open' };
  if (by) ask.by = by.trim();
  if (mergePr) ask.mergePr = mergePr.trim();
  if (opts.length) ask.options = opts;
  if (rec) ask.recommend = rec;
  if (det) ask.details = det;
  if (Object.keys(m).length) ask.media = m;
  if (sameAs) ask.sameAs = String(sameAs).trim();
  task.asks.push(ask);
  task.waitingOn = `Tal: ${ask.text}`;
  return ask;
}

const resolvedSet = (task, kind) => new Set((task?.resolvedAsks || []).filter(r => r && r.kind === kind).map(r => r.text));

/** The last GitHub PR link on the ticket, or ''. */
function prLinkOf(task) {
  const urls = (task?.links || []).map(l => String(l?.url || '').trim()).filter(u => PR_URL_RE.test(u));
  return urls.length ? urls[urls.length - 1] : '';
}

/** The ticket's waitingOn without a leading "Tal:". */
function waitingText(task) {
  const raw = String(task.waitingOn).trim();
  return raw.replace(/^Tal\s*[:,-]\s*/i, '') || raw;
}

/**
 * Every open ask of one ticket, in order: its own asks, legacy Left questions, then the
 * waitingOn row (only when no own ask is open: an ask sets waitingOn itself). No scope check:
 * `ch tasks answer` can still resolve any of these. `skipLine(kind, line)` drops legacy lines.
 * @returns {Array<{ key, kind: 'ask'|'merge'|'question'|'waiting', text, at, legacy, ... }>}
 */
export function taskAsks(task, { skipLine = () => false } = {}) {
  const out = [];
  for (const a of task?.asks || []) {
    if (!a || a.state !== 'open') continue;
    const row = { key: String(a.n), kind: a.mergePr ? 'merge' : 'ask', text: a.text, at: a.at || '', legacy: false };
    for (const k of ['by', 'mergePr', 'recommend', 'details', 'sameAs']) if (a[k]) row[k] = a[k];
    if (a.options?.length) row.options = a.options.map(o => ({ key: o.key, text: o.text }));
    if (a.media && Object.keys(a.media).length) row.media = { ...a.media };
    out.push(row);
  }
  const ownOpen = out.length > 0;
  const at = task?.result?.at || task?.updated || '';
  const doneLeft = resolvedSet(task, 'left');
  (task?.result?.left || []).forEach((line, i) => {
    if (!isLegacyQuestion(line) || doneLeft.has(line) || skipLine('left', line)) return;
    const merge = /\bMerge it\b/.test(line);
    const row = { key: `L${i + 1}`, kind: merge ? 'merge' : 'question', text: line.trim(), line, at, legacy: true };
    const pr = merge ? prLinkOf(task) : '';
    if (pr) row.mergePr = pr;
    out.push(row);
  });
  if (!ownOpen && waitsOnTal(task)) {
    out.push({ key: 'W', kind: 'waiting', text: waitingText(task), at: task.updated || '', legacy: true });
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
    const child = byId.get(m[1])?.task;
    if (!child) return false;
    const rest = line.slice(m[0].length);
    return (child.result?.[kind] || []).includes(rest);
  };
}

/** Section of the nearest epic above `task`, or null. */
function epicSection(task, byId) {
  const seen = new Set([task.id]);
  let id = task.parentId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const row = byId.get(id);
    if (!row) return null;
    if (row.task.type === 'epic') return row.section;
    id = row.task.parentId;
  }
  return null;
}

/**
 * Every ask on open work, one row per ask, oldest first; asks with an answer-by date come first,
 * soonest first. Own asks show while the ticket or its epic is open; legacy Left questions and
 * waitingOn rows only while the ticket itself is open.
 * @returns {Array<{ id, title, section, key, kind, text, at, legacy, ... }>}
 */
export function openAsks(doc) {
  const rows = flat(doc);
  const byId = new Map(rows.map(r => [r.task.id, r]));
  const out = [];
  for (const { task, section } of rows) {
    if (!task?.id) continue;
    const own = ASK_OPEN_SECTIONS.includes(section);
    if (!own && !ASK_OPEN_SECTIONS.includes(epicSection(task, byId))) continue;
    for (const ask of taskAsks(task, { skipLine: rolledCopySkipper(task, byId) })) {
      if (ask.legacy && !own) continue;
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

/** Question text for grouping: lower case, single spaces, no trailing punctuation. */
export function normalizeQuestion(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s?.!]+$/, '');
}

/**
 * One card per question: rows with the same normalized text, or joined by `sameAs` (an ask on
 * one ticket naming another ticket), merge. Each card is its first row plus `members` (every
 * row) and `ids` (their tickets); options, media and details come from the first member that
 * has them. Order follows `rows`.
 */
export function groupAsks(rows) {
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  const byText = new Map();
  rows.forEach((r, i) => {
    const k = normalizeQuestion(r.text);
    if (byText.has(k)) union(byText.get(k), i); else byText.set(k, i);
  });
  rows.forEach((r, i) => {
    if (!r.sameAs) return;
    const j = rows.findIndex(x => x.id === r.sameAs);
    if (j >= 0) union(i, j);
  });
  const cards = new Map();
  rows.forEach((r, i) => {
    const root = find(i);
    if (!cards.has(root)) cards.set(root, { ...r, members: [], ids: [] });
    const card = cards.get(root);
    card.members.push(r);
    if (!card.ids.includes(r.id)) card.ids.push(r.id);
    for (const k of ['options', 'recommend', 'details', 'media', 'mergePr', 'by']) if (card[k] == null && r[k] != null) card[k] = r[k];
  });
  return [...cards.values()];
}

/** How many ask cards wait for Tal. */
export function countAsks(doc) {
  return groupAsks(openAsks(doc)).length;
}

/** "N asks for Tal are on the Plan page", or '' when there are none. */
export function asksNotice(n) {
  if (!n) return '';
  return `${n} ask${n === 1 ? '' : 's'} for Tal ${n === 1 ? 'is' : 'are'} on the Plan page`;
}

/** The rows answered together with ticket `id`'s ask `key` (its card), or just that one. */
export function askGroupMembers(doc, id, key) {
  return askCardOf(doc, id, key).members;
}

/** The card holding ticket `id`'s ask `key`: { members: [{ id, key }], options? } (just that ask when none). */
function askCardOf(doc, id, key) {
  const k = String(key).trim().toUpperCase();
  const card = groupAsks(openAsks(doc)).find(c => c.members.some(m => m.id === id && m.key.toUpperCase() === k));
  if (!card) return { members: [{ id, key: String(key).trim() }] };
  return { members: card.members.map(m => ({ id: m.id, key: m.key })), options: card.options };
}

/** The one open ask key on `task` when there is exactly one, else ''. */
export function onlyAskKey(task) {
  const open = taskAsks(task);
  return open.length === 1 ? open[0].key : '';
}

const ACTIONS = { answer: 'answered', done: 'done', dismiss: 'dismissed', park: 'parked' };

/**
 * Resolve the open ask `key` on `task`. `action`: 'answer' (needs `reply`: free text or an option
 * key of the ask, or of `options` when given), 'done', 'dismiss' or 'park' (reply = the reason). Clears waitingOn when it names Tal.
 * Answer / done write a decision, except on a done / archived ticket (`section`), where they add
 * a review note for the caller to file as a follow-up. Park writes the reason as a decision; the
 * caller moves the ticket to backlog when `park` is true. Mutates `task`.
 * @returns {{ question, state, said, decision, note, park, file }}
 */
export function resolveAsk(task, key, {
  action, reply = '', now = new Date().toISOString(), by = 'Tal', section = '', options,
} = {}) {
  const state = ACTIONS[action];
  if (!state) throw new Error(`unknown action "${action}" (answer, done, dismiss or park)`);
  const text = String(reply ?? '').trim();
  if (action === 'answer' && !text) throw new Error('an answer needs a reply');
  const open = taskAsks(task);
  const k = String(key).trim();
  const ask = open.find(a => a.key === k || a.key === k.toUpperCase());
  if (!ask) {
    const keys = open.map(a => a.key).join(', ');
    throw new Error(`${task?.id || task?.taskId || 'ticket'} has no open ask "${key}"${keys ? ` (open: ${keys})` : ' (none open)'}`);
  }
  const question = ask.text;
  // `options`: the card's options, for a twin ask on another ticket that has none of its own.
  const opt = (ask.options || options || []).find(o => o.key === text.toUpperCase());
  const said = opt ? `${opt.key}: ${opt.text}` : text;
  if (ask.key === 'W') {
    // nothing stored to mark: clearing waitingOn below ends the row
  } else if (ask.legacy) {
    if (!Array.isArray(task.resolvedAsks)) task.resolvedAsks = [];
    task.resolvedAsks.push({ kind: 'left', text: ask.line, state, at: now });
  } else {
    const own = task.asks.find(a => String(a.n) === ask.key);
    own.state = state;
    own.resolvedAt = now;
    if (said) own.answer = said;
  }
  if (waitsOnTal(task)) delete task.waitingOn;
  const out = { question, state, said, decision: null, note: null, park: false, file: false };
  if (action === 'dismiss') return out;
  const day = now.slice(0, 10);
  if (action === 'park') {
    out.decision = { at: now, text: `${by} ${day}: parked "${question}": ${said || 'not now'}` };
    out.park = !CLOSED_SECTIONS.includes(section) && section !== 'backlog';
  } else if (CLOSED_SECTIONS.includes(section)) {
    out.note = addReviewNote(task, { text: `${by} answered "${question}": ${said || 'done'}`, kind: 'fix', now });
    out.file = true;
    return out;
  } else {
    out.decision = { at: now, text: `${by} ${day}: asked "${question}": ${said || 'done'}` };
  }
  if (!Array.isArray(task.decisions)) task.decisions = [];
  task.decisions.push(out.decision);
  return out;
}

/** Move `id` to backlog inside `doc` (Park). Returns true when it moved. */
function moveToBacklog(doc, id, now) {
  const from = (doc.sections || []).find(s => (s.tasks || []).some(t => t.id === id));
  let to = (doc.sections || []).find(s => s.id === 'backlog');
  if (from && !to) { // older documents lack the section: add it before To do
    to = { id: 'backlog', name: 'Backlog', tasks: [] };
    const at = doc.sections.findIndex(s => s.id === 'todo');
    doc.sections.splice(at < 0 ? 0 : at, 0, to);
  }
  if (!from || from === to) return false;
  const task = from.tasks.find(t => t.id === id);
  from.tasks = from.tasks.filter(t => t !== task);
  if (from.id === 'review') task.checked = false;
  if (!Array.isArray(task.history)) task.history = [];
  task.history.push({ at: now, event: 'moved', from: from.id, to: 'backlog' });
  task.updated = now.slice(0, 10);
  if (!Array.isArray(to.tasks)) to.tasks = [];
  to.tasks.push(task);
  return true;
}

/**
 * Answer ticket `id`'s ask `key` and every ask on the same card, inside `doc` (the CLI path; the
 * dashboard does the same on its own state). Parks move to backlog; answers on done tickets are
 * filed as follow-ups through review filing (`newId(project)` allocates ids).
 * @returns {{ question, state, resolved: [{ id, key, decision, note }], parked: [ids], filed: [{ handle, id }], unrouted: [handles] }}
 */
export function answerAsk(doc, id, key, { action, reply = '', newId, now = new Date().toISOString(), by = 'Tal' } = {}) {
  const { members, options } = askCardOf(doc, id, key);
  const out = { question: '', state: '', resolved: [], parked: [], filed: [], unrouted: [] };
  const toFile = [];
  for (const m of members) {
    const row = flat(doc).find(r => r.task.id === m.id);
    if (!row) throw new Error(`task ${m.id} not found`);
    const r = resolveAsk(row.task, m.key, { action, reply, now, by, section: row.section, options });
    row.task.updated = now.slice(0, 10);
    if (!out.question) { out.question = r.question; out.state = r.state; }
    out.resolved.push({ id: m.id, key: m.key, decision: r.decision, note: r.note });
    if (r.park && moveToBacklog(doc, m.id, now)) out.parked.push(m.id);
    if (r.file) toFile.push(m.id);
  }
  for (const tid of toFile) {
    const plan = planFiling(doc, { ticket: tid });
    if (newId) out.filed.push(...applyFiling(doc, plan, { newId, now }).filed);
    out.unrouted.push(...plan.unrouted.map(u => u.handle));
  }
  return out;
}

/**
 * Close every open merge ask on `task` whose PR has merged: its own `mergePr` asks and a legacy
 * "Merge it" line whose ticket links a PR. `prState(url)` returns { state } (e.g. 'MERGED') or
 * { error }; errors leave the ask open. Returns the rows closed.
 */
export function closeMergedAsks(task, prState, { now = new Date().toISOString() } = {}) {
  const closed = [];
  for (const row of taskAsks(task)) {
    if (row.kind !== 'merge' || !row.mergePr) continue;
    const s = prState(row.mergePr) || {};
    if (String(s.state || '').toUpperCase() !== 'MERGED') continue;
    resolveAsk(task, row.key, { action: 'done', reply: `PR merged (${row.mergePr})`, now, by: 'Auto' });
    closed.push(row);
  }
  return closed;
}

/** Plain lines for a ticket's own asks, shown with its result: "Ask: <q>" (+ how it ended). */
export function askLines(task) {
  return (task?.asks || []).filter(Boolean).map((a) => {
    const by = a.by ? ` (by ${a.by})` : '';
    const pr = a.mergePr ? ` [${a.mergePr}]` : '';
    const opts = a.options?.length ? ` [${a.options.map(o => `${o.key}: ${o.text}`).join(' | ')}]` : '';
    if (a.state === 'open') return `Ask: ${a.text}${opts}${by}${pr}`;
    const how = a.state === 'dismissed' ? 'dismissed' : a.answer ? `${a.state}: ${a.answer}` : a.state;
    return `Ask: ${a.text}${pr} (${how})`;
  });
}

/** Schema errors for one stored ask's PRO86 fields (options, recommend, details, media, sameAs). */
function askExtraErrors(a, r) {
  const errors = [];
  if (a.options !== undefined) {
    if (!Array.isArray(a.options) || a.options.some(o => !o || !/^[A-Z]$/.test(o.key) || typeof o.text !== 'string' || !o.text)) {
      errors.push(`${r}.options must be an array of { key: one capital letter, text }`);
    }
  }
  if (a.recommend !== undefined && !(Array.isArray(a.options) ? a.options : []).some(o => o && o.key === a.recommend)) errors.push(`${r}.recommend must name an option key`);
  if (a.details !== undefined && typeof a.details !== 'string') errors.push(`${r}.details must be a string`);
  if (a.media !== undefined) {
    if (!a.media || typeof a.media !== 'object' || Array.isArray(a.media)) errors.push(`${r}.media must be an object`);
    else for (const [k, v] of Object.entries(a.media)) { const e = mediaPathError(k, v); if (e) errors.push(`${r}.media.${e}`); }
  }
  if (a.sameAs !== undefined && !ID_RE.test(String(a.sameAs))) errors.push(`${r}.sameAs must be a ticket id`);
  return errors;
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
        errors.push(...askExtraErrors(a, r));
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
      if (!RESOLVED_STATES.includes(x.state)) errors.push(`${r}.state must be one of ${RESOLVED_STATES.join(', ')}`);
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
      for (const k of ['by', 'mergePr', 'answer', 'resolvedAt', 'recommend', 'details', 'sameAs']) if (typeof a[k] === 'string' && a[k]) e[k] = a[k];
      if (Array.isArray(a.options)) {
        const opts = a.options.filter(o => o && typeof o.key === 'string' && typeof o.text === 'string' && o.text).map(o => ({ key: o.key, text: o.text }));
        if (opts.length) e.options = opts;
      }
      if (a.media && typeof a.media === 'object' && !Array.isArray(a.media)) {
        const m = {};
        for (const k of MEDIA_KINDS) if (typeof a.media[k] === 'string' && !mediaPathError(k, a.media[k])) m[k] = a.media[k];
        if (Object.keys(m).length) e.media = m;
      }
      return e;
    })
    : [];
  const resolvedAsks = Array.isArray(task?.resolvedAsks)
    ? task.resolvedAsks.filter(x => x && RESOLVED_KINDS.includes(x.kind) && typeof x.text === 'string' && x.text
      && RESOLVED_STATES.includes(x.state)).map(x => ({ kind: x.kind, text: x.text, state: x.state, at: String(x.at || '') }))
    : [];
  return { asks, resolvedAsks };
}
