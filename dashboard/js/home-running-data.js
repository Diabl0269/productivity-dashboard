// home-running-data.js — the running-work data of the Home tab (PRO117), shared by every feature that
// shows a "running" dot or count. One fetch of /api/home/running per 15 s, and only while the Home tab is
// showing and the page is visible; the last good answer is kept when a fetch fails.
//
//   getRunning()          -> the last answer { project, at, running[], loose[], epics{}, byTicket{}, warnings[] } or null
//   onRunning(fn)         -> unsubscribe; fn(answer) after every new answer
//   runningFor(ticketId)  -> { state, since, sources, pr?, repo?, branch? } or null
//   epicRunState(epicId)  -> { state: 'running'|'stale'|'idle'|null, running[], lastTouched, inProgressSince } or null
//   refreshRunning()      -> Promise of the new answer (fetch now)
//   startRunning(isShowing) call once with a function that says whether Home is showing; starts the timer
//
// Features call `refreshRunningIfStale()` from their own redraws (Home redraws every 5 s while showing), so
// coming back to the tab fetches at once instead of waiting for the next tick.

import { getProject, subscribe } from './home-state.js';

export const RUNNING_POLL_MS = 15000;

let answer = null;
let answerProject = null;
let fetchedAt = 0;
let inflight = null;
let timer = null;
let showing = () => true;
const listeners = new Set();

export function getRunning() { return answer; }

export function onRunning(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function runningFor(ticketId) { return answer?.byTicket?.[ticketId] || null; }
export function epicRunState(epicId) { return answer?.epics?.[epicId] || null; }

function emit() {
  for (const fn of [...listeners]) {
    try { fn(answer); } catch (e) { console.error('Running listener failed:', e); }
  }
}

/** Fetch now (one request at a time; a second call shares the first). */
export function refreshRunning() {
  if (inflight) return inflight;
  const project = getProject();
  inflight = (async () => {
    try {
      const res = await fetch(`/api/home/running${project ? `?project=${encodeURIComponent(project)}` : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      const next = await res.json();
      const now = getProject();
      if (project && now && project !== now) return answer; // the project changed meanwhile: that answer is for another one
      answer = next;
      answerProject = next.project || project;
      fetchedAt = Date.now();
      emit();
    } catch (e) {
      if (answer) {
        const warning = `Running work could not be refreshed (${e.message}); showing the last answer.`;
        answer = { ...answer, warnings: [...(answer.warnings || []).filter(w => !w.startsWith('Running work could not')), warning] };
        emit();
      }
    } finally {
      inflight = null;
    }
    return answer;
  })();
  return inflight;
}

/** Fetch only when the last answer is older than the poll time (or is for another project). */
export function refreshRunningIfStale() {
  if (!showing() || document.hidden) return;
  const p = getProject();
  if ((p && answerProject !== p) || Date.now() - fetchedAt >= RUNNING_POLL_MS - 500) refreshRunning();
}

function tick() {
  if (showing() && !document.hidden) refreshRunning();
}

/** Start the 15 s poll (idempotent). `isShowing()` says whether the Home tab is the active tab. */
export function startRunning(isShowing) {
  if (typeof isShowing === 'function') showing = isShowing;
  if (timer) return;
  timer = setInterval(tick, RUNNING_POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshRunningIfStale(); });
  subscribe(e => {
    if (e.type === 'project') { answer = null; answerProject = null; emit(); refreshRunningIfStale(); }
    else if (e.type === 'tasks' || e.type === 'config') refreshRunningIfStale();
  });
  refreshRunningIfStale();
}
