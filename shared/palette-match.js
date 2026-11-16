// palette-match.js — fuzzy match and rank for the Home command palette (pure, no DOM).
//
//   rank(query, items, opts?) -> [{ item, score, ranges, idRanges }], best first
//
// An item is { title, id?, keywords?, recent? }: `title` and `id` are matched (and highlighted),
// `keywords` only matched, `recent` is a number (bigger = used more recently) that breaks ties.
// The query is split on spaces; every word must match the title, the id or the keywords. A word
// matches as a plain substring (best), or else as a subsequence of letters in order. Bonuses: start
// of a word, start of the text, letters side by side. An id equal to the whole query comes first.
// `ranges` are [start, end) pairs into the title, `idRanges` into the id (for highlighting).

const SEP = /[\s\-_/.:·›()[\]]/;

function wordStart(text, i) {
  return i === 0 || SEP.test(text[i - 1]) || (text[i - 1] === text[i - 1].toLowerCase() && text[i] !== text[i].toLowerCase());
}

/** Best match of one word in one text: { score, ranges } or null. `lower` is text.toLowerCase(). */
function matchWord(word, text, lower) {
  const at = lower.indexOf(word);
  if (at >= 0) {
    // Prefer an occurrence at the start of a word.
    let best = at;
    for (let i = at; i >= 0; i = lower.indexOf(word, i + 1)) {
      if (wordStart(text, i)) { best = i; break; }
    }
    const score = 100 + word.length * 4 + (wordStart(text, best) ? 40 : 0) + (best === 0 ? 20 : 0) - Math.min(best, 30) * 0.5;
    return { score, ranges: [[best, best + word.length]] };
  }
  if (word.length < 2) return null;
  // Letters spread over more than `span` characters are noise, not a match: try each start of the first letter.
  const span = word.length * 2 + 2;
  for (let from = lower.indexOf(word[0]); from >= 0; from = lower.indexOf(word[0], from + 1)) {
    const hit = subsequenceAt(word, text, lower, from, span);
    if (hit) return hit;
  }
  return null;
}

function subsequenceAt(word, text, lower, from, span) {
  let wi = 0;
  let score = 0;
  let last = -2;
  const ranges = [];
  for (let i = from; i < lower.length && wi < word.length && i - from < span; i++) {
    if (lower[i] !== word[wi]) continue;
    score += 6 + (i === last + 1 ? 8 : 0) + (wordStart(text, i) ? 12 : 0) - (last >= 0 && i > last + 1 ? Math.min(i - last - 1, 6) * 0.5 : 0);
    if (i === last + 1 && ranges.length) ranges[ranges.length - 1][1] = i + 1;
    else ranges.push([i, i + 1]);
    last = i;
    wi++;
  }
  return wi === word.length ? { score: Math.min(score, 90), ranges } : null;
}

function mergeRanges(ranges) {
  const out = [];
  for (const r of [...ranges].sort((a, b) => a[0] - b[0])) {
    const tail = out[out.length - 1];
    if (tail && r[0] <= tail[1]) tail[1] = Math.max(tail[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Score one item against the query words, or null when a word does not match. */
function scoreItem(words, q, item) {
  const title = String(item.title ?? '');
  const id = item.id == null ? '' : String(item.id);
  const kw = item.keywords ? String(item.keywords) : '';
  const tl = title.toLowerCase();
  const il = id.toLowerCase();
  const kl = kw.toLowerCase();
  let score = 0;
  const ranges = [];
  const idRanges = [];
  for (const w of words) {
    const t = matchWord(w, title, tl);
    const i = id ? matchWord(w, id, il) : null;
    const k = kl ? matchWord(w, kw, kl) : null;
    // The id counts a little more: typing "BKR1" means the ticket, not a title that happens to hold it.
    const best = [t && { ...t, in: 'title' }, i && { score: i.score * 1.15, ranges: i.ranges, in: 'id' }, k && { score: k.score * 0.6, in: 'kw' }]
      .filter(Boolean).sort((a, b) => b.score - a.score)[0];
    if (!best) return null;
    score += best.score;
    if (best.in === 'title') ranges.push(...best.ranges);
    else if (best.in === 'id') idRanges.push(...best.ranges);
  }
  if (id && il === q) score += 1000;
  else if (id && il.startsWith(q)) score += 60;
  if (tl === q) score += 200;
  score -= Math.min(title.length, 200) * 0.05;
  return { score, ranges: mergeRanges(ranges), idRanges: mergeRanges(idRanges) };
}

/**
 * Rank `items` for `query`. An empty query keeps every item in its given order (score 0), recent first.
 * @param {string} query
 * @param {Array<{title: string, id?: string, keywords?: string, recent?: number}>} items
 * @param {{ limit?: number }} [opts] keep only the best `limit` matches
 */
export function rank(query, items, opts = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  const out = [];
  if (!q) {
    items.forEach((item, index) => out.push({ item, score: 0, ranges: [], idRanges: [], index }));
  } else {
    const words = q.split(/\s+/);
    items.forEach((item, index) => {
      const s = scoreItem(words, q, item);
      if (s) out.push({ item, index, ...s });
    });
  }
  out.sort((a, b) => b.score - a.score || (b.item.recent || 0) - (a.item.recent || 0) || a.index - b.index);
  const cut = opts.limit > 0 ? out.slice(0, opts.limit) : out;
  return cut.map(({ item, score, ranges, idRanges }) => ({ item, score, ranges, idRanges }));
}

/** Split `text` into [{ text, hit }] pieces along `ranges`, for highlighting without innerHTML. */
export function splitByRanges(text, ranges) {
  const out = [];
  let at = 0;
  for (const [s, e] of ranges || []) {
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
