/**
 * cli/lib/estimator.js: the cost estimator (shared/cost-estimate.js) fed from $CH_HOME/metrics/sessions.jsonl.
 * Used by `ch tasks next`, `ch metrics estimate` and the dashboard endpoints. Read-only.
 */
import { readRecords, metricsConfig } from './metrics-store.js';
import { estimatorFor } from '../../shared/cost-estimate.js';

/** @param {object} doc tasks document; returns null when there is no sessions data at all. */
export function estimatorForDoc(doc, { project, now = Date.now() } = {}) {
  const sessions = readRecords('sessions.jsonl');
  if (!sessions.length) return null;
  return estimatorFor({ doc, sessions, cfg: metricsConfig(), nowMs: now, project });
}
