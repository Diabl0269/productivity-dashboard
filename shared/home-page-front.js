/**
 * Front matter of a Home handbook page (pure, no fs, no DOM).
 *
 *   ---
 *   title: "Counter and till: how a sale is rung up"
 *   updated: 2026-11-03
 *   covers: [bakery-orders/till/**, bakery-site/src/checkout.js]
 *   ---
 *
 * `covers` is an inline list or a "- item" block list. Every problem is a plain-words line in
 * `problems`; nothing throws. Field rules: docs/home-page.md.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function unquote(v) {
  const s = v.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Split an inline list body on commas that are not inside quotes. */
function splitInline(body) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of body) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(unquote).filter(Boolean);
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(s) {
  const m = DATE_RE.exec(String(s));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * @param {string} text the whole page file
 * @returns {{ title: string|null, updated: string|null, covers: string[], body: string, hasFrontMatter: boolean, problems: string[] }}
 */
export function parsePageFile(text) {
  const out = { title: null, updated: null, covers: [], body: '', hasFrontMatter: false, problems: [] };
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) {
    out.body = src;
    out.problems.push('The page has no front matter (a "---" block with title, updated and covers).');
    return out;
  }
  out.hasFrontMatter = true;
  out.body = src.slice(m[0].length);
  let blockKey = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && blockKey === 'covers') { out.covers.push(unquote(item[1])); continue; }
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    blockKey = kv[1];
    const val = kv[2].trim();
    if (blockKey === 'title') out.title = unquote(val) || null;
    else if (blockKey === 'updated') out.updated = unquote(val) || null;
    else if (blockKey === 'covers' && val) {
      const inline = /^\[(.*)\]$/.exec(val);
      if (inline) out.covers = splitInline(inline[1]);
      else out.problems.push('"covers" should be a list: [repo/glob, repo/glob] or lines starting with "- ".');
    }
  }
  if (!out.title) out.problems.push('The front matter has no "title".');
  if (!out.updated) out.problems.push('The front matter has no "updated" date, so staleness cannot be checked.');
  else if (!isIsoDate(out.updated)) {
    out.problems.push(`"updated" should be a date like 2026-11-03, got "${out.updated}".`);
    out.updated = null;
  }
  if (!out.covers.length) out.problems.push('The front matter has no "covers" list, so staleness cannot be checked.');
  return out;
}
