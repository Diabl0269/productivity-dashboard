// home-placeholders.js — quiet stand-ins for every Home zone until its feature lands. Each one is
// registered with `placeholder: true`, so the real registration with the same id replaces it no matter
// which import runs first; the feature's ticket only adds its own import to home-registry.js.

import {
  registerHomeView, registerInspectorTab, registerTopBarItem, registerStripItem,
} from './home-state.js';
import { boxOfWhere } from '../../shared/home-config.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** "Kitchen › Oven" for the current selection, or ''. */
function placeName(ctx) {
  const config = ctx.config();
  const w = ctx.selection();
  if (!config || !w.group) return '';
  const names = [];
  for (const where of [{ group: w.group }, w.area && { group: w.group, area: w.area }, w.part && w]) {
    const box = where && boxOfWhere(config, where);
    if (box) names.push(box.name);
  }
  return names.join(' › ');
}

// ===== centre views =====

const VIEWS = [
  { id: 'overview', label: 'Overview', key: 1, ticket: 'PRO129', what: 'What needs you, what is running, what is next and what just shipped, on one calm screen.' },
  { id: 'map', label: 'Map', key: 2, ticket: 'PRO39', what: 'The project drawn as boxes you can zoom into, from groups down to an area\'s parts.' },
  { id: 'lanes', label: 'Lanes', key: 3, ticket: 'PRO118', what: 'For you, Ready, the Auto queue and the lanes, narrowed to the selected place.' },
  { id: 'tickets', label: 'Tickets', key: 4, ticket: 'PRO119', what: 'Every ticket of every place in one table.' },
  { id: 'how-it-runs', label: 'How it runs', key: 5, ticket: 'PRO122', what: 'The life of a note and a ticket as a flow, and every automation with its last run.' },
];

for (const v of VIEWS) {
  registerHomeView({
    id: v.id,
    label: v.label,
    key: v.key,
    placeholder: true,
    render(root, ctx) {
      const card = el('section', 'hm-card hm-placeholder');
      card.appendChild(el('h2', 'hm-card-title', v.label));
      card.appendChild(el('p', 'hm-card-text', v.what));
      const coming = el('p', 'hm-card-note');
      coming.append('This view arrives with ', ctx.idButton(v.ticket), '.');
      card.appendChild(coming);
      const where = el('p', 'hm-card-note hm-placeholder-where');
      const paint = () => {
        const name = placeName(ctx);
        where.textContent = name ? `Selected place: ${name}` : 'No place selected: showing everything.';
      };
      paint();
      ctx.subscribe(e => { if (e.type === 'selection') paint(); });
      card.appendChild(where);
      root.appendChild(card);
    },
  });
}

// ===== inspector tabs =====

function detailRow(dl, term, values) {
  if (!values || (Array.isArray(values) && !values.length)) return;
  dl.append(el('dt', '', term), el('dd', '', Array.isArray(values) ? values.join(', ') : values));
}

function placeButton(ctx, box, cls = 'hm-place') {
  const b = el('button', cls, box.name);
  b.type = 'button';
  b.dataset.hmKey = `place-${box.id}`;
  b.addEventListener('click', () => ctx.setSelection(box.id));
  return b;
}

/** "How it works": the selected place's details and the places inside it (a small outline to pick from). */
function renderHowItWorks(root, ctx) {
  const config = ctx.config();
  if (!config) {
    root.appendChild(el('p', 'hm-muted', ctx.home() ? 'This project has no map yet.' : 'Loading the map...'));
    return;
  }
  const w = ctx.selection();
  const box = boxOfWhere(config, w);
  if (!box) {
    root.appendChild(el('h3', 'hm-insp-title', config.title || 'Everything'));
    root.appendChild(el('p', 'hm-muted', 'Pick a place to narrow the page to it.'));
  } else {
    root.appendChild(el('h3', 'hm-insp-title', box.name));
    const dl = el('dl', 'hm-details');
    detailRow(dl, 'Lanes', box.lanes);
    detailRow(dl, 'Projects', box.projects);
    detailRow(dl, 'Covers', box.covers);
    detailRow(dl, 'Matches', box.match);
    detailRow(dl, 'Page', box.page);
    if (dl.children.length) root.appendChild(dl);
    const up = w.part ? { group: w.group, area: w.area } : w.area ? { group: w.group } : null;
    const upBox = up && boxOfWhere(config, up);
    const nav = el('div', 'hm-place-nav');
    if (upBox) nav.appendChild(placeButton(ctx, upBox, 'hm-place hm-place-up')).prepend('↑ ');
    const all = el('button', 'hm-place hm-place-up', 'All places');
    all.type = 'button';
    all.dataset.hmKey = 'place-all';
    all.addEventListener('click', () => ctx.clearSelection());
    nav.appendChild(all);
    root.appendChild(nav);
  }
  const inside = !box ? config.groups : box.areas || box.parts || [];
  if (inside.length) {
    root.appendChild(el('h4', 'hm-insp-sub', !box ? 'Groups' : box.areas ? 'Areas' : 'Parts'));
    const list = el('ul', 'hm-place-list');
    for (const child of inside) list.appendChild(el('li')).appendChild(placeButton(ctx, child));
    root.appendChild(list);
  }
}

registerInspectorTab({ id: 'how', label: 'How it works', placeholder: true, render: renderHowItWorks });

for (const [id, label, what] of [
  ['work', 'Work', 'The epics and lanes of the selected place.'],
  ['tickets', 'Tickets', 'Every ticket of the selected place.'],
  ['notes', 'Notes', 'Review notes about the selected place.'],
]) {
  registerInspectorTab({
    id,
    label,
    placeholder: true,
    render(root, ctx) {
      const name = placeName(ctx);
      root.appendChild(el('h3', 'hm-insp-title', name || 'Everything'));
      root.appendChild(el('p', 'hm-muted', `${what} Not built yet.`));
    },
  });
}

// ===== top bar slots =====

for (const [slot, text, title] of [
  ['search', 'Search', 'Search arrives with a later ticket'],
  ['palette', '⌘K', 'The command palette arrives with a later ticket'],
  ['note', 'Note', 'The note key arrives with a later ticket'],
  ['usage', 'Usage', 'The usage chip arrives with a later ticket'],
]) {
  registerTopBarItem({
    id: slot,
    slot,
    placeholder: true,
    render(root) {
      const chip = el('span', 'hm-slot-empty', text);
      chip.title = title;
      chip.setAttribute('aria-hidden', 'true');
      root.appendChild(chip);
    },
  });
}

// ===== lower strip =====

for (const [id, label, ticket] of [['running', 'Running now', 'PRO117'], ['for-you', 'For you', 'PRO118']]) {
  registerStripItem({
    id,
    placeholder: true,
    render(root) {
      root.append(el('span', 'hm-strip-label', label), el('span', 'hm-strip-count hm-muted', '—'));
      const note = el('span', 'hm-strip-note', `arrives with ${ticket}`);
      root.appendChild(note);
    },
  });
}
