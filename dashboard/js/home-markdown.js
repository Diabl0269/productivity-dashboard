// home-markdown.js — builds DOM nodes from a handbook page's Markdown (shared/markdown-blocks.js).
// No innerHTML anywhere: text goes in through text nodes, so raw HTML in a page is only text.
// The older renderer (memory-parser.js renderMarkdownToHtml) escapes then rewrites with regexes into
// an HTML string and has no ordered lists, images or wrapped list lines, so pages get this one.
//
//   renderMarkdown(md, { imageUrl(src), pageFor(href), onPage(boxId), onImage(img, alt), doc })
//     imageUrl: relative image src -> URL on the file route (null = do not show)
//     pageFor:  a relative link such as "other.md" -> the box id that page belongs to, or null
//     onPage:   called with that box id when the link is clicked
//     onImage:  called with the <img> and its alt when a diagram is clicked
//     headingOffset: added to a heading's level (default 1, so "##" is an h3 under the page's h2)

import { parseBlocks } from '../../shared/markdown-blocks.js';

/** http(s) and mailto links only; everything else (javascript:, data:, ...) is not a link. */
export function safeExternalHref(href) {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

export function renderMarkdown(md, opts = {}) {
  const doc = opts.doc || document;
  const make = (tag, cls) => { const n = doc.createElement(tag); if (cls) n.className = cls; return n; };
  const text = v => doc.createTextNode(v);

  function inline(nodes, parent) {
    for (const n of nodes) {
      if (n.t === 'text') parent.appendChild(text(n.v));
      else if (n.t === 'code') { const c = make('code'); c.appendChild(text(n.v)); parent.appendChild(c); }
      else if (n.t === 'strong' || n.t === 'em') { const c = make(n.t === 'strong' ? 'strong' : 'em'); inline(n.c, c); parent.appendChild(c); }
      else if (n.t === 'link') link(n, parent);
      else if (n.t === 'img') image(n, parent);
    }
  }

  function link(n, parent) {
    const ext = safeExternalHref(n.href);
    if (ext) {
      const a = make('a', 'hp-link');
      a.href = ext;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      inline(n.c, a);
      parent.appendChild(a);
      return;
    }
    const box = !/^[a-z][a-z0-9+.-]*:/i.test(n.href) && opts.pageFor ? opts.pageFor(n.href.split('#')[0]) : null;
    if (box) {
      const b = make('button', 'hp-link hp-link-page');
      b.type = 'button';
      b.title = 'Open this page';
      b.addEventListener('click', () => opts.onPage?.(box));
      inline(n.c, b);
      parent.appendChild(b);
      return;
    }
    const s = make('span', 'hp-link hp-link-dead'); // no page behind it: plain text, never a dead anchor
    inline(n.c, s);
    parent.appendChild(s);
  }

  function image(n, parent) {
    const url = opts.imageUrl ? opts.imageUrl(n.src) : null;
    if (!url) { const s = make('span', 'hp-img-missing'); s.appendChild(text(`[image: ${n.alt || n.src}]`)); parent.appendChild(s); return; }
    const fig = make('button', 'hp-fig');
    fig.type = 'button';
    fig.title = 'Open the diagram large';
    fig.setAttribute('aria-label', `${n.alt || 'Diagram'} (open large)`);
    const img = make('img', 'hp-img');
    img.src = url;
    img.alt = n.alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    fig.appendChild(img);
    fig.addEventListener('click', () => opts.onImage?.(img, n.alt));
    parent.appendChild(fig);
  }

  function blocks(list, parent) {
    for (const b of list) {
      if (b.t === 'h') {
        const h = make(`h${Math.min(6, b.level + (opts.headingOffset ?? 1))}`, `hp-h hp-h${b.level}`); // the page title sits above: offset 1 = under an h2
        inline(b.c, h);
        parent.appendChild(h);
      } else if (b.t === 'p') {
        const only = b.c.length === 1 && b.c[0].t === 'img';
        const p = make('p', only ? 'hp-p hp-p-fig' : 'hp-p');
        inline(b.c, p);
        parent.appendChild(p);
      } else if (b.t === 'ul' || b.t === 'ol') {
        const l = make(b.t, 'hp-list');
        if (b.t === 'ol' && b.start !== 1) l.start = b.start;
        for (const item of b.items) {
          const li = make('li');
          const [first, ...rest] = item;
          if (first && first.t === 'p') inline(first.c, li); else if (first) blocks([first], li);
          blocks(rest, li);
          l.appendChild(li);
        }
        parent.appendChild(l);
      } else if (b.t === 'table') table(b, parent);
      else if (b.t === 'code') {
        const pre = make('pre', 'hp-code');
        const c = make('code');
        c.appendChild(text(b.v));
        pre.appendChild(c);
        pre.tabIndex = 0; // keyboard scroll of a long line
        parent.appendChild(pre);
      } else if (b.t === 'quote') {
        const q = make('blockquote', 'hp-quote');
        blocks(b.blocks, q);
        parent.appendChild(q);
      } else if (b.t === 'hr') parent.appendChild(make('hr', 'hp-hr'));
    }
  }

  function table(b, parent) {
    const wrap = make('div', 'hp-table-wrap'); // wide tables scroll sideways inside the page, not the panel
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Table');
    const t = make('table', 'hp-table');
    const row = (cells, tag, parentEl) => {
      const tr = make('tr');
      cells.forEach((c, i) => {
        const cell = make(tag);
        if (b.align[i]) cell.style.textAlign = b.align[i];
        inline(c, cell);
        tr.appendChild(cell);
      });
      parentEl.appendChild(tr);
    };
    const head = make('thead');
    row(b.head, 'th', head);
    const body = make('tbody');
    for (const r of b.rows) row(r, 'td', body);
    t.appendChild(head);
    t.appendChild(body);
    wrap.appendChild(t);
    parent.appendChild(wrap);
  }

  const frag = doc.createDocumentFragment();
  blocks(parseBlocks(md), frag);
  return frag;
}
