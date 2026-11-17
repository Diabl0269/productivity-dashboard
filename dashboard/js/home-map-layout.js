// home-map-layout.js — where every box of the Home map goes (PRO39). Pure: no DOM, so it is tested in node.
//
// The map always lays itself out for the size of the view, at every level, from the config's order. The `box`
// coordinates a config may carry are not used: they come from an older flat drawing, parts never have them,
// and boxes drawn for one size cannot hold labels that are laid out again at each zoom level.
//
//   zoomFor(config, boxId|null)           -> the box whose children the map shows for that selection (null = system)
//   layoutLevel(config, zoomId, W, H, { rest }) -> { zoom, kind, boxes: [{ id, box, rect, showWhat, body, minis, more }] }
//      kind 'system': the groups, each with its areas as small tiles ("minis")
//      kind 'group':  a group's areas, large, each with its parts as minis
//      kind 'area':   an area's parts, large (leaves: their body lists open epics)
//   nearestBox(boxes, fromId, dir)        -> id of the nearest box in that direction ('left'|'right'|'up'|'down')
//   rectsFor(layout)                      -> Map(id -> rect) for main boxes and minis (cables, zoom anchors)

export const PAD = 8; // room for the focus ring at the edges
export const GAP = 14; // between main boxes
const MINI_GAP = 6;
const HEAD = 62; // name row + stats row
const WHAT = 20; // the one-line `what`
const INSET = 12;
export const LINE = 21; // one open-epic line

const kidsOf = box => box?.areas || box?.parts || [];

/** Find a box and its parent chain: [group, area?, part?]. */
export function chainOf(config, boxId) {
  for (const g of config?.groups || []) {
    if (g.id === boxId) return [g];
    for (const a of g.areas || []) {
      if (a.id === boxId) return [g, a];
      for (const p of a.parts || []) if (p.id === boxId) return [g, a, p];
    }
  }
  return [];
}

export function zoomFor(config, boxId) {
  const chain = chainOf(config, boxId);
  if (!chain.length) return null;
  const box = chain[chain.length - 1];
  if (kidsOf(box).length && chain.length < 3) return box.id;
  return chain.length > 1 ? chain[chain.length - 2].id : null;
}

/** Ordered binary treemap: keeps the config's order, cuts along the longer side at the weight's middle. */
export function treemap(weights, rect, gap = GAP) {
  const out = new Array(weights.length);
  const place = (from, to, r) => {
    if (to - from === 1) { out[from] = r; return; }
    const total = weights.slice(from, to).reduce((a, b) => a + b, 0);
    let acc = 0;
    let cut = from + 1;
    let best = Infinity;
    for (let i = from; i < to - 1; i++) {
      acc += weights[i];
      const d = Math.abs(acc - total / 2);
      if (d < best) { best = d; cut = i + 1; }
    }
    const share = weights.slice(from, cut).reduce((a, b) => a + b, 0) / total;
    if (r.w >= r.h) {
      const w1 = Math.round((r.w - gap) * share);
      place(from, cut, { x: r.x, y: r.y, w: w1, h: r.h });
      place(cut, to, { x: r.x + w1 + gap, y: r.y, w: r.w - w1 - gap, h: r.h });
    } else {
      const h1 = Math.round((r.h - gap) * share);
      place(from, cut, { x: r.x, y: r.y, w: r.w, h: h1 });
      place(cut, to, { x: r.x, y: r.y + h1 + gap, w: r.w, h: r.h - h1 - gap });
    }
  };
  if (weights.length) place(0, weights.length, rect);
  return out;
}

/**
 * A tidy grid of n equal tiles in rect, filled row by row from the top left. Picks the column count whose tiles
 * come closest to `aspect` (width / height) without going under minW x minH. When n tiles cannot fit, it shows
 * as many as fit, the last place being kept for a "+k more" tile.
 * @returns {{ rects: object[], more: number, moreRect: object|null }}
 */
export function grid(n, rect, { gap = MINI_GAP, minW = 92, minH = 26, maxH = Infinity, aspect = 3 } = {}) {
  if (n <= 0 || rect.w < minW || rect.h < minH) return { rects: [], more: Math.max(0, n), moreRect: null };
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const tw = (rect.w - (cols - 1) * gap) / cols;
    const th = Math.min(maxH, (rect.h - (rows - 1) * gap) / rows);
    if (tw < minW || th < minH) continue;
    const score = Math.abs(Math.log((tw / th) / aspect));
    if (!best || score < best.score - 1e-9) best = { cols, rows, tw, th, score };
  }
  let shown = n;
  let more = 0;
  if (!best) {
    const cols = Math.max(1, Math.floor((rect.w + gap) / (minW + gap)));
    const rows = Math.max(1, Math.floor((rect.h + gap) / (minH + gap)));
    const tw = (rect.w - (cols - 1) * gap) / cols;
    const th = Math.min(maxH, (rect.h - (rows - 1) * gap) / rows);
    best = { cols, rows, tw, th };
    shown = Math.max(0, cols * rows - 1);
    more = n - shown;
  }
  const at = i => ({
    x: Math.round(rect.x + (i % best.cols) * (best.tw + gap)),
    y: Math.round(rect.y + Math.floor(i / best.cols) * (best.th + gap)),
    w: Math.floor(best.tw),
    h: Math.floor(best.th),
  });
  const rects = [];
  for (let i = 0; i < shown; i++) rects.push(at(i));
  return { rects, more, moreRect: more ? at(shown) : null };
}

const KIND = ['system', 'group', 'area'];

/** Main boxes of a level: a treemap of groups (weighted by their areas) at the top, a grid below. */
function mainRects(kind, boxes, stage) {
  if (kind === 'system') return treemap(boxes.map(b => Math.max(1, kidsOf(b).length)), stage);
  const leaf = kind === 'area';
  const g = grid(boxes.length, stage, { gap: GAP, minW: 150, minH: leaf ? 96 : 120, aspect: leaf ? 1.7 : 1.25 });
  if (!g.more) return g.rects;
  // Too many to fit at the minimum size: fall back to the treemap, which always fits every box.
  return treemap(boxes.map(() => 1), stage);
}

export function layoutLevel(config, zoomId, W, H, { rest = null } = {}) {
  const chain = zoomId ? chainOf(config, zoomId) : [];
  const zoom = chain.length ? chain[chain.length - 1] : null;
  const kind = KIND[chain.length] || 'area';
  // At the area level, `rest` ({ id, name, what }) adds one more leaf for the area's own epics (on none of its parts).
  const list = [...(zoom ? kidsOf(zoom) : (config?.groups || [])), ...(kind === 'area' && rest ? [{ ...rest, rest: true }] : [])];
  const stage = { x: PAD, y: PAD, w: Math.max(0, W - 2 * PAD), h: Math.max(0, H - 2 * PAD) };
  const rects = mainRects(kind, list, stage);
  const boxes = list.map((box, i) => {
    const rect = rects[i];
    const showWhat = !!box.what && rect.w >= 200 && rect.h >= HEAD + WHAT + (kind === 'area' ? 24 : 40);
    const top = HEAD + (showWhat ? WHAT : 0);
    const body = { x: rect.x + INSET, y: rect.y + top, w: Math.max(0, rect.w - 2 * INSET), h: Math.max(0, rect.h - top - INSET) };
    let minis = [];
    let more = 0;
    let moreRect = null;
    const kids = kind === 'area' ? [] : kidsOf(box);
    if (kids.length) {
      const g = grid(kids.length, body, kind === 'system'
        ? { minW: 96, minH: 30, maxH: 52, aspect: 2.6 }
        : { minW: 92, minH: 26, maxH: 34, aspect: 4 });
      minis = g.rects.map((r, j) => ({ id: kids[j].id, box: kids[j], rect: r }));
      more = g.more;
      moreRect = g.moreRect;
    }
    // Where the box lists its open epics: a leaf's whole body, else the room left under its minis (two lines or more).
    let lines = kids.length ? null : body;
    if (kids.length) {
      const used = Math.max(...[...minis.map(m => m.rect), moreRect].filter(Boolean).map(r => r.y + r.h), body.y);
      const free = { x: body.x, y: used + INSET, w: body.w, h: body.y + body.h - used - INSET };
      if (free.h >= 2 * LINE) lines = free;
    }
    return { id: box.id, box, rect, showWhat, body, minis, more, moreRect, lines, kids: kidsOf(box).length };
  });
  return { zoom: zoom ? zoom.id : null, kind, W, H, boxes };
}

export function rectsFor(layout) {
  const out = new Map();
  for (const b of layout?.boxes || []) {
    out.set(b.id, b.rect);
    for (const m of b.minis) out.set(m.id, m.rect);
  }
  return out;
}

const centre = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The nearest box whose centre lies in `dir` from the box `fromId`; boxes in line with it count first. */
export function nearestBox(boxes, fromId, dir) {
  const from = boxes.find(b => b.id === fromId);
  if (!from) return boxes[0]?.id ?? null;
  const a = from.rect;
  const ca = centre(a);
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = null;
  for (const b of boxes) {
    if (b.id === fromId) continue;
    const r = b.rect;
    const cb = centre(r);
    const primary = sign * (horiz ? cb.x - ca.x : cb.y - ca.y);
    if (primary <= 1) continue;
    const overlap = horiz
      ? Math.min(a.y + a.h, r.y + r.h) - Math.max(a.y, r.y)
      : Math.min(a.x + a.w, r.x + r.w) - Math.max(a.x, r.x);
    const secondary = overlap > 0 ? 0 : Math.abs(horiz ? cb.y - ca.y : cb.x - ca.x);
    const score = primary + 3 * secondary;
    if (!best || score < best.score) best = { id: b.id, score };
  }
  return best ? best.id : null;
}
