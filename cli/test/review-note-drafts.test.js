// A review note being typed must survive a re-render (a Pass tick, the 2 s watcher), keep
// its kind and focus, and be saved when the user clicks or tabs away without Enter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Minimal DOM: elements with listeners, children, value, focus.
class FakeEl {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.attrs = {};
    this.value = ''; this.hidden = false; this.className = ''; this.parent = null; this.textContent = '';
    this.classList = { contains: (c) => this.className.split(/\s+/).includes(c), add() {}, remove() {}, toggle() {} };
    this.selectionStart = 0; this.selectionEnd = 0;
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  appendChild(c) { if (this.tagName === 'select' && !this.value) this.value = c.value; c.parent = this; this.children.push(c); return c; }
  contains(n) { return n === this || this.children.some(c => c.contains(n)); }
  get isConnected() { return this.connected !== false; }
  fire(ev, extra = {}) { const e = { target: this, preventDefault() {}, ...extra }; (this.listeners[ev] || []).forEach(fn => fn(e)); return e; }
  focus() { doc.activeElement = this; this.fire('focus'); }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  find(pred) { return pred(this) ? this : this.children.map(c => c.find(pred)).find(Boolean); }
}
const store = new Map();
const docListeners = {};
const doc = {
  activeElement: null,
  createElement: (t) => new FakeEl(t),
  getElementById: () => new FakeEl('div'),
  addEventListener: (ev, fn) => { (docListeners[ev] ||= []).push(fn); },
  querySelectorAll: () => [],
  body: new FakeEl('body'),
};
globalThis.document = doc;
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};

const ui = await import(join(dir, 'review-notes-ui.js'));

const mkTask = () => ({ taskId: 'T7', id: 0.5, title: 'x', reviewNotes: [] });
const input = (row) => row.find(e => e.tagName === 'input' && e.className.includes('td-review-note-input'));
const kindSel = (row) => row.find(e => e.tagName === 'select');
const hintOf = (row) => row.find(e => e.className.includes('td-review-note-draft-hint'));
const build = (task, onChange) => ui.reviewNoteAddRow(task, { check: 'c', key: 0, placeholder: 'p', label: 'l', onChange });

test('typed text and kind survive a re-render; focus and caret come back', async () => {
  store.clear();
  const task = mkTask();
  const row1 = build(task, () => {});
  const in1 = input(row1);
  in1.focus();
  in1.value = 'half a thought';
  in1.selectionStart = in1.selectionEnd = 4;
  in1.fire('input');
  kindSel(row1).value = 'idea';
  kindSel(row1).fire('change');

  // re-render: the old row goes away, a new one is built
  in1.connected = false;
  doc.activeElement = null;
  const row2 = build(task, () => {});
  const in2 = input(row2);
  assert.equal(in2.value, 'half a thought');
  assert.equal(kindSel(row2).value, 'idea');
  assert.equal(hintOf(row2).hidden, false, 'unsaved hint shown for a draft');
  await sleep(20);
  assert.equal(doc.activeElement, in2, 'focus returns to the rebuilt input');
  assert.equal(in2.selectionStart, 4);
  // focus moving to something else forgets the pending refocus, so a later rebuild does not steal it
  docListeners.focusin.forEach(fn => fn({ target: new FakeEl('button') }));
  doc.activeElement = null;
  const in3 = input(build(task, () => {}));
  await sleep(20);
  assert.notEqual(doc.activeElement, in3);
});

test('clicking away without Enter saves the draft as a note and clears it', async () => {
  store.clear();
  const task = mkTask();
  let changes = 0;
  const row = build(task, () => { changes++; });
  const inp = input(row);
  inp.focus();
  inp.value = 'remember this';
  inp.fire('input');
  doc.activeElement = null;
  inp.fire('blur', { relatedTarget: null });
  await sleep(30);
  assert.equal(task.reviewNotes.length, 1);
  assert.equal(task.reviewNotes[0].text, 'remember this');
  assert.equal(task.reviewNotes[0].check, 'c');
  assert.equal(changes, 1);
  assert.equal(store.size, 0, 'draft cleared after save');
  assert.equal(input(build(task, () => {})).value, '', 'a rebuilt input starts empty');
});

test('moving focus to the kind select in the same row does not save yet', async () => {
  store.clear();
  const task = mkTask();
  const row = build(task, () => {});
  const inp = input(row);
  inp.focus();
  inp.value = 'pick a kind first';
  inp.fire('input');
  inp.fire('blur', { relatedTarget: kindSel(row) });
  await sleep(30);
  assert.equal(task.reviewNotes.length, 0);
});

test('a blur caused by a re-render removing the input does not save', async () => {
  store.clear();
  const task = mkTask();
  const row = build(task, () => {});
  const inp = input(row);
  inp.focus();
  inp.value = 'still typing';
  inp.fire('input');
  inp.connected = false;
  inp.fire('blur', { relatedTarget: null });
  await sleep(30);
  assert.equal(task.reviewNotes.length, 0);
  assert.ok(store.size === 1, 'draft kept');
});

test('Enter saves and clears the draft; an empty input saves nothing', async () => {
  store.clear();
  const task = mkTask();
  const row = build(task, () => {});
  const inp = input(row);
  inp.fire('keydown', { key: 'Enter' });
  await sleep(10);
  assert.equal(task.reviewNotes.length, 0);
  inp.value = 'done now';
  inp.fire('input');
  inp.fire('keydown', { key: 'Enter' });
  await sleep(20);
  assert.equal(task.reviewNotes.length, 1);
  assert.equal(store.size, 0);
});

test('isNoteInputBusy is true only while a note input with text has focus', () => {
  const task = mkTask();
  const inp = input(build(task, () => {}));
  inp.focus();
  inp.value = '';
  assert.equal(ui.isNoteInputBusy(), false);
  inp.value = 'typing';
  assert.equal(ui.isNoteInputBusy(), true);
  doc.activeElement = null;
  assert.equal(ui.isNoteInputBusy(), false);
});
