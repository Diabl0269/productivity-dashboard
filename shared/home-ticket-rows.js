/**
 * shared/home-ticket-rows.js (PRO119): every ticket as one plain row for the Home page's Tickets view and
 * inspector tab. Pure: no fs, no DOM, so the CLI, the dashboard and the tests share it.
 *
 *   ticketRows(doc, config, readinessById, running) -> row[]
 *   filterRows(rows, { text, states, types, place, lane, model, label, project, showDone }) -> row[]
 *   sortRows(rows, key, dir) -> row[]        key: id | title | state | place | epic | lane | model | updated
 *   groupRows(rows, by) -> [{ key, label, rows, counts }]    by: none | place | epic | state | lane
 *   countByState(rows) -> { all, running, 'needs you', 'in review', ready, waiting, later, done }
 *
 * `doc` is the tasks.json shape ({ sections: [{ id, tasks }] }). `readinessById` is `{ [epicId]: epicReadiness }`
 * (or a Map) for the OPEN epics, from `openEpicReadiness` in shared/epic-ready.js: the one "is it Ready" rule
 * the Plan page uses. `running` is `byTicket` of GET /api/home/running ({ [ticketId]: { state, pr? } }).
 *
 * One state per ticket, first match wins:
 *   running    live work now (state words: working, waiting on CI, waiting on you)
 *   needs you  an open ask or interpretation, or a check to tick by the Plan page's rule (checksOnOpenWork: not in review or done)
 *   in review  its column is "Ready for review"
 *   ready      Ready by the Plan page's rule: its epic is Ready and this ticket is free to run
 *   waiting    in To do / In progress but not free to run (blocked, held, its epic not ready); `stateWhy` says why
 *   later      inbox, backlog, or an epic that is a "later" bucket
 *   done       done or archived
 */

import { plainReasonText, plainReasonLine } from './epic-ready.js';
import { openAsks } from './asks.js';
import { openInterpretations } from './interpretations.js';
import { unsentNotes } from './review-notes.js';
import { boxForEpic, boxPath } from './home-areas.js';
import { checksOnOpenWork } from './review.js';
import { needsTalLinesByEpic } from './needs-tal-lines.js';

export const STATES = ['running', 'needs you', 'in review', 'ready', 'waiting', 'later', 'done'];
export const GROUPS = ['none', 'place', 'epic', 'state', 'lane'];
export const SORT_KEYS = ['id', 'title', 'state', 'place', 'epic', 'lane', 'model', 'updated'];
export const TYPES = ['epic', 'task', 'subtask'];

const WORK_SECTIONS = new Set(['todo', 'in-progress']);
const FINISHED = new Set(['done', 'review', 'archive']);
const CLOSED = new Set(['done', 'archive']);
const RUN_WORDS = { working: 'Working on it now', 'waiting-ci': 'Waiting on CI', 'waiting-you': 'Waiting on you' };
const PR_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;

const labelsOf = t => (Array.isArray(t.labels) ? t.labels : []).map(l => String(l).trim()).filter(Boolean);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const joinWords = items => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function modelOf(t) {
  const label = labelsOf(t).find(l => /^model:\s*\S/i.test(l));
  if (label) return label.replace(/^model:\s*/i, '').toLowerCase();
  return typeof t.model === 'string' ? t.model.trim() : '';
}

function prOf(t, run) {
  if (run?.pr) return run.pr;
  if (t.heldPr?.pr) return t.heldPr.pr;
  const links = Array.isArray(t.links) ? t.links : [];
  const hit = links.find(l => typeof (l?.url ?? l) === 'string' && PR_RE.test(l?.url ?? l));
  return hit ? (hit.url ?? hit) : undefined;
}

/** The words for one reason of a ticket that is not free to run. */
function whyText(reason) {
  let m;
  reason = String(reason || '');
  if ((m = /^blocked by (.+)$/.exec(reason))) return `Blocked by ${joinWords(m[1].split(/,\s*/))}`;
  if ((m = /^waiting on (.+)$/.exec(reason))) return `Waiting on ${m[1]}`;
  if ((m = /^waits until (.+)$/.exec(reason))) return `Waits until ${m[1]}`;
  if ((m = /^held: (.+)$/.exec(reason))) return `Held for your go-ahead (${m[1]})`;
  if (reason === 'your pick') return 'Waits for your design pick';
  if (reason === 'your co-task') return 'Waits for your co-task';
  return plainReasonText(reason);
}

function readinessOf(map, id) {
  if (!map || !id) return null;
  return (map instanceof Map ? map.get(id) : map[id]) || null;
}

/** Build every ticket's row. See the file header. */
export function ticketRows(doc, config, readinessById, running) {
  const all = [];
  for (const s of doc?.sections || []) for (const t of s.tasks || []) if (t && t.id) all.push({ t, section: s.id });
  const byId = new Map();
  for (const x of all) if (!byId.has(x.t.id)) byId.set(x.t.id, x);

  const epicOf = (t) => {
    const seen = new Set();
    let cur = t;
    while (cur && !seen.has(cur.id)) {
      if (cur.type === 'epic') return cur;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId)?.t : null;
    }
    return null;
  };

  const asksBy = new Map();
  for (const a of openAsks(doc)) asksBy.set(a.id, (asksBy.get(a.id) || 0) + 1);
  const readingsBy = new Map();
  for (const r of openInterpretations(doc)) readingsBy.set(r.id, (readingsBy.get(r.id) || 0) + 1);

  // Checks to tick: the Plan page's own list (checksOnOpenWork), so a ticket already in review stays "in review".
  const checksBy = new Map(checksOnOpenWork(doc, { lines: needsTalLinesByEpic(doc) }).map(c => [c.id, c.checks.total - c.checks.done]));

  const boxCache = new Map();
  const placeOf = (owner) => {
    const key = owner.id;
    let hit = boxCache.get(key);
    if (!hit) {
      const box = config ? boxForEpic(config, owner) : { group: null, area: null, part: null };
      const leaf = box.part || box.area || box.group;
      const names = leaf ? boxPath(config, leaf).map(b => b.name) : [];
      hit = { box: { group: box.group, area: box.area, part: box.part }, placeName: names.join(' › ') };
      boxCache.set(key, hit);
    }
    return hit;
  };

  const rows = [];
  for (const { t, section } of all) {
    const epic = epicOf(t);
    const run = running?.[t.id] && running[t.id].state !== 'idle' ? running[t.id] : null;
    const openBlockers = (t.blockedBy || []).filter(id => byId.has(id) && !FINISHED.has(byId.get(id).section));
    const unticked = checksBy.get(t.id) || 0;
    const asks = (asksBy.get(t.id) || 0) + (readingsBy.get(t.id) || 0);
    const r = readinessOf(readinessById, epic?.id);
    const kind = r?.reasonDetails?.[0]?.kind;
    const place = placeOf(epic || t);

    let state;
    let stateWhy;
    if (run) {
      state = 'running';
      stateWhy = RUN_WORDS[run.state] || 'Running';
    } else if (!CLOSED.has(section) && (asks > 0 || unticked > 0)) {
      state = 'needs you';
      const bits = [];
      if (asks) bits.push(plural(asks, 'open question', 'open questions'));
      if (unticked) bits.push(plural(unticked, 'check to tick', 'checks to tick'));
      stateWhy = `${joinWords(bits)} waiting for you`;
    } else if (section === 'review') {
      state = 'in review';
      stateWhy = 'Shipped; waiting for your look';
    } else if (CLOSED.has(section)) {
      state = 'done';
      stateWhy = section === 'archive' ? 'Archived' : 'Done';
    } else if (!WORK_SECTIONS.has(section)) {
      state = 'later';
      stateWhy = section === 'inbox' ? 'In the inbox: not sorted yet' : 'In backlog: move it to To do to start';
    } else if (r && (kind === 'later-bucket' || kind === 'backlog')) {
      state = 'later';
      stateWhy = plainReasonLine(r);
    } else if (t.type === 'epic' ? r?.ready : (r?.ready && r.children.find(c => c.id === t.id)?.runnable)) {
      state = 'ready';
      stateWhy = t.type === 'epic' ? 'Ready: the Plan page can start it' : 'Free to run: its epic is Ready';
    } else {
      state = 'waiting';
      const child = r?.children?.find(c => c.id === t.id);
      if (t.type === 'epic' && r) stateWhy = plainReasonLine(r) || 'Not ready';
      else if (child && child.why) stateWhy = whyText(child.why);
      else if (r && !r.ready) stateWhy = `Its epic ${epic.id} is not ready: ${plainReasonLine(r)}`;
      else if (openBlockers.length) stateWhy = whyText(`blocked by ${openBlockers.join(', ')}`);
      else if (t.blocked) stateWhy = whyText('marked blocked');
      else stateWhy = 'Not under an open epic, so the Plan page does not queue it';
    }

    const pr = prOf(t, run);
    rows.push({
      id: t.id,
      title: t.title || '',
      type: t.type || 'task',
      section,
      parentId: t.parentId || null,
      epicId: epic ? epic.id : null,
      epicTitle: epic ? (epic.title || '') : '',
      lane: t.lane || epic?.lane || '',
      project: t.project || '',
      box: place.box,
      placeName: place.placeName,
      state,
      stateWhy,
      model: modelOf(t),
      labels: labelsOf(t).filter(l => !/^model:/i.test(l)),
      updated: t.updated || t.created || '',
      created: t.created || '',
      ...(pr ? { prUrl: pr } : {}),
      notesOpen: unsentNotes(t).length,
      idle: !run && running?.[t.id]?.state === 'idle', // a recent session or commit but nothing running now: a quiet mark, never "running"
      checksOpen: (t.checks || []).filter(c => c && !c.checked && !c.handedTo).length,
      blockedBy: openBlockers,
      asks,
    });
  }
  return rows;
}

// ===== filter, sort, group, count =====

const hay = new WeakMap();
function haystack(r) {
  let h = hay.get(r);
  if (h === undefined) {
    h = [r.id, r.title, r.epicId, r.epicTitle, r.placeName, r.lane, r.project, r.model, r.state, ...r.labels].join(' ').toLowerCase();
    hay.set(r, h);
  }
  return h;
}

const asSet = v => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : v ? [v] : []));

/**
 * Keep the rows that pass every filter given. `states` / `types`: empty = any. Done rows show only with
 * `showDone` or when `states` names done. `place`: a Set of epic ids (the map selection), or null for all.
 */
export function filterRows(rows, f = {}) {
  const words = String(f.text || '').toLowerCase().split(/\s+/).filter(Boolean);
  const states = asSet(f.states);
  const types = asSet(f.types);
  const place = f.place instanceof Set ? f.place : null;
  const showDone = !!f.showDone || states.has('done');
  return rows.filter((r) => {
    if (r.state === 'done' && !showDone) return false;
    if (states.size && !states.has(r.state)) return false;
    if (types.size && !types.has(r.type)) return false;
    if (place && !(r.epicId !== null && place.has(r.epicId))) return false;
    if (f.lane && r.lane !== f.lane) return false;
    if (f.model && r.model !== f.model) return false;
    if (f.project && r.project !== f.project) return false;
    if (f.label && !r.labels.includes(f.label)) return false;
    if (words.length) {
      const h = haystack(r);
      if (!words.every(w => h.includes(w))) return false;
    }
    return true;
  });
}

/** "FRO12" < "FRO101" < "WEB3": prefix, then number. */
export function compareIds(a, b) {
  const pa = /^([A-Za-z]*)(\d*)/.exec(a);
  const pb = /^([A-Za-z]*)(\d*)/.exec(b);
  if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
  return (Number(pa[2]) || 0) - (Number(pb[2]) || 0);
}

const text = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const textLast = (a, b) => (a === b ? 0 : !a ? 1 : !b ? -1 : text(a.toLowerCase(), b.toLowerCase())); // empty values last

const COMPARE = {
  id: (a, b) => compareIds(a.id, b.id),
  title: (a, b) => text(a.title.toLowerCase(), b.title.toLowerCase()),
  state: (a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state),
  place: (a, b) => textLast(a.placeName, b.placeName),
  epic: (a, b) => (a.epicId === b.epicId ? 0 : !a.epicId ? 1 : !b.epicId ? -1 : compareIds(a.epicId, b.epicId)),
  lane: (a, b) => textLast(a.lane, b.lane),
  model: (a, b) => textLast(a.model, b.model),
  updated: (a, b) => (a.updated === b.updated ? 0 : !a.updated ? 1 : !b.updated ? -1 : text(a.updated, b.updated)),
};

/** A sorted copy. Ties keep the id order (so the result is the same every time). `dir`: 'asc' | 'desc'. */
export function sortRows(rows, key = 'id', dir = 'asc') {
  const cmp = COMPARE[key] || COMPARE.id;
  const sign = dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => ({ r, i })).sort((a, b) => sign * cmp(a.r, b.r) || compareIds(a.r.id, b.r.id) || a.i - b.i).map(x => x.r);
}

export function countByState(rows) {
  const counts = { all: rows.length };
  for (const s of STATES) counts[s] = 0;
  for (const r of rows) counts[r.state] += 1;
  return counts;
}

const GROUP_KEY = {
  place: r => ({ key: r.box.part || r.box.area || r.box.group || '', label: r.placeName || 'No place' }),
  epic: r => ({ key: r.epicId || '', label: r.epicId ? `${r.epicId} ${r.epicTitle}`.trim() : 'No epic' }),
  state: r => ({ key: r.state, label: r.state }),
  lane: r => ({ key: r.lane, label: r.lane || 'No lane' }),
};

/**
 * Split rows (in their given order) into groups: [{ key, label, rows, counts }].
 * Groups come in state order, or by label (the ones with no value last); `none` gives one group with key 'all'.
 */
export function groupRows(rows, by = 'none') {
  if (!GROUP_KEY[by]) return [{ key: 'all', label: '', rows, counts: countByState(rows) }];
  const groups = new Map();
  for (const r of rows) {
    const { key, label } = GROUP_KEY[by](r);
    if (!groups.has(key)) groups.set(key, { key, label, rows: [], counts: null });
    groups.get(key).rows.push(r);
  }
  const list = [...groups.values()];
  for (const g of list) g.counts = countByState(g.rows);
  if (by === 'state') return list.sort((a, b) => STATES.indexOf(a.key) - STATES.indexOf(b.key));
  if (by === 'epic') return list.sort((a, b) => (a.key === b.key ? 0 : !a.key ? 1 : !b.key ? -1 : compareIds(a.key, b.key)));
  return list.sort((a, b) => (a.key === b.key ? 0 : !a.key ? 1 : !b.key ? -1 : text(a.label.toLowerCase(), b.label.toLowerCase())));
}
