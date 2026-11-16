// home-palette-sources.js — what the palette lists (no palette DOM): places, tickets, views and
// inspector tabs, commands (registered ones plus the built-ins), and the recents of a project.
// An item is { key, group, title, id?, hint, keywords?, run(mods), recent? }; `key` is stable (recents remember it).

import {
  homeViews, setView, inspectorTabList, hasSelection, clearSelection, setProject, getProject, homeCommands,
} from './home-state.js';
import { boxPath } from '../../shared/home-areas.js';
import { GO_KEYS } from '../../shared/home-keymap.js';

export const GROUPS = ['Places', 'Tickets', 'Views', 'Commands'];
const RECENT_MAX = 8;
const LEVEL = { group: 'group', area: 'area', part: 'part' };
const ticketCache = new WeakMap(); // doc -> items; a new doc object (a refresh) starts empty

/** Every group, area and part of the map, with its path as the hint. */
export function placeItems(ctx) {
  const config = ctx.config();
  const out = [];
  for (const g of config?.groups || []) {
    for (const box of [g, ...g.areas.flatMap(a => [a, ...a.parts])]) {
      const path = boxPath(config, box.id);
      const names = path.map(p => p.name);
      out.push({
        key: `place:${box.id}`, group: 'Places', title: box.name,
        hint: names.length > 1 ? names.join(' › ') : LEVEL[path[0]?.level] || 'place',
        keywords: `${names.join(' ')} ${box.id}`, // the id is searchable but not shown
        run: (mods) => { ctx.setSelection(box.id); if (mods?.meta) setView('map'); },
      });
    }
  }
  return out;
}

/** Every ticket (epics too), with its section and type as the hint. Built once per task refresh. */
export function ticketItems(ctx) {
  const doc = ctx.doc();
  const sections = ctx.state()?.sections || [];
  const hit = ticketCache.get(doc);
  if (hit) return hit;
  const names = new Map(sections.map(s => [s.id, s.name || s.id]));
  const items = [];
  for (const s of doc.sections || []) {
    for (const t of s.tasks || []) {
      items.push({
        key: `ticket:${t.id}`, group: 'Tickets', title: t.title || t.id, id: t.id,
        hint: `${names.get(s.id) || s.id}${t.type ? ` · ${t.type}` : ''}`,
        run: () => ctx.openTicket(t.id),
      });
    }
  }
  ticketCache.set(doc, items);
  return items;
}

/** Click an inspector tab button (opening the inspector first when it is collapsed): its module stays untouched. */
function showInspectorTab(id) {
  const body = document.querySelector('.hm-body');
  if (body?.dataset.inspector === 'closed') document.querySelector('[data-hm-key="insp-toggle"]')?.click();
  document.querySelector(`[data-hm-key="insp-${CSS.escape(id)}"]`)?.click();
}

export function viewItems() {
  const out = homeViews().map((v) => {
    const go = GO_KEYS.find(g => g.view === v.id);
    return {
      key: `view:${v.id}`, group: 'Views', title: v.label, hint: `view · ${v.key}${go ? ` or g ${go.letter}` : ''}`,
      keywords: 'view go', run: () => setView(v.id),
    };
  });
  for (const t of inspectorTabList()) {
    out.push({
      key: `insp:${t.id}`, group: 'Views', title: t.label, hint: 'inspector tab', keywords: 'inspector tab',
      run: () => showInspectorTab(t.id),
    });
  }
  return out;
}

async function copyLink(ctx) {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    ctx.toast('Link to this view copied');
  } catch {
    ctx.toast('Could not copy; the address bar holds the link');
  }
}

/** The built-in commands (names and what they do are in docs/home-page.md). */
export function builtinCommands(ctx, { openHelp }) {
  const list = [
    { id: 'note', title: 'Add a note', hint: 'opens the note box', keywords: 'new write', run: (c) => document.dispatchEvent(new CustomEvent('hm:note', { detail: { where: c.selection() } })) },
    { id: 'clear-selection', title: 'Clear the selected place', hint: 'Esc', keywords: 'deselect everything', when: () => hasSelection(), run: (c) => c.clearSelection() },
    { id: 'copy-link', title: 'Copy link to this view', hint: 'the address of this view and place', keywords: 'url share', run: (c) => copyLink(c) },
    { id: 'help', title: 'Open keyboard help', hint: '?', keywords: 'keys shortcuts', run: () => openHelp() },
  ];
  if (document.getElementById('themeToggle')) {
    list.push({ id: 'theme', title: 'Toggle theme', hint: 'light, dark, system', keywords: 'dark light mode', run: () => document.getElementById('themeToggle')?.click() });
  }
  const projects = new Map((ctx.state()?.meta?.projects || []).map(p => [p.id, p.name || p.id]));
  for (const id of ctx.home()?.projects || []) if (!projects.has(id)) projects.set(id, id);
  for (const [id, name] of projects) {
    if (id === getProject()) continue;
    list.push({ id: `project-${id}`, title: `Switch project to ${name}`, hint: 'project', keywords: 'project change', run: () => setProject(id) });
  }
  return list;
}

/** Registered and built-in commands that apply now, as palette items. */
export function commandItems(ctx, opts) {
  const all = [...homeCommands(), ...builtinCommands(ctx, opts)];
  const out = [];
  for (const c of all) {
    let ok = true;
    try { ok = !c.when || c.when(ctx) !== false; } catch { ok = false; }
    if (!ok) continue;
    out.push({
      key: `cmd:${c.id}`, group: 'Commands', title: c.title, hint: c.hint || (c.keys?.length ? c.keys.join(' / ') : ''),
      keywords: c.keywords, run: () => c.run(ctx),
    });
  }
  return out;
}

// ===== recents (per project; storage may be off) =====

const recentKey = () => `home.palette.recents.${getProject() || '-'}`;

export function loadRecents() {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey()) || '[]');
    return Array.isArray(v) ? v.filter(k => typeof k === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

export function rememberRecent(key) {
  try {
    const list = [key, ...loadRecents().filter(k => k !== key)].slice(0, RECENT_MAX);
    localStorage.setItem(recentKey(), JSON.stringify(list));
  } catch { /* storage off: no recents, everything else works */ }
}

/** Give each item `recent` (bigger = newer) from the remembered keys. */
export function markRecents(items, recents) {
  const at = new Map(recents.map((k, i) => [k, recents.length - i]));
  for (const it of items) it.recent = at.get(it.key) || 0;
  return items;
}
