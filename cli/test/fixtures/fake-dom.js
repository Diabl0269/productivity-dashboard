// A tiny stand-in for the DOM helpers of the Metrics page (el/append/section/tile/table/card/empty),
// so view code can be rendered and read back as text in a plain node test. Synthetic only.
export function makeNode(tag, cls, text) {
  const n = { tag, cls: cls || '', text: text == null ? '' : String(text), children: [], attrs: {}, title: '', dataset: {}, listeners: {}, _cls: new Set() };
  n.classList = { toggle: (c, on) => { if (on) n._cls.add(c); else n._cls.delete(c); }, contains: (c) => n._cls.has(c) };
  Object.defineProperty(n, 'textContent', { get: () => n.text, set: (v) => { n.text = String(v); } });
  n.appendChild = (k) => { n.children.push(k); return k; };
  n.setAttribute = (k, v) => { n.attrs[k] = v; };
  n.addEventListener = (ev, fn) => { n.listeners[ev] = fn; };
  n.hasAttribute = (k) => k in n.attrs;
  return n;
}
export const textOf = (n) => (n == null ? '' : [n.text, ...(n.children || []).map(textOf)].join(' '));
export const find = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const k of n.children || []) find(k, pred, out); return out; };

export function makeHelpers() {
  const el = makeNode;
  const append = (p, ...kids) => { for (const k of kids) if (k) p.appendChild(k); return p; };
  const empty = (t) => el('p', 'mc-empty', t);
  const section = (id, title, blurb) => { const s = el('section', 'mc-section'); s.id = id; s.appendChild(el('h3', 'mc-section-title', title)); if (blurb) s.appendChild(el('p', 'mc-section-blurb', blurb)); return s; };
  const card = (title, sub, ...kids) => { const c = el('section', 'mc-card'); c.appendChild(el('h4', 'mc-card-title', title)); if (sub) c.appendChild(el('p', 'mc-card-sub', sub)); append(c, ...kids); return c; };
  const tile = (label, value, sub, delta, hint) => { const t = el('div', 'mc-tile'); t.title = hint || ''; append(t, el('div', 'mc-tile-label', label), el('div', 'mc-tile-value', value), el('div', 'mc-tile-sub', sub)); return t; };
  const table = (label, columns, rows) => {
    const t = el('div', 'mc-table'); t.attrs.label = label;
    t.appendChild(el('div', 'mc-thead', columns.map((c) => c.label).join(' | ')));
    t.columns = columns;
    for (const r of rows) { const tr = el('div', 'mc-tr'); for (const v of r) tr.appendChild(v && v.tag ? v : el('span', 'mc-td', v)); t.appendChild(tr); }
    return t;
  };
  const ticketLink = (id) => el('button', 'mc-link', id);
  return { el, append, empty, section, card, tile, table, ticketLink };
}
