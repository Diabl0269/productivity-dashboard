// home-health-data.js (PRO122, PRO123) — the automations and services of the Home project, with their status,
// for any Home view: GET /api/home/automations and /api/home/services, polled every 60 s while the page shows
// (the server caches for 60 s too), and again after 4 s while a slow reader still says "checking".
//
//   getRuns()      { project, automations: rows|null, services: rows|null, path, errors, loading, failed }
//   getHealth()    { automations: { ok, late, failed, off, unknown, checking }, services: { ... }, problems: [...] }
//   onHealth(fn)   fn() after every change; returns unsubscribe
//   loadRuns(project, { force })   fetch now (a project switch drops the old rows)
//   askProblems() / takeProblemsAsk()   the strip asks the How it runs view to open on "Only problems"

import { summarizeHealth } from '../../shared/home-config-runs.js';

const POLL_MS = 60e3;
const CHECKING_RETRY_MS = 4e3;

const state = { project: null, automations: null, services: null, path: null, errors: [], loading: false, failed: null, at: null };
const listeners = new Set();
let seq = 0;
let pollTimer = null;
let retryTimer = null;
let problemsAsked = false;

function emit() {
  for (const fn of [...listeners]) {
    try { fn(); } catch (e) { console.error('Home health listener failed:', e); }
  }
}

export function onHealth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRuns() { return state; }

/** Counts by state and the rows that need a look (late, failed or off). */
export function getHealth() {
  const a = summarizeHealth(state.automations || []);
  const s = summarizeHealth(state.services || []);
  return {
    automations: a.counts,
    services: s.counts,
    problems: [...a.problems.map(p => ({ ...p, kind: 'automation' })), ...s.problems.map(p => ({ ...p, kind: 'service' }))],
    known: state.automations !== null || state.services !== null,
  };
}

async function getJson(path, project, { fresh = false } = {}) {
  const qs = new URLSearchParams();
  if (project) qs.set('project', project);
  if (fresh) qs.set('fresh', '1');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`${path}${suffix}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
  return body;
}

const stillChecking = rows => (rows || []).some(r => r.result?.checking);

/** Fetch both lists for `project`; a project switch drops the old rows first. */
export async function loadRuns(project, { force = false, fresh = false } = {}) {
  if (project !== state.project) {
    Object.assign(state, { project, automations: null, services: null, path: null, errors: [], failed: null, at: null });
    emit();
  } else if (!force && state.loading) {
    return;
  }
  const my = ++seq;
  state.loading = true;
  startPolling();
  const [a, s] = await Promise.allSettled([getJson('/api/home/automations', project, { fresh }), getJson('/api/home/services', project, { fresh })]);
  if (my !== seq) return;
  state.loading = false;
  state.at = Date.now();
  state.failed = a.status === 'rejected' ? a.reason.message : s.status === 'rejected' ? s.reason.message : null;
  if (a.status === 'fulfilled') {
    state.automations = a.value.automations || [];
    state.path = a.value.path || null;
    state.errors = a.value.errors || [];
  }
  if (s.status === 'fulfilled') state.services = s.value.services || [];
  clearTimeout(retryTimer);
  if (stillChecking(state.automations) || stillChecking(state.services)) {
    retryTimer = setTimeout(() => loadRuns(state.project, { force: true }), CHECKING_RETRY_MS);
  }
  emit();
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && document.getElementById('homeMain')?.offsetParent) loadRuns(state.project, { force: true });
  }, POLL_MS);
}

/** The strip's "2 automations late": open How it runs filtered to problems. */
export function askProblems() { problemsAsked = true; emit(); }
export function takeProblemsAsk() { const v = problemsAsked; problemsAsked = false; return v; }

/** "1 automation failed · 2 late · 1 service down", or '' when nothing needs a look. */
export function healthLine(h = getHealth()) {
  const parts = [];
  const a = h.automations;
  const first = (n, word) => `${n} automation${n === 1 ? '' : 's'} ${word}`;
  let named = false;
  for (const [key, word] of [['failed', 'failed'], ['late', 'late'], ['off', 'off']]) {
    if (!a[key]) continue;
    parts.push(named ? `${a[key]} ${word}` : first(a[key], word));
    named = true;
  }
  const down = h.services.failed + h.services.late + h.services.off;
  if (down) parts.push(`${down} service${down === 1 ? '' : 's'} down`);
  return parts.join(' · ');
}
