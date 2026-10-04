/**
 * shared/tasks-files.js — where the tasks document lives on disk.
 *
 * Two layouts, same in-memory document ({ version, ticketTypes, meta, sections }):
 *
 *   single  <root>/tasks.json                    one file (the original layout; fixtures,
 *                                                demos and fresh clones still use it)
 *   split   <root>/tasks.d/index.json            the document with each section's `tasks`
 *                                                replaced by an ordered list of ticket ids
 *           <root>/tasks.d/tickets/<ID>.json     one file per ticket
 *
 * When tasks.d/index.json exists the split layout wins. Readers get the assembled
 * document either way, so the CLI, the dashboard server and backups don't care which
 * layout is on disk. `ch tasks split` migrates single -> split.
 *
 * Split writes touch only tickets whose text changed, write the index last, then remove
 * ticket files the index no longer lists. A reader that runs mid-save sees the previous
 * index and ignores unlisted files, so it always gets a consistent document.
 *
 * Node-only (fs); shared by cli/ (ESM) and serve.js (dynamic import).
 */

import fs from 'node:fs';
import path from 'node:path';

export const SINGLE_FILE = 'tasks.json';
export const SPLIT_DIR = 'tasks.d';
export const INDEX_FILE = 'index.json';
export const TICKETS_DIR = 'tickets';

const TICKET_ID = /^[A-Z][A-Z0-9]{0,5}\d+$/;

export function singlePath(root) { return path.join(root, SINGLE_FILE); }
export function splitDir(root) { return path.join(root, SPLIT_DIR); }
export function indexPath(root) { return path.join(root, SPLIT_DIR, INDEX_FILE); }
export function ticketsDir(root) { return path.join(root, SPLIT_DIR, TICKETS_DIR); }
export function ticketPath(root, id) { return path.join(ticketsDir(root), `${id}.json`); }

/** 'split' | 'single' | 'none' */
export function tasksLayout(root) {
  if (fs.existsSync(indexPath(root))) return 'split';
  if (fs.existsSync(singlePath(root))) return 'single';
  return 'none';
}

/** The text every writer produces: 2-space JSON plus a trailing newline. */
export function stringifyDoc(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Split a document into its index and per-ticket objects. Throws when a ticket has no
 * valid id or an id repeats, since either would lose a ticket on disk.
 * @returns {{ index: object, tickets: Map<string, object> }}
 */
export function splitDoc(doc) {
  if (!doc || !Array.isArray(doc.sections)) throw new Error('tasks document has no sections array');
  const tickets = new Map();
  const index = { ...doc };
  index.sections = doc.sections.map((section) => {
    const ids = (section.tasks || []).map((task) => {
      const id = task && task.id;
      if (typeof id !== 'string' || !TICKET_ID.test(id)) {
        throw new Error(`cannot store ticket without a valid id in section "${section.id}": ${JSON.stringify(id)}`);
      }
      if (tickets.has(id)) throw new Error(`duplicate ticket id ${id}; fix it before saving`);
      tickets.set(id, task);
      return id;
    });
    return { ...section, tasks: ids };
  });
  return { index, tickets };
}

/**
 * Rebuild the document from an index and a ticket lookup. Key order follows the index,
 * so assembling a freshly split document reproduces it exactly.
 */
export function assembleDoc(index, getTicket) {
  const doc = { ...index };
  doc.sections = (index.sections || []).map((section) => ({
    ...section,
    tasks: (section.tasks || []).map((id) => {
      const task = getTicket(id);
      if (!task) throw new Error(`tasks.d/index.json lists ${id} but tasks.d/tickets/${id}.json is missing`);
      return task;
    }),
  }));
  return doc;
}

function readJsonFile(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`invalid JSON in ${abs}: ${e.message}`);
  }
}

function readSplit(root) {
  const index = readJsonFile(indexPath(root));
  return assembleDoc(index, (id) => {
    const abs = ticketPath(root, id);
    return fs.existsSync(abs) ? readJsonFile(abs) : null;
  });
}

/** Read the assembled document. Throws when neither layout exists. */
export function readTasksDoc(root) {
  const layout = tasksLayout(root);
  if (layout === 'split') return readSplit(root);
  if (layout === 'single') return readJsonFile(singlePath(root));
  throw new Error(`not found: ${singlePath(root)} (and no ${SPLIT_DIR}/${INDEX_FILE})`);
}

/**
 * Read the document as text, for HTTP and backups. A single file is returned verbatim;
 * a split layout is assembled and stringified.
 */
export function readTasksText(root) {
  const layout = tasksLayout(root);
  if (layout === 'single') return fs.readFileSync(singlePath(root), 'utf8');
  return stringifyDoc(readTasksDoc(root));
}

function writeIfChanged(abs, text) {
  try {
    if (fs.readFileSync(abs, 'utf8') === text) return false;
  } catch { /* missing: write it */ }
  const tmp = `${abs}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, abs);
  return true;
}

/**
 * Write the document in the split layout.
 * @returns {{ written: number, removed: number, tickets: number }}
 */
export function writeSplit(root, doc) {
  const { index, tickets } = splitDoc(doc);
  fs.mkdirSync(ticketsDir(root), { recursive: true });
  let written = 0;
  for (const [id, task] of tickets) {
    if (writeIfChanged(ticketPath(root, id), stringifyDoc(task))) written++;
  }
  writeIfChanged(indexPath(root), stringifyDoc(index));
  let removed = 0;
  for (const name of fs.readdirSync(ticketsDir(root))) {
    if (!name.endsWith('.json')) continue;
    if (!tickets.has(name.slice(0, -5))) {
      fs.rmSync(path.join(ticketsDir(root), name));
      removed++;
    }
  }
  return { written, removed, tickets: tickets.size };
}

/**
 * Write the document in whatever layout is on disk (single when none exists yet).
 * `text` may be passed when the caller already has the exact single-file text.
 */
export function writeTasksDoc(root, doc, { text } = {}) {
  if (tasksLayout(root) === 'split') return writeSplit(root, doc);
  fs.mkdirSync(root, { recursive: true });
  writeIfChanged(singlePath(root), text ?? stringifyDoc(doc));
  return { written: 1, removed: 0, tickets: null };
}

/** Problems with the files on disk that don't stop reading (shown by `ch tasks lint`). */
export function layoutWarnings(root) {
  const warnings = [];
  if (tasksLayout(root) === 'split' && fs.existsSync(singlePath(root))) {
    warnings.push(`${SINGLE_FILE} exists next to ${SPLIT_DIR}/ and is ignored; move it out of ${root}`);
  }
  return warnings;
}

function sectionSummary(doc) {
  return doc.sections.map((s) => ({ id: s.id, ids: (s.tasks || []).map((t) => t.id) }));
}

/**
 * Move a single-file document into the split layout. Writes tasks.d/, reads it back and
 * checks per-section counts, ids and the full text match the original; on any mismatch
 * tasks.d/ is removed and tasks.json is left untouched. On success tasks.json is moved
 * to `moveSingleTo` (a backup path) so there is only one source of truth.
 * @returns {{ tickets: number, sections: Array<{ id: string, count: number }>, movedTo: string }}
 */
export function migrateToSplit(root, { moveSingleTo }) {
  const layout = tasksLayout(root);
  if (layout === 'split') throw new Error(`already split: ${splitDir(root)}`);
  if (layout === 'none') throw new Error(`not found: ${singlePath(root)}`);
  if (!moveSingleTo) throw new Error('migrateToSplit needs moveSingleTo (where the original tasks.json goes)');

  const original = fs.readFileSync(singlePath(root), 'utf8');
  const doc = JSON.parse(original);
  try {
    writeSplit(root, doc);
    const back = readSplit(root);
    const want = sectionSummary(doc);
    const got = sectionSummary(back);
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      throw new Error('sections or ticket ids differ after the split');
    }
    if (stringifyDoc(back) !== stringifyDoc(doc)) {
      throw new Error('ticket contents differ after the split');
    }
    // Another writer (a hook, the dashboard) may have saved while we split; don't lose it.
    if (fs.readFileSync(singlePath(root), 'utf8') !== original) {
      throw new Error(`${SINGLE_FILE} changed during the split; run it again`);
    }
  } catch (e) {
    fs.rmSync(splitDir(root), { recursive: true, force: true });
    throw new Error(`split aborted, ${SINGLE_FILE} left as it was: ${e.message}`);
  }

  fs.mkdirSync(path.dirname(moveSingleTo), { recursive: true });
  fs.renameSync(singlePath(root), moveSingleTo);
  return {
    tickets: doc.sections.reduce((n, s) => n + (s.tasks || []).length, 0),
    sections: doc.sections.map((s) => ({ id: s.id, count: (s.tasks || []).length })),
    movedTo: moveSingleTo,
  };
}
