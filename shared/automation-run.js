/**
 * The editable run settings of a launchd automation (pure, no fs, no DOM): schedule, model, skill,
 * prompt, enabled and the description. Shared by the edit route (server/home/automation-edit-route.js),
 * the LaunchAgent installer (scripts/launchagents) and the edit dialog.
 *
 * Stored in home.config.json as `automations[].run = { schedule, model, skill, prompt, enabled }`;
 * the description is the entry's existing `what`.
 */

export const SKILL_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const MAX_PROMPT = 4000;
export const MAX_DESCRIPTION = 500;
export const RUNTIME_FIELDS = ['schedule', 'harness', 'model', 'skill', 'prompt', 'enabled', 'effort', 'cli', 'runner', 'arguments'];
export const EDIT_FIELDS = [...RUNTIME_FIELDS, 'description'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const HARNESSES = ['opencode', 'claude', 'codex', 'copilot', 'custom'];
export const DEFAULT_EFFORT = 'medium';
export const DEFAULT_RUNNER = '~/Library/Application Support/agent-automations/run-job.sh';
export const HARNESS_DEFAULTS = Object.freeze({
  opencode: { cli: '/Applications/OpenCode.app/Contents/Resources/opencode-cli', model: 'github-copilot/mai-code-2' },
  claude: { cli: 'claude', model: 'sonnet' },
  codex: { cli: 'codex', model: 'gpt-5.1-codex' },
  copilot: { cli: 'copilot', model: 'gpt-4.1' },
  custom: { cli: '', model: '' },
});

/** The jobs the installer sets up when home.config.json says nothing else. */
export const DEFAULT_SCHEDULES = Object.freeze({
  'daily-summary': { hour: 8, minute: 58, weekdays: [0, 1, 2, 3, 4] },
  'weekly-performance-review': { hour: 9, minute: 2, weekdays: [0] },
  'ai-ideas-watcher': { hour: 9, minute: 3, weekdays: [0] },
  insights: { hour: 9, minute: 5, day: 1 },
});

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const pad = n => String(n).padStart(2, '0');

/** A clean schedule { hour, minute, weekdays? | day? } or { error }. */
export function checkSchedule(v) {
  if (!isObj(v)) return { error: '"schedule" should be an object like { "hour": 9, "minute": 0 }.' };
  const extra = Object.keys(v).filter(k => !['hour', 'minute', 'weekdays', 'day'].includes(k));
  if (extra.length) return { error: `"schedule" has unknown keys: ${extra.join(', ')}.` };
  if (!isInt(v.hour, 0, 23)) return { error: '"schedule.hour" should be a whole number from 0 to 23.' };
  if (!isInt(v.minute, 0, 59)) return { error: '"schedule.minute" should be a whole number from 0 to 59.' };
  const out = { hour: v.hour, minute: v.minute };
  if (v.weekdays !== undefined && v.day !== undefined) return { error: 'Use either "schedule.weekdays" or "schedule.day", not both.' };
  if (v.weekdays !== undefined) {
    if (!Array.isArray(v.weekdays) || !v.weekdays.length || v.weekdays.length > 7 || !v.weekdays.every(d => isInt(d, 0, 6))) {
      return { error: '"schedule.weekdays" should be a list of 1 to 7 numbers from 0 (Sunday) to 6 (Saturday).' };
    }
    out.weekdays = [...new Set(v.weekdays)].sort((a, b) => a - b);
  }
  if (v.day !== undefined) {
    if (!isInt(v.day, 1, 31)) return { error: '"schedule.day" should be a day of the month from 1 to 31.' };
    out.day = v.day;
  }
  return { value: out };
}

/** Plain-words trigger text for a schedule, e.g. "Sunday through Thursday at 08:58". */
export function describeSchedule(s) {
  const time = `${pad(s.hour)}:${pad(s.minute)}`;
  if (s.day !== undefined) return `Day ${s.day} of the month at ${time}`;
  const w = s.weekdays;
  if (!w || w.length === 7) return `Every day at ${time}`;
  const run = w.every((d, i) => i === 0 || d === w[i - 1] + 1);
  if (w.length === 1) return `${DAY_NAMES[w[0]]} at ${time}`;
  if (run && w.length > 2) return `${DAY_NAMES[w[0]]} through ${DAY_NAMES[w[w.length - 1]]} at ${time}`;
  return `${w.map(d => DAY_NAMES[d]).join(', ')} at ${time}`;
}

function text(v, key, max, { multiline = false } = {}) {
  if (typeof v !== 'string') return { error: `"${key}" should be text.` };
  const t = v.trim();
  if (t.length > max) return { error: `"${key}" is longer than ${max} characters.` };
  if (CONTROL_RE.test(t) || (!multiline && /[\r\n]/.test(t))) return { error: `"${key}" has characters that are not allowed.` };
  return { value: t };
}

/**
 * Validate an edit request body (without `id`). Only the known keys are accepted; every value is checked.
 * @returns {{ patch: object, errors: string[] }} patch holds clean values for the keys that were given
 */
export function validateEdit(body) {
  const errors = [];
  const patch = {};
  if (!isObj(body)) return { patch, errors: ['The request should be a JSON object.'] };
  const extra = Object.keys(body).filter(k => k !== 'id' && !EDIT_FIELDS.includes(k));
  if (extra.length) errors.push(`Unknown fields: ${extra.join(', ')}.`);
  const take = (key, check) => {
    if (body[key] === undefined) return;
    const r = check(body[key]);
    if (r.error) errors.push(r.error); else patch[key] = r.value;
  };
  take('schedule', checkSchedule);
  take('harness', v => (HARNESSES.includes(v) ? { value: v } : { error: `"harness" should be one of ${HARNESSES.join(', ')}.` }));
  take('model', v => {
    if (v === null || v === '') return { value: null };
    const r = text(v, 'model', 120);
    return r.error || r.value ? r : { value: null };
  });
  take('skill', v => {
    if (v === null || v === '') return { value: null };
    return typeof v === 'string' && SKILL_RE.test(v) ? { value: v } : { error: '"skill" should be a skill name: letters, digits, "-" and "_".' };
  });
  take('prompt', v => {
    if (v === null) return { value: null };
    const r = text(v, 'prompt', MAX_PROMPT, { multiline: true });
    return r.error ? r : { value: r.value || null };
  });
  take('enabled', v => (typeof v === 'boolean' ? { value: v } : { error: '"enabled" should be true or false.' }));
  take('effort', v => (EFFORTS.includes(v) ? { value: v } : { error: `"effort" should be one of ${EFFORTS.join(', ')}.` }));
  take('cli', v => {
    const r = text(v, 'cli', 500);
    return r.error ? r : (/^(\/.*|~\/.*|[A-Za-z0-9._-]+)$/.test(r.value) ? r : { error: '"cli" should be a command name, an absolute path, or start with "~/".' });
  });
  take('arguments', v => {
    if (!Array.isArray(v) || v.length > 50) return { error: '"arguments" should be a list of up to 50 text values.' };
    const values = [];
    for (const arg of v) {
      const r = text(arg, 'arguments', 1000);
      if (r.error) return r;
      values.push(r.value);
    }
    return { value: values };
  });
  take('runner', v => {
    const r = text(v, 'runner', 500);
    return r.error ? r : (/^(\/|~\/)/.test(r.value) ? r : { error: '"runner" should be an absolute path or start with "~/".' });
  });
  take('description', v => {
    const r = text(v, 'description', MAX_DESCRIPTION);
    return r.error ? r : r.value ? r : { error: '"description" should not be empty.' };
  });
  if (!Object.keys(patch).length && !errors.length) errors.push('Nothing to change: send at least one field.');
  return { patch, errors };
}

/** The run settings of an automation entry with the defaults filled in: { schedule, model, skill, prompt, enabled }. */
export function effectiveRun(entry, defaults = {}) {
  const run = isObj(entry?.run) ? entry.run : {};
  const harness = run.harness || defaults.harness || '';
  const preset = HARNESS_DEFAULTS[harness] || HARNESS_DEFAULTS.custom;
  return {
    schedule: run.schedule || DEFAULT_SCHEDULES[entry?.id] || null,
    harness,
    model: run.model === undefined ? (defaults.model === undefined ? preset.model : defaults.model) : run.model,
    effort: run.effort || defaults.effort || DEFAULT_EFFORT,
    cli: run.cli || defaults.cli || preset.cli,
    runner: run.runner || defaults.runner || DEFAULT_RUNNER,
    arguments: run.arguments || defaults.arguments || [],
    skill: run.skill === undefined ? (defaults.skill === undefined ? (entry?.id || null) : defaults.skill) : run.skill,
    prompt: run.prompt === undefined ? (defaults.prompt || null) : run.prompt,
    enabled: run.enabled !== false,
  };
}

/** Validate a project-level defaults object using the same runtime constraints. */
export function normDefaults(raw, errors) {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) { errors.push('automationDefaults should be an object; ignored.'); return null; }
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!RUNTIME_FIELDS.includes(key) || key === 'schedule' || key === 'enabled') {
      errors.push(`automationDefaults: unknown key "${key}"; ignored.`);
      continue;
    }
    const one = validateEdit({ [key]: raw[key] });
    if (one.errors.length) errors.push(`automationDefaults: ${one.errors[0]} Ignored.`);
    else out[key] = one.patch[key];
  }
  return out;
}

/** Keep only the valid parts of a stored `run` block; problems go to `errors` and the part is ignored. */
export function normRun(raw, here, errors) {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) { errors.push(`${here}: "run" should be an object; ignored.`); return undefined; }
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!RUNTIME_FIELDS.includes(key)) { errors.push(`${here}: run: unknown key "${key}"; ignored.`); continue; }
    const one = validateEdit({ [key]: raw[key] });
    if (one.errors.length) errors.push(`${here}: run: ${one.errors[0]} Ignored.`);
    else out[key] = one.patch[key];
  }
  return out;
}
