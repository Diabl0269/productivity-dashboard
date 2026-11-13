/**
 * cli/commands/tasks-asks.js
 * Decisions a session leaves for Tal, shown in the Plan page's "For you" list (PRO73, PRO86):
 *   ask <id> "<question>" [--option "A: ..."]... [--recommend A] [--details "..."]
 *       [--video|--audio|--image|--project <path>] [--same-as <id>] [--ask-by YYYY-MM-DD] [--merge-pr URL] [--json]
 *   answer <id> [<key>] <A|B|"reply"> [--done | --dismiss | --park ["reason"]] [--json]
 *   asks [--ticket ID] [--refresh] [--json]
 * Keys come from `ch tasks asks`: the ask's number, L<i> for an older Left question, W for a
 * ticket whose waitingOn names Tal. Rules and shapes: shared/asks.js.
 */

import path from 'node:path';
import { parse } from '../lib/args.js';
import { print, jsonOut, ok, die, printErr } from '../lib/output.js';
import { load, save, findTask, todayStr, nextId } from '../lib/tasks-store.js';
import {
  addAsk, openAsks, groupAsks, answerAsk, closeMergedAsks, asksNotice, countAsks, taskAsks, onlyAskKey, MEDIA_KINDS,
} from '../../shared/asks.js';
import { ghPrState } from '../lib/open-pr-gate.js';
import { toEvidenceRel, resolveEvidence } from '../lib/evidence.js';
import { dataRoot } from '../lib/io.js';

function ticketOrDie(doc, id) {
  const found = findTask(doc, id);
  if (!found) die(`task ${id} not found. Try: ch tasks list`);
  return found.task;
}

/** A media path as stored on the ask (relative to $CH_HOME/evidence); dies when bad or missing. */
function mediaRelOrDie(value, kind) {
  const home = dataRoot();
  let rel;
  try { rel = toEvidenceRel(home, value, kind); } catch (e) { die(`--${kind}: ${e.message}`); }
  try { resolveEvidence(home, rel, kind); } catch {
    die(`--${kind}: not found or outside the evidence folder: ${value} (looked in ${path.join(home, 'evidence', rel)})`);
  }
  return rel;
}

const ASK_USAGE = 'usage: ch tasks ask <id> "<question, max 140 chars>" [--option "A: ..."]... [--recommend A] [--details "..."] [--video|--audio|--image|--project <path>] [--same-as <id>] [--ask-by YYYY-MM-DD] [--merge-pr URL] [--json]';

/** `ch tasks ask <id> "<question>"`: leave a decision for Tal on the ticket (sets its waitingOn). */
export async function cmdAsk(argv) {
  const { values, positionals } = parse(argv, {
    'ask-by': { type: 'string' },
    'merge-pr': { type: 'string' },
    option: { type: 'string', multiple: true },
    recommend: { type: 'string' },
    details: { type: 'string' },
    video: { type: 'string' },
    audio: { type: 'string' },
    image: { type: 'string' },
    project: { type: 'string' },
    'same-as': { type: 'string' },
    json: { type: 'boolean', short: 'j' },
  });
  const [id, text] = positionals;
  if (!id || text === undefined) die(ASK_USAGE);
  const doc = load();
  const task = ticketOrDie(doc, id);
  if (values['same-as']) ticketOrDie(doc, values['same-as']);
  const media = {};
  for (const kind of MEDIA_KINDS) if (values[kind]) media[kind] = mediaRelOrDie(values[kind], kind);
  let ask;
  try {
    ask = addAsk(task, {
      text, by: values['ask-by'], mergePr: values['merge-pr'], options: values.option, recommend: values.recommend,
      details: values.details, media, sameAs: values['same-as'],
    });
  } catch (e) { die(`ask: ${e.message}`); }
  task.updated = todayStr();
  save(doc);
  if (values.json) { jsonOut({ id: task.id, ask, asksForTal: countAsks(doc) }); return; }
  ok(`ask ${task.id} #${ask.n}: ${ask.text}${ask.mergePr ? ' (closes when the PR merges)' : ''} (waiting on Tal)`);
  print(asksNotice(countAsks(doc)));
}

/** Split `answer` positionals into { key, reply } for `task`. */
function keyAndReply(task, rest, flagged) {
  const keys = taskAsks(task).map(a => a.key);
  const isKey = (s) => keys.some(k => k.toUpperCase() === String(s).trim().toUpperCase());
  if (rest.length >= 2) return { key: rest[0], reply: rest[1] };
  if (rest.length === 1 && isKey(rest[0]) && (flagged || keys.length > 1)) return { key: rest[0], reply: '' };
  const only = onlyAskKey(task);
  if (!only) die(`answer: ${task.id} has ${keys.length ? `${keys.length} open asks (${keys.join(', ')}): name one` : 'no open ask'}. Keys: ch tasks asks --ticket ${task.id}`);
  return { key: only, reply: rest[0] ?? '' };
}

/** `ch tasks answer <id> [<key>] <A|B|reply>`: resolve an ask (and its same-question twins); the answer drives the work. */
export async function cmdAnswer(argv) {
  const { values, positionals } = parse(argv, {
    done: { type: 'boolean' },
    dismiss: { type: 'boolean' },
    park: { type: 'boolean' },
    json: { type: 'boolean', short: 'j' },
  });
  const [id, ...rest] = positionals;
  if (!id) die('usage: ch tasks answer <id> [<key>] <A|B|"reply"> [--done | --dismiss | --park ["reason"]] [--json]   (keys: ch tasks asks)');
  if ([values.done, values.dismiss, values.park].filter(Boolean).length > 1) die('answer: pass one of --done, --dismiss, --park');
  const doc = load();
  const task = ticketOrDie(doc, id);
  const flagged = !!(values.done || values.dismiss || values.park);
  const { key, reply } = keyAndReply(task, rest, flagged);
  let action = values.dismiss ? 'dismiss' : values.done ? 'done' : values.park ? 'park' : 'answer';
  let text = reply;
  if (action === 'answer' && /^park\b/i.test(text.trim())) { action = 'park'; text = text.trim().replace(/^park\b\s*[:,-]?\s*/i, ''); }
  let out;
  try {
    out = answerAsk(doc, task.id, key, { action, reply: text, newId: project => nextId(doc, project) });
  } catch (e) { die(`answer: ${e.message}`); }
  save(doc);
  const left = countAsks(doc);
  if (values.json) { jsonOut({ id: task.id, key, ...out, asksForTal: left }); return; }
  const ids = out.resolved.map(r => r.id).join(', ');
  ok(`${ids} ask ${out.state}${out.resolved.some(r => r.decision) ? ' (decision recorded)' : ''}; no longer waiting on Tal`);
  for (const pid of out.parked) print(`parked ${pid}: moved to backlog`);
  for (const f of out.filed) print(`filed follow-up ${f.id} from ${f.handle} (the ticket was done)`);
  if (out.unrouted.length) printErr(`answer: ${out.unrouted.join(', ')} needs an area before it can be filed (Plan page Notes, or ch tasks notes send)`);
  if (left) print(asksNotice(left));
}

/** `ch tasks asks`: every decision on open work, CLI twin of the Plan page list. --refresh closes merged merge asks first. */
export async function cmdAsks(argv) {
  const { values } = parse(argv, {
    ticket: { type: 'string' },
    refresh: { type: 'boolean' },
    json: { type: 'boolean', short: 'j' },
  });
  const doc = load();
  const closed = [];
  if (values.refresh) {
    const cache = new Map();
    const state = (url) => {
      if (!cache.has(url)) cache.set(url, ghPrState(url));
      const s = cache.get(url);
      if (s.error) printErr(`asks: could not check ${url} (${s.error}); left open`);
      return s;
    };
    for (const section of doc.sections || []) {
      for (const task of section.tasks || []) {
        const done = closeMergedAsks(task, state);
        if (done.length) { task.updated = todayStr(); closed.push(...done.map(a => ({ id: task.id, key: a.key, mergePr: a.mergePr }))); }
      }
    }
  }
  if (closed.length) save(doc);
  let rows = openAsks(doc);
  if (values.ticket) rows = rows.filter(r => r.id === values.ticket);
  const cards = groupAsks(rows);
  if (values.json) { jsonOut({ asks: rows, cards: cards.length, closed }); return; }
  closed.forEach(c => print(`closed ${c.id} ask ${c.key}: ${c.mergePr} merged`));
  if (!cards.length) { print('No asks for Tal.'); return; }
  print(`Decisions for you (${cards.length})`);
  for (const c of cards) {
    const by = c.by ? ` (by ${c.by})` : '';
    print(`  ${c.members.map(m => `${m.id} ${m.key}`).join(' + ')}  ${c.text}${by}${c.mergePr ? ` [${c.mergePr}]` : ''}`);
    for (const o of c.options || []) print(`        ${o.key}: ${o.text}${c.recommend === o.key ? ' (recommended)' : ''}`);
    for (const [kind, p] of Object.entries(c.media || {})) print(`        ${kind}: ${p}`);
  }
  print('Answer: ch tasks answer <id> [<key>] <A|B|"reply"> | --done | --dismiss | --park ["reason"]');
}
