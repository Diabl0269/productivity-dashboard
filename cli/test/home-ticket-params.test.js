/**
 * shared/home-ticket-params.js (PRO119): the Tickets view in the address. Short `t` parameters, only
 * what differs from the default, bad values ignored, other parameters left alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TICKET_VIEW, parseTicketParams, ticketParamsString, hasTicketParams, withTicketParams, stripTicketParams, defaultDir,
} from '../../shared/home-ticket-params.js';

test('an empty address is the default view and writes nothing', () => {
  assert.deepEqual(parseTicketParams(''), DEFAULT_TICKET_VIEW);
  assert.equal(ticketParamsString(DEFAULT_TICKET_VIEW), '');
  assert.equal(hasTicketParams('?where=oven'), false);
});

test('the example address from the ticket reads as asked', () => {
  const v = parseTicketParams('?tstate=running,ready&tgroup=epic&tsort=updated');
  assert.deepEqual(v.states, ['running', 'ready']);
  assert.equal(v.group, 'epic');
  assert.equal(v.sort, 'updated');
  assert.equal(v.dir, 'desc');
  assert.equal(hasTicketParams('?tstate=ready'), true);
});

test('a view survives the round trip, with "needs you" and spaces in text', () => {
  const view = {
    text: 'oven fan', states: ['needs you', 'done'], types: ['epic', 'subtask'], group: 'place', sort: 'title', dir: 'desc',
    showDone: true, lane: 'oven', model: 'opus', label: 'public-post',
  };
  const s = ticketParamsString(view);
  assert.ok(s.includes('tstate=needs%20you,done'));
  assert.deepEqual(parseTicketParams(`?${s}`), view);
});

test('only differences from the default are written; the default direction is not', () => {
  assert.equal(ticketParamsString({ ...DEFAULT_TICKET_VIEW, sort: 'id', dir: 'asc' }), 'tsort=id');
  assert.equal(ticketParamsString({ ...DEFAULT_TICKET_VIEW, sort: 'id', dir: 'desc' }), 'tsort=id&tdir=desc');
  assert.equal(ticketParamsString({ ...DEFAULT_TICKET_VIEW, dir: 'asc' }), 'tdir=asc'); // updated starts newest first
  assert.equal(defaultDir('updated'), 'desc');
  assert.equal(defaultDir('lane'), 'asc');
});

test('unknown states, types, groups and sort keys fall back; duplicates collapse', () => {
  const v = parseTicketParams('?tstate=ready,nonsense,ready&ttype=bogus&tgroup=sideways&tsort=color&tdir=up');
  assert.deepEqual(v.states, ['ready']);
  assert.deepEqual(v.types, []);
  assert.equal(v.group, 'none');
  assert.equal(v.sort, 'updated');
  assert.equal(v.dir, 'desc');
});

test('withTicketParams replaces only the t parameters and keeps the others', () => {
  const next = withTicketParams('?where=oven&hproject=bakery&tstate=ready&tgroup=lane', { ...DEFAULT_TICKET_VIEW, states: ['later'] });
  assert.equal(next, '?where=oven&hproject=bakery&tstate=later');
  assert.equal(withTicketParams('?tstate=ready', DEFAULT_TICKET_VIEW), '');
  const p = stripTicketParams(new URLSearchParams('?where=oven&tq=x&tdone=1'));
  assert.equal(p.toString(), 'where=oven');
});
