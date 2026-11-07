/**
 * shared/model-prices.js (pure): API list prices per model and the cost of one usage record.
 * Spec: docs/metrics.md "Cost".
 *
 * Prices are list prices in US dollars per million tokens: [input, output, cache read]. A cache
 * write costs 1.25x input for the 5-minute cache and 2x input for the 1-hour cache. An optional
 * fourth entry is a long-prompt tier: a message whose prompt (input + cache read + cache write)
 * is over `over` tokens pays `mult` times every price. Matched 2026-11-07 to the totals Claude Code
 * itself records (`cost-state` per model) on the same token counts: Sonnet 5.5 cache reads are
 * $0.10 there and Haiku 5.5 prompts over 100K tokens cost 5x. Update the
 * table when a model is added or re-priced; an unknown model is not priced (null), never guessed.
 */

export const MODEL_PRICES = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-opus-5': [5, 25, 0.5],
  'claude-opus-4-8': [5, 25, 0.5],
  'claude-opus-4-7': [5, 25, 0.5],
  'claude-opus-4-6': [5, 25, 0.5],
  'claude-sonnet-5-5': [2, 10, 0.1],
  'claude-sonnet-5': [2, 10, 0.2],
  'claude-sonnet-4-6': [3, 15, 0.3],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, { over: 100000, mult: 5 }],
  'claude-haiku-4-5': [1, 5, 0.1],
  'claude-fable-5-1': [10, 50, 0.25],
  'claude-fable-5': [10, 50, 0.25],
};

export const CACHE_WRITE_5M = 1.25;
export const CACHE_WRITE_1H = 2;

/** "claude-opus-5-5[1m]" or "claude-haiku-4-5-20251001" -> "claude-opus-5-5" / "claude-haiku-4-5". */
export function normalizeModel(model) {
  if (typeof model !== 'string') return null;
  const id = model.trim().replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  return id || null;
}

/**
 * USD for one usage record ({input, output, cacheRead, cacheWrite5m, cacheWrite1h} token counts),
 * or null when the model is not in the table (e.g. `<synthetic>`).
 */
export function priceUsage(model, usage = {}) {
  const p = MODEL_PRICES[normalizeModel(model)];
  if (!p) return null;
  const [inP, outP, readP, tier] = p;
  const n = (k) => Number(usage[k]) || 0;
  const prompt = n('input') + n('cacheRead') + n('cacheWrite5m') + n('cacheWrite1h');
  const mult = tier && prompt > tier.over ? tier.mult : 1;
  return mult * (
    n('input') * inP +
    n('output') * outP +
    n('cacheRead') * readP +
    n('cacheWrite5m') * inP * CACHE_WRITE_5M +
    n('cacheWrite1h') * inP * CACHE_WRITE_1H
  ) / 1e6;
}
