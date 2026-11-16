// home-tickets-inspector.js — the inspector's "Tickets" tab (PRO119): the selected place's tickets (or every
// ticket when no place is chosen) as a compact list grouped by state, from the same rows as the Tickets view.
// A group shows its first few tickets and a "Show N more" button, so a place with hundreds stays calm.
// Done tickets are left out (the Tickets view has the switch for them).

import { registerInspectorTab } from './home-state.js';
import { boxOfWhere } from '../../shared/home-config.js';
import { STATES } from '../../shared/home-ticket-rows.js';
import { computeModel } from './home-tickets-data.js';
import { buildCompact, el } from './home-tickets-row.js';

const PER_GROUP = 12;
const SHOWN_STATES = STATES.filter(s => s !== 'done');
const fmt = n => n.toLocaleString('en-US');

const folded = new Set(); // state words folded shut
const opened = new Set(); // state words showing every ticket

function render(root, ctx) {
  const w = ctx.selection();
  const box = ctx.config() ? boxOfWhere(ctx.config(), w) : null;
  const name = box && (w.group || w.area || w.part) ? box.name : '';
  const model = computeModel(ctx, { text: '', states: [], types: [], group: 'state', sort: 'updated', dir: 'desc', showDone: false, lane: '', model: '', label: '' });
  root.appendChild(el('h3', 'hm-insp-title', name ? `${name}: tickets` : 'Tickets'));
  root.appendChild(el('p', 'hm-muted', `${fmt(model.shown.length)} open ${model.shown.length === 1 ? 'ticket' : 'tickets'}${name ? ' in this place' : ' in the project'}.`));
  if (!model.shown.length) {
    root.appendChild(el('p', 'hm-muted', name ? `Nothing open in ${name}.` : 'Nothing open.'));
    return;
  }
  const byState = new Map(model.groups.map(g => [g.key, g]));
  for (const state of SHOWN_STATES) {
    const g = byState.get(state);
    if (!g) continue;
    const shut = folded.has(state);
    const head = el('button', 'ht-ihead');
    head.type = 'button';
    head.dataset.hmKey = `ti-head-${state}`;
    head.setAttribute('aria-expanded', shut ? 'false' : 'true');
    const dot = el('span', 'ht-dot');
    dot.dataset.state = state;
    head.append(el('span', 'ht-caret'), dot, el('span', 'ht-ihead-name', state), el('span', 'ht-group-count', fmt(g.rows.length)));
    head.addEventListener('click', () => { folded.has(state) ? folded.delete(state) : folded.add(state); ctx.redraw(); });
    root.appendChild(head);
    if (shut) continue;
    const all = opened.has(state);
    const list = el('ul', 'ht-ilist');
    for (const row of all ? g.rows : g.rows.slice(0, PER_GROUP)) list.appendChild(buildCompact(row, ctx));
    root.appendChild(list);
    if (!all && g.rows.length > PER_GROUP) {
      const more = el('button', 'ht-linkbtn ht-imore', `Show ${fmt(g.rows.length - PER_GROUP)} more`);
      more.type = 'button';
      more.dataset.hmKey = `ti-more-${state}`;
      more.addEventListener('click', () => { opened.add(state); ctx.redraw(); });
      root.appendChild(more);
    }
  }
}

registerInspectorTab({ id: 'tickets', label: 'Tickets', render });
