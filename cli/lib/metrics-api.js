/**
 * cli/lib/metrics-api.js: what serve.js needs for the Metrics tab.
 *   metricsPayload(searchParams)  -> payload (throws Error with .status 400 on a bad `since`)
 *   collectExclusive()            -> {ok, summary, lines}; one collect at a time (status 409 otherwise)
 */
import { loadMetricsPayload, runCollect } from '../commands/metrics.js';

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
