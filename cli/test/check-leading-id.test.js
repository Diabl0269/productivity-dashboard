/**
 * cli/test/check-leading-id.test.js
 * PRO135: a check that starts with a ticket id shows it as a button that opens that ticket (Plan grid, ticket
 * modal review panel, needs-Tal list). Splitter unit tests, a fake-DOM render test, and a sibling guard that every
 * check list renders through appendCheckText. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitLeadingTicketId } from '../../shared/leading-ticket-id.js';
import { appendCheckText } from '../../dashboard/js/check-text.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('splitLeadingTicketId: only "<ID>: " at the very start', () => {
  assert.deepEqual(splitLeadingTicketId('BAC76: After the next deploy, look'), { id: 'BAC76', rest: 'After the next deploy, look' });
  assert.deepEqual(splitLeadingTicketId('AB1:   spaced'), { id: 'AB1', rest: 'spaced' });
  assert.equal(splitLeadingTicketId('After the next deploy'), null);
  assert.equal(splitLeadingTicketId('bac76: lowercase'), null);
  assert.equal(splitLeadingTicketId('See BAC76: mid-sentence'), null);
  assert.equal(splitLeadingTicketId('BAC76 no colon'), null);
  assert.equal(splitLeadingTicketId('BAC7600x: not an id'), null);
  assert.equal(splitLeadingTicketId('BAC76:no space'), null);
  assert.equal(splitLeadingTicketId('X1: one letter'), null);
  assert.equal(splitLeadingTicketId(undefined), null);
});

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this._text = ''; this.handlers = {}; this.dataset = {}; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, f) { this.handlers[t] = f; }
  click() { this.handlers.click?.(); }
  set textContent(t) { this._text = t; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
}
const fakeDocument = { createElement: t => new FakeNode(t), createTextNode: t => Object.assign(new FakeNode('#text'), { _text: t }) };

/** The same wiring the pages use, with openTicket replaced by a recorder. */
function render(text, opened) {
  const cell = new FakeNode('div');
  const button = id => { const b = new FakeNode('button'); b._text = id; b.dataset.ticket = id; b.addEventListener('click', () => opened.push(id)); return b; };
  appendCheckText(cell, text, button, t => Object.assign(new FakeNode('span'), { _text: t }));
  return cell;
}

test('a leading id is the first child, a button[data-ticket], and clicking opens that ticket', () => {
  globalThis.document = fakeDocument;
  try {
    const opened = [];
    const cell = render('BAC76: After the next deploy, look at BAC77', opened);
    assert.equal(cell.children[0].tag, 'button');
    assert.equal(cell.children[0].dataset.ticket, 'BAC76');
    cell.children[0].click();
    assert.deepEqual(opened, ['BAC76']);
    assert.equal(cell.textContent, 'BAC76: After the next deploy, look at BAC77');
    const plain = render('Look at BAC77: later', opened);
    assert.equal(plain.children.filter(c => c.tag === 'button').length, 0);
    assert.equal(plain.textContent, 'Look at BAC77: later');
  } finally { delete globalThis.document; }
});

test('sibling guard: every check list (Plan grid, ticket modal review panel, needs-Tal list) renders through appendCheckText', () => {
  const read = f => fs.readFileSync(path.join(ROOT, 'dashboard/js', f), 'utf8');
  const review = read('run-plan-review.js');
  assert.match(review, /appendCheckText\(what, c\.text/, 'Plan grid check text');
  assert.match(review, /appendCheckText\(what, l\.text/, 'needs-Tal list line text');
  assert.doesNotMatch(review, /textWithIds\(c\.text/, 'raw check text bypasses the leading-id button');
  const detail = read('task-detail.js');
  assert.match(detail, /appendCheckText\(text, c\.text/, 'ticket modal review panel');
  assert.doesNotMatch(detail, /text\.textContent = c\.text/, 'raw check text bypasses the leading-id button');
});
