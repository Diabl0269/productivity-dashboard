/**
 * Autorun settings (pure): the keys of $CH_HOME/autorun.json that the autorun dispatcher reads every
 * tick, their defaults, and validate/merge logic for the Overview "Autorun" card. No fs, no DOM.
 * A missing file means all defaults; unknown keys already in the file are preserved on write.
 */

/** @type {{maxRuns: number, maxTotal: number|null, paceStop: number, reviewCap: number, maxStarts: number, finishedIdleMin: number}} */
export const DEFAULTS = Object.freeze({
  maxRuns: 6,
  maxTotal: 8,
  paceStop: 0.85,
  reviewCap: 8,
  maxStarts: 2,
  finishedIdleMin: 90,
});

const RULES = {
  maxRuns: { int: true, min: 1 },
  maxTotal: { int: true, min: 1, nullable: true },
  paceStop: { int: false, min: 0, max: 1 },
  reviewCap: { int: true, min: 0 },
  maxStarts: { int: true, min: 1 },
  finishedIdleMin: { int: true, min: 1 },
};

export const SETTING_KEYS = Object.keys(RULES);

function checkValue(key, v) {
  const r = RULES[key];
  if (v === null) return r.nullable ? null : `${key} cannot be null`;
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${key} must be a number`;
  if (r.int && !Number.isInteger(v)) return `${key} must be a whole number`;
  if (v < r.min) return `${key} must be at least ${r.min}`;
  if (r.max !== undefined && v > r.max) return `${key} must be at most ${r.max}`;
  return null;
}

/**
 * Validate the known keys present in `input`. Returns { ok: true, values } (only the known keys that
 * were present, as given) or { ok: false, error }. Unknown keys are ignored here.
 */
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'settings must be an object' };
  const values = {};
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key) || input[key] === undefined) continue;
    const err = checkValue(key, input[key]);
    if (err) return { ok: false, error: err };
    values[key] = input[key];
  }
  return { ok: true, values };
}

/** Effective settings: defaults, overridden by each valid known key of `stored` (bad values fall back). */
export function normalizeSettings(stored) {
  const out = { ...DEFAULTS };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  for (const key of SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(stored, key) && checkValue(key, stored[key]) === null) out[key] = stored[key];
  }
  return out;
}

/** New file contents: `existing` (unknown keys kept) with the validated `values` applied on top. */
export function mergeSettings(existing, values) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return { ...base, ...values };
}
