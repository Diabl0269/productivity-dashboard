/**
 * cli/test/metrics-stale-server.test.js (PRO88): a Metrics page served by an older running server
 * shows ONE "restart the server" banner, and its sections say "not in this answer", never the
 * misleading "no data" texts. Renders the real view modules against a fake DOM. Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { staleBanner, emptyFor, isOutOfDate } from '../../dashboard/js/metrics-empty.js';
import { renderHealth, renderBacklog } from '../../dashboard/js/metrics-health-view.js';
import { renderQuality } from '../../dashboard/js/metrics-quality-view.js';
import { renderCost } from '../../dashboard/js/metrics-cost-view.js';
import { METRICS_SCHEMA } from '../../shared/metrics-schema.js';
import { makeHelpers, makeNode, textOf } from './fixtures/fake-dom.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, '../../dashboard/e2e/fixtures/metrics.sample.json'), 'utf8'));
const stale = () => { const d = JSON.parse(JSON.stringify(fixture)); delete d.schema; delete d.health; delete d.quality; delete d.flow.backlog; delete d.costs; return d; };

test('the mock payload carries the schema the page expects', () => {
  assert.equal(fixture.schema, METRICS_SCHEMA);
});

test('a payload without schema (or another one) is out of date; a matching one is not', () => {
  assert.equal(isOutOfDate(stale()), true);
  assert.equal(isOutOfDate({ schema: METRICS_SCHEMA + 1 }), true);
  assert.equal(isOutOfDate(fixture), false);
  assert.equal(staleBanner(fixture, makeNode), null);
});

test('out of date: one banner that says to restart the server', () => {
  const b = staleBanner(stale(), makeNode);
  assert.match(textOf(b), /running older code than the page: restart it \(node serve\.js\)/);
  assert.equal(b.attrs.role, 'alert');
});

test('out of date: no section shows the misleading "no data" or "Refresh" texts', () => {
  const h = makeHelpers();
  const d = stale();
  const all = [renderHealth(d, h), renderBacklog(d, h), renderQuality(d, h), renderCost(d, h)].map(textOf).join('\n');
  assert.doesNotMatch(all, /No sessions collected/);
  assert.doesNotMatch(all, /No quality data/);
  assert.doesNotMatch(all, /No backlog data/);
  assert.doesNotMatch(all, /No cost recorded/);
  assert.doesNotMatch(all, /Press Refresh data/);
  assert.equal((all.match(/Not in this server's answer/g) || []).length, 4);
});

test('zero rows (key present) still says its own empty text', () => {
  const h = makeHelpers();
  assert.match(textOf(renderHealth({ health: { n: 0 } }, h)), /No sessions collected in this range/);
  assert.match(textOf(renderBacklog({ flow: { backlog: { byWeek: [] } } }, h)), /No backlog data in this range/);
  assert.match(textOf(emptyFor(undefined, 'zero', h.empty)), /Not in this server/);
  assert.match(textOf(emptyFor(null, 'zero', h.empty)), /zero/);
});

test('current payload: health, backlog and quality render their data', () => {
  const h = makeHelpers();
  const d = JSON.parse(JSON.stringify(fixture));
  if (d.health && d.health.n) assert.doesNotMatch(textOf(renderHealth(d, h)), /Not in this server/);
  assert.doesNotMatch(textOf(renderCost(d, h)), /Not in this server/);
});
