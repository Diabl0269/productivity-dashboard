/**
 * home.config.json: the "How it runs" keys (pure, no fs, no DOM): `automations[]`, `services[]` and
 * `lifecycle`. shared/home-config.js calls these while it normalises the file; every problem is a
 * plain-words line in `errors` and the entry is kept or skipped, never thrown. Meaning of each key:
 * docs/home-page.md ("How it runs").
 */

import { isPlainObject, shown, str, strOrNull, strList, regex, id as checkId, unknownKeys, objList } from './home-config-check.js';
import { LIFECYCLE_STAGE_IDS } from './lifecycle.js';
import { normRun } from './automation-run.js';

export const AUTOMATION_KINDS = ['launchd', 'cron', 'hook', 'ci', 'skill', 'file', 'inside'];
export const AUTOMATION_STATUS_TYPES = ['json-file', 'log-tail', 'launchctl', 'gh-workflow', 'mtime', 'none'];
export const SERVICE_STATUS_TYPES = ['gh-workflow', 'http', 'json-file', 'none'];

/** The group a row lands in when the config names none. */
export const KIND_GROUPS = {
  launchd: 'Scheduled jobs',
  cron: 'Scheduled jobs',
  inside: 'Inside another job',
  hook: 'Hooks',
  ci: 'CI',
  skill: 'By hand',
  file: 'By hand',
};
export const GROUP_ORDER = ['Scheduled jobs', 'Inside another job', 'Hooks', 'CI', 'By hand'];

/** Chip states of a status result, in plain words; `problem` ones show under "Only problems". */
export const HEALTH_STATES = {
  ok: { label: 'ok', problem: false },
  late: { label: 'late', problem: true },
  waiting: { label: 'waiting', problem: false },
  failed: { label: 'failed', problem: true },
  off: { label: 'off', problem: true },
  unknown: { label: 'unknown', problem: false },
  checking: { label: 'checking', problem: false },
};

/** 'ok' | 'waiting' | 'late' | 'failed' | 'off' | 'unknown' | 'checking' for one result (cli/lib/automation-status.js).
 * 'waiting' (AGE207): it runs on time but holds its work for a stated reason (a usage limit), so it is not a problem. */
export function healthState(result) {
  if (!result || result.checking) return 'checking';
  if (result.off) return 'off';
  if (result.ok === false) return 'failed';
  if (result.waiting) return 'waiting';
  if (result.late) return 'late';
  if (result.ok === true) return 'ok';
  return 'unknown';
}

/** Counts by state and the rows with a problem: { counts: { ok, late, ... }, problems: [{ id, name, state }] }. */
export function summarizeHealth(rows = []) {
  const counts = Object.fromEntries(Object.keys(HEALTH_STATES).map(k => [k, 0]));
  const problems = [];
  for (const r of rows) {
    const s = healthState(r.result);
    counts[s] += 1;
    if (HEALTH_STATES[s].problem) problems.push({ id: r.id, name: r.name, state: s });
  }
  return { counts, problems };
}

/** "just now", "4 min ago", "3 h ago", "2 days ago" (or "in 6 min" for a future time); '' when unknown. */
export function relTime(isoText, now = Date.now()) {
  const ms = Date.parse(isoText);
  if (!Number.isFinite(ms)) return '';
  const diff = ms - now;
  const min = Math.round(Math.abs(diff) / 60e3);
  let span;
  if (min < 1) return diff > 0 ? 'in under a minute' : 'just now';
  if (min < 60) span = `${min} min`;
  else if (min < 48 * 60) span = `${Math.round(min / 60)} h`;
  else span = `${Math.round(min / 1440)} days`;
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

const STATUS_KEYS = ['type', 'path', 'field', 'okField', 'label', 'repo', 'workflow', 'url', 'okPattern', 'failPattern', 'match', 'maxAgeMin'];
/** What each status type needs, beyond `type`. */
const NEEDS = {
  'json-file': ['path'],
  'log-tail': ['path'],
  launchctl: ['label'],
  'gh-workflow': ['repo', 'workflow'],
  mtime: ['path'],
  http: ['url'],
  none: [],
};
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Why a status URL may not be fetched, or null when it may. Only https, or plain http to this
 * computer (localhost, 127.0.0.1, [::1]); never a user name or password, and never anything that
 * looks like a secret in the address (an "@", "token", "key=").
 */
export function httpUrlProblem(url) {
  if (typeof url !== 'string' || !url) return 'should be a web address';
  if (/@|token|key=|secret|password/i.test(url)) return 'must not hold a user, token, key or password (the tracker never sends secrets)';
  let u;
  try { u = new URL(url); } catch { return 'is not a valid web address'; }
  if (u.username || u.password) return 'must not hold a user name or password';
  const loop = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && loop) return null;
  return 'should start with https:// (plain http only for localhost)';
}

/** A link a person opens (console, docs): http(s) only. */
function linkOrNull(obj, key, where, errors) {
  const v = strOrNull(obj, key, where, errors);
  if (v === null) return null;
  if (!/^https?:\/\//i.test(v) && !v.startsWith('/') && !v.startsWith('~') && !/^[\w.-]+\//.test(v)) {
    errors.push(`${where}: "${key}" should be a web address (https://...) or a file path, got ${shown(v)}; ignored.`);
    return null;
  }
  return v;
}

/** One status source: { type, ...its keys }, or null (with a problem) when unusable. */
function normStatus(raw, where, errors, types) {
  if (!isPlainObject(raw)) {
    errors.push(`${where}: should be an object like { "type": "${types[0]}", ... }, got ${shown(raw)}; no status is read.`);
    return null;
  }
  if (!types.includes(raw.type)) {
    errors.push(`${where}: "type" should be one of ${types.join(', ')}, got ${shown(raw.type)}; no status is read.`);
    return null;
  }
  unknownKeys(raw, STATUS_KEYS, where, errors);
  const out = { type: raw.type };
  for (const key of ['path', 'field', 'okField', 'label', 'repo', 'workflow', 'url']) {
    const v = strOrNull(raw, key, where, errors);
    if (v !== null) out[key] = v;
  }
  for (const key of ['okPattern', 'failPattern', 'match']) {
    const v = regex(raw, key, where, errors);
    if (v !== null) out[key] = v;
  }
  if (raw.maxAgeMin !== undefined && raw.maxAgeMin !== null) {
    if (typeof raw.maxAgeMin === 'number' && Number.isFinite(raw.maxAgeMin) && raw.maxAgeMin > 0) out.maxAgeMin = raw.maxAgeMin;
    else errors.push(`${where}: "maxAgeMin" should be a number of minutes above 0, got ${shown(raw.maxAgeMin)}; ignored.`);
  }
  const missing = NEEDS[out.type].filter(k => out[k] === undefined);
  if (missing.length) {
    errors.push(`${where}: a "${out.type}" status needs ${missing.map(k => `"${k}"`).join(' and ')}; no status is read.`);
    return null;
  }
  if (out.label && !LABEL_RE.test(out.label)) {
    errors.push(`${where}: "label" should be a launchd label like "com.example.job", got ${shown(out.label)}; no status is read.`);
    return null;
  }
  if (out.repo && !REPO_RE.test(out.repo)) {
    errors.push(`${where}: "repo" should be "owner/name", got ${shown(out.repo)}; no status is read.`);
    return null;
  }
  if (out.url) {
    const bad = httpUrlProblem(out.url);
    if (bad) {
      errors.push(`${where}: "url" ${bad}; no status is read.`);
      return null;
    }
  }
  return out;
}

/** `status` as a list of sources (one object or a list; missing = []). */
function normStatusList(raw, here, errors, types) {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((s, i) => normStatus(s, `${here} > status${Array.isArray(raw) ? `[${i}]` : ''}`, errors, types)).filter(Boolean);
}

/** Shared id / name / what checks of an automation or a service; null when skipped. */
function base(e, i, key, seen, errors) {
  const where = `${key}[${i}]`;
  if (!isPlainObject(e)) {
    errors.push(`${where}: should be an object with "id", "name" and "what", got ${shown(e)}; skipped.`);
    return null;
  }
  const eid = checkId(e, where, errors);
  if (eid === null) return null;
  const here = `${key.replace(/s$/, '')} "${eid}"`;
  if (seen.has(eid)) {
    errors.push(`${here}: the id "${eid}" is used twice in "${key}"; the second is skipped.`);
    return null;
  }
  seen.add(eid);
  const name = typeof e.name === 'string' && e.name ? e.name : eid;
  if (name === eid && e.name !== eid) errors.push(`${here}: "name" is missing; the id is shown instead.`);
  // Keys this file does not know are kept as they are (later features add their own, e.g. a map box).
  return { here, out: { ...e, id: eid, name, what: str(e, 'what', here, errors) } };
}

/** automations[]: { id, name, what, trigger, kind, group, status: [sources], docs }. */
export function normAutomations(raw, errors) {
  const seen = new Set();
  return objList(raw, 'automations', '', errors).map((e, i) => {
    const b = base(e, i, 'automations', seen, errors);
    if (!b) return null;
    const { here, out } = b;
    let kind = null;
    if (e.kind !== undefined && e.kind !== null) {
      if (AUTOMATION_KINDS.includes(e.kind)) kind = e.kind;
      else errors.push(`${here}: "kind" should be one of ${AUTOMATION_KINDS.join(', ')}, got ${shown(e.kind)}; ignored.`);
    }
    const group = strOrNull(e, 'group', here, errors);
    const run = normRun(e.run, here, errors);
    return {
      ...out,
      ...(run ? { run } : {}),
      trigger: str(e, 'trigger', here, errors),
      kind,
      group: group || (kind ? KIND_GROUPS[kind] : 'Other'),
      status: normStatusList(e.status, here, errors, AUTOMATION_STATUS_TYPES),
      docs: linkOrNull(e, 'docs', here, errors),
    };
  }).filter(Boolean);
}

/** services[]: { id, name, what, usedBy[], console, status: [sources], cost }. */
export function normServices(raw, errors, boxIds = null) {
  const seen = new Set();
  return objList(raw, 'services', '', errors).map((e, i) => {
    const b = base(e, i, 'services', seen, errors);
    if (!b) return null;
    const { here, out } = b;
    let usedBy = strList(e, 'usedBy', here, errors);
    if (boxIds) {
      const unknown = usedBy.filter(u => !boxIds.has(u));
      if (unknown.length) errors.push(`${here}: "usedBy" names ${unknown.map(u => `"${u}"`).join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not a group, area or part id; ignored.`);
      usedBy = usedBy.filter(u => boxIds.has(u));
    }
    let link = linkOrNull(e, 'console', here, errors);
    if (link && !/^https?:\/\//i.test(link)) {
      errors.push(`${here}: "console" should be a web address (https://...), got ${shown(link)}; ignored.`);
      link = null;
    }
    let cost = null;
    if (typeof e.cost === 'string') cost = e.cost;
    else if (isPlainObject(e.cost) && typeof e.cost.note === 'string') cost = e.cost.note;
    else if (e.cost !== undefined && e.cost !== null) errors.push(`${here}: "cost" should be text or { "note": "..." }, got ${shown(e.cost)}; ignored.`);
    return { ...out, usedBy, console: link, status: normStatusList(e.status, here, errors, SERVICE_STATUS_TYPES), cost };
  }).filter(Boolean);
}

/** lifecycle: { stages: [{ id, label?, hide? }] } -> the same, with known ids only (null when absent). */
export function normLifecycle(raw, errors) {
  const v = raw.lifecycle;
  if (v === undefined || v === null) return null;
  if (!isPlainObject(v)) {
    errors.push(`the file: "lifecycle" should be an object like { "stages": [{ "id": "ready", "label": "..." }] }, got ${shown(v)}; ignored.`);
    return null;
  }
  unknownKeys(v, ['stages'], 'lifecycle', errors);
  const stages = objList(v, 'stages', 'lifecycle', errors).map((s, i) => {
    const where = `lifecycle > stages[${i}]`;
    if (!isPlainObject(s) || !LIFECYCLE_STAGE_IDS.includes(s.id)) {
      errors.push(`${where}: "id" should be one of ${LIFECYCLE_STAGE_IDS.join(', ')}, got ${shown(isPlainObject(s) ? s.id : s)}; ignored.`);
      return null;
    }
    unknownKeys(s, ['id', 'label', 'hide'], where, errors);
    const out = { id: s.id };
    const label = strOrNull(s, 'label', where, errors);
    if (label) out.label = label;
    if (s.hide !== undefined) {
      if (typeof s.hide === 'boolean') out.hide = s.hide;
      else errors.push(`${where}: "hide" should be true or false, got ${shown(s.hide)}; ignored.`);
    }
    return out;
  }).filter(Boolean);
  return { stages };
}
