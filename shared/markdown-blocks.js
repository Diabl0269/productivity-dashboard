/**
 * A small, safe Markdown reader for handbook pages (pure, no DOM, no HTML output): text in, a tree
 * out. The browser builds DOM nodes from the tree (dashboard/js/home-markdown.js), so raw HTML in a
 * page is only ever text.
 *
 * Blocks: headings (#..######), paragraphs, bullet and numbered lists (wrapped lines, nesting by
 * indent), tables with | rows, fenced code, block quotes, rules. Block-level <!-- comments --> are
 * dropped. Inline: `code`, **bold**, *italic*, [link](url), ![image](url), \ escapes.
 *
 * Block: { t:'h', level, c } | { t:'p', c } | { t:'ul'|'ol', start, items: Block[][] } |
 *   { t:'table', head: Inline[][], align: (string|null)[], rows: Inline[][][] } |
 *   { t:'code', lang, v } | { t:'quote', blocks } | { t:'hr' }
 * Inline: { t:'text', v } | { t:'code', v } | { t:'strong'|'em', c } | { t:'link', href, c } | { t:'img', src, alt }
 */

const ITEM_RE = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,}) *([\w+-]*)[^`]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

// ===== inline =====

function pushText(out, v) {
  if (!v) return;
  const last = out.at(-1);
  if (last && last.t === 'text') last.v += v; else out.push({ t: 'text', v });
}

/** Index of the `]` closing the `[` at `open`, skipping code spans and escapes; -1 if none. */
function closeBracket(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '`') { const e = s.indexOf('`', i + 1); if (e > 0) i = e; continue; }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return i;
  }
  return -1;
}

/** `(url "title")` right after a `]`: { href, end } or null. */
function destination(s, at) {
  if (s[at] !== '(') return null;
  let depth = 0;
  let i = at;
  for (; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) break;
  }
  if (i >= s.length) return null;
  const inner = s.slice(at + 1, i).trim();
  const m = /^(<[^>]*>|\S*)(?:\s+(?:"[^"]*"|'[^']*'))?$/.exec(inner);
  if (!m) return null;
  return { href: m[1].replace(/^<|>$/g, ''), end: i + 1 };
}

/** @returns {object[]} inline nodes */
export function parseInline(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|<>~]/.test(s[i + 1])) { pushText(out, s[i + 1]); i += 2; continue; }
    if (ch === '`') {
      const run = /^`+/.exec(s.slice(i))[0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) { out.push({ t: 'code', v: s.slice(i + run.length, end).replace(/^ (.*) $/, '$1') }); i = end + run.length; continue; }
      pushText(out, run); i += run.length; continue;
    }
    if (ch === '!' && s[i + 1] === '[') {
      const close = closeBracket(s, i + 1);
      const dest = close > 0 && destination(s, close + 1);
      if (dest) { out.push({ t: 'img', src: dest.href, alt: s.slice(i + 2, close) }); i = dest.end; continue; }
    }
    if (ch === '[') {
      const close = closeBracket(s, i);
      const dest = close > 0 && destination(s, close + 1);
      if (dest) { out.push({ t: 'link', href: dest.href, c: parseInline(s.slice(i + 1, close)) }); i = dest.end; continue; }
    }
    if (ch === '*' || ch === '_') {
      const dbl = s[i + 1] === ch;
      const mark = dbl ? ch + ch : ch;
      const before = s[i - 1];
      const opens = s[i + mark.length] && !/\s/.test(s[i + mark.length]) && (ch === '*' || !before || !/\w/.test(before));
      if (opens) {
        let end = i + mark.length;
        for (;;) {
          end = s.indexOf(mark, end);
          if (end < 0) break;
          const after = s[end + mark.length];
          if (!/\s/.test(s[end - 1]) && (ch === '*' || !after || !/\w/.test(after)) && end > i + mark.length) break;
          end += mark.length;
        }
        if (end > 0) { out.push({ t: dbl ? 'strong' : 'em', c: parseInline(s.slice(i + mark.length, end)) }); i = end + mark.length; continue; }
      }
      pushText(out, mark); i += mark.length; continue;
    }
    pushText(out, ch); i++;
  }
  return out;
}

// ===== blocks =====

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; } else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const startsBlock = line => FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line)
  || /^ {0,3}>/.test(line) || ITEM_RE.test(line) || /^ {0,3}<!--/.test(line);

/** @returns {object[]} blocks */
export function parseBlocks(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^ {0,3}<!--/.test(line)) { // a comment block: dropped (the template uses them as notes to the author)
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;
      continue;
    }
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const mark = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(mark) && lines[i].trim().replace(/[`~]/g, '') === '')) body.push(lines[i++]);
      i++;
      out.push({ t: 'code', lang: fence[2] || '', v: body.join('\n') });
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) { out.push({ t: 'h', level: h[1].length, c: parseInline(h[2]) }); i++; continue; }
    if (HR_RE.test(line)) { out.push({ t: 'hr' }); i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const inner = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) inner.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      out.push({ t: 'quote', blocks: parseBlocks(inner.join('\n')) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
      const fit = r => head.map((_, k) => parseInline(r[k] ?? ''));
      out.push({ t: 'table', head: head.map(parseInline), align, rows: rows.map(fit) });
      continue;
    }
    const item = ITEM_RE.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const base = item[1].length;
      const items = [];
      const start = ordered ? parseInt(item[2], 10) : 1;
      while (i < lines.length) {
        const m = ITEM_RE.exec(lines[i]);
        if (!m || /\d/.test(m[2]) !== ordered || m[1].length > base + 1) break;
        const width = m[1].length + m[2].length + Math.max(1, m[3].length);
        const body = [m[4]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) { // a blank line stays in the item only when the next text is indented under it
            const next = lines.slice(i + 1).find(x => x.trim());
            if (next === undefined || next.match(/^ */)[0].length < width) break;
            body.push('');
            i++;
            continue;
          }
          const ind = l.match(/^ */)[0].length;
          if (ITEM_RE.test(l) && ind <= base + 1) break; // the next sibling
          if (ind > base || !startsBlock(l)) { body.push(l.slice(Math.min(ind, width))); i++; continue; }
          break;
        }
        items.push(parseBlocks(body.join('\n')));
      }
      out.push({ t: ordered ? 'ol' : 'ul', start, items });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i]))) {
      para.push(lines[i++].trim());
    }
    out.push({ t: 'p', c: parseInline(para.join(' ')) });
  }
  return out;
}
