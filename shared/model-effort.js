/**
 * Suggested agent model effort tiers for tasks.
 * Used when creating tasks and (future) auto-delegating work to agents.
 */

export const MODEL_EFFORT_VALUES = ['light', 'standard', 'heavy'];

export const MODEL_EFFORT_LABELS = {
  light: 'Light',
  standard: 'Standard',
  heavy: 'Heavy',
};

/** @param {string} value */
export function isModelEffort(value) {
  return MODEL_EFFORT_VALUES.includes(value);
}

/** @param {string|null|undefined} value */
export function formatModelEffort(value) {
  if (!value) return '';
  return MODEL_EFFORT_LABELS[value] || value;
}

/** Compact badge label for tight layouts. */
export function modelEffortShort(value) {
  if (value === 'light') return 'L';
  if (value === 'standard') return 'Std';
  if (value === 'heavy') return 'Hvy';
  return '';
}
