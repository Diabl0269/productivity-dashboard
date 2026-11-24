/**
 * `queues` of home.config.json (pure): lists of items kept in a markdown file that the Overview shows,
 * reorders, edits and drops (shared/md-queue.js has the file format). Problems come back as plain-words
 * lines in `errors`; a bad queue is skipped, a bad optional key falls back to its default.
 *
 * Each queue: { id, title, file, show, dropAs, hiddenStatuses, check }
 *   file   .md path relative to the config file; it is only ever reached through the queue id
 *   show   how many items the panel lists (1-50, default 4)
 *   dropAs "skipped" marks a dropped item `- status: skipped`; leave it out to delete the item
 *   hiddenStatuses  status values whose items are not listed (default skipped and made)
 *   check  { command: [argv...], cwd? } run without a shell after every write and on every read;
 *          exit 1 means its output lines are problems to show
 */

import { isPlainObject, shown, str, strList, id as checkId, unknownKeys, objList, problem } from './home-config-check.js';
import { DEFAULT_HIDDEN } from './md-queue.js';

const QUEUE_KEYS = ['id', 'title', 'file', 'show', 'dropAs', 'hiddenStatuses', 'check'];
const CHECK_KEYS = ['command', 'cwd'];
export const DEFAULT_SHOW = 4;
export const MAX_SHOW = 50;

function normCheck(raw, where, errors) {
  const v = raw.check;
  if (v === undefined || v === null) return null;
  if (!isPlainObject(v)) { problem(errors, where, 'check', 'should be an object with "command"', v); return null; }
  unknownKeys(v, CHECK_KEYS, `${where} > check`, errors);
  const cmd = v.command;
  if (!Array.isArray(cmd) || !cmd.length || !cmd.every(x => typeof x === 'string' && x && !x.includes('\0'))) {
    errors.push(`${where}: check "command" should be a list of text, the program first (like ["node", "check.js"]), got ${shown(cmd)}; the check is ignored.`);
    return null;
  }
  let cwd = null;
  if (v.cwd !== undefined && v.cwd !== null) {
    if (typeof v.cwd === 'string' && v.cwd && !v.cwd.includes('\0')) cwd = v.cwd;
    else problem(errors, `${where} > check`, 'cwd', 'should be a folder path relative to this file', v.cwd);
  }
  return { command: cmd.slice(), cwd };
}

/** @returns {object[]} the valid queues (a duplicate id or a bad file skips that queue) */
export function normQueues(raw, errors) {
  const seen = new Set();
  return objList(raw, 'queues', '', errors).map((q, i) => {
    const at = `queues[${i}]`;
    if (!isPlainObject(q)) { errors.push(`${at}: should be an object with "id", "title" and "file", got ${shown(q)}; skipped.`); return null; }
    const qid = checkId(q, at, errors);
    if (qid === null) return null;
    const where = `queue "${qid}"`;
    if (seen.has(qid)) { errors.push(`${where}: the id is used twice; the second one is skipped.`); return null; }
    unknownKeys(q, QUEUE_KEYS, where, errors);
    const file = q.file;
    if (typeof file !== 'string' || !file.trim() || file.includes('\0') || /^([/\\]|[A-Za-z]:)/.test(file) || !/\.md$/i.test(file)) {
      errors.push(`${where}: "file" should be a .md path relative to this file (like "docs/next-videos.md"), got ${shown(file)}; skipped.`);
      return null;
    }
    seen.add(qid);
    let show = DEFAULT_SHOW;
    if (q.show !== undefined && q.show !== null) {
      if (Number.isInteger(q.show) && q.show >= 1 && q.show <= MAX_SHOW) show = q.show;
      else problem(errors, where, 'show', `should be a whole number from 1 to ${MAX_SHOW}; ${DEFAULT_SHOW} is used`, q.show);
    }
    let dropAs = null;
    if (q.dropAs !== undefined && q.dropAs !== null) {
      if (q.dropAs === 'skipped') dropAs = 'skipped';
      else problem(errors, where, 'dropAs', 'can only be "skipped" (or left out to delete the item); the item is deleted', q.dropAs);
    }
    const hidden = q.hiddenStatuses === undefined || q.hiddenStatuses === null ? DEFAULT_HIDDEN.slice() : strList(q, 'hiddenStatuses', where, errors);
    return {
      id: qid, title: str(q, 'title', where, errors, qid) || qid, file, show, dropAs, hiddenStatuses: hidden, check: normCheck(q, where, errors),
    };
  }).filter(Boolean);
}
