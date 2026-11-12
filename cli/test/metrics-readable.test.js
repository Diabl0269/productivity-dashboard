/**
 * cli/test/metrics-readable.test.js (PRO87): Metrics reads clearly. Plain percentile words, the contents
 * row, the Cost section order and the "Show all (N)" fold. Renders the real view modules against a fake DOM.
 * Synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtPercentileLabel, percentileTip } from '../../dashboard/js/metrics-charts.js';
import { PART_IDS, navItems, LIKELY_COST } from '../../dashboard/js/metrics-nav.js';
import { renderCost } from '../../dashboard/js/metrics-cost-view.js';
import { makeHelpers, makeNode, textOf, find } from './fixtures/fake-dom.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'dashboard/e2e/fixtures/metrics.sample.json'), 'utf8'));

test('fmtPercentileLabel: plain words, no bare p75 or p90', () => {
  assert.equal(fmtPercentileLabel('median'), 'Typical (median)');
  assert.equal(fmtPercentileLabel('p75'), '3 in 4 cost this or less');
  assert.equal(fmtPercentileLabel('p90'), '9 in 10 cost this or less');
  assert.equal(fmtPercentileLabel('p75', 'leave'), '3 in 4 leave within');
  assert.equal(fmtPercentileLabel('p90', 'finish'), '9 in 10 finish within');
  for (const k of ['median', 'p75', 'p90']) for (const kind of ['cost', 'leave', 'take', 'finish', 'use']) assert.doesNotMatch(fmtPercentileLabel(k, kind), /\bp(75|90)\b/);
  assert.match(percentileTip('p75'), /p75/); // the term stays in the tooltip
});

test('no visible header or label in the Metrics modules says a bare p75 or p90', () => {
  // Property reads (s.p75, p90Seconds) are data; the definitions in metrics-charts.js are the helper itself.
  const offenders = [];
  for (const f of fs.readdirSync(path.join(root, 'dashboard/js')).filter((n) => /^metrics-.*\.js$/.test(n) && n !== 'metrics-charts.js')) {
    fs.readFileSync(path.join(root, 'dashboard/js', f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const bare = line.replace(/\.p(75|90)\w*/g, '').replace(/p(75|90)(USD|Seconds|Minutes)/g, '').replace(/'p(75|90)'/g, '');
      if (/\bp(75|90)\b/.test(bare)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('Cost section: headers carry plain percentile words, with the term in a tooltip', () => {
  const h = makeHelpers();
  const s = renderCost(fixture, h);
  const heads = find(s, (n) => n.columns).flatMap((t) => t.columns);
  assert.ok(heads.length > 0);
  for (const c of heads) assert.doesNotMatch(c.label, /\bp(75|90)\b/, c.label);
  const p75 = heads.filter((c) => c.label === '3 in 4 cost this or less');
  assert.ok(p75.length >= 2);
  assert.ok(p75.every((c) => /p75/.test(c.title)));
  assert.ok(heads.some((c) => c.label === 'Typical (median)'));
});

test('Cost section order: tiles, Likely cost per ticket, Cost per shipped ticket, per closed epic, then the detail tables', () => {
  const h = makeHelpers();
  const d = JSON.parse(JSON.stringify(fixture));
  d.costs.perClosedEpic = { n: 2, of: 3, withCost: 2, medianUSD: 40, p75USD: 55, totalUSD: 80 };
  const s = renderCost(d, h);
  const titles = find(s, (n) => n.cls === 'mc-card-title').map((n) => n.text);
  const at = (re) => titles.findIndex((t) => re.test(t));
  const order = [/^Likely cost per ticket$/, /^Cost per shipped ticket/, /^Per closed epic/, /^Cost per ticket$/, /^Epics$/].map(at);
  assert.ok(order.every((i) => i >= 0), `all cards present: ${titles.join(' | ')}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'cards in the agreed order');
  assert.ok(!titles.includes('Estimates') && !titles.includes('Per shipped ticket by model label'), 'old names gone');
  const likely = find(s, (n) => n.cls === 'mc-card').find((n) => textOf(n).includes('Likely cost per ticket'));
  assert.equal(likely.id, LIKELY_COST.id, 'its own anchor');
  assert.match(textOf(likely), /What this tells you/);
});

test('Cost per ticket collapses behind "Show all (N)": first rows visible, the rest folded, button toggles', () => {
  const h = makeHelpers();
  const d = JSON.parse(JSON.stringify(fixture));
  const base = d.costs.byTicket[0];
  d.costs.byTicket = Array.from({ length: 12 }, (_, i) => ({ ...base, ticket: `T-${i}` }));
  const s = renderCost(d, h);
  const btn = find(s, (n) => n.cls.includes('mc-fold-btn'))[0];
  assert.ok(btn, 'fold button present');
  assert.equal(btn.text, 'Show all (12) ▾');
  assert.equal(btn.attrs['aria-expanded'], 'false');
  const tables = find(s, (n) => n.columns && /^Cost per ticket/.test(n.attrs.label));
  assert.deepEqual(tables.map((t) => t.children.length - 1), [5, 7]);
  btn.listeners.click();
  assert.equal(btn.attrs['aria-expanded'], 'true');
  assert.equal(btn.text, 'Show fewer ▴');
  btn.listeners.click(); // leave it closed for other tests
  assert.equal(btn.attrs['aria-expanded'], 'false');
  assert.equal(find(renderCost(fixture, h), (n) => n.cls.includes('mc-fold-btn')).length, 0, 'a short table has no fold');
});

test('contents row: an anchor for every part of the page, plus Likely cost per ticket after Cost', () => {
  const src = fs.readFileSync(path.join(root, 'dashboard/js/metrics-view.js'), 'utf8');
  const labels = [...src.matchAll(/^\s*\['([^']+)', \(\) => render/gm)].map((m) => m[1]);
  assert.ok(labels.length >= 11, `found the parts list: ${labels}`);
  for (const l of labels) assert.ok(PART_IDS[l], `nav knows "${l}"`);
  const items = navItems(labels);
  assert.equal(items.length, labels.length + 1);
  assert.equal(items[labels.indexOf('Cost') + 1].label, 'Likely cost per ticket');
  // Every target id is made by a section() call (mcH-<id>) in the Metrics modules, or is the Likely cost card.
  const code = fs.readdirSync(path.join(root, 'dashboard/js')).filter((n) => /^metrics-.*\.js$/.test(n)).map((n) => fs.readFileSync(path.join(root, 'dashboard/js', n), 'utf8')).join('\n');
  for (const it of items) {
    if (it.id.startsWith('mcH-')) assert.ok(code.includes(`section('${it.id.slice(4)}'`) || code.includes(`.id = '${it.id}'`), it.id);
    else assert.match(code, new RegExp(it.id.replace(/-/g, '\\-')));
  }
});
