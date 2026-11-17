// home-tickets-bar.js — the filter bar of the Home Tickets view (PRO119): a text box (`/` focuses it), state
// chips with live counts (toggles), type toggles, group-by menu, lane and model menus, and the "show done"
// switch, then one line in words saying what is shown. Built once; `paint` updates the counts and values in place.

import { STATES } from '../../shared/home-ticket-rows.js';
import { stateChipClass, el, setText } from './home-tickets-row.js';

const TYPE_LABELS = [['epic', 'Epics'], ['task', 'Tasks'], ['subtask', 'Subtasks']];
const GROUP_LABELS = [['none', 'Nothing'], ['place', 'Place'], ['epic', 'Epic'], ['state', 'State'], ['lane', 'Lane']];
const fmt = n => n.toLocaleString('en-US');

function select(label, className, options, onChange) {
  const wrap = el('label', `ht-field ${className}`);
  wrap.append(el('span', 'ht-field-label', label));
  const s = el('select', 'hm-select ht-select');
  s.dataset.hmKey = `sel-${className}`;
  for (const [value, text] of options) s.appendChild(new Option(text, value));
  s.addEventListener('change', () => onChange(s.value));
  wrap.appendChild(s);
  return { wrap, select: s };
}

function fillOptions(select, first, values) {
  const have = [...select.options].map(o => o.value).join('|');
  const want = ['', ...values].join('|');
  if (have === want) return;
  const keep = select.value;
  select.textContent = '';
  select.appendChild(new Option(first, ''));
  for (const v of values) select.appendChild(new Option(v, v));
  select.value = values.includes(keep) ? keep : '';
}

/**
 * @param {{ onChange(patch), onClearPlace(), onClearFilters(), onLeave() }} on
 */
export function createBar(on) {
  const root = el('div', 'ht-bar');
  const row1 = el('div', 'ht-bar-row');
  const search = el('input', 'ht-search');
  search.type = 'search';
  search.placeholder = 'Filter: id, title, place, epic, lane...  ( / )';
  search.setAttribute('aria-label', 'Filter tickets by text. Press slash to jump here.');
  search.dataset.hmKey = 'ht-search';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.addEventListener('input', () => on.onChange({ text: search.value }));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (search.value) { search.value = ''; on.onChange({ text: '' }); } else on.onLeave();
    } else if (e.key === 'ArrowDown') { e.preventDefault(); on.onLeave(); }
  });

  const types = el('div', 'ht-types');
  types.setAttribute('role', 'group');
  types.setAttribute('aria-label', 'Ticket types');
  const typeBtns = new Map();
  for (const [type, label] of TYPE_LABELS) {
    const b = el('button', 'ht-toggle', label);
    b.type = 'button';
    b.dataset.hmKey = `type-${type}`;
    b.addEventListener('click', () => on.onChange({ toggleType: type }));
    types.appendChild(b);
    typeBtns.set(type, b);
  }
  const group = select('Group by', 'ht-group-sel', GROUP_LABELS, value => on.onChange({ group: value }));
  const lane = select('Lane', 'ht-lane-sel', [['', 'All lanes']], value => on.onChange({ lane: value }));
  const model = select('Model', 'ht-model-sel', [['', 'All models']], value => on.onChange({ model: value }));
  const done = el('button', 'ht-switch');
  done.type = 'button';
  done.setAttribute('role', 'switch');
  done.dataset.hmKey = 'ht-done';
  done.append(el('span', 'ht-switch-track'), el('span', 'ht-switch-label', 'Show done'));
  done.querySelector('.ht-switch-track').appendChild(el('span', 'ht-switch-knob'));
  done.addEventListener('click', () => on.onChange({ toggleDone: true }));
  row1.append(search, types, group.wrap, lane.wrap, model.wrap, done);

  const row2 = el('div', 'ht-bar-row ht-states');
  row2.setAttribute('role', 'group');
  row2.setAttribute('aria-label', 'Filter by state');
  const chips = new Map();
  const mk = (state, label) => {
    const b = el('button', `ht-fchip ${state === 'all' ? 'rp-chip rp-chip-later' : stateChipClass(state)}`);
    b.type = 'button';
    b.dataset.hmKey = `state-${state}`;
    b.dataset.state = state;
    const name = el('span', 'ht-fchip-name', label);
    const count = el('span', 'ht-fchip-count', '0');
    b.append(name, count);
    b.addEventListener('click', () => on.onChange(state === 'all' ? { states: [] } : { toggleState: state }));
    row2.appendChild(b);
    chips.set(state, { b, count });
  };
  mk('all', 'All');
  for (const s of STATES) mk(s, s[0].toUpperCase() + s.slice(1));

  const line = el('div', 'ht-line');
  line.setAttribute('role', 'status');
  const lineText = el('span', 'ht-line-text');
  const lineBtn = el('button', 'ht-linkbtn');
  lineBtn.type = 'button';
  lineBtn.dataset.hmKey = 'ht-line-btn';
  const lineBtn2 = el('button', 'ht-linkbtn');
  lineBtn2.type = 'button';
  lineBtn2.dataset.hmKey = 'ht-line-btn2';
  line.append(lineText, lineBtn, lineBtn2);
  root.append(row1, row2, line);

  function paint(vs, model_, { placeName, filtersOn }) {
    if (search.value !== vs.text && document.activeElement !== search) search.value = vs.text;
    for (const [type, b] of typeBtns) b.setAttribute('aria-pressed', vs.types.includes(type) ? 'true' : 'false');
    if (group.select.value !== vs.group) group.select.value = vs.group;
    fillOptions(lane.select, 'All lanes', model_.lanes);
    fillOptions(model.select, 'All models', model_.models);
    if (lane.select.value !== vs.lane) lane.select.value = vs.lane;
    if (model.select.value !== vs.model) model.select.value = vs.model;
    done.setAttribute('aria-checked', vs.showDone ? 'true' : 'false');
    for (const [state, c] of chips) {
      const pressed = state === 'all' ? vs.states.length === 0 : vs.states.includes(state);
      c.b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      setText(c.count, fmt(model_.counts[state]));
      c.b.setAttribute('aria-label', `${state === 'all' ? 'All' : state}: ${fmt(model_.counts[state])}`);
    }
    const n = model_.shown.length;
    const noun = model_.total === 1 ? 'ticket' : 'tickets';
    const of = placeName ? model_.total : model_.all;
    setText(lineText, placeName
      ? `Showing ${placeName}: ${fmt(n)} of ${fmt(of)} ${noun}.`
      : `Showing ${fmt(n)} of ${fmt(of)} ${of === 1 ? 'ticket' : 'tickets'}.`);
    lineBtn.hidden = !placeName;
    setText(lineBtn, 'Clear place');
    lineBtn.onclick = placeName ? on.onClearPlace : null;
    lineBtn2.hidden = !filtersOn;
    setText(lineBtn2, 'Clear filters');
    lineBtn2.onclick = filtersOn ? on.onClearFilters : null;
  }

  return { el: root, search, paint, focusSearch: () => { search.focus(); search.select(); } };
}
