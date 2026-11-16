// home-tickets-row.js — one ticket row of the Home Tickets view and its compact twin for the inspector (PRO119).
// Rows are built once and refreshed in place: a cell is touched only when its text changed, and the id and
// epic buttons are never rebuilt for the same ticket, so a data poll never costs a focus or a hover.
// Look: the Plan page's `rp-chip` state chips and the same id button (ctx.idButton); colours are base.css tokens.

import { STATES } from '../../shared/home-ticket-rows.js';

export const ROW_H = 34;

const CHIP = {
  running: 'rp-chip-running', 'needs you': 'rp-chip-pick', 'in review': 'rp-chip-review', ready: 'rp-chip-ready',
  waiting: 'rp-chip-partial', later: 'rp-chip-later', done: 'rp-chip-later ht-chip-done',
};
export const stateChipClass = state => `rp-chip ht-chip ${CHIP[state] || 'rp-chip-later'}`;

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

/** "today", "3 d", "2 w", "5 mo" for a YYYY-MM-DD date or an ISO time; '' when unknown. */
export function relAge(when, now = Date.now()) {
  const ms = Date.parse(when);
  if (!Number.isFinite(ms)) return '';
  const days = Math.floor((now - ms) / 86400e3);
  if (days <= 0) return 'today';
  if (days < 14) return `${days} d`;
  if (days < 70) return `${Math.round(days / 7)} w`;
  return `${Math.round(days / 30)} mo`;
}

export const prLabel = (url) => {
  const n = /\/pull\/(\d+)/.exec(url);
  return n ? `PR #${n[1]}` : 'PR';
};

/** The box id a row's place is (the deepest one), for "e" and the place filter. */
export const placeBoxId = row => row.box.part || row.box.area || row.box.group || null;

const sigOf = r => [r.state, r.stateWhy, r.title, r.placeName, r.epicId, r.epicTitle, r.lane, r.model, r.updated, r.notesOpen, r.checksOpen, r.prUrl || '', r.type].join('\u0001');

/** The table row skeleton for ticket `id`. */
export function buildRow(id, ctx) {
  const li = el('div', 'ht-row');
  li.setAttribute('role', 'row');
  li.id = `ht-r-${id}`;
  const idBtn = ctx.idButton(id, 'rp-link rp-chip-id ht-idbtn');
  idBtn.tabIndex = -1;
  const p = {
    id: el('div', 'ht-c ht-id'), title: el('div', 'ht-c ht-title'), state: el('div', 'ht-c ht-state'),
    place: el('div', 'ht-c ht-place'), epic: el('div', 'ht-c ht-epic'), lane: el('div', 'ht-c ht-lane'),
    model: el('div', 'ht-c ht-model'), upd: el('div', 'ht-c ht-upd'), marks: el('div', 'ht-c ht-marks'),
    chip: el('span', 'rp-chip'), epicId: null, prUrl: null,
  };
  p.id.appendChild(idBtn);
  p.state.appendChild(p.chip);
  const epicTitle = el('span', 'ht-epictitle');
  p.epic.appendChild(epicTitle);
  p.epicTitle = epicTitle;
  p.notes = el('span', 'ht-mark ht-mark-notes');
  p.checks = el('span', 'ht-mark ht-mark-checks');
  p.pr = el('span', 'ht-mark ht-mark-pr');
  p.marks.append(p.notes, p.checks, p.pr);
  for (const c of [p.id, p.title, p.state, p.place, p.epic, p.lane, p.model, p.upd, p.marks]) c.setAttribute('role', 'gridcell');
  li.append(p.id, p.title, p.state, p.place, p.epic, p.lane, p.model, p.upd, p.marks);
  li._p = p;
  li._sig = '';
  return li;
}

/** Bring a row up to date with `row`; does nothing when nothing changed. */
export function fillRow(li, row, ctx) {
  const sig = sigOf(row);
  if (li._sig === sig) return;
  li._sig = sig;
  const p = li._p;
  li.dataset.state = row.state;
  li.classList.toggle('ht-is-epic', row.type === 'epic');
  setText(p.title, row.title);
  p.title.title = row.title;
  const cls = stateChipClass(row.state);
  if (p.chip.className !== cls) p.chip.className = cls;
  setText(p.chip, row.state);
  p.chip.title = row.stateWhy;
  setText(p.place, row.placeName.split(' › ').pop()); // the leaf; the whole path is on hover
  p.place.title = row.placeName;
  setText(p.lane, row.lane);
  setText(p.model, row.model);
  setText(p.upd, relAge(row.updated));
  p.upd.title = row.updated ? `Updated ${row.updated}` : '';
  if (p.epicId !== row.epicId) {
    p.epicId = row.epicId;
    p.epic.textContent = '';
    if (row.epicId && row.epicId !== row.id) {
      const b = ctx.idButton(row.epicId, 'rp-link rp-chip-id ht-idbtn');
      b.tabIndex = -1;
      p.epic.append(b);
    }
    p.epic.appendChild(p.epicTitle);
  }
  setText(p.epicTitle, row.epicId && row.epicId !== row.id ? row.epicTitle : '');
  p.epic.title = row.epicTitle;
  setText(p.notes, row.notesOpen ? `✎ ${row.notesOpen}` : '');
  p.notes.title = row.notesOpen ? `${row.notesOpen} open review ${row.notesOpen === 1 ? 'note' : 'notes'}` : '';
  setText(p.checks, row.checksOpen ? `☐ ${row.checksOpen}` : '');
  p.checks.title = row.checksOpen ? `${row.checksOpen} ${row.checksOpen === 1 ? 'check' : 'checks'} to tick` : '';
  if (p.prUrl !== (row.prUrl || '')) {
    p.prUrl = row.prUrl || '';
    p.pr.textContent = '';
    if (p.prUrl) {
      const a = el('a', 'rp-link ht-prlink', prLabel(p.prUrl));
      a.href = p.prUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.tabIndex = -1;
      a.setAttribute('aria-label', `Open ${prLabel(p.prUrl)} for ${row.id} in a new tab`);
      p.pr.appendChild(a);
    }
  }
  li.setAttribute('aria-label', `${row.id} ${row.title}, ${row.state}`);
}

/** A group header row: caret, name, count and the per-state counts. */
export function buildGroup(key) {
  const li = el('div', 'ht-row ht-group');
  li.setAttribute('role', 'row');
  li.id = `ht-g-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const caret = el('span', 'ht-caret');
  caret.setAttribute('aria-hidden', 'true');
  const name = el('span', 'ht-group-name');
  const count = el('span', 'ht-group-count');
  const states = el('span', 'ht-group-states');
  const cell = el('div', 'ht-gcell');
  cell.setAttribute('role', 'gridcell');
  cell.append(caret, name, count, states);
  li.appendChild(cell);
  li._p = { name, count, states };
  li._sig = '';
  return li;
}

export function fillGroup(li, item) {
  const sig = `${item.label}|${item.collapsed}|${item.count}|${STATES.map(s => item.counts[s]).join(',')}`;
  if (li._sig === sig) return;
  li._sig = sig;
  const p = li._p;
  li.setAttribute('aria-expanded', item.collapsed ? 'false' : 'true');
  li.dataset.collapsed = item.collapsed ? 'true' : 'false';
  setText(p.name, item.label);
  p.name.title = item.label;
  setText(p.count, String(item.count));
  p.states.textContent = '';
  for (const s of STATES) {
    if (!item.counts[s] || item.key === s) continue;
    const chip = el('span', 'ht-gstate');
    const dot = el('span', 'ht-dot');
    dot.dataset.state = s;
    chip.append(dot, `${item.counts[s]} ${s}`);
    p.states.appendChild(chip);
  }
  li.setAttribute('aria-label', `${item.label}, ${item.count} ${item.count === 1 ? 'ticket' : 'tickets'}, ${item.collapsed ? 'folded' : 'open'}`);
}

/** A compact row for the inspector: id, title, and the state as a dot with its reason on hover. */
export function buildCompact(row, ctx) {
  const li = el('li', 'ht-crow');
  const dot = el('span', 'ht-dot');
  dot.dataset.state = row.state;
  dot.title = `${row.state}: ${row.stateWhy}`;
  const id = ctx.idButton(row.id, 'rp-link rp-chip-id ht-idbtn');
  const title = el('span', 'ht-ctitle', row.title);
  title.title = row.title;
  li.append(dot, id, title);
  return li;
}
