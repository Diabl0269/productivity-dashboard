/**
 * shared/metrics-schema.js: the version of the /api/metrics payload shape. The server stamps it
 * into every payload (buildMetricsPayload) and the Metrics page compares it with its own copy, so
 * "new page, old running server" shows one clear banner instead of misleading empty sections.
 * Bump it whenever the page starts reading a new top-level part of the payload.
 */
export const METRICS_SCHEMA = 3;
