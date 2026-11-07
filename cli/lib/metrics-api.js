/**
 * cli/lib/metrics-api.js: what serve.js needs for the Metrics tab.
 *   metricsPayload(searchParams)  -> payload (throws Error with .status 400 on a bad `since`)
 *   collectExclusive()            -> {ok, summary, lines}; one collect at a time (status 409 otherwise)
 */
import { loadMetricsPayload, runCollect, ticketCostInfo, estimatesFor } from '../commands/metrics.js';

export function metricsPayload(searchParams) {
  try {
    return loadMetricsPayload({
      since: searchParams.get('since') || '30d',
      project: searchParams.get('project') || undefined,
    });
  } catch (e) {
    if (/^bad since/.test(e.message)) e.status = 400;
    throw e;
  }
}

/** GET /api/metrics/ticket-cost?id=X -> { state, cost, estimate } (cost: spent so far, null when none). */
export function ticketCost(searchParams) {
  const id = String(searchParams.get('id') || '').trim().toUpperCase();
  if (!id) { const e = new Error('id required'); e.status = 400; throw e; }
  return ticketCostInfo(id);
}

/** GET /api/metrics/estimates?ids=A,B -> { A: estimate|null, ... } */
export function ticketEstimates(searchParams) {
  const ids = String(searchParams.get('ids') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 200);
  return estimatesFor(ids);
}

let running = false;

export async function collectExclusive() {
  if (running) {
    const e = new Error('a collect is already running');
    e.status = 409;
    throw e;
  }
  running = true;
  try {
    const { summary, lines } = await runCollect({});
    return { ok: true, summary, lines };
  } finally {
    running = false;
  }
}
