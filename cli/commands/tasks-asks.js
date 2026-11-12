/**
 * cli/commands/tasks-asks.js
 * Questions a session leaves for Tal, shown in the Plan page's "Asks for you" strip (PRO73):
 *   ask <id> "<question>" [--ask-by YYYY-MM-DD] [--merge-pr URL] [--json]
 *   answer <id> <key> ["<reply>"] [--done | --dismiss] [--json]
 *   asks [--ticket ID] [--refresh] [--json]
 * Keys come from `ch tasks asks`: the ask's number, L<i> for an older Left question, T for the
 * needs-tal lines of a ticket. Rules and shapes: shared/asks.js.
 */

import { parse } from '../lib/args.js';
import { print, jsonOut, ok, die, printErr } from '../lib/output.js';
import { load, save, findTask, todayStr } from '../lib/tasks-store.js';
import { addAsk, openAsks, resolveAsk, closeMergedAsks, asksNotice, countAsks } from '../../shared/asks.js';
import { ghPrState } from '../lib/open-pr-gate.js';

function ticketOrDie(doc, id) {
  const found = findTask(doc, id);
  if (!found) die(`task ${id} not found. Try: ch tasks list`);
  return found.task;
}

/** `ch tasks ask <id> "<question>"`: leave a question for Tal on the ticket. */
export async function cmdAsk(argv) {
  const { values, positionals } = parse(argv, {
    'ask-by': { type: 'string' },
    'merge-pr': { type: 'string' },
    json: { type: 'boolean', short: 'j' },
  });
  const [id, text] = positionals;
  if (!id || text === undefined) die('usage: ch tasks ask <id> "<question>" [--ask-by YYYY-MM-DD] [--merge-pr URL] [--json]');
  const doc = load();
  const task = ticketOrDie(doc, id);
  let ask;
  try {
    ask = addAsk(task, { text, by: values['ask-by'], mergePr: values['merge-pr'] });
  } catch (e) { die(`ask: ${e.message}`); }
  task.updated = todayStr();
  save(doc);
  if (values.json) { jsonOut({ id: task.id, ask, asksForTal: countAsks(doc) }); return; }
  ok(`ask ${task.id} #${ask.n}: ${ask.text}${ask.mergePr ? ' (closes when the PR merges)' : ''}`);
  print(asksNotice(countAsks(doc)));
}

/** `ch tasks answer <id> <key> ["<reply>"] [--done | --dismiss]`: resolve an ask, record the decision. */
export async function cmdAnswer(argv) {
  const { values, positionals } = parse(argv, {
    done: { type: 'boolean' },
    dismiss: { type: 'boolean' },
    json: { type: 'boolean', short: 'j' },
  });
  const [id, key, reply] = positionals;
  if (!id || !key) die('usage: ch tasks answer <id> <key> ["<reply>"] [--done | --dismiss] [--json]   (keys: ch tasks asks)');
  if (values.done && values.dismiss) die('answer: pass --done or --dismiss, not both');
  const action = values.dismiss ? 'dismiss' : values.done ? 'done' : 'answer';
  const doc = load();
  const task = ticketOrDie(doc, id);
  let out;
  try {
    out = resolveAsk(task, key, { action, reply });
  } catch (e) { die(`answer: ${e.message}`); }
  task.updated = todayStr();
  save(doc);
  const left = countAsks(doc);
  if (values.json) { jsonOut({ id: task.id, key, ...out, asksForTal: left }); return; }
  ok(`${task.id} ask ${key} ${out.state}${out.decision ? ' (decision recorded)' : ''}`);
  if (left) print(asksNotice(left));
}

/** `ch tasks asks`: every open ask, CLI twin of the Plan page strip. --refresh closes merged merge asks first. */
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
        if (done.length) { task.updated = todayStr(); closed.push(...done.map(a => ({ id: task.id, n: a.n, mergePr: a.mergePr }))); }
      }
    }
  }
  if (closed.length) save(doc);
  let rows = openAsks(doc);
  if (values.ticket) rows = rows.filter(r => r.id === values.ticket);
  if (values.json) { jsonOut({ asks: rows, closed }); return; }
  closed.forEach(c => print(`closed ${c.id} ask ${c.n}: ${c.mergePr} merged`));
  if (!rows.length) { print('No asks for Tal.'); return; }
  print(`Asks for you (${rows.length})`);
  for (const r of rows) {
    const by = r.by ? ` (by ${r.by})` : '';
    print(`  ${r.id} ${r.key}  ${r.text}${by}${r.mergePr ? ` [${r.mergePr}]` : ''}`);
    for (const line of r.lines || []) print(`        - ${line}`);
  }
  print('Answer: ch tasks answer <id> <key> "<reply>" | --done | --dismiss');
}
