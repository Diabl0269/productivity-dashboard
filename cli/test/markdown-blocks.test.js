import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, parseInline } from '../../shared/markdown-blocks.js';
import { renderMarkdown, safeExternalHref } from '../../dashboard/js/home-markdown.js';

// ----- a tiny DOM, enough for the renderer -----
function node(tag) {
  const n = { tag, children: [], attrs: {}, style: {}, listeners: {}, className: '', text: null };
  n.appendChild = (k) => { n.children.push(k); return k; };
  n.setAttribute = (k, v) => { n.attrs[k] = v; };
  n.addEventListener = (ev, fn) => { n.listeners[ev] = fn; };
  return n;
}
const fakeDoc = {
  createElement: node,
  createTextNode: (v) => ({ tag: '#text', text: v, children: [] }),
  createDocumentFragment: () => node('#frag'),
};
const render = (md, opts = {}) => renderMarkdown(md, { doc: fakeDoc, ...opts });
const find = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const k of n.children) find(k, pred, out); return out; };
const textOf = (n) => (n.tag === '#text' ? n.text : n.children.map(textOf).join(''));

test('headings, paragraphs with wrapped lines, rules', () => {
  const b = parseBlocks('# One\n\nfirst line\nsecond line\n\n---\n\n### Three ###\n');
  assert.deepEqual(b.map(x => x.t), ['h', 'p', 'hr', 'h']);
  assert.equal(b[0].level, 1);
  assert.equal(b[1].c[0].v, 'first line second line');
  assert.equal(b[3].level, 3);
  assert.equal(b[3].c[0].v, 'Three');
});

test('numbered list: wrapped lines stay in their item, nested bullets nest', () => {
  const [l] = parseBlocks('1. **A note.** Tal writes it\n   on a card.\n2. Next step\n   - nested one\n   - nested two\n3. Last\n');
  assert.equal(l.t, 'ol');
  assert.equal(l.items.length, 3);
  assert.equal(l.items[0][0].c[0].t, 'strong');
  assert.equal(l.items[0][0].c.at(-1).v, ' Tal writes it on a card.');
  assert.equal(l.items[1][1].t, 'ul');
  assert.equal(l.items[1][1].items.length, 2);
});

test('a bullet list that starts at another number keeps its start; a blank line inside an item keeps it', () => {
  const [l] = parseBlocks('4. four\n\n   still four\n5. five\n');
  assert.equal(l.start, 4);
  assert.equal(l.items.length, 2);
  assert.equal(l.items[0].length, 2);
});

test('a table with alignment and an escaped pipe; no lost rows or raw pipes', () => {
  const [t] = parseBlocks('| Name | Price |\n| --- | ---: |\n| Loaf | 5 |\n| A \\| B | `x` |\n');
  assert.equal(t.t, 'table');
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.align, [null, 'right']);
  assert.equal(t.rows[1][0][0].v, 'A | B');
  assert.equal(t.rows[1][1][0].t, 'code');
});

test('fenced code keeps its text exactly, including markdown characters', () => {
  const [c] = parseBlocks('```js\nconst a = **b**;\n| not | a table |\n```\n');
  assert.equal(c.t, 'code');
  assert.equal(c.lang, 'js');
  assert.equal(c.v, 'const a = **b**;\n| not | a table |');
});

test('inline: code with ** inside stays code, bold, italic, links, images, escapes', () => {
  assert.deepEqual(parseInline('`**/*.md`'), [{ t: 'code', v: '**/*.md' }]);
  const n = parseInline('a **b** and *c* [d](x.md) ![e](img/f.svg) \\*g\\*');
  assert.deepEqual(n.map(x => x.t), ['text', 'strong', 'text', 'em', 'text', 'link', 'text', 'img', 'text']);
  assert.equal(n.at(-1).v, ' *g*');
  assert.equal(n[7].src, 'img/f.svg');
  assert.equal(n[7].alt, 'e');
});

test('snake_case words and a lone star are not emphasis', () => {
  assert.deepEqual(parseInline('some_snake_case and 5 * 3'), [{ t: 'text', v: 'some_snake_case and 5 * 3' }]);
});

test('block comments are dropped (the template uses them for notes to the author)', () => {
  const b = parseBlocks('before\n\n<!--\nnote to author\nmore\n-->\n\nafter');
  assert.deepEqual(b.map(x => x.t), ['p', 'p']);
});

test('raw HTML is text: no element is ever made from it', () => {
  const frag = render('<script>alert(1)</script>\n\nA <img src=x onerror=alert(1)> b\n\n| h |\n| - |\n| <b>x</b> |');
  assert.equal(find(frag, n => n.tag === 'script' || n.tag === 'b').length, 0);
  assert.equal(find(frag, n => n.tag === 'img').length, 0);
  assert.match(textOf(frag), /<script>alert\(1\)<\/script>/);
  assert.match(textOf(frag), /<img src=x onerror=alert\(1\)>/);
  assert.match(textOf(frag), /<b>x<\/b>/);
});

test('links: external opens in a new tab safely; javascript: and data: are never anchors', () => {
  const frag = render('[a](https://example.com/x) [b](javascript:alert(1)) [c](data:text/html,x) [d](other.md)');
  const anchors = find(frag, n => n.tag === 'a');
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].target, '_blank');
  assert.equal(anchors[0].rel, 'noopener noreferrer');
  assert.equal(find(frag, n => n.href && /javascript:|data:/i.test(n.href)).length, 0);
  assert.equal(safeExternalHref('javascript:alert(1)'), null);
  assert.equal(safeExternalHref('mailto:a@b.co'), 'mailto:a@b.co');
});

test('a link to another page becomes a button that selects its box; no page behind it is plain text', () => {
  const picked = [];
  const frag = render('[Oven](oven.md) and [Nowhere](nowhere.md)', { pageFor: (h) => (h === 'oven.md' ? 'oven' : null), onPage: (id) => picked.push(id) });
  const [btn] = find(frag, n => n.tag === 'button');
  assert.equal(textOf(btn), 'Oven');
  btn.listeners.click();
  assert.deepEqual(picked, ['oven']);
  assert.equal(find(frag, n => (n.className || '').includes('hp-link-dead')).length, 1);
});

test('images are rewritten through imageUrl and open large on click; without a url they are a note', () => {
  const opened = [];
  const frag = render('![Flow](img/a.svg)\n\n![Gone](../x.svg)', {
    imageUrl: (s) => (s.startsWith('img/') ? `/file?p=${s}` : null),
    onImage: (img, alt) => opened.push([img.src, alt]),
  });
  const [img] = find(frag, n => n.tag === 'img');
  assert.equal(img.src, '/file?p=img/a.svg');
  assert.equal(img.alt, 'Flow');
  find(frag, n => n.className === 'hp-fig')[0].listeners.click();
  assert.deepEqual(opened, [['/file?p=img/a.svg', 'Flow']]);
  assert.match(textOf(frag), /\[image: Gone\]/);
});

test('a table renders as a table with every row and header cell', () => {
  const frag = render('| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |');
  assert.equal(find(frag, n => n.tag === 'th').length, 2);
  assert.equal(find(frag, n => n.tag === 'td').length, 4);
  assert.doesNotMatch(textOf(frag), /\|/);
});
