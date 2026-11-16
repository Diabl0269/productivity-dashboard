// home-keymap.js — the one table of every key on the Home page (pure, no DOM).
// The `?` sheet, the keys section of docs/home-page.md (scripts/home-keys-doc.js) and the clash test
// are all drawn from keyTable(), so none of them can drift from each other.
//
// A chord is text: "k", "?", "Esc", "Mod+K" (Mod = Cmd on a Mac, Ctrl elsewhere), "Shift+Tab",
// or two keys in a row written with a space: "g o". Keys that mean something only inside the open
// palette have scope 'palette'; the rest are scope 'page'. Two entries must not share a chord in a scope.

/** `g` then a letter jumps to a view. */
export const GO_KEYS = [
  { letter: 'o', view: 'overview', label: 'Overview' },
  { letter: 'm', view: 'map', label: 'Map' },
  { letter: 'l', view: 'lanes', label: 'Lanes' },
  { letter: 't', view: 'tickets', label: 'Tickets' },
  { letter: 'r', view: 'how-it-runs', label: 'How it runs' },
];

export const KEY_GROUPS = ['Find', 'Views', 'Places', 'Close', 'Help', 'In the palette', 'Dashboard'];

/** Keys that belong to the page itself (views and registered commands add theirs in keyTable). */
export const BUILTIN_KEYS = [
  { id: 'palette', keys: ['Mod+K'], label: 'Open the palette: places, tickets, views and commands', group: 'Find', scope: 'page' },
  { id: 'palette-slash', keys: ['/'], label: 'Open the palette (a view with a search box of its own keeps this key)', group: 'Find', scope: 'page' },
  { id: 'note', keys: ['n'], label: 'Write a note with no ticket (handled by the Note button)', group: 'Find', scope: 'page' },
  { id: 'prev-place', keys: ['['], label: 'Select the previous place on the same level', group: 'Places', scope: 'page' },
  { id: 'next-place', keys: [']'], label: 'Select the next place on the same level', group: 'Places', scope: 'page' },
  { id: 'up-place', keys: ['u'], label: 'Select the place one level up', group: 'Places', scope: 'page' },
  { id: 'escape', keys: ['Esc'], label: 'Close the topmost thing; with nothing open, clear the selected place', group: 'Close', scope: 'page' },
  { id: 'help', keys: ['?'], label: 'Show this sheet of keys', group: 'Help', scope: 'page' },
  { id: 'zones', keys: ['Tab'], label: 'Move to the next zone (a list keeps one Tab stop; arrows move inside it)', group: 'Help', scope: 'page' },
  { id: 'tabs', keys: ['Mod+1-9'], label: 'Switch dashboard tab', group: 'Dashboard', scope: 'page' },
  { id: 'pal-move', keys: ['↑', '↓'], label: 'Move through the results', group: 'In the palette', scope: 'palette' },
  { id: 'pal-group', keys: ['Tab', 'Shift+Tab'], label: 'Jump to the next or previous group', group: 'In the palette', scope: 'palette' },
  { id: 'pal-enter', keys: ['Enter'], label: 'Choose: select a place, open a ticket, go to a view, run a command', group: 'In the palette', scope: 'palette' },
  { id: 'pal-map', keys: ['Mod+Enter'], label: 'On a place: select it and open the Map view', group: 'In the palette', scope: 'palette' },
  { id: 'pal-close', keys: ['Esc'], label: 'Close the palette', group: 'In the palette', scope: 'palette' },
];

const SPECIAL = { Escape: 'Esc', ' ': 'Space' };

/** The chord text for a keydown event (or null for a lone modifier key). Pure: reads plain fields. */
export function chordFromEvent(e) {
  const k = e.key;
  if (!k || k === 'Shift' || k === 'Meta' || k === 'Control' || k === 'Alt') return null;
  let key = SPECIAL[k] || k;
  const mod = !!(e.metaKey || e.ctrlKey);
  if (mod && key.length === 1) key = key.toUpperCase();
  const parts = [];
  if (mod) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  // Shift is part of the character for letters and symbols ("?", "N"); it only counts with a modifier or a named key.
  if (e.shiftKey && (key.length > 1 || mod)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const MAC = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↵' };
const OTHER = { Mod: 'Ctrl' };

/** A chord as shown to people: "⌘K" on a Mac, "Ctrl+K" elsewhere; "g o" stays "g o". */
export function formatChord(chord, mac) {
  return String(chord).split(' ').map((step) => {
    const parts = step.split('+');
    const named = parts.map(p => (mac ? MAC[p] : OTHER[p]) || p);
    return mac ? named.join('') : named.join('+');
  }).join(' ');
}

/** Every key of the page as { id, keys[], label, group, scope }: built-ins, one per view, `g` letters, then commands. */
export function keyTable({ views = [], commands = [] } = {}) {
  const rows = [...BUILTIN_KEYS];
  for (const v of views) {
    rows.push({ id: `view-${v.id}`, keys: [String(v.key)], label: `Go to ${v.label}`, group: 'Views', scope: 'page' });
  }
  for (const g of GO_KEYS) {
    rows.push({ id: `go-${g.view}`, keys: [`g ${g.letter}`], label: `Go to ${g.label}`, group: 'Views', scope: 'page' });
  }
  for (const c of commands) {
    const keys = [].concat(c.keys || []);
    if (keys.length) rows.push({ id: `cmd-${c.id}`, keys, label: c.title, group: c.group || 'Commands', scope: 'page' });
  }
  return rows;
}

/** Chords used by more than one entry of the same scope: [{ chord, scope, ids }]. */
export function findKeyClashes(rows) {
  const seen = new Map();
  for (const r of rows) {
    for (const chord of r.keys) {
      const key = `${r.scope}\u0000${chord}`;
      if (!seen.has(key)) seen.set(key, { chord, scope: r.scope, ids: [] });
      seen.get(key).ids.push(r.id);
    }
  }
  return [...seen.values()].filter(x => x.ids.length > 1);
}

/** A `g` + letter sequence is also clashing with a single-key `g` binding; true when any entry binds plain "g". */
export function bindsPlainG(rows) {
  return rows.some(r => r.scope === 'page' && r.keys.includes('g'));
}

/** Rows grouped for display: [{ group, rows }] in KEY_GROUPS order, then any other group by name. */
export function groupKeyRows(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.group)) by.set(r.group, []);
    by.get(r.group).push(r);
  }
  const names = [...by.keys()].sort((a, b) => {
    const ia = KEY_GROUPS.indexOf(a);
    const ib = KEY_GROUPS.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return names.map(group => ({ group, rows: by.get(group) }));
}

/** The markdown table of docs/home-page.md: the built-in and view keys (commands from other features add their own lines). */
export function keysMarkdown(rows) {
  const lines = ['| Keys | What it does |', '| --- | --- |'];
  for (const { group, rows: list } of groupKeyRows(rows)) {
    lines.push(`| **${group}** | |`);
    for (const r of list) {
      const keys = r.keys.map(k => `\`${formatChord(k, true)}\`${/Mod/.test(k) ? ` (\`${formatChord(k, false)}\`)` : ''}`).join(' ');
      lines.push(`| ${keys} | ${r.label} |`);
    }
  }
  return lines.join('\n');
}
