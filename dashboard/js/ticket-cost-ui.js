// ticket-cost-ui.js — cost lines for the task detail panel and the run plan: what a ticket
// has cost so far, or what it will likely cost (from similar shipped tickets, no AI).
// Data: GET /api/metrics/ticket-cost and /api/metrics/estimates (serve.js). Every failure is
// silent: no server, no sessions data or too few shipped tickets means nothing is shown.
// Definitions: docs/metrics.md "Cost estimate".
import { usd } from '../../shared/cost-estimate.js';

const STARTED = new Set(['in-progress', 'review', 'done']);
const TTL_MS = 60 * 1000;
let cache = { at: 0, map: new Map() };

async function getJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * The line to show for one ticket, or '' for nothing.
 * @param {{state?:string|null, cost?:{costUSD:number}|null, estimate?:object|null}|null} info
 */
export function costLine(info) {
  if (!info) return '';
  const { state, cost, estimate } = info;
  if (estimate?.n !== undefined && estimate.basis?.startsWith('sum of ')) {
    const spent = estimate.spentUSD > 0 ? `, ${usd(estimate.spentUSD)} spent so far` : '';
    return `Likely cost left ~${usd(estimate.typicalUSD)}, up to ${usd(estimate.highUSD)} (${estimate.basis})${spent}`;
  }
  if (STARTED.has(state) || (state !== 'todo' && cost)) {
    return cost && cost.costUSD > 0 ? `Cost so far ${usd(cost.costUSD)}` : '';
  }
  if (estimate) return `Likely cost ~${usd(estimate.typicalUSD)}, up to ${usd(estimate.highUSD)} (from ${estimate.n} similar shipped tickets)`;
  return '';
}

/** Fill `node` (a chip) with the ticket's cost line; hidden when there is none. */
export async function mountTicketCost(node, taskId) {
  node.hidden = true;
  if (!taskId) return;
  const info = await getJson(`/api/metrics/ticket-cost?id=${encodeURIComponent(taskId)}`);
  const text = costLine(info);
  if (!text || !node.isConnected) return;
  node.textContent = text;
  if (info.estimate?.basis) node.title = `Basis: ${info.estimate.basis}`;
  node.hidden = false;
}

/** {id: estimate|null} for the epic ids, cached for a minute. */
async function estimates(ids) {
  const fresh = Date.now() - cache.at < TTL_MS;
  const missing = ids.filter(id => !fresh || !cache.map.has(id));
  if (missing.length) {
    const got = await getJson(`/api/metrics/estimates?ids=${missing.map(encodeURIComponent).join(',')}`);
    if (!fresh) cache = { at: Date.now(), map: new Map() };
    for (const id of missing) cache.map.set(id, got ? got[id] ?? null : null);
  }
  return cache.map;
}

/** Fill every `[data-est-epic]` node under `root` with that epic's estimated remaining cost. */
export async function fillEpicEstimates(root) {
  const nodes = [...root.querySelectorAll('[data-est-epic]')];
  if (!nodes.length) return;
  const map = await estimates([...new Set(nodes.map(n => n.dataset.estEpic))]);
  for (const n of nodes) {
    const est = map.get(n.dataset.estEpic);
    if (!est || !n.isConnected) continue;
    n.textContent = `Est. left ~${usd(est.typicalUSD)} (up to ${usd(est.highUSD)})`;
    n.title = `${est.basis}${est.spentUSD > 0 ? `; ${usd(est.spentUSD)} spent so far` : ''}`;
    n.hidden = false;
  }
}
