/**
 * cli/test/review-note-images.test.js
 * Images on review notes (the notes written on the Plan's review cards): model, validation,
 * dashboard normalisation and File review carrying them to the filed ticket.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addReviewNote, reviewNoteErrors, noteLine } from '../../shared/review-notes.js';
import { planFiling, applyFiling } from '../../shared/review-filing.js';
import { normalizeReviewNotes } from '../../dashboard/js/tasks-json.js';

const IMG = 'PRO1/0123456789abcdef.png';

test('a review note can carry images, and may have no text when it does', () => {
  const t = { id: 'PRO1' };
  const n = addReviewNote(t, { text: '  looks off ', check: 'c', images: [IMG] });
  assert.deepEqual(n.images, [IMG]);
  const only = addReviewNote(t, { text: '', images: [IMG] });
  assert.equal(only.text, '');
  assert.throws(() => addReviewNote(t, { text: '' }), /empty/);
  assert.throws(() => addReviewNote(t, { text: ' ', images: [] }), /empty/);
  assert.equal('images' in addReviewNote(t, { text: 'plain' }), false);
  assert.deepEqual(reviewNoteErrors(t.reviewNotes, 'PRO1'), []);
  assert.match(noteLine('PRO1', only), /\(image only\) \(1 image\)/);
});

test('validation rejects an empty note without images and malformed images', () => {
  const base = { n: 1, at: '2026-10-28T00:00:00Z', kind: 'fix', state: 'new' };
  assert.equal(reviewNoteErrors([{ ...base, text: '' }], 'T').length, 1);
  assert.equal(reviewNoteErrors([{ ...base, text: '', images: [IMG] }], 'T').length, 0);
  assert.equal(reviewNoteErrors([{ ...base, text: 'x', images: [5] }], 'T').length, 1);
});

test('dashboard normalisation keeps images and image-only notes', () => {
  const base = { n: 1, at: '2026-10-28T00:00:00Z', kind: 'fix', state: 'new' };
  const out = normalizeReviewNotes([{ ...base, text: '', images: [IMG, ''] }, { ...base, n: 2, text: '' }]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].images, [IMG]);
});

test('File review hands the screenshots to the filed ticket as a note', () => {
  const src = { id: 'PRO1', type: 'task', title: 'Src', checks: [{ text: 'c', checked: false }], subtasks: [] };
  const note = addReviewNote(src, { text: 'Button is clipped', check: 'c', area: 'ui', images: [IMG] });
  const doc = { sections: [{ id: 'review', tasks: [src] }, { id: 'todo', tasks: [] }, { id: 'backlog', tasks: [] }, { id: 'done', tasks: [] }] };
  let next = 100;
  const out = applyFiling(doc, planFiling(doc), { newId: () => `PRO${next++}` });
  const filed = doc.sections.flatMap(s => s.tasks).find(t => t.id === out.filed[0].id);
  assert.equal(note.state, 'filed');
  assert.equal(filed.notes.length, 1);
  assert.deepEqual(filed.notes[0].images, [IMG]);
});

test('an image-only note files under a readable title', () => {
  const src = { id: 'PRO1', type: 'task', title: 'Src', checks: [], subtasks: [] };
  addReviewNote(src, { text: '', area: 'ui', images: [IMG] });
  const doc = { sections: [{ id: 'review', tasks: [src] }, { id: 'todo', tasks: [] }, { id: 'backlog', tasks: [] }, { id: 'done', tasks: [] }] };
  const plan = planFiling(doc);
  assert.match(plan.groups[0].items[0].title, /screenshot/i);
});
