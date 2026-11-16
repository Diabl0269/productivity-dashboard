/**
 * cli/commands/tasks-free-notes.js — free notes (PRO121): a note with no ticket, which the notes run
 * files like any review note. Stored in `meta.freeNotes`, handle `free#<n>` (shared/review-notes.js).
 *
 *   ch tasks notes add --free "<text>" --project <slug> [--kind fix|idea|design] [--area <lane>] [--where <box>]
 *                      [--image <file>]... (alias --note-image) [--json]
 *   ch tasks notes edit free#<n> ["<text>"] [--kind K] [--area <lane>|--clear-area] [--where <box>] [--json]
 *   ch tasks notes dismiss free#<n> [--json]
 *
 * Listing, prep, route, send and report pick free notes up through shared/review-notes.js
 * (pendingReviewNotes) and shared/review-filing.js (planFiling), so they need no command of their own.
 */

import path from 'node:path';
import { parse } from '../lib/args.js';
import { jsonOut, ok, die } from '../lib/output.js';
import { load, save } from '../lib/tasks-store.js';
import { dataRoot } from '../lib/io.js';
import { storeImageFile } from '../../shared/note-images.js';
import {
  addFreeNote, editFreeNote, setFreeNoteState, parseFreeHandle, FREE_ID,
} from '../../shared/review-notes.js';

const ADD_USAGE = 'usage: ch tasks notes add --free "<text>" --project <slug> [--kind fix|idea|design] [--area <lane>] [--where <box>] [--image <file>]...';
const LANE_RE = /^[a-z0-9][a-z0-9-]*$/;

/** True when `notes add` is the free form (`--free` given). */
export function isFreeAdd(args) {
  return args.some(a => a === '--free' || a.startsWith('--free='));
}

/** True when `notes edit|dismiss` names a free note (`free#n`). */
export function isFreeHandleArg(args) {
  return args.some(a => !!parseFreeHandle(a));
}

function knownProject(doc, slug) {
  const projects = doc.meta?.projects || [];
  if (!projects.length || projects.some(p => p.id === slug)) return;
  die(`unknown project "${slug}". Valid projects: ${projects.map(p => p.id).join(', ')}`);
}

function storeImages(files) {
  const out = [];
  for (const f of files || []) {
    try { out.push(storeImageFile(dataRoot(), FREE_ID, path.resolve(f))); } catch (e) { die(e.message); }
  }
  return out;
}

/** `ch tasks notes add --free ...` */
export function cmdFreeNoteAdd(argv) {
  const { values, positionals } = parse(argv, {
    free:         { type: 'string' },
    project:      { type: 'string', short: 'p' },
    kind:         { type: 'string' },
    area:         { type: 'string' },
    where:        { type: 'string' },
    image:        { type: 'string', multiple: true },
    'note-image': { type: 'string', multiple: true },
    json:         { type: 'boolean', short: 'j' },
  });
  const text = values.free ?? positionals[0] ?? '';
  const files = [...(values.image || []), ...(values['note-image'] || [])];
  if (!String(text).trim() && !files.length) die(ADD_USAGE);
  const project = values.project?.trim();
  if (!project) die(`a free note needs --project <slug> (it picks the new ticket's id prefix). ${ADD_USAGE}`);
  const area = values.area?.trim();
  if (area && !LANE_RE.test(area)) die(`invalid --area "${values.area}". Use lowercase letters, digits and hyphens`);
  const doc = load();
  knownProject(doc, project);
  const images = storeImages(files);
  let note;
  try {
    note = addFreeNote(doc, { text, kind: values.kind || 'fix', project, area, where: values.where?.trim(), images });
  } catch (e) { die(e.message); }
  save(doc);
  if (values.json) { jsonOut({ handle: `${FREE_ID}#${note.n}`, ...note }); return; }
  ok(`added ${FREE_ID}#${note.n}${area ? '' : ' (no area yet: the notes run will ask for one)'}`);
}

/** `ch tasks notes edit free#n ...` and `ch tasks notes dismiss free#n`. */
export function cmdFreeNoteChange(sub, argv) {
  const { values, positionals } = parse(argv, {
    kind:         { type: 'string' },
    area:         { type: 'string' },
    'clear-area': { type: 'boolean' },
    where:        { type: 'string' },
    json:         { type: 'boolean', short: 'j' },
  });
  const handle = parseFreeHandle(positionals[0]);
  if (!handle) die(`usage: ch tasks notes ${sub} free#<n>`);
  const doc = load();
  let note;
  try {
    if (sub === 'dismiss') {
      note = setFreeNoteState(doc, handle.n, 'dismissed');
    } else {
      const area = values['clear-area'] ? '' : values.area?.trim();
      if (positionals[1] === undefined && values.kind === undefined && area === undefined && values.where === undefined) {
        die('usage: ch tasks notes edit free#<n> ["<text>"] [--kind fix|idea|design] [--area <lane> | --clear-area] [--where <box>]');
      }
      note = editFreeNote(doc, handle.n, { text: positionals[1], kind: values.kind, area, where: values.where?.trim() });
    }
  } catch (e) { die(e.message); }
  save(doc);
  if (values.json) { jsonOut({ handle: `${FREE_ID}#${note.n}`, ...note }); return; }
  ok(`${sub === 'dismiss' ? 'dismissed' : 'edited'} ${FREE_ID}#${note.n}`);
}

/** The header line `ch tasks notes` prints above a free note. */
export function freeEntryLine(entry) {
  const note = entry.notes[0] || {};
  const bits = [`project:${entry.project || '?'}`, entry.lane ? `lane:${entry.lane}` : 'no area', note.where ? `place:${note.where}` : ''];
  return `free note ${bits.filter(Boolean).join(' ')}`;
}
