/**
 * A queue kept in a markdown file (pure, no fs, no DOM): free text, then one `## title` section per item
 * with `- key: value` lines (any other line inside a section is kept as it is).
 *
 *   Notes for the baker (kept as they are)
 *
 *   ## Sourdough starter
 *   - status: idea
 *   - length: 5 min
 *
 * Every operation returns new text in which every byte it did not have to touch is identical:
 *   moveItem: reorders whole sections (the items shown swap places among the sections that are shown;
 *             hidden sections stay where they are),
 *   editItem: replaces the value of one `- key: value` line (adds the line for a new key; key "title" renames),
 *   dropItem: deletes the section, or with dropAs "skipped" sets `- status: skipped` in it.
 * An item is named by its title plus the count of earlier sections with the same title: "Sourdough starter#0".
 * Problems throw a QueueError whose message is plain words and whose `status` is the HTTP code to answer with.
 */

export class QueueError extends Error {
  constructor(status, message) { super(message); this.name = 'QueueError'; this.status = status; }
}

export const DEFAULT_HIDDEN = ['skipped', 'made'];
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;
const HEAD_RE = /^##[ \t]+(.*\S)[ \t]*\r?\n?$/;
const FIELD_RE = /^(-[ \t]+([A-Za-z0-9][A-Za-z0-9 _-]{0,39}):(?:[ \t]+|(?=\r?\n?$)))(.*?)([ \t]*)(\r?\n?)$/;
const FENCE_RE = /^[ \t]*(```|~~~)/;

const eolOf = line => (/\r\n$/.test(line) ? '\r\n' : '\n');
const withEol = line => (/\n$/.test(line) ? line : `${line}\n`);

/** Split into the preamble and the sections; preamble + every section's lines is always the original text. */
export function parseQueue(text) {
  const src = String(text);
  const lines = src.match(/[^\n]*\n|[^\n]+/g) || [];
  const sections = [];
  const preamble = [];
  let fence = null;
  for (const line of lines) {
    const f = FENCE_RE.exec(line);
    if (f) fence = fence === null ? f[1] : fence === f[1] ? null : fence;
    const head = fence === null && !f ? HEAD_RE.exec(line) : null;
    if (head) sections.push({ title: head[1], lines: [line] });
    else (sections.length ? sections[sections.length - 1].lines : preamble).push(line);
  }
  const seen = new Map();
  for (const s of sections) {
    const n = seen.get(s.title) || 0;
    seen.set(s.title, n + 1);
    s.id = `${s.title}#${n}`;
    s.fields = [];
    s.lines.forEach((line, i) => {
      const m = i ? FIELD_RE.exec(line) : null;
      if (m) s.fields.push({ key: m[2], value: m[3], line: i });
    });
  }
  return { preamble: preamble.join(''), sections, endsWithNewline: /\n$/.test(src) || !lines.length };
}

const isBlank = line => !/\S/.test(line);

/** After a reorder: a section that moved off the end gets the blank line that separates sections, and the one that moved to the end loses its own. */
function tidyGaps(parsed, sections) {
  const ends = x => x.lines.length > 1 && isBlank(x.lines[x.lines.length - 1]);
  const body = parsed.sections.slice(0, -1);
  // Only a file that separates its sections with blank lines (and whose last section has none) needs tidying.
  const gap = body.length && body.every(ends) && !ends(parsed.sections[parsed.sections.length - 1]);
  const sepEol = eolOf(parsed.sections[0]?.lines[0] || '\n');
  return sections.map((s, i) => {
    const lines = s.lines.slice();
    const endsBlank = lines.length > 1 && isBlank(lines[lines.length - 1]);
    if (i < sections.length - 1 && !endsBlank && gap) lines[lines.length - 1] = withEol(lines[lines.length - 1]), lines.push(sepEol);
    if (i === sections.length - 1 && gap) while (lines.length > 1 && isBlank(lines[lines.length - 1])) lines.pop();
    return { ...s, lines };
  });
}

function join(parsed, sections) {
  let out = parsed.preamble;
  sections.forEach((s, i) => {
    const raw = s.lines.join('');
    out += i < sections.length - 1 ? withEol(raw) : raw;
  });
  if (!parsed.endsWithNewline && sections.length) out = out.replace(/\r?\n$/, '');
  return out;
}

function statusOf(section) {
  const f = section.fields.find(x => x.key.toLowerCase() === 'status');
  return f ? f.value.trim().toLowerCase() : '';
}

/**
 * The items of a parsed queue: `all` in file order, `visible` (status not hidden) in file order, `hidden` count.
 * Each item: { id, title, index, hidden, fields: [{ key, value }] }.
 */
export function listItems(parsed, { hiddenStatuses = DEFAULT_HIDDEN } = {}) {
  const hide = new Set(hiddenStatuses.map(s => String(s).trim().toLowerCase()));
  const all = parsed.sections.map((s, index) => ({
    id: s.id, title: s.title, index, hidden: hide.has(statusOf(s)) && statusOf(s) !== '',
    fields: s.fields.map(f => ({ key: f.key, value: f.value })),
  }));
  const visible = all.filter(i => !i.hidden);
  return { all, visible, hidden: all.length - visible.length };
}

function find(parsed, id) {
  const s = parsed.sections.find(x => x.id === id);
  if (!s) throw new QueueError(404, 'That item is no longer in the file. The list was refreshed.');
  return s;
}

/** Move item `id` to position `to` (0 = first) among the visible items. Returns the new text. */
export function moveItem(text, id, to, opts = {}) {
  const parsed = parseQueue(text);
  find(parsed, id);
  const { all, visible } = listItems(parsed, opts);
  const from = visible.findIndex(i => i.id === id);
  if (from < 0) throw new QueueError(400, 'That item is hidden, so it cannot be moved.');
  if (!Number.isInteger(to)) throw new QueueError(400, '"to" should be the new position, a whole number.');
  const target = Math.max(0, Math.min(visible.length - 1, to));
  if (target === from) return text;
  const order = visible.map(i => i.id);
  order.splice(target, 0, order.splice(from, 1)[0]);
  const byId = new Map(parsed.sections.map(s => [s.id, s]));
  const slots = all.filter(i => !i.hidden).map(i => i.index);
  const sections = parsed.sections.slice();
  slots.forEach((slot, k) => { sections[slot] = byId.get(order[k]); });
  return join(parsed, tidyGaps(parsed, sections));
}

/** Replace one field's value (key "title" renames the item). Returns { text, id } (the id follows a new title). */
export function editItem(text, id, key, value) {
  if (typeof key !== 'string' || (key !== 'title' && !KEY_RE.test(key))) throw new QueueError(400, '"key" should be a field name: letters, digits, spaces, "-" or "_".');
  if (typeof value !== 'string') throw new QueueError(400, '"value" should be text.');
  if (/[\r\n]/.test(value)) throw new QueueError(400, 'A value must stay on one line.');
  const parsed = parseQueue(text);
  const s = find(parsed, id);
  const lines = s.lines.slice();
  const clean = value.trim();
  if (key === 'title') {
    if (!clean) throw new QueueError(400, 'The title cannot be empty.');
    lines[0] = `## ${clean}${/\r?\n$/.exec(lines[0])?.[0] || ''}`;
  } else {
    const f = s.fields.find(x => x.key === key);
    if (f) {
      const m = FIELD_RE.exec(lines[f.line]);
      const head = m[1].replace(/[ \t]+$/, '');
      lines[f.line] = `${head}${clean ? ` ${clean}` : ''}${m[5]}`;
    } else {
      const at = s.fields.length ? s.fields[s.fields.length - 1].line : 0;
      const eol = eolOf(lines[0]);
      const open = !/\n$/.test(lines[at]);
      if (open) lines[at] += eol;
      lines.splice(at + 1, 0, `- ${key}:${clean ? ` ${clean}` : ''}${open ? '' : eol}`);
    }
  }
  const idx = parsed.sections.indexOf(s);
  const sections = parsed.sections.map((x, i) => (i === idx ? { ...x, lines } : x));
  const next = join(parsed, sections);
  return { text: next, id: key === 'title' ? parseQueue(next).sections[idx].id : id };
}

/** Drop an item: delete its section, or with dropAs "skipped" mark it `- status: skipped`. Returns the new text. */
export function dropItem(text, id, { dropAs = null } = {}) {
  const parsed = parseQueue(text);
  const s = find(parsed, id);
  if (dropAs === 'skipped') return editItem(text, id, 'status', 'skipped').text;
  return join(parsed, parsed.sections.filter(x => x !== s));
}
