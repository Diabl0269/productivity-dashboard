/**
 * shared/home-ticket-params.js (PRO119): the Tickets view's filters, sort and grouping as short URL
 * parameters (all prefixed `t`), so a view can be linked and remembered. Pure: no DOM.
 *
 *   ?tq=mixer&tstate=running,ready&ttype=epic&tgroup=epic&tsort=updated&tdir=asc&tdone=1&tlane=x&tmodel=opus&tlabel=y
 *
 *   DEFAULT_TICKET_VIEW                       the view with nothing chosen
 *   parseTicketParams(search)                 -> a view ({ text, states, types, group, sort, dir, showDone, lane, model, label }); bad values fall back to the default
 *   ticketParamsString(view)                  -> 'tstate=ready&tgroup=epic' (only what differs from the default; '' when nothing)
 *   hasTicketParams(search)                   -> true when any `t` parameter is present
 *   withTicketParams(search, view)            -> a full query string ('?a=b&tq=...' or '') with the `t` parameters replaced
 *   stripTicketParams(params)                 -> deletes every `t` parameter from a URLSearchParams
 */

import { STATES, GROUPS, SORT_KEYS, TYPES } from './home-ticket-rows.js';

const KEYS = ['tq', 'tstate', 'ttype', 'tgroup', 'tsort', 'tdir', 'tdone', 'tlane', 'tmodel', 'tlabel'];

export const DEFAULT_TICKET_VIEW = Object.freeze({
  text: '', states: [], types: [], group: 'none', sort: 'updated', dir: 'desc', showDone: false, lane: '', model: '', label: '',
});

/** The direction a column starts in when first clicked: dates newest first, the rest A to Z. */
export const defaultDir = key => (key === 'updated' ? 'desc' : 'asc');

const list = (value, allowed) => [...new Set(String(value || '').split(',').map(s => s.trim()).filter(s => allowed.includes(s)))];

export function parseTicketParams(search) {
  const p = new URLSearchParams(search || '');
  const sort = SORT_KEYS.includes(p.get('tsort')) ? p.get('tsort') : DEFAULT_TICKET_VIEW.sort;
  const dir = ['asc', 'desc'].includes(p.get('tdir')) ? p.get('tdir') : defaultDir(sort);
  return {
    text: (p.get('tq') || '').slice(0, 200),
    states: list(p.get('tstate'), STATES),
    types: list(p.get('ttype'), TYPES),
    group: GROUPS.includes(p.get('tgroup')) ? p.get('tgroup') : DEFAULT_TICKET_VIEW.group,
    sort,
    dir,
    showDone: p.get('tdone') === '1',
    lane: (p.get('tlane') || '').slice(0, 80),
    model: (p.get('tmodel') || '').slice(0, 40),
    label: (p.get('tlabel') || '').slice(0, 80),
  };
}

function entries(view) {
  const v = { ...DEFAULT_TICKET_VIEW, ...view };
  const out = [];
  if (v.text) out.push(['tq', v.text]);
  if (v.states.length) out.push(['tstate', STATES.filter(s => v.states.includes(s)).join(',')]);
  if (v.types.length) out.push(['ttype', TYPES.filter(s => v.types.includes(s)).join(',')]);
  if (v.group !== DEFAULT_TICKET_VIEW.group) out.push(['tgroup', v.group]);
  if (v.sort !== DEFAULT_TICKET_VIEW.sort) out.push(['tsort', v.sort]);
  if (v.dir !== defaultDir(v.sort)) out.push(['tdir', v.dir]);
  if (v.showDone) out.push(['tdone', '1']);
  if (v.lane) out.push(['tlane', v.lane]);
  if (v.model) out.push(['tmodel', v.model]);
  if (v.label) out.push(['tlabel', v.label]);
  return out;
}

export function ticketParamsString(view) {
  return entries(view).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ',')}`).join('&');
}

export function hasTicketParams(search) {
  const p = new URLSearchParams(search || '');
  return KEYS.some(k => p.has(k));
}

export function stripTicketParams(params) {
  for (const k of KEYS) params.delete(k);
  return params;
}

export function withTicketParams(search, view) {
  const p = stripTicketParams(new URLSearchParams(search || ''));
  const rest = p.toString();
  const mine = ticketParamsString(view);
  const all = [rest, mine].filter(Boolean).join('&');
  return all ? `?${all}` : '';
}
